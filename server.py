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
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))
USER_AGENT = "ChessAnalytics/1.0 (contact: chessalwaysfun@gmail.com)"
SESSION_COOKIE = "chess_analytics_session"
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
ALLOW_MULTIPLE_SESSIONS_PER_USER = False
DB_PATH = os.environ.get("DB_PATH", "auth.db").strip() or "auth.db"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_BACKEND = "postgres" if DATABASE_URL else "sqlite"
RATE_LIMIT_WINDOW_SECONDS = 10 * 60
RATE_LIMIT_MAX_ATTEMPTS = 8
RATE_LIMIT_LOCK = threading.Lock()
RATE_LIMIT_BUCKETS = {}
RATE_LIMIT_PRUNE_INTERVAL_SECONDS = 5 * 60
RATE_LIMIT_LAST_PRUNE_AT = 0.0
MAX_JSON_BODY_BYTES = 256 * 1024
PGN_ANALYSIS_MAX_CHARS = 120000
PGN_ANALYSIS_MAX_PLIES = 400
PGN_ANALYSIS_MIN_DEPTH = 8
PGN_ANALYSIS_MAX_DEPTH = 20
STOCKFISH_API_URL = "https://chess-api.com/v1"
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
PASSWORD_RESET_PROVIDER = os.environ.get("PASSWORD_RESET_PROVIDER", "").strip().lower()
PASSWORD_RESET_FROM_EMAIL = os.environ.get("PASSWORD_RESET_FROM_EMAIL", "").strip()
PASSWORD_RESET_PAGE_URL = os.environ.get("PASSWORD_RESET_PAGE_URL", "").strip()
SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "").strip()
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
DEBUG_RESET_TOKEN_RESPONSE = os.environ.get("DEBUG_RESET_TOKEN_RESPONSE", "0") == "1"
ADMIN_REPORT_TOKEN = os.environ.get("ADMIN_REPORT_TOKEN", "").strip()
DAILY_REPORT_RECIPIENT = "chessalwaysfun@gmail.com"

ARCHIVES_RE = re.compile(r"^/api/chesscom/player/([^/]+)/games/archives/?$")
ARCHIVE_MONTH_RE = re.compile(r"^/api/chesscom/player/([^/]+)/games/archive/(\d{4})/(\d{2})/?$")
AUTH_REGISTER_RE = re.compile(r"^/api/auth/register/?$")
AUTH_LOGIN_RE = re.compile(r"^/api/auth/login/?$")
AUTH_LOGOUT_RE = re.compile(r"^/api/auth/logout/?$")
AUTH_ME_RE = re.compile(r"^/api/auth/me/?$")
AUTH_GUEST_RE = re.compile(r"^/api/auth/guest/?$")
AUTH_UPDATE_EMAIL_RE = re.compile(r"^/api/auth/profile/email/?$")
AUTH_PASSWORD_RESET_REQUEST_RE = re.compile(r"^/api/auth/password-reset/request/?$")
AUTH_PASSWORD_RESET_CONFIRM_RE = re.compile(r"^/api/auth/password-reset/confirm/?$")
ADMIN_DAILY_REPORT_RE = re.compile(r"^/api/admin/daily-report/?$")
ANALYSIS_PGN_EVAL_RE = re.compile(r"^/api/analysis/pgn-eval/?$")
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
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

try:
    import psycopg  # type: ignore
except Exception:
    psycopg = None


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
    with connect_db() as conn:
        ensure_auth_schema(conn)


class PostgresCompatConnection:
    def __init__(self, raw_conn):
        self.raw_conn = raw_conn

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is None:
                self.raw_conn.commit()
            else:
                self.raw_conn.rollback()
        finally:
            self.raw_conn.close()
        return False

    def execute(self, sql: str, params: Tuple[Any, ...] = ()):
        cur = self.raw_conn.cursor()
        cur.execute(sql.replace("?", "%s"), params)
        return cur

    def commit(self):
        self.raw_conn.commit()


def connect_db():
    if DB_BACKEND == "postgres":
        if not psycopg:
            raise RuntimeError("DATABASE_URL is set but psycopg is not installed.")
        raw_conn = psycopg.connect(DATABASE_URL)
        return PostgresCompatConnection(raw_conn)
    return sqlite3.connect(DB_PATH)


