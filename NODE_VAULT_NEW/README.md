# NODE_VAULT (mk2)

TRON Ares hex-keypad note system with calendar-organized scans, PDFs, images, and ASCII notes.
**Read-only static site + local Flask editor — designed for GitHub Pages.**

## How the architecture works

```
EDITING (your laptop only):
   start_vault.bat → Flask server runs locally
       ↓ edit notes, drop scans, manage classes via the editor popup
       ↓ Flask rewrites index.json on every change
   click [● BACKEND] in the header to shut Flask down

DEPLOYING:
   git add . && git commit && git push
       ↓
   GitHub Pages serves the static files (no backend, ever)
       ↓ vault.html reads index.json directly
       ↓ notes & files load straight from /assets/
       ↓ search runs client-side over the manifest
       ↓ edit buttons are visible but disabled (LIVE MODE ONLY)
```

## Quick start

```bash
pip install -r requirements.txt
python vault_server.py        # or double-click start_vault.bat on Windows
```

Then visit <http://localhost:5000/> (or whatever port the server picked — the
banner in the console window will tell you).

## Static preview (no Flask)

Open `index.html` directly in any browser (double-click, or via VS Code Live
Server) to preview the site as visitors will see it. Login + spiral + vault
all work; edit buttons are disabled with a "LIVE MODE ONLY" tooltip.

## Port configuration

Default port is **5000**, but the server is flexible:

```bash
python vault_server.py --port 5055         # explicit
NODE_VAULT_PORT=5055 python vault_server.py  # env var
python vault_server.py                       # auto-discover 5000..5020
```

The chosen port is written to `.port`; `start_vault.bat` reads it to know
which URL to open in the browser.

## Pages

| Route (live) | File (static) | Purpose |
|---|---|---|
| `/` | `index.html` | Splash, hex keypad login, Archimedean π validation |
| `/vault` | `vault.html` | Calendar viewer (DAY FILES + classes, search, viewer panel) |
| `/edit` | `edit_vault.html` | Editor popup — **live mode only** |

## Asset structure

```
assets/YYYY/MM/DD/
  ├── notes/             (loose .txt — same `##` / `[ ]` / `[x]` syntax)
  ├── images/            (loose .png/.jpg/.jpeg)
  ├── loose/             (arbitrary files: PDFs, etc.)
  └── <class_id>/        (structured class folder)
        ├── meta.json    ({name, tag})
        ├── notes.txt
        ├── scan_001.png
        └── handout.pdf
```

`index.json` is the manifest the static site reads. **Flask keeps it in sync
automatically** — every create / upload / delete / note-save rewrites it.
You commit `index.json` along with `assets/`.

## ASCII notes micro-syntax

```
## SECTION HEADER     → cyan display-font header
[ ] todo item          → orange highlight
[x] done item          → green strikethrough
plain text             → preserved as-is
```

## Search behavior

- **Live mode** — hits `/api/search`, scans filenames, class metadata, every notes.txt
- **Static mode** — client-side scan of the in-memory manifest covers filenames,
  class IDs/names/tags. Notes content matches if you've opened the note in the
  viewer at least once this session (it gets cached).

## Backend status pill

| State | Meaning |
|---|---|
| **● BACKEND: ONLINE** (green) | Flask is running, all editing works |
| **○ BACKEND: OFFLINE** (red) | Flask was reachable but went down — refresh to retry |
| **● BACKEND: STOPPING** (orange) | Shutdown in progress |
| **STATIC MODE** (dim) | No Flask detected — static site, read-only |

## Theme

CLASSIC (cyan) and ARES (red). Toggle in the header. Persists across pages
via `sessionStorage`.

## What's in the filler

The repo ships with three days of placeholder content so you can preview
immediately:

- **2026-05-22** — INFO 698 Capstone meeting + day-level scans / notes / images
- **2026-05-15** — INFO 521 Exam Prep
- **2026-04-03** — CRUCIBLE Round 2

Replace these with your real notes when Flask is running — every change
auto-rewrites `index.json`.
