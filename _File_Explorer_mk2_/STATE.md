# STATE — mk_2 (iteration 2)

Fixes since last drop:
- Canvas no longer overflows .stack-host (added overflow:hidden,
  max-width/height clamp, contain:layout)
- Camera pulls back when host is narrow so the folder fan fits
  within the visible viewport
- Removed conflicting .docs-stage inline styles that were applying
  padding/border under the split layout
- Count panel hidden (display:none) — was dev-only
- Slot name de-duped when id and label match (was "[ACADEMIC] ACADEMIC")

This should restore the wheel (LIBRARY was being occluded by the
canvas overflow, not actually missing) and produce a cleanly bounded
folder-stack pane.

## Run
```
python -m http.server 8000
```
then open http://localhost:8000/nav.html
