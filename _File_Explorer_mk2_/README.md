# INFO 698 // Capstone

Static front-end site for the INFO 698 Data Science MS Capstone project.
TRON Ares aesthetic. Pure HTML/CSS/JS — no build step.

```
info698_capstone/
├── index.html              # Splash page
├── nav.html                # Radial navigation page
├── README.md
├── assets/
│   └── logo.png            # ← DROP YOUR LOGO HERE
├── css/
│   └── ares.css            # Shared TRON Ares stylesheet
├── data/                   # Faux backend — JSON loaded via fetch()
│   ├── meta.json           # Site title, operator, cycle, version
│   ├── nodes.json          # Radial menu nodes (label, icon, angle, href)
│   ├── links.json          # External URLs (GitHub, datasets, contact)
│   └── content.json        # Per-section body content
├── js/
│   ├── data-loader.js      # Shared fetch wrapper + clock ticker
│   ├── splash.js           # Splash page wiring
│   └── nav.js              # Radial menu builder
└── pages/                  # Section pages (one per node)
    ├── overview.html
    ├── methodology.html
    ├── datasets.html
    ├── results.html
    ├── docs.html
    ├── deck.html
    └── about.html
```

## Setup

1. Drop your logo at `assets/logo.png`. The splash and nav pages
   reference it as `<img src="assets/logo.png">`. If the file is missing,
   a graceful fallback frame appears so the layout doesn't break.

2. Edit the JSON files in `data/` to populate the site:
   - **meta.json** — operator name, cycle, version string, etc.
   - **nodes.json** — change `href` values to point to your real pages,
     or flip a node to `"external": true` to open in a new tab.
   - **links.json** — GitHub repo URL, dataset sources, contact info.
   - **content.json** — per-section body content (abstract, methodology
     stages, metrics, bio, etc.).

3. Serve locally — `fetch()` will not work from `file://` due to CORS.
   Any static server works:

   ```bash
   # Python
   python3 -m http.server 8000

   # Node
   npx serve .
   ```

   Then open `http://localhost:8000/`.

## Deploying

Drop the whole folder onto GitHub Pages, Netlify, Vercel, or any
static host. No build required.

## Customization

- **Colors** live as CSS variables at the top of `css/ares.css`:
  `--ares-cyan`, `--ares-purple`, `--ares-lime`. Change them once,
  everything updates.
- **Radial geometry** — the node positions are computed from the
  `angle` field in `data/nodes.json`. Angles are degrees, 0 = right,
  -90 = top. Change `RADIUS` at the top of `js/nav.js` to push nodes
  in or out.
- **Add a node** — append an object to `data/nodes.json`, then adjust
  the `angle` values to redistribute around the circle (or compute
  evenly: `360 / N` per node).

## Notes

- Tabler Icons is loaded from a CDN for the radial icons. If you want
  a pure offline build, remove the `<link>` tag from `index.html`,
  `nav.html`, and the page template, then either self-host the font
  or swap in inline SVG icons.
- The HUD clock is decorative — purely client-side `setInterval`.
- The `ENTER GRID` button links to `nav.html`. Anchor tag, no JS needed.
