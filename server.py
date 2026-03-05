#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http import cookies
from typing import Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))
USER_AGENT = "ChessAnalytics/1.0 (contact: chessalwaysfun@gmail.com)"
SESSION_COOKIE = "chess_analytics_session"
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
ALLOW_MULTIPLE_SESSIONS_PER_USER = False
DB_PATH = "auth.db"
RATE_LIMIT_WINDOW_SECONDS = 10 * 60
RATE_LIMIT_MAX_ATTEMPTS = 8
RATE_LIMIT_LOCK = threading.Lock()
RATE_LIMIT_BUCKETS = {}
RATE_LIMIT_PRUNE_INTERVAL_SECONDS = 5 * 60
RATE_LIMIT_LAST_PRUNE_AT = 0.0
MAX_JSON_BODY_BYTES = 16 * 1024
LOGIN_FAILURE_DELAY_SECONDS = 0.35
ACCOUNT_LOCKOUT_WINDOW_SECONDS = 15 * 60
ACCOUNT_LOCKOUT_MAX_FAILURES = 12
ACCOUNT_LOCKOUT_SECONDS = 15 * 60
ACCOUNT_LOCKOUT_LOCK = threading.Lock()
ACCOUNT_FAILURE_BUCKETS = {}
ACCOUNT_LOCKED_UNTIL = {}
ACCOUNT_LOCKOUT_PRUNE_INTERVAL_SECONDS = 5 * 60
ACCOUNT_LOCKOUT_LAST_PRUNE_AT = 0.0
LEGACY_PBKDF2_ITERATIONS = 120000
PBKDF2_ITERATIONS = 240000
PASSWORD_RESET_TOKEN_TTL_SECONDS = 15 * 60

ARCHIVES_RE = re.compile(r"^/api/chesscom/player/([^/]+)/games/archives/?$")
ARCHIVE_MONTH_RE = re.compile(r"^/api/chesscom/player/([^/]+)/games/archive/(\d{4})/(\d{2})/?$")
AUTH_REGISTER_RE = re.compile(r"^/api/auth/register/?$")
AUTH_LOGIN_RE = re.compile(r"^/api/auth/login/?$")
AUTH_LOGOUT_RE = re.compile(r"^/api/auth/logout/?$")
AUTH_ME_RE = re.compile(r"^/api/auth/me/?$")
AUTH_GUEST_RE = re.compile(r"^/api/auth/guest/?$")
AUTH_PASSWORD_RESET_REQUEST_RE = re.compile(r"^/api/auth/password-reset/request/?$")
AUTH_PASSWORD_RESET_CONFIRM_RE = re.compile(r"^/api/auth/password-reset/confirm/?$")
HEALTH_RE = re.compile(r"^/health/?$")
COMMON_WEAK_PASSWORDS = {
    "12345678",
    "123456789",
    "1234567890",
    "password",
    "password123",
    "qwerty123",
    "letmein",
    "admin123",
    "welcome123",
    "iloveyou",
}


class PayloadTooLargeError(Exception):
    pass


def log_runtime(message: str):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)


def get_instance_id() -> str:
    return (
        os.environ.get("RAILWAY_REPLICA_ID")
        or os.environ.get("RAILWAY_DEPLOYMENT_ID")
        or os.environ.get("HOSTNAME")
        or f"pid-{os.getpid()}"
    )


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        ensure_auth_schema(conn)


