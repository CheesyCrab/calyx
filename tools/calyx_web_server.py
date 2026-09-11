#!/usr/bin/env python3
"""Small localhost-only origin for an atomically switched Calyx payload."""

from __future__ import annotations

import argparse
import json
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


class Server(ThreadingHTTPServer):
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if args.host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("Calyx hosted origin must bind to loopback")

    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {
            **SimpleHTTPRequestHandler.extensions_map,
            ".wasm": "application/wasm",
            ".mjs": "text/javascript",
            ".webmanifest": "application/manifest+json",
        }

        def __init__(self, *handler_args: Any, **kwargs: Any) -> None:
            super().__init__(
                *handler_args, directory=str(args.root.resolve()), **kwargs
            )

        def end_headers(self) -> None:
            path = self.path.split("?", 1)[0].lstrip("/")
            if path in ("", "index.html", "sw.js", "release.json", "carts/carts.json"):
                self.send_header("Cache-Control", "no-cache, must-revalidate")
            else:
                self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            super().end_headers()

        def do_GET(self) -> None:
            if self.path.split("?", 1)[0] == "/healthz":
                try:
                    release = json.loads(
                        (args.root.resolve() / "release.json").read_text()
                    )
                    body = json.dumps(
                        {
                            "ok": True,
                            "payload_id": release["payload_id"],
                            "channel": release.get("channel", "stable"),
                        }
                    ).encode()
                except (OSError, KeyError, json.JSONDecodeError) as error:
                    self.send_error(503, str(error))
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    print(f"Calyx origin: http://{args.host}:{args.port} -> {args.root}", flush=True)
    Server((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
