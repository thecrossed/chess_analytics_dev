#!/usr/bin/env python3
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http import cookies
from typing import Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))
USER_AGENT = "ChessAnalytics/1.0 (contact: chessalwaysfun@gmail.com)"
SESSION_COOKIE = "chess_analytics_session"
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
DB_PATH = "auth.db"

ARCHIVES_RE = re.compile(r"^/api/chesscom/player/([^/]+)/games/archives/?$")
ARCHIVE_MONTH_RE = re.compile(r"^/api/chesscom/player/([^/]+)/games/archive/(\d{4})/(\d{2})/?$")
AUTH_REGISTER_RE = re.compile(r"^/api/auth/register/?$")
AUTH_LOGIN_RE = re.compile(r"^/api/auth/login/?$")
AUTH_LOGOUT_RE = re.compile(r"^/api/auth/logout/?$")
AUTH_ME_RE = re.compile(r"^/api/auth/me/?$")
AUTH_GUEST_RE = re.compile(r"^/api/auth/guest/?$")


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
            created_at INTEGER NOT NULL
        )
        """
    )
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
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")
    conn.commit()


def hash_password(password: str, salt_hex: str) -> str:
    salt = bytes.fromhex(salt_hex)
    password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return password_hash.hex()


def make_password_hash(password: str) -> Tuple[str, str]:
    salt = secrets.token_bytes(16).hex()
    return hash_password(password, salt), salt


def parse_json_body(handler: SimpleHTTPRequestHandler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    body = handler.rfile.read(length)
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


def set_session_cookie(handler: SimpleHTTPRequestHandler, token: str):
    handler.send_header(
        "Set-Cookie",
        f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={SESSION_TTL_SECONDS}; SameSite=Lax",
    )


def clear_session_cookie(handler: SimpleHTTPRequestHandler):
    handler.send_header(
        "Set-Cookie",
        f"{SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax",
    )


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Keep local development simple when loading from this same server.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
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

        self._send_json(404, {"error": "not_found"})

    def _handle_register(self):
        try:
            payload = parse_json_body(self)
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))
        if not re.fullmatch(r"[A-Za-z0-9_-]{3,32}", username):
            self._send_json(400, {"error": "invalid_username"})
            return
        if len(password) < 8:
            self._send_json(400, {"error": "password_too_short"})
            return

        password_hash, salt = make_password_hash(password)
        try:
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    "INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
                    (username, password_hash, salt, int(time.time())),
                )
                conn.commit()
        except sqlite3.IntegrityError:
            self._send_json(409, {"error": "username_exists"})
            return

        self._send_json(201, {"ok": True})

    def _handle_login(self):
        try:
            payload = parse_json_body(self)
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))
        with sqlite3.connect(DB_PATH) as conn:
            ensure_auth_schema(conn)
            row = conn.execute(
                "SELECT id, username, password_hash, salt FROM users WHERE username = ?",
                (username,),
            ).fetchone()

            if not row:
                self._send_json(401, {"error": "invalid_credentials"})
                return

            user_id, db_username, db_hash, db_salt = row
            if hash_password(password, db_salt) != db_hash:
                self._send_json(401, {"error": "invalid_credentials"})
                return

            token = self._create_session(conn, user_id)

        extra_headers = [("Set-Cookie", f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={SESSION_TTL_SECONDS}; SameSite=Lax")]
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
                password_hash, salt = make_password_hash(random_password)
                conn.execute(
                    "INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
                    (guest_username, password_hash, salt, int(time.time())),
                )
                guest_user_id = conn.execute("SELECT id FROM users WHERE username = ?", (guest_username,)).fetchone()[0]
                conn.commit()

            token = self._create_session(conn, guest_user_id)

        extra_headers = [("Set-Cookie", f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={SESSION_TTL_SECONDS}; SameSite=Lax")]
        self._send_json(200, {"ok": True, "username": guest_username}, extra_headers=extra_headers)

    def _handle_logout(self):
        token = parse_session_token_from_headers(self.headers)
        if token:
            with sqlite3.connect(DB_PATH) as conn:
                ensure_auth_schema(conn)
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()

        extra_headers = [("Set-Cookie", f"{SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax")]
        self._send_json(200, {"ok": True}, extra_headers=extra_headers)

    def _create_session(self, conn: sqlite3.Connection, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        expires_at = int(time.time()) + SESSION_TTL_SECONDS
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
    print(f"Serving on http://{HOST}:{PORT}")
    print(f"Chess.com proxy User-Agent: {USER_AGENT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
