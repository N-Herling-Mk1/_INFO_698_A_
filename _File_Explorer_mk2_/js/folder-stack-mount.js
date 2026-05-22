/* ============================================================
   folder-stack-mount.js
   ------------------------------------------------------------
   The folder-stack engine (js/folder-stack.js) was extracted from a
   standalone HTML file and queries the DOM by id for ~25 elements:
     #stage (the <canvas>), the rail (#sideRail + all its sub-blocks),
     #countValue + #countUp/#countDown, #sectorLabel, #folderTags,
     #transferOverlay.

   Rather than refactor the engine into an init/destroy module (which
   was the previous plan and got complicated), we just TEMPLATE the
   required DOM into #stack-host before the engine's <script> tag
   parses. When the engine then runs `document.getElementById('stage')`
   it finds the canvas we just inserted.

   This file MUST execute BEFORE folder-stack.js. Both are classic
   <script>s loaded in order at the bottom of nav.html so script-order
   guarantees that.
   ============================================================ */

(function () {
  'use strict';

  var host = document.getElementById('stack-host');
  if (!host) {
    console.warn('[folder-stack-mount] #stack-host not found; skipping mount');
    return;
  }

  host.innerHTML =
    /* Toolstrip ABOVE the canvas: horizontal FIND + SCROLL row.
       Moved here from the rail so the rail itself stays short enough
       to fit the stack-host height. The two engine-managed sections
       (railFind, railScroll) keep their original ids so folder-stack.js
       finds them — they just live in a new container. */
    '<div class="stack-toolstrip" id="stackToolstrip">' +
      /* FIND block — same DOM as before, restyled into a horizontal pill. */
      '<section class="rail-block rail-block-find toolstrip-block" id="railFind">' +
        '<div class="rail-block-head">' +
          '<span class="rail-block-title">// FIND</span>' +
          '<span class="rail-block-meta" id="findCount">—</span>' +
        '</div>' +
        '<div class="rail-block-body find-body">' +
          '<div class="find-input-wrap">' +
            '<span class="find-prompt">&gt;</span>' +
            '<input type="text" id="findInput" class="find-input" ' +
                   'placeholder="filter folders…" autocomplete="off" spellcheck="false" />' +
            '<button id="findClear" class="find-clear" aria-label="clear" title="clear">×</button>' +
          '</div>' +
        '</div>' +
      '</section>' +

      /* SCROLL block — also moved up here. */
      '<section class="rail-block rail-block-scroll toolstrip-block" id="railScroll">' +
        '<div class="rail-block-head">' +
          '<span class="rail-block-title">// SCROLL</span>' +
          '<span class="rail-block-meta" id="scrollMeta">0 / 0</span>' +
        '</div>' +
        '<div class="rail-block-body scroll-body">' +
          '<button id="scrollBack" class="scroll-btn" aria-label="back" title="back">◀</button>' +
          '<span class="scroll-hint">cycle stack</span>' +
          '<button id="scrollFwd"  class="scroll-btn" aria-label="forward" title="forward">▶</button>' +
        '</div>' +
      '</section>' +
    '</div>' +

    /* ACCESS panel — YES / NO buttons floated at the top-left of the
       stack-host (just under the toolstrip). Moved out of the inspector
       rail so the rail stays compact and doesn\'t need to scroll. The
       engine still wires these by id (#dialogYes / #dialogNo), so all
       existing click handling continues to work unchanged. */
    '<div class="access-panel" id="accessPanel">' +
      '<span class="access-panel-label">// ACCESS</span>' +
      '<button id="dialogYes" class="access-btn access-btn-yes" disabled>YES</button>' +
      '<button id="dialogNo"  class="access-btn access-btn-no"  disabled>NO</button>' +
    '</div>' +

    /* The Three.js canvas. CSS positions it absolutely inside .stack-host
       so it fills the host. folder-stack.js will pick it up by id. */
    '<canvas id="stage" class="stack-canvas"></canvas>' +

    /* Sector label removed in this iteration — the URL launch card now
       sits in the bottom-center area instead. The engine still references
       #sectorLabel for opacity flips on activation, so we keep a hidden
       placeholder so getElementById() returns a valid element. */
    '<div id="sectorLabel" style="display:none"></div>' +

    /* URL launch card — shown when the active folder is kind:url.
       Pure DOM, populated by docs-nav.js. Hidden by default. The close
       button lets the user dismiss the card without deactivating the
       folder. */
    '<div class="url-launch" id="urlLaunch" hidden>' +
      '<button type="button" class="url-launch-close" id="urlLaunchClose" ' +
              'aria-label="close" title="close">×</button>' +
      '<div class="url-launch-head">' +
        '<i class="ti ti-external-link" aria-hidden="true"></i>' +
        '<span class="url-launch-title" id="urlLaunchTitle">EXTERNAL LINK</span>' +
      '</div>' +
      '<div class="url-launch-host" id="urlLaunchHost">—</div>' +
      '<button type="button" class="url-launch-btn" id="urlLaunchBtn">' +
        'LAUNCH&nbsp;↗' +
      '</button>' +
      '<div class="url-launch-alert" id="urlLaunchAlert" hidden>opened in new tab</div>' +
    '</div>' +

    /* Folder count toggle — used internally by the engine for the
       fan-size logic. Templated into DOM so the engine's getElementById
       lookups succeed, but display:none so it's not user-visible
       (it was for dev). The engine still calls setFolderCount() on
       _setCatalog so each section auto-fits its child count. */
    '<div class="count-panel" style="display:none">' +
      '<div class="label">Folder Count</div>' +
      '<div class="row">' +
        '<button id="countDown" aria-label="decrease">−</button>' +
        '<div class="value" id="countValue">7</div>' +
        '<button id="countUp" aria-label="increase">+</button>' +
      '</div>' +
    '</div>' +

    /* Transfer overlay — full-host flash on YES (legacy compat). */
    '<div class="transfer-overlay" id="transferOverlay">' +
      '<div class="msg">TRANSFER COMPLETE' +
        '<span class="sub">routing to sector_16</span>' +
      '</div>' +
    '</div>' +

    /* Tag fallback column — engine writes here, currently display:none. */
    '<div class="folder-tags" id="folderTags"></div>' +

    /* Descent overlay — full-host black veil that fades up during a
       container descent and fades back down on the other side. The
       engine drives its opacity via a JS-side animation. */
    '<div class="descent-veil" id="descentVeil"></div>' +

    /* Corner-back label — paired HTML overlay for the 3D corner-folder.
       Shown when a descent has parked a corner-folder in the
       bottom-right; clicking it triggers the same ascent as clicking
       the 3D folder. The 3D folder is the visual hero, but the HTML
       label gives an unambiguous "BACK" affordance with crisp text. */
    '<button type="button" class="corner-back" id="cornerBack" hidden>' +
      '<span class="corner-back-arrow" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24"><polyline points="15 6 9 12 15 18"></polyline></svg>' +
      '</span>' +
      '<span class="corner-back-lbl">BACK</span>' +
      '<span class="corner-back-where" id="cornerBackWhere">—</span>' +
    '</button>' +

    /* INSPECTOR RAIL — short version. FIND + SCROLL moved up to the
       toolstrip; rail keeps TYPE LEGEND + FILE INSPECT + ACCESS. */
    '<aside class="side-rail" id="sideRail">' +

      '<div class="rail-head">' +
        '<span class="rail-head-title">INSPECTOR</span>' +
        '<span class="rail-head-meta">SECTOR_16 // L2</span>' +
      '</div>' +

      '<section class="rail-block" id="railLegend">' +
        '<div class="rail-block-head">' +
          '<span class="rail-block-title">// TYPE LEGEND</span>' +
          '<span class="rail-block-meta" id="legendCount">—</span>' +
        '</div>' +
        '<div class="rail-block-body legend-body" id="legendBody"></div>' +
      '</section>' +

      '<section class="rail-block file-info" id="fileInfo">' +
        '<div class="rail-block-head">' +
          '<span class="rail-block-title">// FILE INSPECT</span>' +
          '<span class="blink" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="rail-block-body fi-body">' +
          '<div class="fi-idle" id="fiIdle">no folder selected</div>' +
          '<div class="fi-content" id="fiContent">' +
            '<span class="fi-line"><span class="accent">load</span> <span class="v fi-name" id="fiName">—</span></span>' +
            '<span class="fi-line"><span class="k">type    </span> <span class="v" id="fiType">—</span></span>' +
            '<span class="fi-line"><span class="k">drive   </span> <span class="v" id="fiDrive">—</span></span>' +
            '<span class="fi-line"><span class="k">size    </span> <span class="v" id="fiSize">—</span></span>' +
            '<span class="fi-line"><span class="k">modified</span> <span class="v" id="fiModified">—</span></span>' +
            '<span class="fi-line"><span class="k">enc     </span> <span class="v" id="fiEnc">AES-256</span></span>' +
            '<span class="fi-line"><span class="k">sector  </span> <span class="v" id="fiSector">16</span></span>' +
            '<div class="fi-preview" id="fiPreview"></div>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<section class="rail-block access-dialog" id="accessDialog">' +
        '<div class="rail-block-head access-head">' +
          '<span class="rail-block-title">// ACCESS</span>' +
        '</div>' +
        '<div class="rail-block-body access-body">' +
          '<div class="drive" id="driveName">— no drive —</div>' +
        '</div>' +
        /* accessMsg kept hidden for backwards-compat; the engine
           writes a message to it on activation but it isn\'t shown. */
        '<div id="accessMsg" style="display:none"></div>' +
      '</section>' +

    '</aside>';

})();