def ensure_auth_schema(conn):
    if DB_BACKEND == "postgres":
        return ensure_auth_schema_postgres(conn)
    return ensure_auth_schema_sqlite(conn)


def ensure_auth_schema_sqlite(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            iterations INTEGER NOT NULL DEFAULT 120000,
            created_at INTEGER NOT NULL
        )
        """
    )
    columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "email" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS login_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            login_at INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS page_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            client_ip TEXT NOT NULL,
            viewed_at INTEGER NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens(expires_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_login_events_login_at ON login_events(login_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_login_events_username ON login_events(username)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_page_views_client_ip ON page_views(client_ip)")
    conn.commit()


def ensure_auth_schema_postgres(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            email TEXT,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            iterations INTEGER NOT NULL DEFAULT 120000,
            created_at BIGINT NOT NULL
        )
        """
    )
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS iterations INTEGER NOT NULL DEFAULT 120000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id),
            expires_at BIGINT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token TEXT PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id),
            expires_at BIGINT NOT NULL,
            used_at BIGINT,
            created_at BIGINT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS login_events (
            id BIGSERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            login_at BIGINT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS page_views (
            id BIGSERIAL PRIMARY KEY,
            path TEXT NOT NULL,
            client_ip TEXT NOT NULL,
            viewed_at BIGINT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens(expires_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_login_events_login_at ON login_events(login_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_login_events_username ON login_events(username)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_page_views_client_ip ON page_views(client_ip)")
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


def validate_email(email: str) -> bool:
    return bool(EMAIL_RE.fullmatch(email))


def build_password_reset_link(token: str) -> str:
    if PASSWORD_RESET_PAGE_URL:
        base = PASSWORD_RESET_PAGE_URL
    elif os.environ.get("RAILWAY_PUBLIC_DOMAIN"):
        base = f"https://{os.environ.get('RAILWAY_PUBLIC_DOMAIN')}/forgot-password.html"
    else:
        base = f"http://localhost:{PORT}/forgot-password.html"
    separator = "&" if "?" in base else "?"
    return f"{base}{separator}{urlencode({'reset_token': token})}"


def send_email_via_provider(to_email: str, subject: str, text_body: str, html_body: str, context: str) -> bool:
    if not PASSWORD_RESET_FROM_EMAIL:
        log_runtime(f"{context} email not sent: PASSWORD_RESET_FROM_EMAIL is missing.")
        return False

    if PASSWORD_RESET_PROVIDER == "sendgrid":
        if not SENDGRID_API_KEY:
            log_runtime(f"{context} email not sent: SENDGRID_API_KEY is missing.")
            return False
        payload = {
            "personalizations": [{"to": [{"email": to_email}]}],
            "from": {"email": PASSWORD_RESET_FROM_EMAIL},
            "subject": subject,
            "content": [
                {"type": "text/plain", "value": text_body},
                {"type": "text/html", "value": html_body},
            ],
        }
        req = Request(
            "https://api.sendgrid.com/v3/mail/send",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {SENDGRID_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )
    elif PASSWORD_RESET_PROVIDER == "resend":
        if not RESEND_API_KEY:
            log_runtime(f"{context} email not sent: RESEND_API_KEY is missing.")
            return False
        payload = {
            "from": PASSWORD_RESET_FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "text": text_body,
            "html": html_body,
        }
        req = Request(
            "https://api.resend.com/emails",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )
    else:
        log_runtime(f"{context} email not sent: PASSWORD_RESET_PROVIDER not set to sendgrid/resend.")
        return False

    try:
        with urlopen(req, timeout=15) as response:
            return 200 <= response.status < 300
    except HTTPError as err:
        details = ""
        try:
            details = err.read().decode("utf-8", errors="ignore")
        except Exception:
            details = ""
        log_runtime(f"{context} email send failed: status={err.code}, body={details}")
        return False
    except Exception as exc:
        log_runtime(f"{context} email send failed: {exc}")
        return False


def send_password_reset_email(email: str, username: str, token: str) -> bool:
    reset_link = build_password_reset_link(token)
    subject = "ChessAnalytics password reset"
    text_body = (
        f"Hi {username},\n\n"
        "A password reset was requested for your account.\n"
        f"Reset link (valid {PASSWORD_RESET_TOKEN_TTL_SECONDS // 60} minutes):\n{reset_link}\n\n"
        "If you did not request this, you can ignore this email."
    )
    html_body = (
        f"<p>Hi {username},</p>"
        "<p>A password reset was requested for your account.</p>"
        f"<p><a href=\"{reset_link}\">Reset password</a> "
        f"(valid {PASSWORD_RESET_TOKEN_TTL_SECONDS // 60} minutes)</p>"
        "<p>If you did not request this, you can ignore this email.</p>"
    )
    return send_email_via_provider(email, subject, text_body, html_body, "Password reset")


def send_daily_login_report_email(
    report_date: str,
    total_logins: int,
    unique_users: int,
    guest_logins: int,
    total_page_views: int,
    unique_visitors: int,
) -> bool:
    member_logins = total_logins - guest_logins
    subject = f"ChessAnalytics daily login report - {report_date}"
    text_body = (
        f"Daily login report for {report_date} (UTC)\n\n"
        f"Total page views: {total_page_views}\n"
        f"Unique visitors (by IP): {unique_visitors}\n"
        "\n"
        f"Total logins: {total_logins}\n"
        f"Unique usernames: {unique_users}\n"
        f"Guest logins: {guest_logins}\n"
        f"Member logins: {member_logins}\n"
    )
    html_body = (
        f"<p>Daily login report for <strong>{report_date}</strong> (UTC)</p>"
        "<ul>"
        f"<li>Total page views: {total_page_views}</li>"
        f"<li>Unique visitors (by IP): {unique_visitors}</li>"
        f"<li>Total logins: {total_logins}</li>"
        f"<li>Unique usernames: {unique_users}</li>"
        f"<li>Guest logins: {guest_logins}</li>"
        f"<li>Member logins: {member_logins}</li>"
        "</ul>"
    )
    return send_email_via_provider(
        DAILY_REPORT_RECIPIENT,
        subject,
        text_body,
        html_body,
        "Daily login report",
    )


def is_password_reset_service_configured() -> bool:
    if not PASSWORD_RESET_FROM_EMAIL:
        return False
    if PASSWORD_RESET_PROVIDER == "sendgrid":
        return bool(SENDGRID_API_KEY)
    if PASSWORD_RESET_PROVIDER == "resend":
        return bool(RESEND_API_KEY)
    return False


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


def record_login_event(conn: sqlite3.Connection, username: str):
    conn.execute(
        "INSERT INTO login_events (username, login_at) VALUES (?, ?)",
        ((username or "").strip().lower() or "-", int(time.time())),
    )


def should_track_page_view(path: str) -> bool:
    parsed_path = (urlparse(path).path or "").strip()
    if not parsed_path:
        return False
    if parsed_path.startswith("/api/") or parsed_path == "/health":
        return False
    if parsed_path == "/":
        return True
    return parsed_path.endswith(".html")


def record_page_view(conn: sqlite3.Connection, path: str, client_ip: str):
    parsed_path = (urlparse(path).path or "").strip() or "/"
    normalized_ip = (client_ip or "").strip() or "-"
    conn.execute(
        "INSERT INTO page_views (path, client_ip, viewed_at) VALUES (?, ?, ?)",
        (parsed_path, normalized_ip, int(time.time())),
    )


def extract_pgn_moves_text(pgn_text: str) -> str:
    lines = [line.strip() for line in pgn_text.splitlines()]
    move_lines = [line for line in lines if line and not line.startswith("[")]
    return " ".join(move_lines).strip()


def parse_san_moves(moves_text: str) -> List[str]:
    result_tokens = {"1-0", "0-1", "1/2-1/2", "*"}
    text = re.sub(r"\{[^}]*\}", " ", moves_text)
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\$\d+", " ", text)
    tokens = re.split(r"\s+", text.strip())
    moves: List[str] = []
    for token in tokens:
        token = token.strip()
        if not token or token in result_tokens:
            continue
        if re.fullmatch(r"\d+\.(\.\.)?", token):
            continue
        token = re.sub(r"^\d+\.(\.\.)?", "", token).strip()
        if not token or token in result_tokens:
            continue
        moves.append(token)
    return moves


def build_pgn_prefix(moves: List[str]) -> str:
    parts: List[str] = []
    move_no = 1
    for i in range(0, len(moves), 2):
        white = moves[i]
        black = moves[i + 1] if i + 1 < len(moves) else None
        if black:
            parts.append(f"{move_no}. {white} {black}")
        else:
            parts.append(f"{move_no}. {white}")
        move_no += 1
    return " ".join(parts)


def request_stockfish_eval(pgn_prefix: str, depth: int) -> Dict:
    payload = {"input": pgn_prefix, "depth": depth}
    req = Request(
        STOCKFISH_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_eval_score(data: Dict) -> str:
    eval_value = data.get("eval")
    centipawns = data.get("centipawns")
    mate = data.get("mate")
    if isinstance(eval_value, (int, float)):
        return str(eval_value)
    if isinstance(centipawns, int):
        return f"{centipawns / 100:.2f}"
    if isinstance(mate, int):
        return f"mate {mate}"
    return ""


def analyze_pgn_rows(pgn_text: str, depth: int) -> Tuple[List[Dict[str, str]], int]:
    moves_text = extract_pgn_moves_text(pgn_text)
    san_moves = parse_san_moves(moves_text)[:PGN_ANALYSIS_MAX_PLIES]
    rows: List[Dict[str, str]] = []
    progressive: List[str] = []
    failed_count = 0
    for ply, san in enumerate(san_moves, start=1):
        progressive.append(san)
        pgn_prefix = build_pgn_prefix(progressive)
        row = {
            "move_number": str((ply + 1) // 2),
            "side": "white" if ply % 2 == 1 else "black",
            "move": san,
            "eval_score": "",
        }
        try:
            data = request_stockfish_eval(pgn_prefix, depth)
            row["eval_score"] = normalize_eval_score(data)
        except Exception:
            failed_count += 1
            row["eval_score"] = ""
        rows.append(row)
    return rows, failed_count


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

        if should_track_page_view(self.path):
            try:
                client_ip = get_client_ip(self)
                with connect_db() as conn:
                    ensure_auth_schema(conn)
                    record_page_view(conn, self.path, client_ip)
                    conn.commit()
            except Exception as exc:
                log_runtime(f"Page view tracking failed: {exc}")

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
        if AUTH_UPDATE_EMAIL_RE.match(self.path):
            self._handle_update_email()
            return
        if AUTH_PASSWORD_RESET_REQUEST_RE.match(self.path):
            self._handle_password_reset_request()
            return
        if AUTH_PASSWORD_RESET_CONFIRM_RE.match(self.path):
            self._handle_password_reset_confirm()
            return
        if ADMIN_DAILY_REPORT_RE.match(self.path):
            self._handle_daily_login_report()
            return
        if ANALYSIS_PGN_EVAL_RE.match(self.path):
            self._handle_pgn_eval_analysis()
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
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        client_ip = get_client_ip(self)
        retry_after = check_rate_limit("register", client_ip, username)
        if retry_after:
            self._send_json(429, {"error": "rate_limited", "retry_after": retry_after})
            return

        if not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", username):
            self._send_json(400, {"error": "invalid_username"})
            return
        if not email:
            self._send_json(400, {"error": "email_required"})
            return
        if not validate_email(email):
            self._send_json(400, {"error": "invalid_email"})
            return
        password_error = validate_password_policy(password)
        if password_error:
            self._send_json(400, {"error": password_error})
            return

        password_hash, salt, iterations = make_password_hash(password)
        try:
            with connect_db() as conn:
                conn.execute(
                    "INSERT INTO users (username, email, password_hash, salt, iterations, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (username, email, password_hash, salt, iterations, int(time.time())),
                )
                conn.commit()
        except Exception:
            with connect_db() as conn:
                row = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
                if row:
                    self._send_json(409, {"error": "username_exists"})
                    return
                row = conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
                if row:
                    self._send_json(409, {"error": "email_exists"})
                    return
            self._send_json(409, {"error": "register_conflict"})
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

        with connect_db() as conn:
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
            record_login_event(conn, db_username)
            conn.commit()

        clear_login_failures(username)
        clear_rate_limit("login", client_ip, username)
        extra_headers = [("Set-Cookie", build_session_cookie(token, SESSION_TTL_SECONDS))]
        self._send_json(200, {"ok": True, "username": db_username}, extra_headers=extra_headers)

    def _handle_guest_login(self):
        guest_username = "guest"
        with connect_db() as conn:
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
            record_login_event(conn, guest_username)
            conn.commit()

        extra_headers = [("Set-Cookie", build_session_cookie(token, SESSION_TTL_SECONDS))]
        self._send_json(200, {"ok": True, "username": guest_username}, extra_headers=extra_headers)

    def _handle_logout(self):
        token = parse_session_token_from_headers(self.headers)
        if token:
            with connect_db() as conn:
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

        provider_ready = is_password_reset_service_configured()
        response_payload = {"ok": True}
        if provider_ready:
            response_payload["delivery_status"] = "accepted"
            response_payload["message"] = "If the account exists, a reset email has been sent."
        else:
            response_payload["delivery_status"] = "service_not_configured"
            response_payload["message"] = "Password reset email service is not configured."

        delivery_detail = "not_attempted"
        with connect_db() as conn:
            ensure_auth_schema(conn)
            row = conn.execute("SELECT id, username, email FROM users WHERE username = ?", (username,)).fetchone()
            if row:
                user_id, db_username, db_email = row
                token = issue_password_reset_token(conn, user_id)
                conn.commit()
                if db_email and validate_email(db_email):
                    email_sent = False
                    if provider_ready:
                        email_sent = send_password_reset_email(db_email, db_username, token)
                    log_runtime(
                        f"Password reset requested. username={db_username}, "
                        f"email_sent={email_sent}, expires_in_seconds={PASSWORD_RESET_TOKEN_TTL_SECONDS}"
                    )
                    delivery_detail = "sent" if email_sent else "send_failed"
                    if DEBUG_RESET_TOKEN_RESPONSE:
                        response_payload["reset_token"] = token
                else:
                    log_runtime(
                        f"Password reset requested but no valid email found. username={db_username}"
                    )
                    delivery_detail = "missing_email"
                    if DEBUG_RESET_TOKEN_RESPONSE:
                        response_payload["reset_token"] = token
            else:
                delivery_detail = "no_user"

        if DEBUG_RESET_TOKEN_RESPONSE:
            response_payload["delivery_status_detail"] = delivery_detail

        log_runtime(
            "Password reset request result: "
            + f"username={username or '-'}, "
            + f"provider_ready={provider_ready}, "
            + f"delivery_status={response_payload.get('delivery_status', '-')}, "
            + f"detail={delivery_detail}"
        )
        self._send_json(200, response_payload)

    def _handle_update_email(self):
        user = self._require_user(optional=True)
        if not user:
            self._send_json(401, {"error": "not_authenticated"})
            return

        try:
            payload = parse_json_body(self)
        except PayloadTooLargeError:
            self._send_json(413, {"error": "payload_too_large"})
            return
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        email = str(payload.get("email", "")).strip().lower()
        if not email:
            self._send_json(400, {"error": "email_required"})
            return
        if not validate_email(email):
            self._send_json(400, {"error": "invalid_email"})
            return

        client_ip = get_client_ip(self)
        retry_after = check_rate_limit("update_email", client_ip, user["username"])
        if retry_after:
            self._send_json(429, {"error": "rate_limited", "retry_after": retry_after})
            return

        try:
            with connect_db() as conn:
                ensure_auth_schema(conn)
                conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, user["id"]))
                conn.commit()
        except Exception:
            self._send_json(409, {"error": "email_exists"})
            return

        self._send_json(200, {"ok": True, "email": email})

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
        with connect_db() as conn:
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

    def _handle_daily_login_report(self):
        if not ADMIN_REPORT_TOKEN:
            self._send_json(503, {"error": "admin_report_token_not_configured"})
            return

        provided_token = (self.headers.get("X-Admin-Token") or "").strip()
        if not provided_token or not hmac.compare_digest(provided_token, ADMIN_REPORT_TOKEN):
            self._send_json(401, {"error": "unauthorized"})
            return

        now = int(time.time())
        today_start = now - (now % 86400)
        yesterday_start = today_start - 86400
        report_date = time.strftime("%Y-%m-%d", time.gmtime(yesterday_start))

        with connect_db() as conn:
            ensure_auth_schema(conn)
            total_logins = conn.execute(
                "SELECT COUNT(*) FROM login_events WHERE login_at >= ? AND login_at < ?",
                (yesterday_start, today_start),
            ).fetchone()[0]
            unique_users = conn.execute(
                "SELECT COUNT(DISTINCT username) FROM login_events WHERE login_at >= ? AND login_at < ?",
                (yesterday_start, today_start),
            ).fetchone()[0]
            guest_logins = conn.execute(
                """
                SELECT COUNT(*) FROM login_events
                WHERE login_at >= ? AND login_at < ? AND username = 'guest'
                """,
                (yesterday_start, today_start),
            ).fetchone()[0]
            total_page_views = conn.execute(
                "SELECT COUNT(*) FROM page_views WHERE viewed_at >= ? AND viewed_at < ?",
                (yesterday_start, today_start),
            ).fetchone()[0]
            unique_visitors = conn.execute(
                "SELECT COUNT(DISTINCT client_ip) FROM page_views WHERE viewed_at >= ? AND viewed_at < ?",
                (yesterday_start, today_start),
            ).fetchone()[0]

        email_sent = send_daily_login_report_email(
            report_date=report_date,
            total_logins=total_logins,
            unique_users=unique_users,
            guest_logins=guest_logins,
            total_page_views=total_page_views,
            unique_visitors=unique_visitors,
        )
        log_runtime(
            "Daily login report result: "
            + f"date={report_date}, total_logins={total_logins}, unique_users={unique_users}, "
            + f"guest_logins={guest_logins}, page_views={total_page_views}, "
            + f"unique_visitors={unique_visitors}, sent={email_sent}"
        )
        if not email_sent:
            self._send_json(502, {"error": "email_send_failed"})
            return

        self._send_json(
            200,
            {
                "ok": True,
                "date": report_date,
                "total_logins": total_logins,
                "unique_users": unique_users,
                "guest_logins": guest_logins,
                "total_page_views": total_page_views,
                "unique_visitors": unique_visitors,
                "recipient": DAILY_REPORT_RECIPIENT,
            },
        )

    def _handle_pgn_eval_analysis(self):
        try:
            payload = parse_json_body(self)
        except PayloadTooLargeError:
            self._send_json(413, {"error": "payload_too_large"})
            return
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        pgn_text = str(payload.get("pgn_text", "")).strip()
        depth_raw = payload.get("depth", 12)
        try:
            depth = int(depth_raw)
        except (TypeError, ValueError):
            depth = 12
        depth = max(PGN_ANALYSIS_MIN_DEPTH, min(PGN_ANALYSIS_MAX_DEPTH, depth))

        if not pgn_text:
            self._send_json(400, {"error": "pgn_required"})
            return
        if len(pgn_text) > PGN_ANALYSIS_MAX_CHARS:
            self._send_json(400, {"error": "pgn_too_large", "max_chars": PGN_ANALYSIS_MAX_CHARS})
            return
        # Basic format validation: if no SAN-like moves can be parsed, reject as invalid PGN.
        moves_text = extract_pgn_moves_text(pgn_text)
        parsed_moves = parse_san_moves(moves_text)
        if len(parsed_moves) == 0:
            self._send_json(400, {"error": "invalid_pgn_format"})
            return

        client_ip = get_client_ip(self)
        retry_after = check_rate_limit("pgn_eval_analysis", client_ip, "-")
        if retry_after:
            self._send_json(429, {"error": "rate_limited", "retry_after": retry_after})
            return

        rows, failed_count = analyze_pgn_rows(pgn_text, depth)
        self._send_json(
            200,
            {
                "ok": True,
                "depth": depth,
                "rows": rows,
                "rows_count": len(rows),
                "failed_eval_count": failed_count,
            },
        )

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

        with connect_db() as conn:
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
    if DB_BACKEND == "postgres":
        log_runtime("Database backend: postgres (DATABASE_URL)")
    else:
        log_runtime(f"Database backend: sqlite ({DB_PATH})")
    log_runtime(
        "Password reset email config: "
        + f"provider={PASSWORD_RESET_PROVIDER or '-'}, "
        + f"from_set={bool(PASSWORD_RESET_FROM_EMAIL)}, "
        + f"page_url_set={bool(PASSWORD_RESET_PAGE_URL)}, "
        + f"debug_token_response={DEBUG_RESET_TOKEN_RESPONSE}"
    )
    log_runtime(
        "Daily report config: "
        + f"admin_token_set={bool(ADMIN_REPORT_TOKEN)}, "
        + f"recipient={DAILY_REPORT_RECIPIENT}"
    )
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
