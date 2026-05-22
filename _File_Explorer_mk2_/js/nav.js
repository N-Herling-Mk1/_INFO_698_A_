/* ============================================================
   nav.js
   ------------------------------------------------------------
   Builds the radial wheel from data/sections.json (top-level
   `sections[]` array). Each section becomes an orbiting node.
   Clicking / clicker-stepping fires a `helix:subject` event
   that docs-nav.js listens for to repopulate the folder-stack
   engine.

   The wheel layout is the same as the INFO 698 version:
     - nodes orbit at radius 265 around a 680px SVG
     - the ▲ pointer sits at -90° (top center)
     - PREV / NEXT clicker rotates the wheel one slot at a time
     - the active node is whichever is closest to -90°

   Section color mapping (matches the folder-stack):
     - any child is container       -> cyan   (#00d9ff)
     - else majority kind is folder -> amber  (#e0a437)
     - else all children url        -> green  (#25d695)
   ============================================================ */

(function () {
  'use strict';

  var CENTER_X  = 340;
  var CENTER_Y  = 340;
  var RADIUS    = 265;
  var NODE_SZ   = 110;
  var TOP_ANGLE = -90;

  // Color tokens — keep in sync with css/folder-stack.css FOLDER_TYPES.
  var KIND_COLORS = {
    schematic: '#00d9ff',  // cyan   — container
    ops:       '#e0a437',  // amber  — leaf folder (PDFs)
    core:      '#25d695',  // green  — url
  };

  // Per-kind icon (Tabler classnames — already linked in nav.html head)
  var KIND_ICONS = {
    container: 'ti-stack-3',
    folder:    'ti-folder',
    url:       'ti-external-link',
  };

  var radial    = document.getElementById('radial');
  var readout   = document.getElementById('readout');
  var spokes    = document.getElementById('radial-spokes');
  var hudCount  = document.getElementById('hud-count');
  var btnLeft   = document.getElementById('wheel-btn-left');
  var btnRight  = document.getElementById('wheel-btn-right');
  var slotName  = document.getElementById('wheel-slot-name');

  var built    = [];
  var rotation = 0;
  var stepDeg  = 45;

  AresData.load('sections.json').then(function (data) {
    var sections = (data && data.sections) || [];
    if (!sections.length) {
      if (readout) readout.textContent = '[ ERR // NO SECTIONS ]';
      return;
    }
    stepDeg = 360 / sections.length;

    // Distribute sections evenly around the wheel.
    // Starting angle = -90 (top) so the first section opens at the pointer.
    sections.forEach(function (s, i) {
      s._angle = -90 + i * stepDeg;
      s._sectionKind = pickSectionKind(s);
      s._color = KIND_COLORS[s._sectionKind] || '#00d9ff';
      buildNode(s, i);
    });

    if (hudCount) {
      hudCount.textContent = sections.length + ' SECTIONS // 0 LOCKED';
    }
    applyRotation();
    wireClicker();

    // Honor default_section if present — rotate the wheel so that
    // section sits at the top pointer on boot.
    if (data.default_section) {
      var idx = sections.findIndex(function (s) { return s.id === data.default_section; });
      if (idx >= 0) {
        // rotation needed to bring section idx's base angle to TOP_ANGLE
        rotation = TOP_ANGLE - (-90 + idx * stepDeg);
        applyRotation();
        // Auto-dispatch so the right pane boots with default content.
        dispatchSubject(sections[idx]);
      }
    }
  }).catch(function (err) {
    console.error('[nav] failed to load sections.json:', err);
    if (readout) {
      readout.textContent = '[ ERR // SECTION DATA UNAVAILABLE ]';
      readout.style.borderColor = '#ff3030';
      readout.style.color = '#ff3030';
    }
  });

  /* ---------- color rule ----------
     Mirrors the folder-stack rule: any container child -> schematic
     (cyan); else if majority folder -> ops (amber); else core (green). */
  function pickSectionKind(s) {
    var kids = s.children || s.files || [];
    if (!kids.length) {
      if (s.kind === 'url')       return 'core';
      if (s.kind === 'folder')    return 'ops';
      return 'schematic';
    }
    var nC = 0, nF = 0, nU = 0;
    kids.forEach(function (c) {
      if (c.kind === 'container') nC++;
      else if (c.kind === 'folder') nF++;
      else if (c.kind === 'url') nU++;
    });
    if (nC > 0) return 'schematic';
    if (nF >= nU) return 'ops';
    return 'core';
  }

  /* ---------- one node DOM element ---------- */
  function buildNode(s, i) {
    var el = document.createElement('div');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.className = 'node ares-frame';
    el.style.border = '1px solid ' + s._color + '66';
    el.style.color  = s._color;
    el.setAttribute('data-id', s.id);

    var iconClass = KIND_ICONS[s.kind] || 'ti-folder';
    var sub = s.subtitle || s.kind || '';

    el.innerHTML =
      '<span class="ares-corner-bl" style="border-color:' + s._color + ';"></span>' +
      '<span class="ares-corner-br" style="border-color:' + s._color + ';"></span>' +
      '<i class="ti ' + iconClass + ' node-icon" aria-hidden="true"></i>' +
      '<span class="node-label">' + escapeHtml(s.label) + '</span>' +
      '<span class="node-id">' + escapeHtml(sub) + '</span>';

    el.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      dispatchSubject(s);
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        dispatchSubject(s);
      }
    });

    el.addEventListener('mouseenter', function () {
      el.style.borderColor = s._color;
      el.style.boxShadow = '0 0 0 1px ' + s._color + '40';
      if (readout) {
        readout.innerHTML =
          '<span style="color:' + s._color + ';">[ ' + escapeHtml(s.id) + ' ]</span> &nbsp;' +
          escapeHtml(s.label).toUpperCase() + ' // ' + escapeHtml(sub).toUpperCase();
        readout.style.borderColor = s._color + '80';
        readout.style.color = s._color;
      }
    });
    el.addEventListener('mouseleave', function () {
      if (el.classList.contains('is-active')) {
        el.style.borderColor = s._color;
        el.style.boxShadow = '0 0 0 1px ' + s._color + ', 0 0 18px ' + s._color + '40';
      } else {
        el.style.borderColor = s._color + '66';
        el.style.boxShadow = 'none';
      }
      if (readout) {
        readout.textContent = '[ HOVER NODE // AWAITING INPUT ]';
        readout.style.borderColor = 'rgba(0, 217, 255, 0.3)';
        readout.style.color = 'var(--ares-muted)';
      }
    });

    radial.appendChild(el);
    built.push({ data: s, el: el });

    // Decorative spoke
    if (spokes) {
      var rad = (s._angle) * Math.PI / 180;
      var ix = CENTER_X + 115 * Math.cos(rad);
      var iy = CENTER_Y + 115 * Math.sin(rad);
      var ox = CENTER_X + 200 * Math.cos(rad);
      var oy = CENTER_Y + 200 * Math.sin(rad);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', ix); line.setAttribute('y1', iy);
      line.setAttribute('x2', ox); line.setAttribute('y2', oy);
      spokes.appendChild(line);
    }
  }

  /* ---------- place nodes + resolve active ---------- */
  function applyRotation() {
    built.forEach(function (b) {
      var deg = (b.data._angle || 0) + rotation;
      var rad = deg * Math.PI / 180;
      var x = CENTER_X + RADIUS * Math.cos(rad);
      var y = CENTER_Y + RADIUS * Math.sin(rad);
      var leftPct = ((x - NODE_SZ / 2) / 680) * 100;
      var topPct  = ((y - NODE_SZ / 2) / 680) * 100;
      b.el.style.left = leftPct + '%';
      b.el.style.top  = topPct  + '%';
    });

    var active = null;
    var bestDiff = Infinity;
    built.forEach(function (b) {
      var eff = (b.data._angle || 0) + rotation;
      var diff = Math.abs(angleDiff(eff, TOP_ANGLE));
      if (diff < bestDiff) { bestDiff = diff; active = b; }
    });

    built.forEach(function (b) {
      var isAct = (b === active);
      b.el.classList.toggle('is-active', isAct);
      if (isAct) {
        b.el.style.borderColor = b.data._color;
        b.el.style.boxShadow = '0 0 0 1px ' + b.data._color +
                               ', 0 0 18px ' + b.data._color + '40';
      } else {
        b.el.style.borderColor = b.data._color + '66';
        b.el.style.boxShadow = 'none';
      }
    });

    /* Update the static highlight frame's color to match the active
       node's section color (cyan/amber/green). The frame itself
       doesn't move — only its tint changes as nodes rotate through. */
    var highlight = document.getElementById('wheelHighlight');
    if (highlight && active) {
      highlight.style.setProperty('--highlight-color', active.data._color || '#00d9ff');
    }

    if (slotName && active) {
      var s = active.data;
      var labelUp = String(s.label || '').toUpperCase();
      var idUp = String(s.id || '').toUpperCase();
      // Avoid "[ ACADEMIC ] ACADEMIC" — when id and label are the same
      // word, show just the bracketed bold form.
      if (labelUp === idUp) {
        slotName.innerHTML =
          '<b style="color:' + s._color + ';">[ ' + escapeHtml(labelUp) + ' ]</b>';
      } else {
        slotName.innerHTML =
          '<span style="color:' + s._color + ';">[ ' + escapeHtml(idUp) + ' ]</span> &nbsp;' +
          '<b style="color:' + s._color + ';">' + escapeHtml(labelUp) + '</b>';
      }
      slotName.style.borderColor = s._color + '60';
      slotName.setAttribute('href', '#');
      slotName.removeAttribute('target');
      slotName._helixSubject = s;
    }
  }

  /* ---------- slotName click ---------- */
  (function wireSlotNameOnce() {
    if (!slotName || slotName._helixWired) return;
    slotName._helixWired = true;
    slotName.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      var s = slotName._helixSubject;
      if (s) dispatchSubject(s);
    });
  })();

  function angleDiff(a, b) {
    return ((b - a + 540) % 360 + 360) % 360 - 180;
  }

  /* ---------- clicker buttons ---------- */
  function wireClicker() {
    if (btnLeft)  btnLeft.addEventListener('click', function () { step(+1); });
    if (btnRight) btnRight.addEventListener('click', function () { step(-1); });
    document.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft')  { step(+1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { step(-1); e.preventDefault(); }
    });
  }
  function step(dir) {
    rotation = (rotation + dir * stepDeg);
    if (rotation >  3600) rotation -= 3600;
    if (rotation < -3600) rotation += 3600;
    applyRotation();
    // Auto-dispatch the new top-of-wheel section so the right pane follows.
    var atTop = null, bestDiff = Infinity;
    built.forEach(function (b) {
      var eff = (b.data._angle || 0) + rotation;
      var diff = Math.abs(angleDiff(eff, TOP_ANGLE));
      if (diff < bestDiff) { bestDiff = diff; atTop = b; }
    });
    if (atTop) dispatchSubject(atTop.data);
  }

  /* ---------- event dispatch ---------- */
  function dispatchSubject(s) {
    try {
      window.dispatchEvent(new CustomEvent('helix:subject', {
        detail: {
          id:       s.id,
          label:    s.label,
          color:    s._color,
          kind:     s.kind,
          // Pass the underlying node so docs-nav can recurse.
          node:     s,
        }
      }));
    } catch (e) {
      console.warn('[nav] dispatch failed:', e);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

})();
