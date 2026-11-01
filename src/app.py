#!/usr/bin/env python3
"""TraceIQ server: JSON API over the generated dataset plus the built web app.

    python src/app.py --out out --port 3000

The generated dataset is opened read-only; user actions persist to out/ops.db.
The React application is served from web/dist with an SPA fallback.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from api import Api  # noqa: E402

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
}

MAX_BODY = 1_000_000


def build_handler(outdir, webdir):
    webdir = os.path.abspath(webdir)
    api = Api(outdir)
    index_path = os.path.join(webdir, "index.html")

    class Handler(BaseHTTPRequestHandler):
        server_version = "TraceIQ/2.0"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

        # ------------------------------------------------------------ helpers
        def _common_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "SAMEORIGIN")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
                "frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
            )

        def send_json(self, payload, status=200):
            body = json.dumps(payload, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._common_headers()
            self.end_headers()
            self.wfile.write(body)

        def send_file(self, path, cache="no-cache"):
            try:
                with open(path, "rb") as fh:
                    body = fh.read()
            except OSError:
                return self.send_json({"error": "not found"}, 404)
            ext = os.path.splitext(path)[1].lower()
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(ext,
                                                       mimetypes.guess_type(path)[0] or
                                                       "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self._common_headers()
            self.end_headers()
            self.wfile.write(body)

        def _same_origin(self):
            origin = self.headers.get("Origin")
            if not origin:
                return True
            host = self.headers.get("Host", "")
            return origin in (f"http://{host}", f"https://{host}")

        # -------------------------------------------------------------- routes
        def do_GET(self):
            url = urlparse(self.path)
            path = unquote(url.path)
            if path.startswith("/api/"):
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                try:
                    status, payload = api.handle("GET", path, query, None)
                except Exception as exc:  # pragma: no cover - defensive
                    self.log_message("api error %s", exc)
                    return self.send_json({"error": f"{type(exc).__name__}: {exc}"}, 500)
                return self.send_json(payload, status)

            if path in ("/", "/index.html"):
                return self.send_file(index_path)

            candidate = os.path.abspath(os.path.join(webdir, path.lstrip("/\\")))
            if (candidate == webdir or candidate.startswith(webdir + os.sep)) and os.path.isfile(candidate):
                cache = "public, max-age=31536000, immutable" if "/assets/" in path else "no-cache"
                return self.send_file(candidate, cache=cache)
            if "." not in os.path.basename(path):
                return self.send_file(index_path)
            return self.send_json({"error": "not found"}, 404)

        def _read_body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            if length > MAX_BODY:
                raise ValueError("request body too large")
            raw = self.rfile.read(length)
            if not raw:
                return {}
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError(f"invalid JSON body: {exc}") from exc

        def _mutate(self, method):
            url = urlparse(self.path)
            path = unquote(url.path)
            if not path.startswith("/api/"):
                return self.send_json({"error": "not found"}, 404)
            if not self._same_origin():
                return self.send_json({"error": "cross-origin request blocked"}, 403)
            try:
                body = self._read_body()
            except ValueError as exc:
                return self.send_json({"error": str(exc)}, 400)
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                status, payload = api.handle(method, path, query, body)
            except Exception as exc:  # pragma: no cover - defensive
                self.log_message("api error %s", exc)
                return self.send_json({"error": f"{type(exc).__name__}: {exc}"}, 500)
            return self.send_json(payload, status)

        def do_POST(self):
            self._mutate("POST")

        def do_PUT(self):
            self._mutate("PUT")

        def do_DELETE(self):
            self._mutate("DELETE")

    return Handler


def main(argv=None):
    ap = argparse.ArgumentParser(description="TraceIQ server")
    ap.add_argument("--out", default="out")
    ap.add_argument("--web", default=os.path.join(ROOT, "web", "dist"))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=3000)
    args = ap.parse_args(argv)

    db = os.path.join(args.out, "sqlite", "traceability.db")
    if not os.path.exists(db):
        print(f"missing {db}; run: python src/generate.py --profile full --out {args.out}")
        return 2
    if not os.path.exists(os.path.join(args.web, "index.html")):
        print(f"missing web build in {args.web}; run: cd web && npm install && npm run build")
        return 2

    server = ThreadingHTTPServer((args.host, args.port), build_handler(args.out, args.web))
    print(f"TraceIQ on http://{args.host}:{args.port} (dataset {args.out}, web {args.web})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
