#!/usr/bin/env python3
import json
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOST = "127.0.0.1"
PORT = 8000
USER_AGENT = "ChessAnalytics/1.0 (contact: chessalwaysfun@gmail.com)"

ARCHIVES_RE = re.compile(r"^/api/chesscom/player/([^/]+)/games/archives/?$")
ARCHIVE_MONTH_RE = re.compile(r"^/api/chesscom/player/([^/]+)/games/archive/(\d{4})/(\d{2})/?$")


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Keep local development simple when loading from this same server.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
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

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Serving on http://{HOST}:{PORT}")
    print(f"Chess.com proxy User-Agent: {USER_AGENT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
