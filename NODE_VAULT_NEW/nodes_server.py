#!/usr/bin/env python3
"""
NODES  //  LOCAL EDIT SERVER
────────────────────────────
Run:    python nodes_server.py
Opens:  http://localhost:5000        → edit.html  (editor)
        http://localhost:5000/view   → view.html  (viewer)
        http://localhost:5000/login  → index.html (login)
        http://localhost:5000/notes  → REST API (GET/POST/PUT/DELETE)
"""

import json, os, sys
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).parent
NOTES_FILE  = SCRIPT_DIR / "data" / "notes.json"
INDEX_FILE  = SCRIPT_DIR / "index.html"   # login + auth
VIEW_FILE   = SCRIPT_DIR / "view.html"    # read-only viewer
EDIT_FILE   = SCRIPT_DIR / "edit.html"    # editor
PORT        = 5000

# ── init ──────────────────────────────────────────────────────────────────────
NOTES_FILE.parent.mkdir(exist_ok=True)
if not NOTES_FILE.exists():
    NOTES_FILE.write_text("[]", encoding="utf-8")

# ── helpers ───────────────────────────────────────────────────────────────────
def read_notes():
    return json.loads(NOTES_FILE.read_text(encoding="utf-8"))

def write_notes(notes):
    NOTES_FILE.write_text(
        json.dumps(notes, indent=2, ensure_ascii=False), encoding="utf-8"
    )

def json_resp(handler, code, data):
    body = json.dumps(data, ensure_ascii=False).encode()
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", len(body))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)

def html_resp(handler, code, body_bytes, mime="text/html"):
    handler.send_response(code)
    handler.send_header("Content-Type", mime + "; charset=utf-8")
    handler.send_header("Content-Length", len(body_bytes))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body_bytes)

def serve_file(handler, path: Path, fallback_msg: bytes = b"Not found"):
    if path.exists():
        html_resp(handler, 200, path.read_bytes())
    else:
        html_resp(handler, 404, fallback_msg)

# ── request handler ───────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()}  {fmt % args}")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ── GET ───────────────────────────────────────────────────────────────────
    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")

        # ── HTML pages ──────────────────────────────────────────────
        if path in ("", "/"):
            # Root → editor (requires server to be running)
            serve_file(self, EDIT_FILE, b"<h1>edit.html not found</h1>")

        elif path in ("/login", "/index", "/index.html"):
            serve_file(self, INDEX_FILE, b"<h1>index.html not found</h1>")

        elif path in ("/view", "/viewer", "/preview", "/view.html"):
            serve_file(self, VIEW_FILE, b"<h1>view.html not found</h1>")

        elif path in ("/edit", "/editor", "/edit.html"):
            serve_file(self, EDIT_FILE, b"<h1>edit.html not found</h1>")

        # ── API ─────────────────────────────────────────────────────
        elif path == "/ping":
            json_resp(self, 200, {"status": "ok", "notes": str(NOTES_FILE)})

        elif path == "/notes":
            json_resp(self, 200, read_notes())

        elif path == "/data/notes.json":
            # Static fallback for view.html when served via GitHub Pages
            json_resp(self, 200, read_notes())

        else:
            html_resp(self, 404, b"Not found", "text/plain")

    # ── POST ──────────────────────────────────────────────────────────────────
    def do_POST(self):
        path   = urlparse(self.path).path.rstrip("/")
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length) if length else b"{}")

        if path == "/notes":
            notes = read_notes()
            # Auto-assign ID
            if not body.get("id"):
                nums = [
                    int(n["id"].split("-")[1])
                    for n in notes
                    if n.get("id", "").startswith("NODE-")
                ]
                body["id"] = f"NODE-{max(nums, default=0)+1:03d}"
            # Auto-date
            if not body.get("date"):
                from datetime import date
                body["date"] = str(date.today())
            notes.append(body)
            write_notes(notes)
            json_resp(self, 201, body)

        elif path == "/notes/reorder":
            write_notes(body)
            json_resp(self, 200, {"status": "ok"})

        else:
            json_resp(self, 404, {"error": "not found"})

    # ── PUT ───────────────────────────────────────────────────────────────────
    def do_PUT(self):
        path  = urlparse(self.path).path.rstrip("/")
        parts = path.split("/")                       # ['', 'notes', 'NODE-001']
        if len(parts) == 3 and parts[1] == "notes":
            note_id = parts[2]
            length  = int(self.headers.get("Content-Length", 0))
            body    = json.loads(self.rfile.read(length))
            notes   = read_notes()
            idx     = next((i for i, n in enumerate(notes) if n["id"] == note_id), None)
            if idx is None:
                json_resp(self, 404, {"error": "not found"}); return
            notes[idx] = body
            write_notes(notes)
            json_resp(self, 200, body)
        else:
            json_resp(self, 404, {"error": "not found"})

    # ── DELETE ────────────────────────────────────────────────────────────────
    def do_DELETE(self):
        path  = urlparse(self.path).path.rstrip("/")
        parts = path.split("/")
        if len(parts) == 3 and parts[1] == "notes":
            note_id = parts[2]
            notes   = read_notes()
            before  = len(notes)
            notes   = [n for n in notes if n["id"] != note_id]
            if len(notes) == before:
                json_resp(self, 404, {"error": "not found"}); return
            write_notes(notes)
            json_resp(self, 200, {"status": "deleted", "id": note_id})
        else:
            json_resp(self, 404, {"error": "not found"})

# ── entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import webbrowser, threading

    server = HTTPServer(("127.0.0.1", PORT), Handler)

    print(f"""
  ╔═══════════════════════════════════════════╗
  ║   NODES  //  LOCAL EDIT SERVER            ║
  ╠═══════════════════════════════════════════╣
  ║   Editor  →  http://localhost:{PORT}          ║
  ║   Viewer  →  http://localhost:{PORT}/view     ║
  ║   Login   →  http://localhost:{PORT}/login    ║
  ╠═══════════════════════════════════════════╣
  ║   notes.json  →  {str(NOTES_FILE):<25s} ║
  ║   Ctrl+C to stop                          ║
  ╚═══════════════════════════════════════════╝
""")

    def _open():
        import time; time.sleep(0.4)
        webbrowser.open(f"http://localhost:{PORT}")
    threading.Thread(target=_open, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        sys.exit(0)
