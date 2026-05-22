/* ============================================================
   folder-stack.js
   Extracted verbatim from folder_system.html (mk_0).
   Loaded as a classic <script> after Three.js r128.
   Depends on the following DOM elements existing in index.html:
     #stage, #sideRail, #sectorLabel, #folderTags, #transferOverlay,
     #legendBody, #legendCount, #findInput, #findClear, #findCount,
     #scrollFwd, #scrollBack, #scrollMeta, #fileInfo, #fiName, #fiType,
     #fiDrive, #fiSize, #fiModified, #fiEnc, #fiSector, #fiPreview,
     #accessDialog, #driveName, #accessMsg, #dialogYes, #dialogNo,
     #countValue, #countUp, #countDown, #clock
   The five pending changes (per RESUME_NOTE.txt) will be applied to
   THIS file in future commits.
   ============================================================ */

  /* =========================================================
     3D FILE FOLDER SYSTEM — STARK INDUSTRIES SECTOR_16
     - Pentagonal shield-shaped folders fanned in perspective
     - Hover -> folder slides out
     - Click -> opens access dialog
     ========================================================= */

  const canvas = document.getElementById('stage');
  // The canvas lives inside the .stack-pane grid column. We size the
  // renderer + camera aspect against the CONTAINER's bounding rect, not
  // window.innerWidth/innerHeight, so the 3D viewer stays correctly
  // proportioned regardless of the wheel/rail column widths or window resize.
  const container = canvas.parentElement;
  function _containerSize() {
    const r = container.getBoundingClientRect();
    // Floors prevent sub-pixel jitter; minimums prevent zero-size renderer
    return { w: Math.max(2, Math.floor(r.width)), h: Math.max(2, Math.floor(r.height)) };
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  {
    const s = _containerSize();
    renderer.setSize(s.w, s.h, false);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    35, (() => { const s = _containerSize(); return s.w / s.h; })(), 0.1, 1000
  );
  camera.position.set(0, 0.6, 9.5);
  camera.lookAt(0, 0, 0);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-4, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd4e6, 0.6);
  rim.position.set(6, 2, -3);
  scene.add(rim);

  /* ---- Pentagonal "shield" folder shape ---- */
  // Tall pentagon with the angled top edge on the right side, like the reference.
  function makeFolderShape(w = 2.0, h = 2.6, notch = 0.55) {
    const s = new THREE.Shape();
    s.moveTo(-w/2, -h/2);
    s.lineTo( w/2 - notch, -h/2);
    s.lineTo( w/2,         -h/2 + notch);
    s.lineTo( w/2,          h/2 - notch);
    s.lineTo( w/2 - notch,  h/2);
    s.lineTo(-w/2,          h/2);
    s.lineTo(-w/2,         -h/2);
    return s;
  }

  const folderShape = makeFolderShape();
  const extrudeSettings = {
    depth: 0.015,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 2,
  };
  const folderGeo = new THREE.ExtrudeGeometry(folderShape, extrudeSettings);
  folderGeo.translate(0, 0, -extrudeSettings.depth / 2);

  // === ACTIVATOR L-BRACKET ===
  // Visible structural element of the folder that runs from the binder
  // hole along the top edge and down through the first corner notch.
  // Same color as the folder's border (type color). Never changes color
  // on activation — it's just part of the folder. Clicking the bracket
  // (or the binder hole) toggles activate/deactivate.
  //
  // The bracket geometry is shared across all folders (same pentagon
  // shape). Material is per-folder so each one carries its own type color.
  //
  // Path (folder-local coords, matches makeFolderShape with w=2.0, h=2.6,
  // notch=0.55):
  //   start at hole x  (-0.82) along the top edge (y = +1.30)
  //   continue along the top to corner before notch (+0.45, +1.30)
  //   continue down the angled notch to (+1.00, +0.75)
  //
  // We build it as a thin filled strip just inside the perimeter so it
  // visually reads as a "tab" on the folder rather than a separate widget.
  function makeBracketGeo() {
    const W = 2.0, H = 2.6, NOTCH = 0.55;
    const HOLE_X = -0.82;
    const STRIP = 0.085;  // perpendicular thickness of the bracket strip

    // Outer path (along the folder perimeter)
    const outer = [
      [HOLE_X,        H/2],            // p0  start at hole x, top edge
      [W/2 - NOTCH,   H/2],            // p1  top-right pre-notch
      [W/2,           H/2 - NOTCH],    // p2  top-right post-notch (down the bend)
    ];
    // Inner path offset perpendicularly inward by STRIP.
    // For p1 (a corner), we offset both inward directions and use the
    // intersection. Simpler: for this specific pentagon, the inward
    // normals are well-defined per segment:
    //   - top edge: inward = (0, -1)
    //   - notch diagonal (from p1 to p2): direction is (NOTCH, -NOTCH)/√2,
    //     inward normal is (-NOTCH, -NOTCH)/√2 ≈ (-0.707, -0.707)
    // For the corner at p1 we use the bisector — for an exact mitre we'd
    // solve a small linear system, but a manual fudge works here because
    // the angle is fixed.
    const inner = [
      [HOLE_X,        H/2 - STRIP],                     // p0' under top edge
      [W/2 - NOTCH - STRIP * 0.6, H/2 - STRIP],          // p1' mitred inward
      [W/2 - STRIP * 0.707, H/2 - NOTCH - STRIP * 0.707] // p2' under the diagonal
    ];

    // Build the strip as a closed shape: outer p0 → p1 → p2, then inner p2' → p1' → p0', back to p0.
    const s = new THREE.Shape();
    s.moveTo(outer[0][0], outer[0][1]);
    s.lineTo(outer[1][0], outer[1][1]);
    s.lineTo(outer[2][0], outer[2][1]);
    s.lineTo(inner[2][0], inner[2][1]);
    s.lineTo(inner[1][0], inner[1][1]);
    s.lineTo(inner[0][0], inner[0][1]);
    s.lineTo(outer[0][0], outer[0][1]);

    return new THREE.ShapeGeometry(s);
  }
  const bracketGeo = makeBracketGeo();

  // === BINDER HOLE ===
  // Visible small dot at the upper-left, marking the start of the bracket.
  // Always its idle (near-black) color — the activation cue is the rail
  // and the folder pull-out, not the hole color.
  const HOLE_RADIUS = 0.06;
  const holeGeo = new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, 0.05, 16);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x0a1118 });

  // === BAR-PICK ===
  // Invisible larger plane covering the L-bracket + hole region for a
  // comfortable click target. The raycaster resolves intersections on
  // this mesh to the owning folder group.
  const BAR_PICK_W = 2.0;
  const BAR_PICK_H = 0.40;
  const barPickGeo = new THREE.PlaneGeometry(BAR_PICK_W, BAR_PICK_H);
  const barPickMat = new THREE.MeshBasicMaterial({
    visible: false, side: THREE.DoubleSide,
  });

  /* ---- Folder material — translucent dark slab ---- */
  function makeFolderMaterial(opacity = 0.78) {
    return new THREE.MeshPhysicalMaterial({
      color: 0x10171f,
      metalness: 0.15,
      roughness: 0.55,
      transmission: 0.0,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      clearcoat: 0.4,
      clearcoatRoughness: 0.4,
    });
  }

  /* ---- Folder type registry — THREE TYPES ONLY ----
     Reduced from 11 to 3 per the three-kind double-encoding spec.
     Each type's color signals both visual identity AND dispatch behavior:
       schematic (cyan)   — container — descent animation on activation
       ops       (amber)  — leaf w/ preview — bottom doc-preview panel
       core      (green)  — url — opens link in new tab
     The behavior dispatch itself is added in drop 2; drop 1 just uses
     these as the color palette for files loaded from sections.json. */
  const FOLDER_TYPES = {
    schematic: { label: 'CONTAINER', color: 0x2bb7d6 },  // cyan
    ops:       { label: 'PREVIEW',   color: 0xe0a437 },  // amber
    core:      { label: 'EXTERNAL',  color: 0x25d695 },  // green
  };
  const TYPE_EDGE_OPACITY = 0.85;

  /* Helpers used by the catalog builder. */
  const TYPE_FROM_KIND = {
    container: 'schematic',
    folder:    'ops',
    url:       'core',
  };

  /* ---- File-name pool ----
     Single source of truth for the simulated filename strings. Stand-in
     used for the engine's initial boot — before app.js wires up wheel +
     sections.json. After boot, FOLDER_CATALOG is swapped at runtime via
     window.FolderStack.setCatalog(...). The placeholder filenames stay
     here so the engine has SOMETHING to render in the brief window
     between Three.js init and the first wheel selection. */
  const PLACEHOLDER_FILE_NAMES = [
    '_NODE_VAULT_INIT',
    '_AWAITING_DATA',
    '_PLACEHOLDER_03',
    '_PLACEHOLDER_04',
    '_PLACEHOLDER_05',
    '_PLACEHOLDER_06',
    '_PLACEHOLDER_07',
  ];

  /* ---- Catalog generator ----
     Produces a stable placeholder catalog (no randomness in names).
     Cycles through the three new types. After this, the engine relies
     on _setCatalog() to receive real data from app.js. */
  function buildPlaceholderCatalog() {
    const typeKeys = Object.keys(FOLDER_TYPES);
    const previews = {
      schematic: 'CONTAINER STUB — awaiting data',
      ops:       'PREVIEW STUB — awaiting data',
      core:      'EXTERNAL STUB — awaiting data',
    };
    return PLACEHOLDER_FILE_NAMES.map((label, i) => {
      const type = typeKeys[i % typeKeys.length];
      return {
        id: 'P' + i,
        type,
        label,
        drive: 'DRIVE PLACEHOLDER/' + String(i).padStart(2, '0'),
        size: '—',
        modified: '—',
        preview: previews[type] || '—',
        // .kind preserved for future dispatch logic; not used in drop 1.
        kind: type === 'schematic' ? 'container' : (type === 'core' ? 'url' : 'folder'),
        url: null,
        path: null,
      };
    });
  }

  // FOLDER_CATALOG is a `let` (was const) so it can be re-assigned at
  // runtime when a wheel section is activated. All downstream code reads
  // it by name, so swapping the binding is transparent to the engine.
  let FOLDER_CATALOG = buildPlaceholderCatalog();

  /* ---- Catalog-swap jitter window ----
     When the catalog changes (descent into a container, ascent back,
     or wheel-section switch) the per-folder animate loop applies a
     short jittery wobble so the user notices the labels/colors changed.
     _jitterUntil is set to (now + JITTER_DURATION_MS) at every swap;
     the loop reads it and tapers amplitude to zero by the end. */
  let _jitterUntil = 0;
  const JITTER_DURATION_MS = 350;
  const JITTER_AMPLITUDE   = 0.06;

  /* External entry point: app.js calls this when a section is selected.
     Files arrive as the section's children array from sections.json —
     each entry has kind/label/url/files etc. We map kind -> folder-type
     so the engine's color/legend logic keeps working unchanged. */
  function _setCatalog(children, sectionLabel) {
    if (!Array.isArray(children) || children.length === 0) {
      FOLDER_CATALOG = buildPlaceholderCatalog();
    } else {
      FOLDER_CATALOG = children.map((c, i) => {
        const type = TYPE_FROM_KIND[c.kind] || 'ops';
        // Synthesize the inspector-rail metadata fields from whatever the
        // JSON provides. Most of these are decorative in drop 1; drop 2
        // will use them properly when ACTION dispatch is wired.
        let size = '—';
        let modified = '—';
        if (c.kind === 'folder' && Array.isArray(c.files)) {
          size = c.files.length + ' file' + (c.files.length === 1 ? '' : 's');
        } else if (c.kind === 'url') {
          size = 'link';
        } else if (c.kind === 'container' && Array.isArray(c.children)) {
          size = c.children.length + ' item' + (c.children.length === 1 ? '' : 's');
        }
        return {
          id: c.id || ('N' + i),
          type,
          label: c.label || '(unnamed)',
          drive: c.subtitle ? ('// ' + c.subtitle.toUpperCase()) : ('// ' + (sectionLabel || 'SECTION')),
          size,
          modified,
          preview: c.subtitle || ('// ' + c.kind.toUpperCase()),
          // Preserved for drop 2's dispatch:
          kind: c.kind,
          url: c.url || null,
          files: c.files || null,
          children: c.children || null,
        };
      });
    }
    // Force folderCount to match the new catalog size exactly. The
    // previous clamp logic preserved whatever value folderCount had
    // (capping or floor-ing it), which led to a bug where ascent
    // back to LIBRARY occasionally rendered fewer folders than the
    // catalog actually contained.
    //
    // Catalog length is the ground truth: the user always wants to
    // see all the items in the current level. No reason for the
    // count toggle (currently hidden in the UI anyway) to persist
    // across catalog swaps.
    folderCount = Math.min(20, FOLDER_CATALOG.length);
    if (folderCount < 1) folderCount = 1;
    setFolderCount(folderCount);

    // Kick off a "fresh folders" jitter window. The per-folder animate
    // loop reads _jitterUntil and applies a small position offset for
    // ~350ms after any catalog swap, so the user notices the change.
    _jitterUntil = performance.now() + JITTER_DURATION_MS;
  }

  /* ---- Descent / ascent animation state ----
     Single straight-line lerp from where the active folder IS to the
     button anchor (descent), and reverse (ascent). Catalog swap is
     instant at animation start; the corner-folder mesh flies/shrinks
     during the lerp.

     descentState / ascentState are the active animation or null. Each
     carries: t0, startPos, startScale, and (for ascent) targetPos.
  */
  let descentState = null;   // { t0, startPos, startScale }
  const DESCENT_MS = 600;

  let cornerFolder = null;   // THREE.Group or null
  let ascentState  = null;   // { t0, startPos, targetPos }
  const ASCENT_MS  = 500;

  // Corner-folder anchor: computed dynamically each frame from the
  // HTML BACK button's screen position. World-Z is fixed at CORNER_Z.
  const CORNER_Z      = 2.4;
  const CORNER_SCALE  = 0.55;

  // Fallback anchor in world coords, used if the BACK button can't be
  // located (e.g. during the brief window before the mount template
  // is templated, or if the button is hidden).
  const CORNER_ANCHOR_FALLBACK = { x: 1.3, y: -1.0, z: CORNER_Z };

  /* Compute the world position that projects to the BACK button's
     screen center at world-Z = CORNER_Z. The corner-folder's parked
     position is set to this each frame so the folder tracks the
     button precisely. */
  function _cornerAnchorFromButton() {
    const btn = document.getElementById('cornerBack');
    const cRect = canvas.getBoundingClientRect();
    if (!btn || !cRect.width || !cRect.height) return CORNER_ANCHOR_FALLBACK;
    const bRect = btn.getBoundingClientRect();
    if (!bRect.width || !bRect.height) return CORNER_ANCHOR_FALLBACK;

    // Button center in canvas-NDC. NDC ranges -1..+1 across the canvas;
    // Y is positive UP, the opposite of CSS Y, hence the negation.
    const cx = bRect.left + bRect.width  / 2;
    const cy = bRect.top  + bRect.height / 2;
    const ndcX =  ((cx - cRect.left) / cRect.width)  * 2 - 1;
    const ndcY = -((cy - cRect.top)  / cRect.height) * 2 + 1;

    // Convert NDC at world-Z = CORNER_Z to world-space coords.
    // For a perspective camera at (camX, camY, camZ) looking down -Z,
    // the visible half-height at distance d in front of the camera
    // is d * tan(fovY/2), half-width is that scaled by aspect.
    const dist = camera.position.z - CORNER_Z;
    const fovRad = camera.fov * Math.PI / 180;
    const halfTan = Math.tan(fovRad / 2);
    const worldX = ndcX * halfTan * dist * camera.aspect;
    const worldY = ndcY * halfTan * dist + camera.position.y;
    return { x: worldX, y: worldY, z: CORNER_Z };
  }

  /* ---- Corner-folder builder ----
     Constructs a small standalone folder Group from a catalog data
     entry. Re-uses the shared folderGeo/bracketGeo/holeGeo but uses
     fresh materials so the corner-folder's colors can change
     independently of the inline stack.

     The Group is scaled and positioned by the caller (animation
     loop) — this builder just produces it at unit scale at origin. */
  function _buildCornerFolderMesh(data) {
    const typeKey = data.type || 'ops';
    const typeInfo = FOLDER_TYPES[typeKey] || FOLDER_TYPES.ops;
    const edgeColorHex = typeInfo.color;

    const group = new THREE.Group();

    // Body
    const mat = makeFolderMaterial(0.88);
    const mesh = new THREE.Mesh(folderGeo, mat);
    group.add(mesh);

    // Edges
    const edgesGeoLocal = new THREE.EdgesGeometry(folderGeo, 30);
    const edgeMat = new THREE.LineBasicMaterial({
      color: edgeColorHex,
      transparent: true,
      opacity: 1.0,
      linewidth: 1,
    });
    const edges = new THREE.LineSegments(edgesGeoLocal, edgeMat);
    group.add(edges);

    // Bracket strip
    const bracketMat = new THREE.MeshBasicMaterial({
      color: edgeColorHex,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const bracket = new THREE.Mesh(bracketGeo, bracketMat);
    bracket.position.z = 0.025;
    group.add(bracket);

    // Binder hole
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.rotation.x = Math.PI / 2;
    hole.position.set(-0.82, 1.08, 0.028);
    group.add(hole);

    // Bar-pick (invisible click target — same plane the inline folders
    // use for raycaster picking, just on the corner-folder's own group)
    const barPick = new THREE.Mesh(barPickGeo, barPickMat.clone());
    barPick.position.set(0, 1.10, 0.03);
    barPick.userData.isCornerPick = true;
    group.add(barPick);

    // Face label
    const faceLabel = makeFaceLabelMesh(data.label || '(parent)', edgeColorHex);
    group.add(faceLabel);

    group.userData = {
      data: data,
      isCornerFolder: true,
      mesh: mesh,
      edges: edges,
      edgesGeo: edgesGeoLocal,
      bracket: bracket,
      bracketMat: bracketMat,
      hole: hole,
      barPick: barPick,
      faceLabel: faceLabel,
    };
    return group;
  }

  /* Adjust the opacity of every material in the corner-folder. Used
     during ascent to fade the folder out as it reaches its target. */
  function _setCornerFolderOpacity(group, opacity) {
    if (!group || !group.userData) return;
    const ud = group.userData;
    if (ud.mesh && ud.mesh.material) {
      ud.mesh.material.transparent = true;
      ud.mesh.material.opacity = opacity * 0.88; // body keeps its baseline
    }
    if (ud.edges && ud.edges.material) {
      ud.edges.material.transparent = true;
      ud.edges.material.opacity = opacity;
    }
    if (ud.bracketMat) {
      ud.bracketMat.transparent = true;
      ud.bracketMat.opacity = opacity * 0.95;
    }
    if (ud.faceLabel && ud.faceLabel.material) {
      ud.faceLabel.material.transparent = true;
      ud.faceLabel.material.opacity = opacity;
    }
  }

  function _disposeCornerFolder() {
    if (!cornerFolder) return;
    scene.remove(cornerFolder);
    // Free per-instance materials/geometries (geometries that are
    // shared with the inline folders — folderGeo/bracketGeo/holeGeo —
    // are NOT disposed since they outlive the corner-folder).
    const ud = cornerFolder.userData;
    if (ud) {
      if (ud.edgesGeo) ud.edgesGeo.dispose();
      if (ud.edges && ud.edges.material) ud.edges.material.dispose();
      if (ud.mesh  && ud.mesh.material)  ud.mesh.material.dispose();
      if (ud.bracketMat) ud.bracketMat.dispose();
      if (ud.barPick && ud.barPick.material) ud.barPick.material.dispose();
      if (ud.faceLabel) {
        if (ud.faceLabel.material) {
          if (ud.faceLabel.material.map) ud.faceLabel.material.map.dispose();
          ud.faceLabel.material.dispose();
        }
        if (ud.faceLabel.geometry) ud.faceLabel.geometry.dispose();
      }
    }
    cornerFolder = null;
  }

  /* Programmatic ascent — clicking the corner-folder calls this.
     Captures the corner-folder's CURRENT position, swaps catalog to
     the parent level instantly, then lerps the corner-folder in a
     single straight line to the BACK of the new queue (deepest slot)
     while growing to scale 1.0. Disposed at the end.

     Why the back of the queue, not slot 0? Slot 0 is the front-most
     folder and visually crowded. Landing the returning corner-folder
     at the deepest slot looks like "tucking it back behind everyone
     else" — clean, no overlap with the front folder. */
  function _ascendFromCorner(parentChildren, parentLabel) {
    if (!cornerFolder) return;
    if (ascentState || descentState) return;

    // 1. Capture current corner-folder transform.
    const startPos = {
      x: cornerFolder.position.x,
      y: cornerFolder.position.y,
      z: cornerFolder.position.z,
    };

    // 2. Swap catalog to parent level instantly. This also rebuilds
    //    the fan; the new count gives us the back-slot position.
    _setCatalog(parentChildren, parentLabel);
    activeIndex = -1;
    state = STATE.IDLE;
    resetRailToIdle();

    // 3. Compute the BACK-slot target position. Each slot inside
    //    fanGroup has a local position from slotLayout; the back slot
    //    is index (count - 1). Add fanGroup's world offset to convert.
    const count = folders.length || 1;
    const backLocal = slotLayout(count - 1, count);
    const fanPos = fanGroup.position;
    const targetPos = {
      x: fanPos.x + backLocal.x,
      y: fanPos.y + backLocal.y,
      z: fanPos.z + backLocal.z,
    };

    ascentState = {
      t0: performance.now(),
      startPos: startPos,
      targetPos: targetPos,
    };
  }

  function _setCatalogWithDescent(children, sectionLabel) {
    // If no active folder, just swap instantly. No animation possible
    // because there's nothing to clone.
    if (activeIndex < 0) {
      _setCatalog(children, sectionLabel);
      return;
    }
    if (descentState || ascentState) return;

    // 1. Capture the active folder's current world-space transform.
    //    This is where the corner-folder clone will START — exactly
    //    where the user just saw the original.
    const active = folders[activeIndex];
    const parentData = active && active.userData && active.userData.data;
    if (!parentData) {
      _setCatalog(children, sectionLabel);
      return;
    }
    // World position: the folder lives inside fanGroup, so we read its
    // group's local position and add fanGroup's offset to get world.
    const localPos = active.position;
    const fanPos = fanGroup.position;
    const startPos = {
      x: localPos.x + fanPos.x,
      y: localPos.y + fanPos.y,
      z: localPos.z + fanPos.z,
    };
    const startScale = active.scale.x;     // uniform scale assumed

    // 2. Build the clone at that exact world position + scale.
    //    Added directly to `scene` so it isn't affected by the fan's
    //    breathing rotation. Same baseline rotY as inline folders.
    if (cornerFolder) _disposeCornerFolder();
    cornerFolder = _buildCornerFolderMesh(parentData);
    cornerFolder.position.set(startPos.x, startPos.y, startPos.z);
    cornerFolder.scale.setScalar(startScale);
    cornerFolder.rotation.y = -0.22;
    scene.add(cornerFolder);

    // 3. Swap catalog instantly. The new fan replaces the old fan in
    //    place; the cloned corner-folder we just spawned floats over
    //    everything and will lerp to the button anchor.
    _setCatalog(children, sectionLabel);
    activeIndex = -1;
    state = STATE.IDLE;
    resetRailToIdle();

    // 4. Start the lerp.
    descentState = {
      t0: performance.now(),
      startPos: startPos,
      startScale: startScale,
    };
  }

  /* ---- Type legend ----
     Defined BEFORE buildFolders so the call inside buildFolders never
     hits a TDZ-style ReferenceError, regardless of how the script is
     loaded (inline, module, or otherwise). */
  const legendBodyEl  = document.getElementById('legendBody');
  const legendCountEl = document.getElementById('legendCount');

  function buildLegend(count) {
    if (!legendBodyEl) return;
    const presentTypes = new Set(
      FOLDER_CATALOG.slice(0, count).map(d => d.type)
    );
    legendBodyEl.innerHTML = '';
    Object.entries(FOLDER_TYPES).forEach(([typeKey, def]) => {
      const row = document.createElement('div');
      row.className = 'legend-row' + (presentTypes.has(typeKey) ? '' : ' dim');
      const hex = '#' + def.color.toString(16).padStart(6, '0');
      row.innerHTML =
        '<span class="swatch" style="background:' + hex + '; color:' + hex + '"></span>' +
        '<span class="legend-label">' + def.label + '</span>';
      legendBodyEl.appendChild(row);
    });
    if (legendCountEl) {
      legendCountEl.textContent = presentTypes.size + '/' + Object.keys(FOLDER_TYPES).length;
    }
  }

  /* ---- Face label helper ----
     Renders folder text onto a 2D canvas, then attaches it as a textured
     plane on the front face of the folder mesh. Color matches the edge
     color of the folder's type so the eye binds name <-> stripe instantly. */
  function makeFaceLabelMesh(text, hexColor, folderW = 2.0, folderH = 2.6) {
    // Increase texture resolution AND the rendered plane so labels read
    // larger on screen without scaling the folder mesh itself.
    const cw = 1280, ch = 480;
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    // Hex int -> css rgb
    const r = (hexColor >> 16) & 0xff;
    const g = (hexColor >>  8) & 0xff;
    const b =  hexColor        & 0xff;
    const css = `rgb(${r}, ${g}, ${b})`;

    // === Filename, dead center, no other chrome ===
    // Largest single-line font that fits, floor 64px. If still too wide,
    // wrap at the nearest underscore past midpoint.
    let line1 = text, line2 = '';
    let fontPx = 120;
    ctx.font = `bold ${fontPx}px "Courier New", ui-monospace, monospace`;
    while (ctx.measureText(text).width > cw - 120 && fontPx > 64) {
      fontPx -= 4;
      ctx.font = `bold ${fontPx}px "Courier New", ui-monospace, monospace`;
    }
    if (ctx.measureText(text).width > cw - 120) {
      const mid = (text.length / 2) | 0;
      let breakAt = -1;
      for (let k = mid; k < text.length; k++) {
        if (text[k] === '_') { breakAt = k; break; }
      }
      if (breakAt < 0) breakAt = mid;
      line1 = text.slice(0, breakAt);
      line2 = text.slice(breakAt);
      fontPx = 90;
      ctx.font = `bold ${fontPx}px "Courier New", ui-monospace, monospace`;
    }

    ctx.fillStyle = css;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (line2) {
      ctx.fillText(line1, cw / 2, ch / 2 - (fontPx * 0.6));
      ctx.fillText(line2, cw / 2, ch / 2 + (fontPx * 0.6));
    } else {
      ctx.fillText(line1, cw / 2, ch / 2);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;

    // Label plane: ~95% of folder width (was 88%) — gives the bigger
    // text the room it needs without crowding the binder hole or edge.
    const planeW = folderW * 0.95;
    const planeH = planeW * (ch / cw);
    const geo = new THREE.PlaneGeometry(planeW, planeH);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      // polygonOffset pulls the label PLANE forward in the depth buffer
      // so it can never z-fight with the folder's front face.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Position: centered on the folder face. Z offset clears the front face.
    mesh.position.set(0, 0, 0.04);
    return mesh;
  }

  /* ---- Slot layout helper ----
     Given a slot index i and the total visible count N, returns the
     position/rotation/renderOrder that the folder occupying that slot
     should target. Called from buildFolders (initial) and from
     applyDisplayOrder (re-rank). */
  function slotLayout(i, count) {
    const stepX =  0.52;
    const stepY =  0.30;
    const stepZ = -0.85;
    return {
      x: i * stepX,
      y: i * stepY,
      z: i * stepZ,
      rotY: -0.22,
      renderOrder: (count - i) * 10,
    };
  }

  /* ---- Build the fan of folders ---- */
  const folders = [];
  const fanGroup = new THREE.Group();
  // Anchor stack: bottom-left of frame, leaning toward upper-right.
  // (Inherited from the prototype — visually well-tuned for the
  // current camera FOV and host aspect.)
  fanGroup.position.set(-2.6, -0.8, -0.5);
  fanGroup.rotation.y = -0.08;
  scene.add(fanGroup);

  // displayOrder[slotIdx] = the catalog-index currently sitting at slot.
  // This is the single source of truth for rolodex rotation and find rerank.
  // Note: folders[i] is bound to a stable catalog entry once built; we
  // reorder by mutating each folder's basePos/baseRotY/renderOrder and
  // re-sorting the folders[] array to match new slot order, then letting
  // the existing position-lerp in animate() smoothly tween everyone home.
  let displayOrder = [];

  function buildFolders(count) {
    // Tear down any existing folders
    while (folders.length) {
      const f = folders.pop();
      fanGroup.remove(f);
      // Dispose materials and textures to avoid GPU leak when toggling count
      if (f.userData.mesh) f.userData.mesh.material.dispose();
      if (f.userData.edges) f.userData.edges.material.dispose();
      if (f.userData.edgesHalo) f.userData.edgesHalo.material.dispose();
      if (f.userData.bracketMat) f.userData.bracketMat.dispose();
      if (f.userData.faceLabel) {
        f.userData.faceLabel.material.map?.dispose();
        f.userData.faceLabel.material.dispose();
        f.userData.faceLabel.geometry.dispose();
      }
    }
    // Reset interaction state
    state = STATE.IDLE;
    activeIndex = -1;
    triggerMouse = null;
    lastReturnMouse = null;
    updateTagsColumn(count);

    // Reset display order to natural catalog order
    displayOrder = Array.from({length: count}, (_, i) => i);
    // Clear any active filter rerank
    if (typeof findInput !== 'undefined' && findInput) findInput.value = '';

    const data = FOLDER_CATALOG.slice(0, count);
    data.forEach((d, i) => {
      const group = new THREE.Group();
      const isFront = i === 0;
      const opacity = isFront ? 0.92 : 0.55 - i * 0.05;
      const mat = makeFolderMaterial(Math.max(0.22, opacity));
      const mesh = new THREE.Mesh(folderGeo, mat);
      // Keep depthWrite ON so the stack's spatial Z-order is honored. We
      // use renderOrder only to break ties for transparents at similar depths,
      // not to override depth.
      mat.depthWrite = true;
      group.add(mesh);

      // Edges are tinted by folder TYPE so the user can read type at a glance.
      const typeDef = FOLDER_TYPES[d.type];
      const edgeColorHex = typeDef ? typeDef.color : 0x0a1118;
      const edgesGeo = new THREE.EdgesGeometry(folderGeo, 30);
      const edges = new THREE.LineSegments(
        edgesGeo,
        new THREE.LineBasicMaterial({
          color: edgeColorHex, transparent: true, opacity: TYPE_EDGE_OPACITY,
        })
      );
      group.add(edges);

      // Edge HALO: a second edges layer used to simulate a thicker border
      // when this folder is active. Scaled slightly outward so it sits
      // just OUTSIDE the original silhouette, creating a double-stroke
      // that visually reads as a fatter line. (WebGL LineBasicMaterial
      // ignores linewidth > 1 on most platforms — this is the workaround.)
      const edgesHalo = new THREE.LineSegments(
        edgesGeo,
        new THREE.LineBasicMaterial({
          color: edgeColorHex,
          transparent: true,
          opacity: 0,        // animated up when active
          depthWrite: false, // halo doesn't occlude
        })
      );
      edgesHalo.scale.set(1.012, 1.012, 1.012); // 1.2% outward
      group.add(edgesHalo);

      // Activator L-BRACKET: structural strip following the top edge from
      // the binder hole through the first corner notch. Same color as the
      // folder's border (type color). Sits just in front of the folder
      // face. Color does NOT change on activation — the bracket is part
      // of the folder's identity.
      const bracketMat = new THREE.MeshBasicMaterial({
        color: edgeColorHex,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
      const bracket = new THREE.Mesh(bracketGeo, bracketMat);
      bracket.position.z = 0.025; // in front of face, behind face label
      group.add(bracket);

      // Binder hole: small black dot at the start of the bracket
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(-0.82, 1.08, 0.028);
      group.add(hole);

      // Bar-PICK: invisible click target covering the bracket region.
      // The raycaster resolves intersections on this mesh to the owning
      // folder group via userData.folderGroup.
      const barPick = new THREE.Mesh(barPickGeo, barPickMat);
      // Position the pick rect over the top half of the folder face so
      // clicks anywhere along the L-bracket register comfortably.
      barPick.position.set(0, 1.10, 0.03);
      barPick.userData.isBarPick = true;
      group.add(barPick);

      // Face label — text in type color on the front face
      const faceLabel = makeFaceLabelMesh(d.label, edgeColorHex);
      group.add(faceLabel);

      // Initial slot = i (catalog order). Reorder logic mutates these later.
      const slot = slotLayout(i, count);
      group.position.set(slot.x, slot.y, slot.z);
      group.rotation.y = slot.rotY;

      // === Render order ===
      // Front-of-stack (slot 0) is closest to the camera, draws LAST (on top).
      const baseRenderOrder = slot.renderOrder;
      mesh.renderOrder      = baseRenderOrder;
      edges.renderOrder     = baseRenderOrder + 1;
      edgesHalo.renderOrder = baseRenderOrder + 1;  // same layer as edges
      bracket.renderOrder   = baseRenderOrder + 2;
      hole.renderOrder      = baseRenderOrder + 3;
      faceLabel.renderOrder = baseRenderOrder + 3;

      group.userData = {
        catalogIndex: i,   // stable identity (index into FOLDER_CATALOG)
        slot: i,           // current visible slot (mutated by rerank/scroll)
        basePos: new THREE.Vector3(slot.x, slot.y, slot.z),
        baseRotY: slot.rotY,
        data: d,
        mesh,
        edges,
        edgesHalo,
        bracket,
        bracketMat,
        hole,
        barPick,
        faceLabel,
        hoverT: 0,
        baseRenderOrder,
        baseColorHex: 0x10171f,
        baseEdgeColorHex: edgeColorHex,
        baseEdgeOpacity: TYPE_EDGE_OPACITY,
      };

      // Back-reference so the raycaster on the bar-pick can resolve to the group
      barPick.userData.folderGroup = group;

      fanGroup.add(group);
      folders.push(group);
    });
    // After folders are added, refresh legend + rail
    buildLegend(count);
    resetRailToIdle();
    // Scroll meta reflects new front folder
    if (typeof refreshScrollMeta === 'function') refreshScrollMeta();
    if (typeof findCountEl !== 'undefined' && findCountEl) findCountEl.textContent = '—';
    if (typeof findClearBtn !== 'undefined' && findClearBtn) findClearBtn.disabled = true;
  }

  /* ---- Slot reorder (rolodex / find-rerank) ----
     newOrder: array of folder references, length = folders.length, in
     new slot order (slot 0 = front of stack, last = back). Mutates
     folders[] to match and retargets each folder's slot pos/rot/render.
     The active folder's identity stays put — its activeIndex is
     re-derived after the reorder. */
  function applyDisplayOrder(newOrder) {
    if (newOrder.length !== folders.length) return;
    const count = folders.length;

    // Remember the currently-active folder ref so we can keep activeIndex
    // pointing at it after the reorder.
    const activeFolder = (activeIndex >= 0) ? folders[activeIndex] : null;

    // Reassign slots
    for (let newSlot = 0; newSlot < count; newSlot++) {
      const f = newOrder[newSlot];
      f.userData.slot = newSlot;
      const lay = slotLayout(newSlot, count);
      // SET TARGETS — the animation loop lerps basePos/baseRotY toward these
      f.userData.targetPos  = new THREE.Vector3(lay.x, lay.y, lay.z);
      f.userData.targetRotY = lay.rotY;
      // Render order snaps (no tween — depth-correct sort is more important
      // than visual smoothness here)
      f.userData.baseRenderOrder = lay.renderOrder;
    }

    // Re-sort folders[] in place to match slot order
    folders.length = 0;
    newOrder.forEach(f => folders.push(f));

    // Re-derive activeIndex by identity (the active folder may have moved)
    if (activeFolder) {
      activeIndex = folders.indexOf(activeFolder);
    }

    // Scroll meta shows the new front-folder id
    if (typeof refreshScrollMeta === 'function') refreshScrollMeta();
  }

  /* ---- Rolodex rotation ---- */
  function rotateStack(direction) {
    // direction: +1 = forward (front folder cycles to back)
    //            -1 = backward (back folder cycles to front)
    if (folders.length < 2) return;
    if (state !== STATE.IDLE) return; // don't reorder mid-selection
    const newOrder = folders.slice();
    if (direction > 0) {
      const head = newOrder.shift();
      newOrder.push(head);
    } else {
      const tail = newOrder.pop();
      newOrder.unshift(tail);
    }
    applyDisplayOrder(newOrder);
  }

  /* ---- Find / filter ----
     Scores each folder against a query; lower score = better match.
     Scoring:
       0    : exact match
       1    : prefix match (case-insensitive)
       2    : substring match
       100  : no match
     Ties broken by original catalog order so it stays stable. */
  function scoreLabel(label, q) {
    if (!q) return 100;
    const L = label.toLowerCase();
    if (L === q) return 0;
    if (L.startsWith(q)) return 1;
    if (L.includes(q)) return 2;
    return 100;
  }

  function applyFilter(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      // Empty query — restore catalog order (folders sorted by catalogIndex)
      const restored = folders.slice().sort(
        (a, b) => a.userData.catalogIndex - b.userData.catalogIndex
      );
      applyDisplayOrder(restored);
      return { matches: 0, total: folders.length };
    }
    const decorated = folders.map((f, k) => ({
      f,
      score: scoreLabel(f.userData.data.label, q),
      origCat: f.userData.catalogIndex,
    }));
    decorated.sort((a, b) => a.score - b.score || a.origCat - b.origCat);
    applyDisplayOrder(decorated.map(d => d.f));
    const matches = decorated.filter(d => d.score < 100).length;
    return { matches, total: folders.length };
  }

  // (fanGroup.position was set at line 722, when the fanGroup was
  // created. The prototype had a second .position.set call here that
  // overrode the corner-folder-fitting offset — removed.)

  /* ---- Raycasting for hover/click ---- */
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(-10, -10);
  const mousePx = new THREE.Vector2(-9999, -9999); // raw pixel mouse for delta checks

  // ===== STATE MACHINE =====
  // Atomic transaction: pull-out → out → (optional: held while dialog open) → pull-back → idle.
  // While any folder is in a non-IDLE state, no other folder can be selected.
  const STATE = {
    IDLE:          'IDLE',
    PULLING_OUT:   'PULLING_OUT',
    OUT:           'OUT',          // cursor controls exit
    HELD:          'HELD',         // click happened; folder locked OUT until dialog dismissed
    PULLING_BACK:  'PULLING_BACK',
  };
  let state = STATE.IDLE;
  let activeIndex = -1;
  let triggerMouse = null;
  let lastReturnMouse = null;
  let pendingTransferAfterReturn = false;

  const T_OUT_REACHED   = 0.97;
  const T_REST_REACHED  = 0.02;
  const EXIT_MOUSE_PX   = 30;
  const REACQ_MOUSE_PX  = 8;

  function onPointerMove(e) {
    // NDC must be computed against the CANVAS's rect (the actual draw
    // surface), not the window. When the canvas is bounded inside a
    // host pane this is critical for accurate raycasting.
    const r = canvas.getBoundingClientRect();
    mouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    mouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
    mousePx.x = e.clientX;
    mousePx.y = e.clientY;
  }
  function onPointerLeave() {
    mouse.x = -10; mouse.y = -10;
    mousePx.x = -9999; mousePx.y = -9999;
  }
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerleave', onPointerLeave);

  /* ---- Click handler ---- */
  const accessDialog = document.getElementById('accessDialog');
  const driveName    = document.getElementById('driveName');
  const accessMsgEl  = document.getElementById('accessMsg');
  const dialogYesBtn = document.getElementById('dialogYes');
  const dialogNoBtn  = document.getElementById('dialogNo');
  const sectorLabel  = document.getElementById('sectorLabel');

  // Idle state of the rail's two interactive blocks. Called whenever a
  // selection is cleared (NO, deactivation, post-transfer rebuild).
  function resetRailToIdle() {
    // FILE INSPECT goes idle
    fileInfoEl.classList.remove('active');
    // ACCESS goes idle
    accessDialog.classList.remove('active');
    dialogYesBtn.disabled = true;
    dialogNoBtn.disabled  = true;
    driveName.textContent = '— no drive —';
    accessMsgEl.innerHTML = 'select a folder to begin transfer';
    // Legend dims un-selected types? No — legend stays as-is; it's the key.
  }

  /* ---- Folder clicks are handled by canvas-level raycaster on hole-pick
         discs (see pickHoleAtPointer + canvas click listener above). ---- */

  dialogYesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // YES: release HELD so the folder slides back. Once the pull-back
    // animation completes, runTransferAndReset() fires (showing the
    // transfer overlay) and rebuilds the stack from scratch.
    if (state === STATE.HELD) {
      state = STATE.PULLING_BACK;
      pendingTransferAfterReturn = true;
    }
    // Disable buttons immediately so it can't be double-fired during pull-back
    dialogYesBtn.disabled = true;
    dialogNoBtn.disabled  = true;
    sectorLabel.style.opacity = '1';
  });
  dialogNoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // NO: cancel selection. Same as clicking the active bar again.
    deactivateActive();
  });


  /* ---- Render side filename tags from the fan ---- */
  const tagsEl = document.getElementById('folderTags');
  function updateTagsColumn(count) {
    tagsEl.innerHTML = '';
    FOLDER_CATALOG.slice(0, count).slice().reverse().forEach(d => {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = d.label;
      tagsEl.appendChild(t);
    });
  }

  /* ---- Bar-pick raycaster ----
     The thin activator bar at the top of each folder is the click target.
     We raycast into the scene against each folder's invisible barPick
     plane (larger than the visible bar for click comfort), and toggle
     activate/deactivate based on which one (if any) was hit. */
  const _ndc = new THREE.Vector2();
  function pickBarAtPointer(ev) {
    // Same as onPointerMove: NDC against canvas rect, not window.
    const r = canvas.getBoundingClientRect();
    _ndc.x =  ((ev.clientX - r.left) / r.width)  * 2 - 1;
    _ndc.y = -((ev.clientY - r.top)  / r.height) * 2 + 1;
    raycaster.setFromCamera(_ndc, camera);
    // Build the candidate list from each folder's barPick mesh
    const targets = folders.map(f => f.userData.barPick).filter(Boolean);
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    // intersectObjects returns nearest-first; take the front-most one.
    return hits[0].object.userData.folderGroup || null;
  }

  /* Raycast helper for the corner-folder. Returns true if the hit
     intersected the corner-folder's bar-pick plane. */
  function _pickCornerAtPointer(ev) {
    if (!cornerFolder) return false;
    const r = canvas.getBoundingClientRect();
    _ndc.x =  ((ev.clientX - r.left) / r.width)  * 2 - 1;
    _ndc.y = -((ev.clientY - r.top)  / r.height) * 2 + 1;
    raycaster.setFromCamera(_ndc, camera);
    // The bar-pick AND the body mesh + edges all count as click targets
    // on the corner folder — the user can click anywhere on it.
    const targets = [];
    const ud = cornerFolder.userData;
    if (ud.barPick) targets.push(ud.barPick);
    if (ud.mesh)    targets.push(ud.mesh);
    if (targets.length === 0) return false;
    const hits = raycaster.intersectObjects(targets, false);
    return hits.length > 0;
  }

  // Single canvas click handler: corner-folder first, then bar-pick.
  canvas.addEventListener('click', (ev) => {
    if (_pickCornerAtPointer(ev)) {
      // Fire a generic event — docs-nav.js owns the pathStack and knows
      // what the parent level's children should be. The engine doesn't.
      try {
        window.dispatchEvent(new CustomEvent('helix:corner-click'));
      } catch (_) { /* no-op */ }
      return;
    }
    const hit = pickBarAtPointer(ev);
    if (!hit) return;
    const slotIdx = folders.indexOf(hit);
    if (slotIdx < 0) return;
    onFolderClick(slotIdx);
  });

  // Cursor feedback — pointer when hovering the activator bar OR the corner.
  canvas.addEventListener('pointermove', (ev) => {
    const cornerHit = _pickCornerAtPointer(ev);
    const barHit = !cornerHit && pickBarAtPointer(ev);
    canvas.style.cursor = (cornerHit || barHit) ? 'pointer' : 'default';
  });

  // === Folder activate / deactivate ===
  // Click an inactive bar -> folder slides out, becomes active, bar
  //   brightens, rail's FILE INSPECT + ACCESS go active.
  // Click the active bar -> deactivate.
  // Click any other bar while one is active -> ignored.
  function onFolderClick(idx) {
    if (activeIndex === idx) { deactivateActive(); return; }
    if (activeIndex !== -1)  return; // another is active; ignore
    if (state !== STATE.IDLE) return;

    // === ACTIVATE ===
    activeIndex = idx;
    state = STATE.PULLING_OUT;
    triggerMouse = null;

    // Populate the rail's FILE INSPECT block
    populateFileInfo(idx);
    fileInfoEl.classList.add('active');

    // Activate the rail's ACCESS block
    const f = folders[idx];
    driveName.textContent = f.userData.data.drive;
    accessMsgEl.innerHTML = 'This folder is encrypted.<br/>Continue with the transfer?';
    accessDialog.classList.add('active');
    dialogYesBtn.disabled = false;
    dialogNoBtn.disabled  = false;
    sectorLabel.style.opacity = '0.4';
    state = STATE.HELD; // animation keeps folder OUT until dialog resolved

    // Broadcast activation so external listeners (docs-nav.js) can
    // react — e.g. show the URL launch card for kind:url folders.
    try {
      window.dispatchEvent(new CustomEvent('helix:folder-active', {
        detail: { folder: f.userData.data }
      }));
    } catch (_) { /* no-op */ }
  }

  // Used by NO button and by clicking the active bar
  function deactivateActive() {
    if (activeIndex < 0) return;
    if (state === STATE.OUT || state === STATE.HELD || state === STATE.PULLING_OUT) {
      state = STATE.PULLING_BACK;
    }
    resetRailToIdle();
    sectorLabel.style.opacity = '1';
    try {
      window.dispatchEvent(new CustomEvent('helix:folder-deactive'));
    } catch (_) { /* no-op */ }
  }

  /* ---- File info panel population ---- */
  const fileInfoEl   = document.getElementById('fileInfo');
  const fiNameEl     = document.getElementById('fiName');
  const fiTypeEl     = document.getElementById('fiType');
  const fiDriveEl    = document.getElementById('fiDrive');
  const fiSizeEl     = document.getElementById('fiSize');
  const fiModifiedEl = document.getElementById('fiModified');
  const fiPreviewEl  = document.getElementById('fiPreview');

  function randomHex(len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += '0123456789ABCDEF'[(Math.random() * 16) | 0];
      if (i > 0 && i % 2 === 1 && i < len - 1) s += ' ';
    }
    return s;
  }

  function populateFileInfo(idx) {
    const d = folders[idx].userData.data;
    const typeDef = FOLDER_TYPES[d.type];
    fiNameEl.textContent     = d.label;
    if (typeDef) {
      // Show as colored chip so it visually echoes the folder's edge color
      const hex = '#' + typeDef.color.toString(16).padStart(6, '0');
      fiTypeEl.innerHTML =
        '<span style="color:' + hex + '; text-shadow:0 0 6px ' + hex + '88">' +
        typeDef.label + '</span>';
    } else {
      fiTypeEl.textContent = '—';
    }
    fiDriveEl.textContent    = d.drive;
    fiSizeEl.textContent     = d.size || '— MB';
    fiModifiedEl.textContent = d.modified || '—';
    // Preview: the simulated content blurb + a hex tail to look like raw data
    fiPreviewEl.innerHTML =
      (d.preview || '').replace(/\n/g, '<br>') +
      '<br><span class="hex">' + randomHex(48) + '</span>';
  }

  /* ---- Count panel: change number of folders ----
     MIN/MAX were originally `const` evaluated against the placeholder
     catalog at module load. Since FOLDER_CATALOG is reassigned by
     _setCatalog() when a wheel section is activated, the bounds must
     be recomputed dynamically — wrapped as `_getMinCount/_getMaxCount`
     functions that read the current catalog each call. */
  function _getMaxCount() { return Math.min(20, FOLDER_CATALOG.length); }
  // Floor at 1 so single-child sections (e.g. NETWORK) still render.
  function _getMinCount() { return Math.min(2, FOLDER_CATALOG.length); }
  let folderCount = 7;
  const countValueEl = document.getElementById('countValue');
  const countUpBtn   = document.getElementById('countUp');
  const countDownBtn = document.getElementById('countDown');

  function setFolderCount(n) {
    const lo = _getMinCount();
    const hi = _getMaxCount();
    folderCount = Math.max(lo, Math.min(hi, n));
    countValueEl.textContent = folderCount;
    countUpBtn.disabled   = folderCount >= hi;
    countDownBtn.disabled = folderCount <= lo;
    buildFolders(folderCount);
  }
  countUpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setFolderCount(folderCount + 1);
  });
  countDownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setFolderCount(folderCount - 1);
  });

  /* ---- Find input ---- */
  const findInput    = document.getElementById('findInput');
  const findClearBtn = document.getElementById('findClear');
  const findCountEl  = document.getElementById('findCount');

  function updateFindCount(matches) {
    if (!findCountEl) return;
    const q = findInput.value.trim();
    if (!q) { findCountEl.textContent = '—'; return; }
    findCountEl.textContent = matches + '/' + folders.length;
  }

  // Debounce (small) — every keystroke applies, but rerank is cheap
  let _findDebounce = 0;
  findInput.addEventListener('input', () => {
    clearTimeout(_findDebounce);
    _findDebounce = setTimeout(() => {
      const { matches } = applyFilter(findInput.value);
      updateFindCount(matches);
      findClearBtn.disabled = findInput.value.length === 0;
    }, 60);
  });
  findClearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    findInput.value = '';
    applyFilter('');
    updateFindCount(0);
    findClearBtn.disabled = true;
    findInput.focus();
  });

  /* ---- Scroll buttons ---- */
  const scrollFwdBtn  = document.getElementById('scrollFwd');
  const scrollBackBtn = document.getElementById('scrollBack');
  const scrollMetaEl  = document.getElementById('scrollMeta');

  function refreshScrollMeta() {
    // Show "front catalog-id / total". Front is folders[0] after any rerank.
    if (!scrollMetaEl) return;
    const front = folders[0];
    if (!front) { scrollMetaEl.textContent = '—'; return; }
    scrollMetaEl.textContent =
      (front.userData.catalogIndex + 1) + ' / ' + folders.length;
  }

  scrollFwdBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    rotateStack(+1);
    refreshScrollMeta();
  });
  scrollBackBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    rotateStack(-1);
    refreshScrollMeta();
  });

  // Keyboard shortcuts: arrow keys also rotate (ignored while focused in input)
  window.addEventListener('keydown', (e) => {
    if (e.target === findInput) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault(); rotateStack(+1); refreshScrollMeta();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault(); rotateStack(-1); refreshScrollMeta();
    }
  });

  /* ---- Transfer flow: shown briefly after YES, then reset stack ---- */
  const transferOverlay = document.getElementById('transferOverlay');
  function runTransferAndReset() {
    // Rail returns to idle state (FILE INSPECT goes blank, ACCESS buttons disabled)
    resetRailToIdle();
    transferOverlay.classList.add('shown');
    setTimeout(() => {
      transferOverlay.classList.remove('shown');
      // Reset everything to original — fresh build of the same count
      buildFolders(folderCount);
    }, 1200);
  }

  /* ---- Initial build ---- */
  setFolderCount(folderCount);

  /* ---- Animation loop ---- */
  const clock = new THREE.Clock();

  function animate() {
    const dt = Math.min(clock.getDelta(), 0.033);
    const now = performance.now();

    // ===== DESCENT ANIMATION =====
    // Single straight-line lerp. The corner-folder was built at the
    // active folder's exact world position when descent started, and
    // the catalog was swapped at the same moment. From here we just
    // glide it to the button anchor while shrinking.
    if (descentState) {
      const ds = descentState;
      const elapsed = now - ds.t0;
      const u = Math.min(1, elapsed / DESCENT_MS);
      const ee = 1 - Math.pow(1 - u, 2);   // ease-out quadratic

      if (cornerFolder) {
        const anchor = _cornerAnchorFromButton();
        const sx = ds.startPos.x, sy = ds.startPos.y, sz = ds.startPos.z;
        cornerFolder.position.x = sx + (anchor.x - sx) * ee;
        cornerFolder.position.y = sy + (anchor.y - sy) * ee;
        cornerFolder.position.z = sz + (anchor.z - sz) * ee;
        const s = ds.startScale + (CORNER_SCALE - ds.startScale) * ee;
        cornerFolder.scale.setScalar(s);
      }

      if (u >= 1) descentState = null;
    }

    // ===== ASCENT ANIMATION =====
    // Single straight-line lerp from the button anchor back to the
    // inline slot-0 position (world origin), growing back to full
    // scale. The catalog was already swapped to the parent level
    // when ascent started.
    if (ascentState) {
      const as = ascentState;
      const elapsed = now - as.t0;
      const u = Math.min(1, elapsed / ASCENT_MS);
      const ee = 1 - Math.pow(1 - u, 2);

      if (cornerFolder) {
        const sx = as.startPos.x, sy = as.startPos.y, sz = as.startPos.z;
        cornerFolder.position.x = sx + (as.targetPos.x - sx) * ee;
        cornerFolder.position.y = sy + (as.targetPos.y - sy) * ee;
        cornerFolder.position.z = sz + (as.targetPos.z - sz) * ee;
        const s = CORNER_SCALE + (1.0 - CORNER_SCALE) * ee;
        cornerFolder.scale.setScalar(s);

        // Fade opacity over the last 30% of the lerp so the
        // corner-folder dissolves cleanly into the back-slot instead
        // of popping out when disposed. The inline back-slot folder
        // (a different folder identity) is rendered there already,
        // so we want the corner-folder gone by arrival.
        const fadeStart = 0.7;
        const opacity = u < fadeStart ? 1 : Math.max(0, 1 - (u - fadeStart) / (1 - fadeStart));
        _setCornerFolderOpacity(cornerFolder, opacity);
      }

      if (u >= 1) {
        _disposeCornerFolder();
        ascentState = null;
      }
    }

    // Idle pinning — when the corner-folder is parked (no animation in
    // flight) keep it locked to the live button anchor so layout changes
    // (window resize, host resize) don't leave it stale.
    if (cornerFolder && !descentState && !ascentState) {
      const anchor = _cornerAnchorFromButton();
      cornerFolder.position.set(anchor.x, anchor.y, anchor.z);
      cornerFolder.scale.setScalar(CORNER_SCALE);
    }

    // ===== STATE MACHINE =====
    // Hole-pick clicks drive IDLE -> PULLING_OUT (onFolderClick) and HELD ->
    // PULLING_BACK (deactivateActive / dialog YES/NO). This loop only
    // handles animation-driven transitions:
    //   PULLING_OUT -> OUT (when hoverT reaches the top)
    //   PULLING_BACK -> IDLE (when hoverT returns to rest)
    if (state === STATE.PULLING_OUT) {
      if (folders[activeIndex].userData.hoverT >= T_OUT_REACHED) {
        state = STATE.OUT;
      }
    } else if (state === STATE.PULLING_BACK) {
      if (folders[activeIndex] && folders[activeIndex].userData.hoverT <= T_REST_REACHED) {
        folders[activeIndex].userData.hoverT = 0;
        activeIndex = -1;
        triggerMouse = null;
        state = STATE.IDLE;
        lastReturnMouse = { x: mousePx.x, y: mousePx.y };
        // Bar color/opacity is driven from hoverT in the per-folder loop
        // below, so no explicit reset is needed here.
        if (pendingTransferAfterReturn) {
          pendingTransferAfterReturn = false;
          runTransferAndReset();
        }
      }
    }

    // Drive each folder's hoverT. Only the activeIndex folder ever moves;
    // every other folder is locked at hoverT = 0 by the state machine.

    folders.forEach((f, i) => {
      let target;
      if (i === activeIndex && (
        state === STATE.PULLING_OUT ||
        state === STATE.OUT ||
        state === STATE.HELD
      )) {
        target = 1;
      } else {
        target = 0;
      }
      f.userData.hoverT += (target - f.userData.hoverT) * Math.min(1, dt * 9);

      // Lerp basePos toward targetPos (set by applyDisplayOrder). This is
      // what produces the smooth rolodex/rerank motion. If no rerank has
      // happened the two are equal and this is a no-op.
      const SLOT_LERP = Math.min(1, dt * 7);
      const tp = f.userData.targetPos;
      const tr = f.userData.targetRotY;
      if (tp) {
        f.userData.basePos.x += (tp.x - f.userData.basePos.x) * SLOT_LERP;
        f.userData.basePos.y += (tp.y - f.userData.basePos.y) * SLOT_LERP;
        f.userData.basePos.z += (tp.z - f.userData.basePos.z) * SLOT_LERP;
      }
      if (typeof tr === 'number') {
        f.userData.baseRotY += (tr - f.userData.baseRotY) * SLOT_LERP;
      }

      const t = f.userData.hoverT;
      const base = f.userData.basePos;

      // Pull-out: up and to the right for every active folder, regardless
      // of slot. Non-active folders have t = 0 so they don't move; the
      // queue itself never shifts.
      //
      // We do NOT pull forward in Z — the active folder stays at its
      // stack depth so closer stack folders continue to occlude it
      // (which is the desired look: the folder slides out from behind).
      f.position.x = base.x + t * 1.3;
      f.position.y = base.y + t * 1.0;
      f.position.z = base.z + t * 0.05;
      f.rotation.y = f.userData.baseRotY + t * 0.15;

      // Jitter: applied when fresh folders just arrived from a catalog
      // swap. Each folder gets a deterministic sine wobble keyed by
      // its slot index so they wiggle in non-uniform directions. The
      // amplitude decays linearly to zero over the JITTER_DURATION_MS
      // window so the wobble settles gracefully.
      if (now < _jitterUntil) {
        const remaining = (_jitterUntil - now) / JITTER_DURATION_MS;  // 1..0
        const amp = JITTER_AMPLITUDE * remaining;
        // 5 phases per folder so adjacent folders don't oscillate in
        // sync. The (i * 1.3) and (i * 2.1) keep x and y desynced.
        const phaseX = (now * 0.025) + i * 1.3;
        const phaseY = (now * 0.030) + i * 2.1;
        f.position.x += Math.sin(phaseX) * amp;
        f.position.y += Math.cos(phaseY) * amp;
      }

      // Render order — snaps to new slot's renderOrder immediately so depth
      // sorting stays consistent during rerank animation.
      f.userData.mesh.renderOrder  = f.userData.baseRenderOrder;
      f.userData.edges.renderOrder = f.userData.baseRenderOrder + 1;
      if (f.userData.bracket) {
        f.userData.bracket.renderOrder = f.userData.baseRenderOrder + 2;
      }
      if (f.userData.hole) {
        f.userData.hole.renderOrder = f.userData.baseRenderOrder + 3;
      }
      if (f.userData.faceLabel) {
        f.userData.faceLabel.renderOrder = f.userData.baseRenderOrder + 3;
      }

      const mesh = f.userData.mesh;

      // Body color stays its dark base — never tinted.
      mesh.material.color.setHex(0x10171f);
      if (mesh.material.emissive) {
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0;
      }

      // === Edges: steady brighten on activation, no oscillation ===
      // Edges hold their TYPE color always. When the folder is active
      // they brighten toward white. The bracket and binder hole keep
      // their colors regardless of activation state.
      const eMat = f.userData.edges.material;
      const baseEdge = f.userData.baseEdgeColorHex;
      const er = (baseEdge >> 16) & 0xff;
      const eg = (baseEdge >>  8) & 0xff;
      const eb =  baseEdge        & 0xff;
      const mix = t * 0.55;
      const nr = Math.round(er + (255 - er) * mix);
      const ng = Math.round(eg + (255 - eg) * mix);
      const nb = Math.round(eb + (255 - eb) * mix);
      eMat.color.setRGB(nr / 255, ng / 255, nb / 255);
      eMat.opacity = f.userData.baseEdgeOpacity + t * (1.0 - f.userData.baseEdgeOpacity);

      // Halo: same steady brighten, opacity follows activation.
      if (f.userData.edgesHalo) {
        const hMat = f.userData.edgesHalo.material;
        hMat.color.setRGB(nr / 255, ng / 255, nb / 255);
        hMat.opacity = t * 0.7;
      }

      // Face label: same white-mix idea, applied as a multiplicative tint
      // on the material color. MeshBasicMaterial.color multiplies the
      // texture, so (1,1,1) = no change. We bias from that toward the
      // brighter mix so the text glows when active.
      if (f.userData.faceLabel) {
        const fMat = f.userData.faceLabel.material;
        // Brighten the label texture by overlaying a slight white tint
        const fb = 1 + t * 0.3;   // 1.0 idle, up to 1.3 active
        fMat.color.setRGB(fb, fb, fb);
        fMat.opacity = 1.0;
      }

      // Opacity (body) — based on stack depth, gently brightening when active
      const stackOpacity = (i === 0) ? 0.92 : Math.max(0.22, 0.55 - i * 0.05);
      const wantOpacity = stackOpacity + t * (0.95 - stackOpacity);
      mesh.material.opacity += (wantOpacity - mesh.material.opacity) * 0.2;
    });

    // Gentle scene breathing (very subtle now — stack is already at an angle)
    const tt = clock.elapsedTime;
    fanGroup.rotation.y = -0.08 + Math.sin(tt * 0.3) * 0.01;

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  /* ---- Resize: observe the container, not the window. ----
     Camera framing:
       - Default z = 9.5 (matches the original prototype's sizing —
         folders fill ~43% of vertical extent at this distance).
       - Pull back only when the container is unusually narrow or
         short, just enough so the fan still fits. The constraints
         are conservative: the fan is ~5 units wide spread out, the
         folder is 2.6 units tall. We need:
             visible width  >= 5.5
             visible height >= 3.5
         At FOV 35°, halfTan ≈ 0.307.
             visibleWidth  = 2 * halfTan * z * aspect
             visibleHeight = 2 * halfTan * z
         So:
             zForWidth  = 5.5 / (2*0.307*aspect) ≈ 2.75/(0.307*aspect)
             zForHeight = 3.5 / (2*0.307)        ≈ 5.70
     For widescreen aspects (>1.5) both bounds are well under 9.5,
     so z stays at the default and folders render at full prototype
     size. ---- */
  /* ---- Camera framing ----
     Default z = 7.0. The original prototype used 9.5 (folders fairly
     small to fit a full-screen viewport); we brought it to 5.0 for
     2x scale, then walked back to 7.0 (~30% smaller than 5.0) to
     find a balance where labels stay legible and the fan doesn't
     crowd the host edges.

     Pullback minimums scale correspondingly so the same fan fits
     when the host gets narrow.
  */
  function _fitCamera() {
    const s = _containerSize();
    camera.aspect = s.w / s.h;
    const fovRad = camera.fov * Math.PI / 180;
    const halfTan = Math.tan(fovRad / 2);
    const minZForWidth  = 2.0 / (halfTan * Math.max(camera.aspect, 0.1));
    const minZForHeight = 1.3 /  halfTan;
    const targetZ = Math.max(7.0, minZForWidth, minZForHeight);
    camera.position.set(0, 0.6, targetZ);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(s.w, s.h, false);
  }

  const _resizeObs = new ResizeObserver(_fitCamera);
  _resizeObs.observe(container);
  window.addEventListener('resize', _fitCamera);
  // Run once at boot to set the initial z based on host's actual size.
  // (Deferred one tick so the container has finished laying out.)
  setTimeout(_fitCamera, 0);

  /* Clock is owned by js/app.js (the ES-module orchestrator). The old
     folder_system.html standalone wrote a `HH:MM PT` value here on a
     30-second tick. With app.js handling it on a 1-second tick against
     the same element, the engine's tickClock would have raced with it.
     Removed. */

  /* ============================================================
     External API
     ============================================================
     app.js (the ES-module orchestrator) calls into the folder-stack
     engine via window.FolderStack. Drop 1 exposes only _setCatalog;
     drop 2 will add dispatch hooks and a callback registration API
     for name-click events / descent / etc.

     _setCatalog(children, sectionLabel):
       children     — array of nodes from sections.json (the active
                      section's `children`), each having .id .label
                      .kind plus per-kind fields (url|files|children).
       sectionLabel — the section's display label (for the sector
                      tag and inspector header). Optional.
     Triggers a full stack rebuild with the new content.

     getActiveFolder():
       Returns the currently-active folder's catalog entry (the same
       shape _setCatalog produced — kind, url, files, etc.), or null
       if no folder is active. docs-nav.js reads this to decide what
       to do when the rail's YES button is clicked.
  */
  function _getActiveFolder() {
    if (activeIndex < 0 || activeIndex >= folders.length) return null;
    var f = folders[activeIndex];
    return (f && f.userData && f.userData.data) || null;
  }

  /* Public: programmatically deactivate the active folder, returning
     it to its inline stack position. Used by docs-nav.js when the
     URL launch card is dismissed (X) or fired (LAUNCH) — both should
     reset the folder to its slot instead of leaving it popped out. */
  function _deactivateActive() {
    if (typeof deactivateActive === 'function') deactivateActive();
  }

  window.FolderStack = {
    _setCatalog: _setCatalog,
    _setCatalogWithDescent: _setCatalogWithDescent,
    getActiveFolder: _getActiveFolder,
    deactivateActive: _deactivateActive,
    /* Trigger an ascent animation from the corner-folder back to the
       inline stack. Called by docs-nav.js on helix:corner-click. */
    ascendFromCorner: _ascendFromCorner,
    /* Test whether the corner-folder is currently visible (for any
       external code that wants to gate behaviors on it). */
    hasCorner: function () { return !!cornerFolder; },
    /* Drop the corner-folder immediately (no animation). Used when
       the user switches sections via the wheel — the old corner
       doesn't apply to the new section. */
    disposeCorner: function () {
      if (descentState || ascentState) return;  // don't tear down mid-anim
      _disposeCornerFolder();
    },
  };

