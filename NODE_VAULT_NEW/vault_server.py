#!/usr/bin/env python3
"""
NODE_VAULT // FLASK SERVER  (mk2: day-level files + search + viewer)
─────────────────────────────────────────────────────────────────────
Run:    python vault_server.py
        (install once: pip install flask)

Schema (per day):
    assets/YYYY/MM/DD/
        notes/      → loose .txt notes for the day  (any ext allowed; mostly .txt)
        images/     → loose images (png/jpg/jpeg)
        loose/      → loose PDFs and other files (any ext)
        <class_id>/ → structured class folders (existing behavior)
            meta.json, notes.txt, scan_001.png, ...

Routes:
  GET  /                              → index.html (splash + spiral)
  GET  /vault                         → vault.html (calendar viewer)
  GET  /edit                          → edit_vault.html (editor popup)
  GET  /view                          → view.html (legacy)
  GET  /assets/<path>                 → serve uploaded files

  GET  /api/manifest                  → walk assets/, full nested manifest
  GET  /api/day/<YYYY-MM-DD>          → day object (loose + classes)
  GET  /api/search?q=...              → global search across files/classes/notes

  Class-level (existing, with rename support on upload):
  POST   /api/class                   { date, id, name, tag }
  PUT    /api/class/<date>/<id>       { name?, tag? }
  DELETE /api/class/<date>/<id>
  POST   /api/upload                  multipart (date, class_id, file, rename_to?)
  DELETE /api/asset/<date>/<id>/<fn>
  GET    /api/note/<date>/<id>
  PUT    /api/note/<date>/<id>        { text }

  Day-level (new):
  POST   /api/day-upload              multipart (date, file, rename_to?)
                                      auto-routes by extension to notes|images|loose
  POST   /api/day-upload              alternate: form 'bucket=notes|images|loose' to force
  DELETE /api/day-asset/<date>/<bucket>/<fn>
  GET    /api/day-note/<date>/<fn>    read loose notes/*.txt
  PUT    /api/day-note/<date>/<fn>    { text }  create or overwrite

  POST   /api/shutdown                kills the server (localhost-only)
"""

from __future__ import annotations
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from flask import (
    Flask, request, jsonify, send_file, send_from_directory, abort
)

# ──────────────────────────── paths ────────────────────────────
SCRIPT_DIR  = Path(__file__).parent.resolve()
ASSETS_DIR  = SCRIPT_DIR / "assets"
INDEX_HTML  = SCRIPT_DIR / "index.html"
VAULT_HTML  = SCRIPT_DIR / "vault.html"
EDIT_HTML   = SCRIPT_DIR / "edit_vault.html"
VIEW_HTML   = SCRIPT_DIR / "view.html"

ASSETS_DIR.mkdir(exist_ok=True)

# Day-level reserved bucket names. These CANNOT be used as class IDs.
DAY_BUCKETS = ("notes", "images", "loose")
RESERVED_CLASS_IDS = set(DAY_BUCKETS)

# Class-level uploads keep the strict PNG/JPG/PDF policy.
CLASS_ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".pdf"}
# Day-level 'images' bucket: images only.
IMAGE_EXT = {".png", ".jpg", ".jpeg"}
# 'notes' bucket: typically .txt but we don't hard-restrict (user said allow arbitrary).
# 'loose' bucket: ARBITRARY file types allowed (user choice).

DATE_RE     = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID_RE       = re.compile(r"^[A-Za-z0-9_\-]+$")
FNAME_RE    = re.compile(r"^[A-Za-z0-9_\-. ]+$")
BUCKET_RE   = re.compile(r"^(notes|images|loose)$")

# Port resolution: CLI flag wins, then env var, then auto-discovery from default.
# The chosen port is written to .port so start_vault.bat can find it.
DEFAULT_PORT   = 5000
PORT_SCAN_MAX  = 20        # how many ports to try when auto-discovering
PORT_FILE      = SCRIPT_DIR / ".port"