def ensure_auth_schema(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            iterations INTEGER NOT NULL DEFAULT 120000,
            created_at INTEGER NOT NULL
        )
        """
    )
    columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "iterations" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN iterations INTEGER NOT NULL DEFAULT 120000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            used_at INTEGER,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens(expires_at)")
    conn.commit()


def hash_password(password: str, salt_hex: str, iterations: int) -> str:
    salt = bytes.fromhex(salt_hex)
    password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return password_hash.hex()


def make_password_hash(password: str) -> Tuple[str, str, int]:
    salt = secrets.token_bytes(16).hex()
    return hash_password(password, salt, PBKDF2_ITERATIONS), salt, PBKDF2_ITERATIONS


def parse_json_body(handler: SimpleHTTPRequestHandler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        raise ValueError("invalid_content_length")
    if length > MAX_JSON_BODY_BYTES:
        raise PayloadTooLargeError("payload_too_large")
    if length <= 0:
        return {}
    body = handler.rfile.read(length)
    if len(body) > MAX_JSON_BODY_BYTES:
        raise PayloadTooLargeError("payload_too_large")
    return json.loads(body.decode("utf-8"))


def parse_session_token_from_headers(headers) -> Optional[str]:
    cookie_header = headers.get("Cookie")
    if not cookie_header:
        return None
    jar = cookies.SimpleCookie()
    jar.load(cookie_header)
    morsel = jar.get(SESSION_COOKIE)
    if not morsel:
        return None
    return morsel.value


def should_use_secure_cookie() -> bool:
    if os.environ.get("FORCE_SECURE_COOKIE") == "1":
        return True
    return os.environ.get("RAILWAY_ENVIRONMENT") == "production"


def build_session_cookie(token: str, max_age: int) -> str:
    parts = [f"{SESSION_COOKIE}={token}", "HttpOnly", "Path=/", f"Max-Age={max_age}", "SameSite=Lax"]
    if should_use_secure_cookie():
        parts.append("Secure")
    return "; ".join(parts)


def validate_password_policy(password: str) -> Optional[str]:
    if len(password) < 12:
        return "password_too_short"
    if password.lower() in COMMON_WEAK_PASSWORDS:
        return "password_too_weak"
    if not re.search(r"[A-Z]", password):
        return "password_missing_uppercase"
    if not re.search(r"[a-z]", password):
        return "password_missing_lowercase"
    if not re.search(r"[0-9]", password):
        return "password_missing_number"
    if not re.search(r"[^A-Za-z0-9]", password):
        return "password_missing_symbol"
    return None


def get_client_ip(handler: SimpleHTTPRequestHandler) -> str:
    # Railway/Proxy usually forwards real client IP via X-Forwarded-For.
    forwarded_for = handler.headers.get("X-Forwarded-For", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return handler.client_address[0] if handler.client_address else "unknown"


def check_rate_limit(action: str, client_ip: str, username: str) -> Optional[int]:
    global RATE_LIMIT_LAST_PRUNE_AT
    now = time.time()
    normalized_username = username.strip().lower() or "-"
    key = f"{action}:{client_ip}:{normalized_username}"
    with RATE_LIMIT_LOCK:
        if now - RATE_LIMIT_LAST_PRUNE_AT >= RATE_LIMIT_PRUNE_INTERVAL_SECONDS:
            cutoff = now - RATE_LIMIT_WINDOW_SECONDS
            for bucket_key in list(RATE_LIMIT_BUCKETS.keys()):
                kept = [ts for ts in RATE_LIMIT_BUCKETS[bucket_key] if ts >= cutoff]
                if kept:
                    RATE_LIMIT_BUCKETS[bucket_key] = kept
                else:
                    RATE_LIMIT_BUCKETS.pop(bucket_key, None)
            RATE_LIMIT_LAST_PRUNE_AT = now

        attempts = RATE_LIMIT_BUCKETS.get(key, [])
        attempts = [ts for ts in attempts if (now - ts) < RATE_LIMIT_WINDOW_SECONDS]
        if len(attempts) >= RATE_LIMIT_MAX_ATTEMPTS:
            retry_after = max(1, int(RATE_LIMIT_WINDOW_SECONDS - (now - attempts[0])))
            RATE_LIMIT_BUCKETS[key] = attempts
            return retry_after
        attempts.append(now)
        RATE_LIMIT_BUCKETS[key] = attempts
    return None


def clear_rate_limit(action: str, client_ip: str, username: str):
    normalized_username = username.strip().lower() or "-"
    key = f"{action}:{client_ip}:{normalized_username}"
    with RATE_LIMIT_LOCK:
        RATE_LIMIT_BUCKETS.pop(key, None)


def check_account_lockout(username: str) -> Optional[int]:
    global ACCOUNT_LOCKOUT_LAST_PRUNE_AT
    normalized_username = username.strip().lower() or "-"
    now = time.time()
    with ACCOUNT_LOCKOUT_LOCK:
        if now - ACCOUNT_LOCKOUT_LAST_PRUNE_AT >= ACCOUNT_LOCKOUT_PRUNE_INTERVAL_SECONDS:
            active_users = set(ACCOUNT_FAILURE_BUCKETS.keys()) | set(ACCOUNT_LOCKED_UNTIL.keys())
            failure_cutoff = now - ACCOUNT_LOCKOUT_WINDOW_SECONDS
            for user in list(active_users):
                attempts = ACCOUNT_FAILURE_BUCKETS.get(user, [])
                attempts = [ts for ts in attempts if ts >= failure_cutoff]
                if attempts:
                    ACCOUNT_FAILURE_BUCKETS[user] = attempts
                else:
                    ACCOUNT_FAILURE_BUCKETS.pop(user, None)

                locked_until_user = ACCOUNT_LOCKED_UNTIL.get(user, 0)
                if locked_until_user <= now:
                    ACCOUNT_LOCKED_UNTIL.pop(user, None)
            ACCOUNT_LOCKOUT_LAST_PRUNE_AT = now

        locked_until = ACCOUNT_LOCKED_UNTIL.get(normalized_username, 0)
        if locked_until > now:
            return max(1, int(locked_until - now))
        if normalized_username in ACCOUNT_LOCKED_UNTIL:
            ACCOUNT_LOCKED_UNTIL.pop(normalized_username, None)
    return None


def record_login_failure(username: str):
    normalized_username = username.strip().lower() or "-"
    now = time.time()
    with ACCOUNT_LOCKOUT_LOCK:
        attempts = ACCOUNT_FAILURE_BUCKETS.get(normalized_username, [])
        attempts = [ts for ts in attempts if (now - ts) < ACCOUNT_LOCKOUT_WINDOW_SECONDS]
        attempts.append(now)
        ACCOUNT_FAILURE_BUCKETS[normalized_username] = attempts
        if len(attempts) >= ACCOUNT_LOCKOUT_MAX_FAILURES:
            ACCOUNT_LOCKED_UNTIL[normalized_username] = now + ACCOUNT_LOCKOUT_SECONDS
            ACCOUNT_FAILURE_BUCKETS[normalized_username] = []
            log_runtime(
                f"Account lockout triggered. username={normalized_username}, "
                f"duration_seconds={ACCOUNT_LOCKOUT_SECONDS}"
            )


def clear_login_failures(username: str):
    normalized_username = username.strip().lower() or "-"
    with ACCOUNT_LOCKOUT_LOCK:
        ACCOUNT_FAILURE_BUCKETS.pop(normalized_username, None)
        ACCOUNT_LOCKED_UNTIL.pop(normalized_username, None)


def issue_password_reset_token(conn: sqlite3.Connection, user_id: int) -> str:
    now = int(time.time())
    token = secrets.token_urlsafe(32)
    expires_at = now + PASSWORD_RESET_TOKEN_TTL_SECONDS
    conn.execute(
        "DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ? OR used_at IS NOT NULL",
        (user_id, now),
    )
    conn.execute(
        """
        INSERT INTO password_reset_tokens (token, user_id, expires_at, used_at, created_at)
        VALUES (?, ?, ?, NULL, ?)
        """,
        (token, user_id, expires_at, now),
    )
    return token


def is_same_origin_request(handler: SimpleHTTPRequestHandler) -> bool:
    host = (handler.headers.get("Host") or "").strip().lower()
    if not host:
        return True

    origin = (handler.headers.get("Origin") or "").strip()
    referer = (handler.headers.get("Referer") or "").strip()

    # Non-browser clients may not send Origin/Referer.
    if not origin and not referer:
        return True

    if origin:
        parsed = urlparse(origin)
        return parsed.netloc.lower() == host

    parsed = urlparse(referer)
    return parsed.netloc.lower() == host


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Keep local development simple when loading from this same server.
        csp = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", csp)
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if should_use_secure_cookie():
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        super().end_headers()

    def do_GET(self):
        if HEALTH_RE.match(self.path):
            self._send_json(200, {"ok": True})
            return

        if AUTH_ME_RE.match(self.path):
            user = self._require_user(optional=True)
            if not user:
                self._send_json(401, {"error": "not_authenticated"})
                return
            self._send_json(200, {"username": user["username"]})
            return

        archives_match = ARCHIVES_RE.match(self.path)
        if archives_match:
            username = archives_match.group(1).lower()
            upstream = f"https://api.chess.com/pub/player/{username}/games/archives"
            self._proxy_json(upstream)
            return

        archive_match = ARCHIVE_MONTH_RE.match(self.path)
        if archive_match:
            username = archive_match.group(1).lower()
            year = int(archive_match.group(2))
            month = int(archive_match.group(3))

            if month < 1 or month > 12:
                self._send_json(400, {"error": "invalid month"})
                return

            upstream = f"https://api.chess.com/pub/player/{username}/games/{year}/{month:02d}"
            self._proxy_json(upstream)
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/") and not is_same_origin_request(self):
            self._send_json(403, {"error": "cross_origin_blocked"})
            return

        if AUTH_REGISTER_RE.match(self.path):
            self._handle_register()
            return
        if AUTH_LOGIN_RE.match(self.path):
            self._handle_login()
            return
        if AUTH_GUEST_RE.match(self.path):
            self._handle_guest_login()
            return
        if AUTH_LOGOUT_RE.match(self.path):
            self._handle_logout()
            return
        if AUTH_PASSWORD_RESET_REQUEST_RE.match(self.path):
            self._handle_password_reset_request()
            return
        if AUTH_PASSWORD_RESET_CONFIRM_RE.match(self.path):
            self._handle_password_reset_confirm()
            return

        self._send_json(404, {"error": "not_found"})

    def _handle_register(self):
        try:
            payload = parse_json_body(self)
        except PayloadTooLargeError:
            self._send_json(413, {"error": "payload_too_large"})
            return
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))
        client_ip = get_client_ip(self)
        retry_after = check_rate_limit("register", client_ip, username)
        if retry_after:
            self._send_json(429, {"error": "rate_limited", "retry_after": retry_after})
            return

        if not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", username):
            self._send_json(400, {"error": "invalid_username"})
            return
        password_error = validate_password_policy(password)
        if password_error:
            self._send_json(400, {"error": password_error})
            return

        password_hash, salt, iterations = make_password_hash(password)
        try:
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    "INSERT INTO users (username, password_hash, salt, iterations, created_at) VALUES (?, ?, ?, ?, ?)",
                    (username, password_hash, salt, iterations, int(time.time())),
                )
                conn.commit()
        except sqlite3.IntegrityError:
            self._send_json(409, {"error": "username_exists"})
            return

        clear_rate_limit("register", client_ip, username)
        self._send_json(201, {"ok": True})

    def _handle_login(self):
        try:
            payload = parse_json_body(self)
        except PayloadTooLargeError:
            self._send_json(413, {"error": "payload_too_large"})
            return
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))
        client_ip = get_client_ip(self)
        lockout_retry = check_account_lockout(username)
        if lockout_retry:
            self._send_json(429, {"error": "account_locked", "retry_after": lockout_retry})
            return
        retry_after = check_rate_limit("login", client_ip, username)
        if retry_after:
            self._send_json(429, {"error": "rate_limited", "retry_after": retry_after})
            return

        with sqlite3.connect(DB_PATH) as conn:
            ensure_auth_schema(conn)
            row = conn.execute(
                "SELECT id, username, password_hash, salt, iterations FROM users WHERE username = ?",
                (username,),
            ).fetchone()

            if not row:
                record_login_failure(username)
                time.sleep(LOGIN_FAILURE_DELAY_SECONDS)
                self._send_json(401, {"error": "invalid_credentials"})
                return

            user_id, db_username, db_hash, db_salt, db_iterations = row
            if not isinstance(db_iterations, int) or db_iterations <= 0:
                db_iterations = LEGACY_PBKDF2_ITERATIONS

            candidate_hash = hash_password(password, db_salt, db_iterations)
            if not hmac.compare_digest(candidate_hash, db_hash):
                record_login_failure(username)
                time.sleep(LOGIN_FAILURE_DELAY_SECONDS)
                self._send_json(401, {"error": "invalid_credentials"})
                return

            if db_iterations < PBKDF2_ITERATIONS:
                upgraded_hash = hash_password(password, db_salt, PBKDF2_ITERATIONS)
                conn.execute(
                    "UPDATE users SET password_hash = ?, iterations = ? WHERE id = ?",
                    (upgraded_hash, PBKDF2_ITERATIONS, user_id),
                )

            token = self._create_session(conn, user_id)

        clear_login_failures(username)
        clear_rate_limit("login", client_ip, username)
        extra_headers = [("Set-Cookie", build_session_cookie(token, SESSION_TTL_SECONDS))]
        self._send_json(200, {"ok": True, "username": db_username}, extra_headers=extra_headers)

    def _handle_guest_login(self):
        guest_username = "guest"
        with sqlite3.connect(DB_PATH) as conn:
            ensure_auth_schema(conn)
            row = conn.execute("SELECT id FROM users WHERE username = ?", (guest_username,)).fetchone()
            if row:
                guest_user_id = row[0]
            else:
                random_password = secrets.token_urlsafe(32)
                password_hash, salt, iterations = make_password_hash(random_password)
                conn.execute(
                    "INSERT INTO users (username, password_hash, salt, iterations, created_at) VALUES (?, ?, ?, ?, ?)",
                    (guest_username, password_hash, salt, iterations, int(time.time())),
                )
                guest_user_id = conn.execute("SELECT id FROM users WHERE username = ?", (guest_username,)).fetchone()[0]
                conn.commit()

            token = self._create_session(conn, guest_user_id)

        extra_headers = [("Set-Cookie", build_session_cookie(token, SESSION_TTL_SECONDS))]
        self._send_json(200, {"ok": True, "username": guest_username}, extra_headers=extra_headers)

    def _handle_logout(self):
        token = parse_session_token_from_headers(self.headers)
        if token:
            with sqlite3.connect(DB_PATH) as conn:
                ensure_auth_schema(conn)
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()

        extra_headers = [("Set-Cookie", build_session_cookie("", 0))]
        self._send_json(200, {"ok": True}, extra_headers=extra_headers)

    def _handle_password_reset_request(self):
        try:
            payload = parse_json_body(self)
        except PayloadTooLargeError:
            self._send_json(413, {"error": "payload_too_large"})
            return
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        username = str(payload.get("username", "")).strip()
        client_ip = get_client_ip(self)
        retry_after = check_rate_limit("password_reset_request", client_ip, username)
        if retry_after:
            self._send_json(429, {"error": "rate_limited", "retry_after": retry_after})
            return

        response_payload = {"ok": True}
        with sqlite3.connect(DB_PATH) as conn:
            ensure_auth_schema(conn)
            row = conn.execute("SELECT id, username FROM users WHERE username = ?", (username,)).fetchone()
            if row:
                user_id, db_username = row
                token = issue_password_reset_token(conn, user_id)
                conn.commit()
                # Demo workflow without email delivery: expose token in response.
                response_payload["reset_token"] = token
                log_runtime(
                    f"Password reset token issued. username={db_username}, "
                    f"expires_in_seconds={PASSWORD_RESET_TOKEN_TTL_SECONDS}"
                )
            else:
                # Keep response shape consistent to avoid easy username enumeration.
                response_payload["reset_token"] = secrets.token_urlsafe(32)

        self._send_json(200, response_payload)

    def _handle_password_reset_confirm(self):
        try:
            payload = parse_json_body(self)
        except PayloadTooLargeError:
            self._send_json(413, {"error": "payload_too_large"})
            return
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        token = str(payload.get("token", "")).strip()
        new_password = str(payload.get("new_password", ""))
        client_ip = get_client_ip(self)
        retry_after = check_rate_limit("password_reset_confirm", client_ip, token[:12] or "-")
        if retry_after:
            self._send_json(429, {"error": "rate_limited", "retry_after": retry_after})
            return

        password_error = validate_password_policy(new_password)
        if password_error:
            self._send_json(400, {"error": password_error})
            return

        if not token:
            self._send_json(400, {"error": "invalid_or_expired_token"})
            return

        now = int(time.time())
        with sqlite3.connect(DB_PATH) as conn:
            ensure_auth_schema(conn)
            row = conn.execute(
                """
                SELECT token, user_id, expires_at, used_at
                FROM password_reset_tokens
                WHERE token = ?
                """,
                (token,),
            ).fetchone()
            if not row:
                self._send_json(400, {"error": "invalid_or_expired_token"})
                return

            _, user_id, expires_at, used_at = row
            if used_at is not None or expires_at <= now:
                conn.execute("DELETE FROM password_reset_tokens WHERE token = ?", (token,))
                conn.commit()
                self._send_json(400, {"error": "invalid_or_expired_token"})
                return

            user_row = conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
            username = user_row[0] if user_row else ""

            password_hash, salt, iterations = make_password_hash(new_password)
            conn.execute(
                "UPDATE users SET password_hash = ?, salt = ?, iterations = ? WHERE id = ?",
                (password_hash, salt, iterations, user_id),
            )
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            conn.execute("UPDATE password_reset_tokens SET used_at = ? WHERE token = ?", (now, token))
            conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ? AND token != ?", (user_id, token))
            conn.commit()

        clear_login_failures(username)
        self._send_json(200, {"ok": True})

    def _create_session(self, conn: sqlite3.Connection, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        expires_at = int(time.time()) + SESSION_TTL_SECONDS
        if not ALLOW_MULTIPLE_SESSIONS_PER_USER:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", (token, user_id, expires_at))
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
        conn.commit()
        return token

    def _require_user(self, optional=False):
        token = parse_session_token_from_headers(self.headers)
        if not token:
            return None if optional else None

        with sqlite3.connect(DB_PATH) as conn:
            ensure_auth_schema(conn)
            row = conn.execute(
                """
                SELECT users.id, users.username, sessions.expires_at
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token = ?
                """,
                (token,),
            ).fetchone()
            if not row:
                return None

            user_id, username, expires_at = row
            now = int(time.time())
            if expires_at <= now:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
                return None

            return {"id": user_id, "username": username}

    def _proxy_json(self, url: str):
        req = Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json"
            },
        )

        try:
            with urlopen(req, timeout=15) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type", "application/json")
                self.send_response(response.status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as err:
            payload = {
                "error": "upstream_error",
                "status": err.code,
            }
            self._send_json(err.code, payload)
        except URLError:
            self._send_json(502, {"error": "upstream_unreachable"})

    def _send_json(self, status: int, payload: dict, extra_headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for header, value in extra_headers or []:
            self.send_header(header, value)
        self.end_headers()
        self.wfile.write(body)


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    instance_id = get_instance_id()

    def handle_signal(signum, _frame):
        signal_name = "SIGTERM" if signum == signal.SIGTERM else "SIGINT"
        log_runtime(f"Signal received: {signal_name}; shutting down. instance_id={instance_id}")
        server.shutdown()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    log_runtime(f"Starting server. instance_id={instance_id}")
    log_runtime(f"Serving on http://{HOST}:{PORT}")
    log_runtime(f"Chess.com proxy User-Agent: {USER_AGENT}")
    log_runtime(
        "Railway env: "
        + f"RAILWAY_ENVIRONMENT={os.environ.get('RAILWAY_ENVIRONMENT', '-')}, "
        + f"RAILWAY_PROJECT_ID={os.environ.get('RAILWAY_PROJECT_ID', '-')}, "
        + f"RAILWAY_SERVICE_ID={os.environ.get('RAILWAY_SERVICE_ID', '-')}, "
        + f"RAILWAY_DEPLOYMENT_ID={os.environ.get('RAILWAY_DEPLOYMENT_ID', '-')}, "
        + f"SecureCookie={should_use_secure_cookie()}"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
