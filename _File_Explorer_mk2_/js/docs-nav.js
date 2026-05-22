/* ============================================================
   docs-nav.js
   ------------------------------------------------------------
   Bridge between the wheel (nav.js) and the folder-stack engine
   (folder-stack.js).

   On `helix:subject` (wheel pick or clicker-step):
     - update banner + breadcrumb
     - hand the section's children to window.FolderStack._setCatalog
     - clear the preview pane if user switches sections

   On rail YES button click (the engine's ACCESS dialog):
     - read which folder is active
     - dispatch by kind:
         core      -> window.open the url, NO preview
         ops       -> fire helix:preview with the folder's files
         schematic -> recurse: re-call _setCatalog with the
                      container's children, push breadcrumb

   On sub-banner BACK button: pop one level of breadcrumb,
   re-render that level into the engine.
   ============================================================ */

(function () {
  'use strict';

  // ---------- DOM ----------
  // The banner is now a single full-width row; we still keep refs
  // separately for: the title text, the BACK button, the crumb, and
  // the bar itself (used as the CSS-variable host for depth colors
  // and as the container for the depth-pip indicator).
  var bannerTitle    = document.getElementById('docs-banner-title-text');
  var subbanner      = document.getElementById('docs-banner-bar');
  var subbannerBack  = document.getElementById('docs-subbanner-back');
  var subbannerCrumb = document.getElementById('docs-subbanner-crumb');

  // ---------- state ----------
  // pathStack[i] = { node, label, color } — root section is index 0.
  // When the user descends into a container, push. Back button pops.
  var pathStack = [];

  // ---------- helpers ----------
  function setBannerTitle(text, color) {
    if (!bannerTitle) return;
    bannerTitle.textContent = text;
    if (color && bannerTitle.parentNode) {
      bannerTitle.parentNode.style.color = color;
    }
  }

  function setCrumb(parts, backEnabled) {
    if (subbannerBack) {
      subbannerBack.disabled = !backEnabled;
      subbannerBack.setAttribute('aria-disabled', backEnabled ? 'false' : 'true');
    }
    if (!subbannerCrumb) return;
    var html = '';
    parts.forEach(function (p, i) {
      if (i > 0) html += '<span class="sep">/</span> ';
      var cls = p.cls ? ' class="' + p.cls + '"' : '';
      var style = p.color ? ' style="color:' + escapeAttr(p.color) + ';"' : '';
      html += '<span' + cls + style + '>' + escapeHtml(p.text) + '</span> ';
    });
    subbannerCrumb.innerHTML = html;
  }

  function refreshCrumb() {
    // Color of the deepest level — used as --depth-color on the
    // sub-banner so the BACK pill, here-segment, and depth dots all
    // pick it up. ALSO propagated to the stack-host so the
    // is-descended background tints in the right color.
    var deepestColor =
      pathStack.length > 0
        ? pathStack[pathStack.length - 1].color || '#00d9ff'
        : '#00d9ff';
    if (subbanner) {
      subbanner.style.setProperty('--depth-color', deepestColor);
    }
    var stackHost = document.getElementById('stack-host');
    if (stackHost) {
      stackHost.style.setProperty('--depth-color', deepestColor);
      // is-descended when below the top level of a section
      // (pathStack > 1 means we've descended into a container).
      if (pathStack.length > 1) {
        stackHost.classList.add('is-descended');
      } else {
        stackHost.classList.remove('is-descended');
      }
    }

    // Corner-back HTML overlay visibility — mirrors the 3D corner
    // folder. Showing only when descended below depth 1.
    syncCornerBackVisibility();

    if (pathStack.length === 0) {
      setCrumb([{ text: '// HOME', cls: 'here' }], false);
      renderDepthPips(0);
      setBannerTitle('DOCS // STANDBY', '#00d9ff');
      return;
    }
    var parts = [{ text: 'HOME', cls: '' }];
    pathStack.forEach(function (lvl, i) {
      parts.push({
        text: (lvl.label || '').toUpperCase(),
        cls: (i === pathStack.length - 1) ? 'here' : '',
        color: lvl.color,
      });
    });
    setCrumb(parts, /*backEnabled*/ pathStack.length > 0);
    renderDepthPips(pathStack.length);
    var deepest = pathStack[pathStack.length - 1];
    setBannerTitle(
      'DOCS // ' + parts.slice(1).map(function (p) { return p.text; }).join(' // '),
      deepest.color
    );
  }

  // Show / hide the HTML corner-back button to match the 3D corner-folder.
  // Populates the "where" label with the parent level's name so the user
  // sees what they're going back to. Color-tinted by the parent level's
  // color.
  function syncCornerBackVisibility() {
    var btn = document.getElementById('cornerBack');
    if (!btn) return;
    if (pathStack.length > 1) {
      // We're descended. Show the back button with the parent's name.
      var parent = pathStack[pathStack.length - 2];
      var label = (parent && parent.label) ? parent.label.toUpperCase() : '';
      var where = document.getElementById('cornerBackWhere');
      if (where) where.textContent = label ? '/ ' + label : '';
      // Tint the button by the parent's color (which is what we're
      // going BACK to), so the affordance matches the destination.
      var parentColor = (parent && parent.color) || '#00d9ff';
      btn.style.borderColor = parentColor;
      btn.style.color = parentColor;
      btn.style.boxShadow = '0 0 12px ' + parentColor + '55';
      btn.hidden = false;
    } else {
      btn.hidden = true;
    }
  }

  // Depth indicator pips. Renders N dots, K of them lit (K = current
  // depth). N = max(3, depth). Lives at the right end of the sub-banner.
  function renderDepthPips(depth) {
    if (!subbanner) return;
    var pip = subbanner.querySelector('.docs-subbanner-depth');
    if (!pip) {
      pip = document.createElement('div');
      pip.className = 'docs-subbanner-depth';
      // Insert BEFORE the spacer so the depth indicator sits to the
      // LEFT of the spacer (which absorbs slack), keeping the swap
      // chip + return-to-main flush against the right edge.
      var spacer = subbanner.querySelector('.docs-banner-spacer');
      if (spacer) {
        subbanner.insertBefore(pip, spacer);
      } else {
        subbanner.appendChild(pip);
      }
    }
    var total = Math.max(3, depth);
    var html = '<span class="lbl">// DEPTH ' + depth + '</span>';
    for (var i = 1; i <= total; i++) {
      html += '<span class="dot' + (i <= depth ? ' active' : '') + '"></span>';
    }
    pip.innerHTML = html;
  }

  // Push a level onto the path stack and re-render the folder-stack
  // engine with that level's children.
  //   opts.withDescent — if true, use the engine's descent animation
  //     (fade-to-black + zoom + swap + fade-back-in). Used when the
  //     user clicks YES on a container folder. Top-level wheel picks
  //     and back-button pops use the instant swap instead.
  //   When descending, the breadcrumb update is delayed so the new
  //   crumb appears at the same moment the veil fades back — the
  //   user sees their context update IN SYNC with the visual swap.
  function pushLevel(node, label, color, opts) {
    pathStack.push({ node: node, label: label, color: color });
    var children = node.children || [];
    renderLevelIntoStack(children, label, opts);
    // Catalog swap is now instant (engine does it at descent kickoff);
    // refresh the breadcrumb immediately to match.
    refreshCrumb();
  }

  // Replace the entire path (used on a fresh wheel click).
  function replaceRoot(node, label, color) {
    pathStack = [];
    // If we were mid-descent and the user clicks a different wheel
    // section, the corner-folder of the OLD descent doesn't apply
    // to the new section — drop it.
    if (window.FolderStack && typeof window.FolderStack.disposeCorner === 'function') {
      window.FolderStack.disposeCorner();
    }
    pushLevel(node, label, color);
  }

  function popLevel(opts) {
    if (pathStack.length <= 1) {
      // At root — popping clears everything.
      pathStack = [];
      refreshCrumb();
      // Leave the folder-stack as-is on full pop.
      return;
    }
    pathStack.pop();
    var top = pathStack[pathStack.length - 1];
    var children = (top.node && top.node.children) || [];
    var withAscent = !!(opts && opts.withAscent);
    if (withAscent && window.FolderStack && typeof window.FolderStack.ascendFromCorner === 'function') {
      // Engine swaps catalog instantly, then lerps the corner-folder
      // back to slot 0. Crumb refresh matches the instant swap.
      window.FolderStack.ascendFromCorner(children, top.label);
      refreshCrumb();
    } else {
      renderLevelIntoStack(children, top.label);
      refreshCrumb();
    }
  }

  // Corner-folder click — fires from the engine when the user clicks
  // the floating bottom-right folder representing the descended-from
  // container. Same effect as the sub-banner BACK button, but with
  // the ascent animation.
  window.addEventListener('helix:corner-click', function () {
    popLevel({ withAscent: true });
  });

  // The HTML corner-back button mirrors the 3D folder. Wiring it to
  // fire the same event keeps the dispatch path single.
  document.addEventListener('click', function (e) {
    if (!e.target) return;
    // walk up to find the button (in case the click landed on an
    // inner span like the arrow svg or the label)
    var btn = e.target.closest ? e.target.closest('#cornerBack') : null;
    if (!btn) return;
    if (btn.hidden) return;
    window.dispatchEvent(new CustomEvent('helix:corner-click'));
  });

  // ---------- SWAP VIEW chip ----------
  // Physical DOM swap. The wheel (.nav-left) and the preview pane
  // (.preview-host) trade parents — the wheel moves into the
  // docs-stage where the preview was; the preview moves into the
  // nav-page slot where the wheel was. The folder-stack (top of
  // docs-stage) is unaffected.
  //
  // We remember each element's original parent + next-sibling so
  // we can put them back exactly when unswapped (idempotent).
  var swapBtn = document.getElementById('docs-subbanner-swap');
  var navPage = document.querySelector('.nav-page');
  var swapState = { active: false, savedNavLeft: null, savedPreview: null };

  function doSwap() {
    var navLeft     = document.querySelector('.nav-left');
    var previewHost = document.getElementById('preview-host');
    if (!navLeft || !previewHost) return;

    if (!swapState.active) {
      // Save current parents/positions
      swapState.savedNavLeft = {
        parent:      navLeft.parentNode,
        nextSibling: navLeft.nextSibling,
      };
      swapState.savedPreview = {
        parent:      previewHost.parentNode,
        nextSibling: previewHost.nextSibling,
      };
      // Move preview-host into the wheel's old slot (parent of navLeft)
      // and move navLeft into the preview's old slot (parent of preview-host).
      var navLeftParent = navLeft.parentNode;
      var navLeftNext   = navLeft.nextSibling;
      var previewParent = previewHost.parentNode;
      var previewNext   = previewHost.nextSibling;
      // Insert previewHost where navLeft was
      navLeftParent.insertBefore(previewHost, navLeftNext);
      // Insert navLeft where previewHost was
      previewParent.insertBefore(navLeft, previewNext);
      swapState.active = true;
    } else {
      // Restore both to original parents/positions
      if (swapState.savedNavLeft.parent) {
        swapState.savedNavLeft.parent.insertBefore(
          navLeft, swapState.savedNavLeft.nextSibling);
      }
      if (swapState.savedPreview.parent) {
        swapState.savedPreview.parent.insertBefore(
          previewHost, swapState.savedPreview.nextSibling);
      }
      swapState.active = false;
    }
    // Toggle the class for the mini-wheel styling.
    if (navPage) navPage.classList.toggle('is-swapped', swapState.active);
    // Update chip label
    var lbl = swapBtn && swapBtn.querySelector('.swap-lbl');
    if (lbl) lbl.textContent = swapState.active ? 'RESTORE VIEW' : 'SWAP VIEW';
  }

  if (swapBtn) {
    swapBtn.addEventListener('click', function () {
      if (swapBtn.disabled) return;
      doSwap();
    });
  }
  window.addEventListener('helix:preview', function () {
    if (swapBtn) swapBtn.disabled = false;
  });
  window.addEventListener('helix:preview-clear', function () {
    if (!swapBtn) return;
    // Only disable the chip if we're NOT currently swapped. If
    // swapped, keep it enabled so the user can RESTORE VIEW back to
    // the default layout — even with no preview loaded. The swap
    // state is purely user-toggled; nothing else should change it.
    if (!swapState.active) swapBtn.disabled = true;
  });

  function renderLevelIntoStack(children, label, opts) {
    if (!window.FolderStack || typeof window.FolderStack._setCatalog !== 'function') {
      console.warn('[docs-nav] FolderStack not ready yet, deferring');
      // Defer one tick — folder-stack.js may not have finished initializing.
      setTimeout(function () { renderLevelIntoStack(children, label, opts); }, 50);
      return;
    }
    var withDescent = !!(opts && opts.withDescent);
    if (withDescent && typeof window.FolderStack._setCatalogWithDescent === 'function') {
      window.FolderStack._setCatalogWithDescent(children, label);
    } else {
      window.FolderStack._setCatalog(children, label);
    }
  }

  // ---------- wheel events ----------
  window.addEventListener('helix:subject', function (evt) {
    var d = evt && evt.detail;
    if (!d || !d.node) return;
    var n = d.node;

    if (n.kind === 'url') {
      // Top-level URL section: open immediately, don't change the pane.
      if (n.url) window.open(n.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (n.kind === 'folder') {
      // Top-level folder section (no recursion): treat as a single-level
      // "fake container" whose children are the files themselves, so the
      // user sees a folder per file in the stack.
      var synth = {
        kind: 'container',
        children: (n.files || []).map(function (f, i) {
          return {
            id: f.name || ('f' + i),
            label: f.name || ('FILE_' + i),
            kind: 'folder',
            subtitle: f.path || '',
            files: [{ name: f.name, path: f.path }],
          };
        }),
      };
      replaceRoot(synth, n.label, d.color);
      return;
    }
    // container — render its children
    replaceRoot(n, n.label, d.color);
    // Clear preview so it doesn't show a stale doc from a previous section.
    window.dispatchEvent(new CustomEvent('helix:preview-clear'));
  });

  // ---------- rail YES button: per-kind dispatch ----------
  // The engine's dialog YES button would, by default, fire its own
  // "transfer overlay" animation + rebuild the stack from scratch.
  // That conflicts with our kind-specific dispatch (URL open, preview,
  // descent). Capture-phase + stopPropagation lets us replace the
  // engine's behavior entirely with kind-aware handling.
  //
  // After dispatching, we manually call the engine's deactivateActive()
  // so the active folder slides back into the stack (the engine would
  // have handled that for us if we'd let its YES handler run).
  document.addEventListener('click', function (e) {
    if (!e.target || e.target.id !== 'dialogYes') return;
    if (!window.FolderStack || typeof window.FolderStack.getActiveFolder !== 'function') return;

    var active = window.FolderStack.getActiveFolder();
    if (!active) return;

    // Suppress the engine's bubble-phase YES handler (which would fire
    // its transfer-overlay + rebuild). Our dispatch replaces it.
    e.stopPropagation();

    var color = pathStack.length
      ? pathStack[pathStack.length - 1].color
      : '#00d9ff';

    if (active.kind === 'url' && active.url) {
      window.open(active.url, '_blank', 'noopener,noreferrer');
      window.FolderStack.deactivateActive();
      return;
    }
    if (active.kind === 'folder' && Array.isArray(active.files) && active.files.length) {
      window.dispatchEvent(new CustomEvent('helix:preview', {
        detail: {
          files: active.files,
          label: active.label,
          color: color,
        }
      }));
      window.FolderStack.deactivateActive();
      return;
    }
    if (active.kind === 'container' && Array.isArray(active.children) && active.children.length) {
      // Descend: push the active container onto the path stack and
      // render its children. withDescent triggers the engine's
      // fade-to-black + zoom animation. (deactivateActive is implicit
      // in the descent — the post-swap state resets activeIndex.)
      pushLevel(active, active.label, color, { withDescent: true });
      // Clear preview since the user is moving deeper.
      window.dispatchEvent(new CustomEvent('helix:preview-clear'));
      return;
    }
  }, /*useCapture*/ true);

  // ---------- sub-banner BACK ----------
  if (subbannerBack) {
    subbannerBack.addEventListener('click', popLevel);
  }

  // ---------- URL launch card ----------
  // Wired against the DOM templated by folder-stack-mount.js. When the
  // engine activates a folder of kind:url, show the launch card with
  // the URL host + a LAUNCH button. Both LAUNCH and the X-close button
  // call the engine's deactivateActive() to slide the popped-out folder
  // back into its inline stack position. The helix:folder-deactive
  // event then hides the card.
  window.addEventListener('helix:folder-active', function (evt) {
    var data = evt && evt.detail && evt.detail.folder;
    if (!data) return;
    var launch = document.getElementById('urlLaunch');
    if (!launch) return;

    if (data.kind === 'url' && data.url) {
      var host;
      try { host = new URL(data.url).hostname; }
      catch (_) { host = data.url; }
      document.getElementById('urlLaunchTitle').textContent =
        (data.label ? data.label.toUpperCase() : 'EXTERNAL LINK');
      document.getElementById('urlLaunchHost').textContent = host;
      var alertEl = document.getElementById('urlLaunchAlert');
      if (alertEl) alertEl.hidden = true;
      launch.hidden = false;
      // Color-tint by the active path's color, if known.
      var color = pathStack.length
        ? pathStack[pathStack.length - 1].color
        : '#00d9ff';
      launch.style.borderColor = color;
      launch.style.boxShadow = '0 0 14px ' + color + '55';
    } else {
      launch.hidden = true;
    }
  });
  window.addEventListener('helix:folder-deactive', function () {
    var launch = document.getElementById('urlLaunch');
    if (launch) launch.hidden = true;
  });

  // LAUNCH + close button handlers. Delegated since the DOM is
  // templated by folder-stack-mount.js after this script loads.
  document.addEventListener('click', function (e) {
    if (!e.target) return;

    // X close button: deactivate the folder. The helix:folder-deactive
    // listener above will then hide the card.
    if (e.target.id === 'urlLaunchClose') {
      if (window.FolderStack && typeof window.FolderStack.deactivateActive === 'function') {
        window.FolderStack.deactivateActive();
      } else {
        // Fallback if deactivate isn't exposed for some reason.
        var launchFallback = document.getElementById('urlLaunch');
        if (launchFallback) launchFallback.hidden = true;
      }
      return;
    }

    if (e.target.id !== 'urlLaunchBtn') return;
    if (!window.FolderStack || typeof window.FolderStack.getActiveFolder !== 'function') return;
    var active = window.FolderStack.getActiveFolder();
    if (!active || active.kind !== 'url' || !active.url) return;

    window.open(active.url, '_blank', 'noopener,noreferrer');

    var alertEl2 = document.getElementById('urlLaunchAlert');
    if (alertEl2) {
      alertEl2.hidden = false;
      alertEl2.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      alertEl2.offsetWidth;     // forced reflow to replay animation
      alertEl2.style.animation = '';
    }

    // After a short beat (long enough for the alert to flash + the
    // user to register what happened) deactivate the folder so it
    // returns to inline position. The card hides via the deactive
    // listener.
    setTimeout(function () {
      if (window.FolderStack && typeof window.FolderStack.deactivateActive === 'function') {
        window.FolderStack.deactivateActive();
      }
    }, 1400);
  });

  // ---------- initial state ----------
  refreshCrumb();

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

})();
