/* ============================================================
   preview-pane.js
   ------------------------------------------------------------
   The bottom-right pane. Two states, no chrome:
     - EMPTY: large ◇ glyph + "// AWAITING SELECTION" hero
     - LOADED: <iframe> fills 100% of the pane, document IS the UI

   Switching documents = re-fire helix:preview with new files.
   Dismissal = helix:preview-clear (deactivating folder, switching
   sections, etc.).

   Listens for:
     window 'helix:preview'       { files: [{ name, path }, ...] }
       Loads files[0] into the iframe.
     window 'helix:preview-clear'
       Clears back to empty hero.
   ============================================================ */

(function () {
  'use strict';

  var els = {
    host:   document.getElementById('preview-host'),
    empty:  document.getElementById('previewEmpty'),
    iframe: document.getElementById('previewIframe'),
  };
  if (!els.host || !els.iframe) return;

  window.addEventListener('helix:preview', function (evt) {
    var d = evt && evt.detail;
    if (!d || !Array.isArray(d.files) || d.files.length === 0) return;
    var file = d.files[0];
    if (!file || !file.path) return;

    var resolved = resolvePath(file.path);
    // Avoid reload jitter if the user re-clicks the same folder.
    if (els.iframe.getAttribute('src') !== resolved) {
      els.iframe.setAttribute('src', resolved);
    }
    if (els.empty)  els.empty.hidden  = true;
    els.iframe.hidden = false;
  });

  window.addEventListener('helix:preview-clear', clear);

  function clear() {
    els.iframe.setAttribute('src', 'about:blank');
    els.iframe.hidden = true;
    if (els.empty) els.empty.hidden = false;
  }

  // Files in sections.json reference paths like 'pdfs/foo.pdf'. We're
  // serving from nav.html (root level), so the path is already relative
  // to the document. Absolute URLs (http(s)://) pass through unchanged.
  function resolvePath(p) {
    if (/^https?:\/\//i.test(p)) return p;
    return p;
  }
})();