def resolve_port() -> int:
    """
    Resolve which port to bind. Priority:
      1. --port N   on the command line
      2. NODE_VAULT_PORT  env var
      3. Auto-discover: start at DEFAULT_PORT, scan up to +PORT_SCAN_MAX,
         use the first port that accepts a bind on 127.0.0.1.
    Returns the chosen port (raises SystemExit if all options exhausted).
    """
    import os, socket, argparse, sys

    # --- (1) CLI flag ---
    # argparse here parses ONLY known args so we don't fight Flask's reloader.
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--port", type=int, default=None,
                        help=f"port to bind (default: auto from {DEFAULT_PORT})")
    parser.add_argument("--help", "-h", action="store_true")
    known, _unknown = parser.parse_known_args()

    if known.help:
        print(f"\nusage: python vault_server.py [--port N]\n")
        print(f"  --port N             bind to port N explicitly")
        print(f"  NODE_VAULT_PORT=N    same effect via env var")
        print(f"  (default: auto-discover starting at {DEFAULT_PORT})\n")
        raise SystemExit(0)

    explicit = known.port

    # --- (2) Env var ---
    if explicit is None:
        env_val = os.environ.get("NODE_VAULT_PORT", "").strip()
        if env_val:
            try:
                explicit = int(env_val)
            except ValueError:
                print(f"  [!] NODE_VAULT_PORT={env_val!r} is not a valid integer; ignoring")

    def _can_bind(p: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", p))
        except OSError:
            return False
        return True

    if explicit is not None:
        if not _can_bind(explicit):
            print(f"  [!] port {explicit} is busy — refusing to start")
            print(f"      (something is already listening on 127.0.0.1:{explicit})")
            raise SystemExit(1)
        return explicit

    # --- (3) Auto-discover ---
    for offset in range(PORT_SCAN_MAX + 1):
        candidate = DEFAULT_PORT + offset
        if _can_bind(candidate):
            if offset > 0:
                print(f"  [i] port {DEFAULT_PORT} was busy; auto-selected {candidate}")
            return candidate
    print(f"  [!] no free ports in range {DEFAULT_PORT}..{DEFAULT_PORT + PORT_SCAN_MAX}")
    raise SystemExit(1)

app = Flask(__name__, static_folder=None)

# ──────────────────────────── helpers ────────────────────────────
def safe_date(s: str) -> str:
    if not DATE_RE.match(s):
        abort(400, f"bad date format: {s}")
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        abort(400, f"invalid calendar date: {s}")
    return s

def safe_id(s: str) -> str:
    if not s or not ID_RE.match(s):
        abort(400, f"bad class id: {s!r}  (use letters, digits, _ -)")
    if s in RESERVED_CLASS_IDS:
        abort(400, f"class id '{s}' is reserved for day-level files")
    return s

def safe_bucket(s: str) -> str:
    if not BUCKET_RE.match(s or ""):
        abort(400, f"bad bucket: {s!r}  (must be notes|images|loose)")
    return s

def safe_filename(s: str) -> str:
    if not s or not FNAME_RE.match(s):
        abort(400, f"bad filename: {s!r}")
    return s

def day_dir(date: str) -> Path:
    y, m, d = date.split("-")
    return ASSETS_DIR / y / m / d

def class_dir(date: str, class_id: str) -> Path:
    return day_dir(date) / class_id

def bucket_dir(date: str, bucket: str) -> Path:
    return day_dir(date) / bucket

def read_meta(cdir: Path) -> dict:
    mp = cdir / "meta.json"
    if mp.exists():
        try:
            return json.loads(mp.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"name": cdir.name, "tag": ""}

def write_meta(cdir: Path, meta: dict):
    cdir.mkdir(parents=True, exist_ok=True)
    (cdir / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

def list_class_files(cdir: Path) -> tuple[list[str], list[str]]:
    """Return (images, pdfs) — sorted, hidden files skipped, no meta/notes."""
    images, pdfs = [], []
    if not cdir.is_dir():
        return images, pdfs
    for f in sorted(cdir.iterdir(), key=lambda p: p.name.lower()):
        if not f.is_file() or f.name.startswith("."):
            continue
        if f.name in ("meta.json", "notes.txt"):
            continue
        ext = f.suffix.lower()
        if ext in (".png", ".jpg", ".jpeg"):
            images.append(f.name)
        elif ext == ".pdf":
            pdfs.append(f.name)
    return images, pdfs

def list_bucket_files(bdir: Path) -> list[str]:
    """List files inside a day bucket dir (notes/images/loose). Sorted, hidden skipped."""
    if not bdir.is_dir():
        return []
    out = []
    for f in sorted(bdir.iterdir(), key=lambda p: p.name.lower()):
        if f.is_file() and not f.name.startswith("."):
            out.append(f.name)
    return out

def read_notes_text(cdir: Path) -> str:
    nt = cdir / "notes.txt"
    if nt.exists():
        try:
            return nt.read_text(encoding="utf-8")
        except Exception:
            return ""
    return ""

def ext_to_bucket(ext: str) -> str:
    """Auto-route uploads by extension."""
    e = ext.lower()
    if e in IMAGE_EXT: return "images"
    if e == ".txt":    return "notes"
    return "loose"

def is_iso_date_dir(p: Path, pattern: str) -> bool:
    return p.is_dir() and re.match(pattern, p.name) is not None

def build_day(date: str) -> dict:
    """Build the day object: { loose:{notes,images,files}, classes:[...] }."""
    ddir = day_dir(date)
    loose = {"notes": [], "images": [], "files": []}
    classes: list[dict] = []
    if not ddir.is_dir():
        return {"loose": loose, "classes": classes}

    for sub in sorted(ddir.iterdir(), key=lambda p: p.name.lower()):
        if not sub.is_dir() or sub.name.startswith("."):
            continue
        if sub.name == "notes":
            loose["notes"] = list_bucket_files(sub)
        elif sub.name == "images":
            loose["images"] = list_bucket_files(sub)
        elif sub.name == "loose":
            loose["files"] = list_bucket_files(sub)
        else:
            # treat as class folder
            meta = read_meta(sub)
            images, pdfs = list_class_files(sub)
            classes.append({
                "id":       sub.name,
                "name":     meta.get("name", sub.name),
                "tag":      meta.get("tag", ""),
                "images":   images,
                "pdfs":     pdfs,
                "hasNotes": (sub / "notes.txt").exists(),
            })
    return {"loose": loose, "classes": classes}

def build_manifest() -> dict:
    """Walk assets/YYYY/MM/DD/ for every day and build the full nested manifest."""
    days: dict[str, dict] = {}
    if not ASSETS_DIR.exists():
        return {"days": {}}
    for ydir in sorted(ASSETS_DIR.iterdir()):
        if not is_iso_date_dir(ydir, r"^\d{4}$"): continue
        for mdir in sorted(ydir.iterdir()):
            if not is_iso_date_dir(mdir, r"^\d{2}$"): continue
            for ddir in sorted(mdir.iterdir()):
                if not is_iso_date_dir(ddir, r"^\d{2}$"): continue
                date_key = f"{ydir.name}-{mdir.name}-{ddir.name}"
                day = build_day(date_key)
                # only include the day if it has content
                if (day["classes"] or day["loose"]["notes"] or
                    day["loose"]["images"] or day["loose"]["files"]):
                    days[date_key] = day
    return {"days": days}

# Path to the static-deploy manifest — committed alongside assets/ so GitHub Pages
# can read it directly without any backend.
MANIFEST_FILE = SCRIPT_DIR / "index.json"

def write_static_manifest():
    """Refresh index.json so the static (GitHub Pages) deploy stays in sync."""
    try:
        m = build_manifest()
        MANIFEST_FILE.write_text(
            json.dumps(m, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8"
        )
    except Exception as e:
        # never let a manifest write fail the request
        print(f"  [!] could not write {MANIFEST_FILE.name}: {e}")

def prune_empty_parents(start: Path):
    """Walk up from `start`, removing empty parent dirs up to (but not including) ASSETS_DIR."""
    parent = start
    while parent != ASSETS_DIR and parent.is_dir() and not any(parent.iterdir()):
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent

# ──────────────────────────── page routes ────────────────────────────
@app.route("/")
def root():     return send_file(INDEX_HTML)

@app.route("/vault")
def vault():    return send_file(VAULT_HTML)

@app.route("/edit")
def edit():     return send_file(EDIT_HTML)

@app.route("/view")
def legacy_view(): return send_file(VIEW_HTML)

# ──────────────────────────── asset serving ────────────────────────────
@app.route("/assets/<path:relpath>")
def serve_asset(relpath: str):
    full = (ASSETS_DIR / relpath).resolve()
    # path-traversal defense
    if ASSETS_DIR.resolve() not in full.parents and full != ASSETS_DIR.resolve():
        abort(403)
    if not full.is_file():
        abort(404)
    return send_from_directory(ASSETS_DIR, relpath)

# ──────────────────────────── manifest / day ────────────────────────────
@app.route("/api/manifest")
def api_manifest():
    return jsonify(build_manifest())

@app.route("/api/day/<date>")
def api_day(date: str):
    safe_date(date)
    return jsonify(build_day(date))

# ──────────────────────────── classes ────────────────────────────
@app.route("/api/class", methods=["POST"])
def api_create_class():
    data = request.get_json(silent=True) or {}
    date     = safe_date(str(data.get("date", "")))
    class_id = safe_id(str(data.get("id", "")))
    name     = str(data.get("name", class_id)).strip() or class_id
    tag      = str(data.get("tag", "")).strip()

    cdir = class_dir(date, class_id)
    if cdir.exists():
        return jsonify(error=f"class '{class_id}' already exists on {date}"), 409
    write_meta(cdir, {"name": name, "tag": tag})
    return jsonify(ok=True, id=class_id, date=date)

@app.route("/api/class/<date>/<class_id>", methods=["PUT"])
def api_update_class(date: str, class_id: str):
    safe_date(date); safe_id(class_id)
    cdir = class_dir(date, class_id)
    if not cdir.exists():
        abort(404)
    data = request.get_json(silent=True) or {}
    meta = read_meta(cdir)
    if "name" in data: meta["name"] = str(data["name"]).strip() or meta.get("name", class_id)
    if "tag"  in data: meta["tag"]  = str(data["tag"]).strip()
    write_meta(cdir, meta)
    return jsonify(ok=True)

@app.route("/api/class/<date>/<class_id>", methods=["DELETE"])
def api_delete_class(date: str, class_id: str):
    safe_date(date); safe_id(class_id)
    cdir = class_dir(date, class_id)
    if not cdir.exists():
        abort(404)
    shutil.rmtree(cdir)
    prune_empty_parents(cdir.parent)
    return jsonify(ok=True)

# ──────────────────────────── helper: rename handling ────────────────────────────
def resolve_rename(rename_raw: str, source_name: str, ext: str, target_dir: Path) -> Path:
    """
    Given an optional rename stem, a source filename, and the validated extension,
    return the final Path inside target_dir (de-duped against existing files).
    """
    rename_raw = (rename_raw or "").strip()
    if rename_raw:
        stem_in = Path(rename_raw).stem if "." in rename_raw else rename_raw
        if not stem_in or not re.match(r"^[A-Za-z0-9_\-. ]+$", stem_in):
            abort(400, f"bad rename: {rename_raw!r}  (letters, digits, _ - . space only)")
        fname = stem_in + ext
    else:
        fname = safe_filename(source_name)
    target = target_dir / fname
    if target.exists():
        stem, suf = Path(fname).stem, ext
        i = 1
        while (target_dir / f"{stem}-{i}{suf}").exists():
            i += 1
        target = target_dir / f"{stem}-{i}{suf}"
    return target

# ──────────────────────────── class uploads ────────────────────────────
@app.route("/api/upload", methods=["POST"])
def api_upload():
    date     = safe_date(request.form.get("date", ""))
    class_id = safe_id(request.form.get("class_id", ""))
    cdir     = class_dir(date, class_id)
    if not cdir.exists():
        abort(404, f"class not found: {date}/{class_id}")
    f = request.files.get("file")
    if not f or not f.filename:
        abort(400, "no file")

    source_name = f.filename.replace("/", "_").replace("\\", "_")
    ext = Path(source_name).suffix.lower()
    if ext not in CLASS_ALLOWED_EXT:
        abort(400, f"class uploads require PNG/JPG/PDF (got {ext!r})")

    target = resolve_rename(request.form.get("rename_to"), source_name, ext, cdir)
    f.save(str(target))
    return jsonify(ok=True, filename=target.name)

@app.route("/api/asset/<date>/<class_id>/<filename>", methods=["DELETE"])
def api_delete_asset(date: str, class_id: str, filename: str):
    safe_date(date); safe_id(class_id); safe_filename(filename)
    if filename == "meta.json":
        abort(400, "meta.json cannot be deleted directly")
    fp = class_dir(date, class_id) / filename
    if not fp.is_file():
        abort(404)
    fp.unlink()
    return jsonify(ok=True)

# ──────────────────────────── class notes ────────────────────────────
@app.route("/api/note/<date>/<class_id>", methods=["GET"])
def api_get_note(date: str, class_id: str):
    safe_date(date); safe_id(class_id)
    cdir = class_dir(date, class_id)
    if not cdir.exists():
        abort(404)
    return jsonify(text=read_notes_text(cdir))

@app.route("/api/note/<date>/<class_id>", methods=["PUT"])
def api_put_note(date: str, class_id: str):
    safe_date(date); safe_id(class_id)
    cdir = class_dir(date, class_id)
    if not cdir.exists():
        abort(404)
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", ""))
    (cdir / "notes.txt").write_text(text, encoding="utf-8")
    return jsonify(ok=True)

# ──────────────────────────── DAY-LEVEL uploads ────────────────────────────
@app.route("/api/day-upload", methods=["POST"])
def api_day_upload():
    date = safe_date(request.form.get("date", ""))
    f = request.files.get("file")
    if not f or not f.filename:
        abort(400, "no file")

    source_name = f.filename.replace("/", "_").replace("\\", "_")
    ext = Path(source_name).suffix.lower()

    # bucket: explicit form param wins, else auto-route by extension
    forced = request.form.get("bucket", "").strip()
    if forced:
        bucket = safe_bucket(forced)
    else:
        bucket = ext_to_bucket(ext)

    # bucket-specific extension validation
    if bucket == "images" and ext not in IMAGE_EXT:
        abort(400, f"images/ requires PNG/JPG/JPEG (got {ext!r})")
    # notes/ and loose/ accept anything

    bdir = bucket_dir(date, bucket)
    bdir.mkdir(parents=True, exist_ok=True)

    target = resolve_rename(request.form.get("rename_to"), source_name, ext, bdir)
    f.save(str(target))
    return jsonify(ok=True, filename=target.name, bucket=bucket)

@app.route("/api/day-asset/<date>/<bucket>/<filename>", methods=["DELETE"])
def api_delete_day_asset(date: str, bucket: str, filename: str):
    safe_date(date); safe_bucket(bucket); safe_filename(filename)
    fp = bucket_dir(date, bucket) / filename
    if not fp.is_file():
        abort(404)
    fp.unlink()
    # prune empty bucket + day dirs
    prune_empty_parents(fp.parent)
    return jsonify(ok=True)

# ──────────────────────────── DAY-LEVEL notes (loose .txt CRUD) ────────────────────────────
@app.route("/api/day-note/<date>/<filename>", methods=["GET"])
def api_get_day_note(date: str, filename: str):
    safe_date(date); safe_filename(filename)
    fp = bucket_dir(date, "notes") / filename
    if not fp.is_file():
        abort(404)
    try:
        return jsonify(text=fp.read_text(encoding="utf-8"))
    except Exception as e:
        abort(500, f"read failed: {e}")

@app.route("/api/day-note/<date>/<filename>", methods=["PUT"])
def api_put_day_note(date: str, filename: str):
    safe_date(date); safe_filename(filename)
    # enforce .txt extension on notes/ writes
    if not filename.lower().endswith(".txt"):
        abort(400, "loose note filename must end in .txt")
    bdir = bucket_dir(date, "notes")
    bdir.mkdir(parents=True, exist_ok=True)
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", ""))
    (bdir / filename).write_text(text, encoding="utf-8")
    return jsonify(ok=True)

# ──────────────────────────── SEARCH ────────────────────────────
def _search_filenames(query_lc: str, results: list[dict], max_per_kind: int = 100):
    """Walk assets/, accumulate hits on filenames (and class IDs / day bucket dirs)."""
    if not ASSETS_DIR.exists():
        return
    for ydir in ASSETS_DIR.iterdir():
        if not is_iso_date_dir(ydir, r"^\d{4}$"): continue
        for mdir in ydir.iterdir():
            if not is_iso_date_dir(mdir, r"^\d{2}$"): continue
            for ddir in mdir.iterdir():
                if not is_iso_date_dir(ddir, r"^\d{2}$"): continue
                date_key = f"{ydir.name}-{mdir.name}-{ddir.name}"
                for sub in ddir.iterdir():
                    if not sub.is_dir(): continue
                    if sub.name in DAY_BUCKETS:
                        for f in sub.iterdir():
                            if f.is_file() and not f.name.startswith(".") \
                               and query_lc in f.name.lower():
                                results.append({
                                    "kind":    "day_file",
                                    "date":    date_key,
                                    "bucket":  sub.name,
                                    "filename": f.name,
                                    "snippet": f.name,
                                })
                    else:
                        # class folder
                        cid = sub.name
                        meta = read_meta(sub)
                        # class id / name / tag hit
                        hay = " ".join([cid, meta.get("name",""), meta.get("tag","")]).lower()
                        if query_lc in hay:
                            results.append({
                                "kind":  "class",
                                "date":  date_key,
                                "id":    cid,
                                "name":  meta.get("name", cid),
                                "tag":   meta.get("tag",""),
                                "snippet": f"{meta.get('name', cid)} — {meta.get('tag','')}".strip(" —"),
                            })
                        for f in sub.iterdir():
                            if f.is_file() and not f.name.startswith(".") \
                               and f.name not in ("meta.json","notes.txt") \
                               and query_lc in f.name.lower():
                                results.append({
                                    "kind":     "class_file",
                                    "date":     date_key,
                                    "id":       cid,
                                    "filename": f.name,
                                    "snippet":  f.name,
                                })

def _search_notes(query_lc: str, results: list[dict], max_per_file: int = 3):
    """Walk every notes.txt (class) and notes/*.txt (loose); return up to 3 hits per file."""
    if not ASSETS_DIR.exists():
        return
    for ydir in ASSETS_DIR.iterdir():
        if not is_iso_date_dir(ydir, r"^\d{4}$"): continue
        for mdir in ydir.iterdir():
            if not is_iso_date_dir(mdir, r"^\d{2}$"): continue
            for ddir in mdir.iterdir():
                if not is_iso_date_dir(ddir, r"^\d{2}$"): continue
                date_key = f"{ydir.name}-{mdir.name}-{ddir.name}"
                for sub in ddir.iterdir():
                    if not sub.is_dir(): continue
                    if sub.name == "notes":
                        for f in sub.iterdir():
                            if f.is_file() and f.suffix.lower() == ".txt":
                                _scan_text_file(f, query_lc, date_key,
                                                kind="day_note",
                                                extra={"filename": f.name},
                                                results=results,
                                                max_per_file=max_per_file)
                    elif sub.name not in DAY_BUCKETS:
                        nt = sub / "notes.txt"
                        if nt.exists():
                            _scan_text_file(nt, query_lc, date_key,
                                            kind="class_note",
                                            extra={"id": sub.name},
                                            results=results,
                                            max_per_file=max_per_file)

def _scan_text_file(fp: Path, query_lc: str, date_key: str, kind: str,
                    extra: dict, results: list[dict], max_per_file: int):
    try:
        txt = fp.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return
    hits = 0
    for i, line in enumerate(txt.splitlines(), 1):
        if query_lc in line.lower():
            snippet = line.strip()
            if len(snippet) > 140: snippet = snippet[:140] + "…"
            r = {
                "kind":    kind,
                "date":    date_key,
                "line":    i,
                "snippet": snippet,
            }
            r.update(extra)
            results.append(r)
            hits += 1
            if hits >= max_per_file:
                break

@app.route("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify(query=q, count=0, results=[])
    q_lc = q.lower()
    results: list[dict] = []
    _search_filenames(q_lc, results)
    _search_notes(q_lc, results)
    # newest-first by date, then by kind preference
    kind_order = {"class": 0, "class_file": 1, "day_file": 2, "class_note": 3, "day_note": 4}
    results.sort(key=lambda r: (r["date"], kind_order.get(r["kind"], 9)), reverse=True)
    # hard cap
    results = results[:200]
    return jsonify(query=q, count=len(results), results=results)

# ──────────────────────────── shutdown ────────────────────────────
@app.route("/api/shutdown", methods=["POST"])
def api_shutdown():
    import threading, time, os
    def _die():
        time.sleep(0.4)
        try:
            PORT_FILE.unlink(missing_ok=True)
        except Exception:
            pass
        os._exit(0)
    threading.Thread(target=_die, daemon=True).start()
    return jsonify(ok=True, msg="shutdown scheduled")

# ──────────────────────────── CORS / OPTIONS ────────────────────────────
@app.after_request
def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"]  = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

# ──────────────────────────── static manifest sync ────────────────────────────
@app.after_request
def _sync_static_manifest(resp):
    """
    After any successful mutating request, rewrite index.json so the static
    (GitHub Pages) deploy stays in sync without a separate build step.
    """
    if request.method in ("POST", "PUT", "DELETE") and 200 <= resp.status_code < 300:
        # skip the shutdown endpoint — process is about to die and we already
        # wrote the manifest after the last real mutation.
        if not request.path.startswith("/api/shutdown"):
            write_static_manifest()
    return resp

@app.route("/<path:_p>", methods=["OPTIONS"])
@app.route("/", methods=["OPTIONS"])
def _options(_p=None):
    return ("", 204)

# ──────────────────────────── boot ────────────────────────────
if __name__ == "__main__":
    import atexit

    chosen_port = resolve_port()

    # Write the chosen port to a sibling file so start_vault.bat can poll the right URL.
    try:
        PORT_FILE.write_text(str(chosen_port), encoding="utf-8")
        atexit.register(lambda: PORT_FILE.unlink(missing_ok=True))
    except OSError as e:
        print(f"  [!] could not write {PORT_FILE.name}: {e}")

    bar = "─" * 46
    print(f"┌{bar}┐")
    print(f"│  NODE_VAULT  //  FLASK SERVER  (mk2)         │")
    print(f"├{bar}┤")
    line = lambda p, label: f"│  http://localhost:{chosen_port}/{p:<10s} {label:<14s}│"
    print(line("",      "splash"))
    print(line("vault", "calendar"))
    print(line("edit",  "editor popup"))
    print(line("view",  "legacy view"))
    print(f"└{bar}┘")
    print(f"  port:        {chosen_port}  (default {DEFAULT_PORT}; override with --port N or NODE_VAULT_PORT)")
    print(f"  assets dir:  {ASSETS_DIR}")
    print(f"  day buckets: {DAY_BUCKETS}")
    # Ensure index.json exists at boot — static deploy depends on it being present.
    write_static_manifest()
    app.run(host="127.0.0.1", port=chosen_port, debug=False, threaded=True)
