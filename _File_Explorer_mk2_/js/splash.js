/* ============================================================
   INFO 698 // CAPSTONE — splash.js
   - meta.json text injection (unchanged from v1)
   - click-pulse: electric bolts radiating across the grid when
     the bullseye logo is clicked, then navigate to nav.html
   ============================================================ */

(function () {
  'use strict';

  // ---------- Meta-driven text (overlays HTML defaults) ----------
  // The inline clock script in index.html handles the HUD timestamp,
  // so we don't need AresData.startClock() here.

  AresData.load('meta.json').then(function (meta) {
    var s = meta.site || {};

    setText('stat-cycle',     s.cycle    || '');
    setText('stat-operator', (s.operator || '').toUpperCase());
    setText('stat-course',    s.course   || '');
    setText('stat-program',  (s.program || '').replace(/\s*\/\/.*/, '').toUpperCase());

    // stat-status starts as 'READY' in HTML; meta only overrides if
    // explicitly provided. The power-up sequence also sets it to READY.
    if (s.status) {
      var el = document.getElementById('stat-status');
      if (el) el.textContent = s.status;
    }

    document.title = (s.course ? s.course + ' // ' : '') + (s.courseName || 'Capstone');

  }).catch(function (err) {
    console.warn('[splash] meta load failed — using HTML defaults:', err);
  });

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el && val) el.textContent = val;
  }

  // ============================================================
  // 3D textured globe — Three.js + d3-geo + Natural Earth
  // ------------------------------------------------------------
  // A real sphere with real continent outlines, painted from the
  // Natural Earth land-110m dataset. Pipeline:
  //
  //   world-atlas land-110m.json (TopoJSON)
  //     → topojson.feature()                       decode → GeoJSON
  //     → d3.geoPath(d3.geoEquirectangular(), ctx) paint → 2D canvas
  //     → THREE.CanvasTexture(canvas)              canvas → GPU texture
  //     → MeshBasicMaterial({ map: tex })          texture → sphere
  //     → mesh.rotation.y in render loop           globe spins
  //
  // The data is fetched async on init. The <canvas> starts at
  // opacity:0; we add the .is-ready class to fade it in once the
  // first continent-painted frame is on screen.
  //
  // GLOBE_CONFIG below holds the values dialled in via globe-lab.html.
  // To re-tune: open globe-lab.html, adjust, hit "Export Config",
  // paste the JSON over GLOBE_CONFIG and reload.
  // ============================================================

  var GLOBE_CONFIG = {
    // rotation
    spinPeriod:     40.0,
    axialTilt:      23.4,
    wobbleAmp:      4.0,
    wobblePeriod:   22.0,
    // texture
    // Continents render as solid filled regions with crisp outlines so
    // they stand out clearly against the dark substrate. Previous setting
    // ('outline' + 0.15 fill) made the landmasses too faint.
    fillStyle:      'both',      // 'outline' | 'filled' | 'both'
    coastWidth:     2.2,
    coastAlpha:     1.00,
    fillAlpha:      0.55,
    textureRes:     2048,
    graticule:      true,
    graticuleAlpha: 0.07,
    landColorHex:   '#00d9ff',
    // geometry / overlay
    sphereSegments: 64,
    wireframe:      true,
    wireAlpha:      0.10,
    wireSegments:   24,
    halo:           true,
    haloIntensity:  0.18,
    // camera
    projection:     'ortho',
    zoom:           1.15
  };

  var globeCanvas = document.getElementById('bullseye-globe');

  // Dependency sanity check. If any library failed to load we silently
  // skip the globe (the rest of the splash page still works). The
  // window.error handler in index.html will surface real reasons.
  var globeDepsOK =
    globeCanvas &&
    typeof THREE     !== 'undefined' &&
    typeof d3        !== 'undefined' && d3.geoPath && d3.range &&
    typeof topojson  !== 'undefined';

  // ----- World data (Natural Earth land-110m, ~55KB TopoJSON) -----
  var WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json';
  var worldData = null;   // GeoJSON FeatureCollection once loaded

  function loadWorldData(onReady) {
    fetch(WORLD_TOPO_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (topo) {
        // Decode TopoJSON → GeoJSON FeatureCollection.
        worldData = topojson.feature(topo, topo.objects.land);
        onReady && onReady();
      })
      .catch(function (err) {
        console.warn('[splash] world data fetch failed:', err);
        // Globe stays as graticule + wireframe + halo only. Page still works.
        // Reveal the canvas anyway so the user isn't staring at nothing.
        if (globeCanvas) globeCanvas.classList.add('is-ready');
      });
  }

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  function rgbaStr(rgb, a) {
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + a + ')';
  }

  // Build the equirectangular world texture: graticule (back), continent
  // fill (middle), continent outlines (front). Returns a <canvas>.
  function buildWorldTexture() {
    var cfg = GLOBE_CONFIG;
    var TW = cfg.textureRes;
    var TH = Math.floor(TW / 2);   // 2:1 — matches SphereGeometry UVs
    var c = document.createElement('canvas');
    c.width = TW; c.height = TH;
    var cx = c.getContext('2d');
    cx.clearRect(0, 0, TW, TH);

    var rgb = hexToRgb(cfg.landColorHex);

    // 1. Graticule (lat/lon grid every 30°)
    if (cfg.graticule) {
      cx.strokeStyle = 'rgba(0,217,255,' + cfg.graticuleAlpha + ')';
      cx.lineWidth = Math.max(1, TW / 2048);
      for (var lat = -60; lat <= 60; lat += 30) {
        var y = ((90 - lat) / 180) * TH;
        cx.beginPath(); cx.moveTo(0, y); cx.lineTo(TW, y); cx.stroke();
      }
      for (var lon = -180; lon < 180; lon += 30) {
        var x = ((lon + 180) / 360) * TW;
        cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, TH); cx.stroke();
      }
    }

    // 2 + 3. Continents (only once world data arrives)
    if (worldData && d3.geoEquirectangular) {
      // Projection: lon ±180° → x 0..TW, lat ±90° → y 0..TH.
      // d3-geo's default scale needs to be overridden:
      //   canvas width = 2 * π * scale  →  scale = TW / (2π)
      var projection = d3.geoEquirectangular()
        .scale(TW / (2 * Math.PI))
        .translate([TW / 2, TH / 2]);
      var path = d3.geoPath(projection, cx);

      if (cfg.fillStyle === 'filled' || cfg.fillStyle === 'both') {
        cx.fillStyle = rgbaStr(rgb, cfg.fillAlpha);
        cx.beginPath();
        path(worldData);
        cx.fill();
      }
      if (cfg.fillStyle === 'outline' || cfg.fillStyle === 'both') {
        cx.strokeStyle = rgbaStr(rgb, cfg.coastAlpha);
        cx.lineWidth = cfg.coastWidth * (TW / 2048);
        cx.lineJoin = 'round';
        cx.lineCap = 'round';
        cx.beginPath();
        path(worldData);
        cx.stroke();
      }
    }

    return c;
  }

  function initGlobe() {
    if (!globeDepsOK) return null;
    var cfg = GLOBE_CONFIG;

    var scene = new THREE.Scene();

    // Camera — orthographic so continents at the silhouette don't
    // distort under perspective foreshortening.
    var camera;
    if (cfg.projection === 'ortho') {
      camera = new THREE.OrthographicCamera(
        -cfg.zoom, cfg.zoom, cfg.zoom, -cfg.zoom, 0.1, 10
      );
      camera.position.set(0, 0, 3);
    } else {
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
      var d = 1 / Math.tan((45/2) * Math.PI / 180) * cfg.zoom * 0.92;
      camera.position.set(0, 0, d);
    }
    camera.lookAt(0, 0, 0);

    var renderer = new THREE.WebGLRenderer({
      canvas: globeCanvas, alpha: true, antialias: true
    });
    renderer.setClearColor(0x000000, 0);  // transparent — substrate shows through

    function sizeRenderer() {
      // SQUARE MODE — the previous behaviour let CSS stretch the canvas
      // to width:100%/height:100% of a non-square panel, producing the
      // oblate "squashed" look on load. Now we measure the panel, take
      // the smaller dimension as our square edge, and set the canvas's
      // explicit CSS px so it never stretches.
      var rect = globeCanvas.getBoundingClientRect();
      var parentRect = globeCanvas.parentNode
        ? globeCanvas.parentNode.getBoundingClientRect()
        : rect;
      // Use the parent's available square area so the canvas centres
      // cleanly. Fall back to whatever we measured if parent missing.
      var avail = Math.min(parentRect.width, parentRect.height);
      var size = Math.max(120, Math.floor(avail));
      var dpr  = Math.min(window.devicePixelRatio || 1, 2);
      globeCanvas.width  = Math.floor(size * dpr);
      globeCanvas.height = Math.floor(size * dpr);
      globeCanvas.style.width  = size + 'px';
      globeCanvas.style.height = size + 'px';
      renderer.setPixelRatio(dpr);
      renderer.setSize(size, size, false);
    }
    sizeRenderer();
    window.addEventListener('resize', sizeRenderer);

    // Main globe mesh. Built ONCE on init with whatever texture is
    // available (initially graticule-only). After the TopoJSON arrives,
    // rebuildGlobeTexture() swaps the texture in place — no mesh churn.
    var tiltRad = cfg.axialTilt * Math.PI / 180;

    var globeMaterial = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(buildWorldTexture()),
      transparent: true,
      depthWrite: false
    });
    globeMaterial.map.minFilter = THREE.LinearFilter;
    globeMaterial.map.magFilter = THREE.LinearFilter;

    var segH = cfg.sphereSegments;
    var segV = Math.max(8, Math.floor(segH * 0.75));
    var globeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, segH, segV),
      globeMaterial
    );
    globeMesh.rotation.z = tiltRad;
    scene.add(globeMesh);

    // Wireframe overlay — separate slightly larger sphere with
    // wireframe:true material. 1.003 radius prevents z-fighting.
    var wireMesh = null;
    if (cfg.wireframe) {
      var wSegH = cfg.wireSegments;
      var wSegV = Math.max(6, Math.floor(wSegH * 0.65));
      wireMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.003, wSegH, wSegV),
        new THREE.MeshBasicMaterial({
          color: 0x00d9ff,
          wireframe: true,
          transparent: true,
          opacity: cfg.wireAlpha,
          depthWrite: false
        })
      );
      wireMesh.rotation.z = tiltRad;
      scene.add(wireMesh);
    }

    // Halo / atmosphere — flat disc BEHIND the globe with a custom
    // GLSL shader that draws a radial cyan glow at the limb.
    if (cfg.halo) {
      var halo = new THREE.Mesh(
        new THREE.CircleGeometry(1.18, 64),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { uIntensity: { value: cfg.haloIntensity } },
          vertexShader:
            'varying vec2 vUv;' +
            'void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader:
            'varying vec2 vUv;uniform float uIntensity;' +
            'void main(){' +
              'float d=distance(vUv,vec2(0.5));' +
              'float a=smoothstep(0.5,0.36,d)*uIntensity;' +
              'gl_FragColor=vec4(0.0,0.85,1.0,a);' +
            '}'
        })
      );
      halo.position.z = -0.5;
      scene.add(halo);
    }

    return {
      scene: scene,
      camera: camera,
      renderer: renderer,
      globeMesh: globeMesh,
      wireMesh: wireMesh,
      globeMaterial: globeMaterial,
      halo: cfg.halo ? halo : null,
      startedAt: performance.now(),
      revealed: false
    };
  }

  var globe = initGlobe();
  // Expose globe so the probe system can pulse its halo on hit.
  window._splashGlobe = globe;

  // Replace the globe's texture once continent data arrives. Disposes
  // the placeholder texture so we don't leak GPU memory.
  function rebuildGlobeTexture() {
    if (!globe) return;
    var oldTex = globe.globeMaterial.map;
    var newTex = new THREE.CanvasTexture(buildWorldTexture());
    newTex.minFilter = THREE.LinearFilter;
    newTex.magFilter = THREE.LinearFilter;
    newTex.needsUpdate = true;
    globe.globeMaterial.map = newTex;
    globe.globeMaterial.needsUpdate = true;
    if (oldTex) oldTex.dispose();
  }

  // Reveal the canvas via CSS fade-in. Done once, after we know there's
  // something worth looking at.
  function revealGlobe() {
    if (!globe || globe.revealed) return;
    globe.revealed = true;
    if (globeCanvas) globeCanvas.classList.add('is-ready');
  }

  // Kick off async data fetch; rebuild texture + reveal on success.
  // The render loop is already running below, so the next frame after
  // the texture swap will show real continents.
  if (globeDepsOK) {
    loadWorldData(function () {
      rebuildGlobeTexture();
      revealGlobe();
    });
  }

  // ----- Render loop -----
  // GPU does the work; main thread just updates rotation and submits draws.
  function renderGlobe(now) {
    if (!globe) return;
    var cfg = GLOBE_CONFIG;
    var t = (now - globe.startedAt) / 1000;
    var yaw    = (t / cfg.spinPeriod) * 2 * Math.PI;
    var wobble = Math.sin((t / cfg.wobblePeriod) * 2 * Math.PI) *
                 (cfg.wobbleAmp * Math.PI / 180);
    globe.globeMesh.rotation.y = yaw;
    globe.globeMesh.rotation.x = wobble;
    if (globe.wireMesh) {
      globe.wireMesh.rotation.y = yaw;
      globe.wireMesh.rotation.x = wobble;
    }
    globe.renderer.render(globe.scene, globe.camera);
  }

  var prefersReducedGlobe =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function globeLoop(now) {
    renderGlobe(now);
    if (!prefersReducedGlobe) requestAnimationFrame(globeLoop);
  }
  if (globe) requestAnimationFrame(globeLoop);

  // No-op stubs in place of the old align/release functions so anything
  // else that references them won't break.
  function alignArcs()   {}
  function releaseArcs() {}

  // ============================================================
  // Click-pulse: electric bolts across the grid
  // ============================================================

  var link       = document.getElementById('splash-enter-link');
  var overlay    = document.getElementById('pulse-overlay');
  var ring       = document.getElementById('pulse-ring');
  var ring2      = document.getElementById('pulse-ring-2');
  var canvas     = document.getElementById('pulse-canvas');
  var substrate  = document.querySelector('.ares-substrate');
  var prefersReduced =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!link || !overlay || !canvas) return;

  // Hi-DPI canvas sizing
  function fitCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  // ------------------------------------------------------------
  // Build a bolt that walks the 20px grid: starts at the origin,
  // takes a primary direction (N/E/S/W), and steps cell-by-cell
  // until it reaches the requested length. At each cell, with a
  // probability that depends on distance from origin, it turns 90°
  // (always staying on the grid lines). The result looks like a
  // circuit trace lighting up across the substrate.
  //
  //   ox, oy       — origin in viewport coords (any number)
  //   primaryDir   — 0=E, 1=S, 2=W, 3=N
  //   totalLen     — pixel "budget" along the path
  //   step         — grid pitch (px), default 20
  // ------------------------------------------------------------
  function makeGridBolt(ox, oy, primaryDir, totalLen, step) {
    step = step || 20;
    // Snap the start to the nearest grid intersection
    var x = Math.round(ox / step) * step;
    var y = Math.round(oy / step) * step;
    var pts = [{ x: x, y: y }];

    // Direction vectors: E, S, W, N
    var DX = [ 1, 0,-1, 0];
    var DY = [ 0, 1, 0,-1];
    var dir = primaryDir;
    var travelled = 0;

    // Maintain a "preferred axis" — we want net travel along primaryDir.
    while (travelled < totalLen) {
      // Probability of a 90° turn rises slowly with distance, so the
      // bolt starts straight and gets more "fractal" as it grows.
      var turnProb = 0.10 + Math.min(0.35, travelled / (totalLen * 1.5));
      if (Math.random() < turnProb) {
        // turn left or right (90°), but bias back toward the primary axis
        // so the bolt doesn't double-back.
        var leftDir  = (dir + 3) & 3;
        var rightDir = (dir + 1) & 3;
        // If turning would reverse primary progress, prefer the other turn.
        var candA = leftDir, candB = rightDir;
        // 50/50 between left and right, with bias toward primary axis
        var primaryAxis = primaryDir & 1; // 0 = horizontal axis, 1 = vertical
        var candAxisA = candA & 1;
        if (candAxisA === primaryAxis) {
          dir = (Math.random() < 0.65) ? candA : candB;
        } else {
          dir = (Math.random() < 0.65) ? candB : candA;
        }
      }
      x += DX[dir] * step;
      y += DY[dir] * step;
      pts.push({ x: x, y: y });
      travelled += step;

      // Every few steps, occasionally re-bias toward the primary direction
      // so the bolt as a whole moves outward.
      if (Math.random() < 0.18) dir = primaryDir;
    }
    return pts;
  }

  function drawBolt(ctx, pts, color, width, alpha) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = width;
    ctx.globalAlpha = alpha;
    // Circuit-trace look: square caps, mitred joins
    ctx.lineCap     = 'square';
    ctx.lineJoin    = 'miter';
    ctx.miterLimit  = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // Run one full pulse, ~1800ms, then resolve.
  function firePulse() {
    return new Promise(function (resolve) {
      if (prefersReduced) { resolve(); return; }

      // Origin = centre of the bullseye link, in viewport coords.
      var rect = link.getBoundingClientRect();
      var ox   = rect.left + rect.width  / 2;
      var oy   = rect.top  + rect.height / 2;

      // Position BOTH shock rings at the bullseye centre, then fire.
      // (The CSS handles the 400ms stagger between them.)
      ring.style.left  = ox + 'px';
      ring.style.top   = oy + 'px';
      if (ring2) {
        ring2.style.left = ox + 'px';
        ring2.style.top  = oy + 'px';
      }

      overlay.classList.add('is-firing');
      ring.classList.add('is-firing');
      if (ring2) ring2.classList.add('is-firing');
      if (substrate) substrate.classList.add('is-charged');

      var ctx  = canvas.getContext('2d');
      var W    = window.innerWidth;
      var H    = window.innerHeight;
      var maxR = Math.hypot(W, H);          // farthest pixel from origin
      var duration = 3200;                   // ms — matches CSS ring timing
      var startedAt = performance.now();

      // ----- Pre-generate the bolts ONCE.
      // 4 primary cardinal dirs × N bolts per direction, fanning out.
      // Each bolt knows its full final path; we reveal progressively each frame.
      var palette = ['#b026ff', '#c8ff00', '#00d9ff'];
      var bolts = [];
      var perDir = 5;
      for (var d = 0; d < 4; d++) {          // 0=E, 1=S, 2=W, 3=N
        for (var i = 0; i < perDir; i++) {
          // Slight offset start: shift origin perpendicular to primary axis
          // by 0..2 grid cells so bolts don't all share the exact origin.
          var perpAxis = (d & 1) === 0 ? 'y' : 'x'; // E/W → perpY, S/N → perpX
          var jitter   = (Math.floor(Math.random() * 5) - 2) * 20; // -40..+40
          var sx = ox + (perpAxis === 'x' ? jitter : 0);
          var sy = oy + (perpAxis === 'y' ? jitter : 0);
          // Path length budget: a touch beyond half-diagonal so it crosses screen
          var len = maxR * (0.85 + Math.random() * 0.25);
          var pts = makeGridBolt(sx, sy, d, len, 20);
          bolts.push({
            pts:      pts,
            color:    palette[(d + i) % palette.length],
            // Wider stagger over a slower total; the eye reads launches as waves.
            // Range: 0–1100ms (~34% of 3200ms duration).
            delay:    i * 140 + Math.random() * 220,
            width:    1.0 + Math.random() * 1.2
          });
        }
      }

      // ------------------------------------------------------------
      // Compute the polyline length-prefix array for each bolt so we
      // can reveal progressively by total path length (not point count).
      // ------------------------------------------------------------
      for (var b = 0; b < bolts.length; b++) {
        var p = bolts[b].pts;
        var prefix = [0];
        var total  = 0;
        for (var q = 1; q < p.length; q++) {
          total += Math.hypot(p[q].x - p[q-1].x, p[q].y - p[q-1].y);
          prefix.push(total);
        }
        bolts[b].prefix = prefix;
        bolts[b].total  = total;
      }

      // Slice a bolt's polyline to the first `reveal` pixels of path.
      function slicePolyline(pts, prefix, reveal) {
        if (reveal <= 0) return null;
        if (reveal >= prefix[prefix.length - 1]) return pts;
        var out = [pts[0]];
        for (var i = 1; i < pts.length; i++) {
          if (prefix[i] <= reveal) {
            out.push(pts[i]);
          } else {
            // partial segment: interpolate
            var segLen   = prefix[i] - prefix[i-1];
            var needed   = reveal  - prefix[i-1];
            var t = needed / segLen;
            out.push({
              x: pts[i-1].x + (pts[i].x - pts[i-1].x) * t,
              y: pts[i-1].y + (pts[i].y - pts[i-1].y) * t
            });
            break;
          }
        }
        return out;
      }

      // ----- Full-grid sparks -----
      // Short, bright, screen-wide grid-aligned segments that flicker
      // independently of the radial bolts. They make the entire substrate
      // feel electrified during the click.
      var sparks = [];
      var lastSparkSpawn = 0;
      var SPARK_PALETTE = ['#00d9ff', '#c8ff00', '#b026ff', '#ffffff'];

      function spawnSpark(now) {
        // Pick a random grid cell. Bias toward farther-from-center
        // so the effect feels screen-wide (not just at the bullseye).
        var gx = Math.round((Math.random() * W) / 20) * 20;
        var gy = Math.round((Math.random() * H) / 20) * 20;
        // Spark is a short straight segment along the grid: horizontal
        // or vertical, 2–5 cells (40–100px).
        var horiz = Math.random() < 0.5;
        var segs  = 2 + Math.floor(Math.random() * 4);
        var len   = segs * 20;
        var x2 = horiz ? gx + len : gx;
        var y2 = horiz ? gy       : gy + len;
        sparks.push({
          x1: gx, y1: gy, x2: x2, y2: y2,
          color: SPARK_PALETTE[Math.floor(Math.random() * SPARK_PALETTE.length)],
          bornAt: now,
          life: 220 + Math.random() * 280,   // 220–500ms total
          width: 0.8 + Math.random() * 1.2
        });
      }

      function renderSparks(ctx, now) {
        var still = [];
        for (var i = 0; i < sparks.length; i++) {
          var s = sparks[i];
          var age = now - s.bornAt;
          if (age >= s.life) continue;
          // Flicker envelope: fast rise, brief peak, fast fall
          var u = age / s.life;
          var env;
          if (u < 0.20)       env = u / 0.20;          // attack
          else if (u < 0.45)  env = 1;                  // peak hold
          else                env = 1 - (u - 0.45) / 0.55; // decay
          env = Math.max(0, env);

          ctx.save();
          ctx.strokeStyle = s.color;
          ctx.globalAlpha = env;
          ctx.lineCap = 'square';
          ctx.shadowColor = s.color;
          ctx.shadowBlur = 8;
          // Outer soft + inner bright
          ctx.lineWidth = s.width * 2.5;
          ctx.globalAlpha = env * 0.25;
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
          ctx.lineWidth = s.width;
          ctx.globalAlpha = env;
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
          ctx.restore();
          still.push(s);
        }
        sparks = still;
      }

      function frame(now) {
        var elapsed = now - startedAt;
        var t       = Math.min(1, elapsed / duration);

        ctx.clearRect(0, 0, W, H);

        // ----- spawn sparks throughout the pulse -----
        // Toned down: ~1 spark every 100–160ms, single per tick, only
        // in the first 70% of the pulse. Roughly 18–22 sparks total.
        if (elapsed < duration * 0.70) {
          if (now - lastSparkSpawn > 100 + Math.random() * 60) {
            spawnSpark(now);
            lastSparkSpawn = now;
          }
        }

        // Each bolt has a fixed crawl time so its progression along the
        // grid is visible at human speed regardless of total duration.
        var crawlMs = 2000;

        for (var i = 0; i < bolts.length; i++) {
          var bb = bolts[i];
          var localElapsed = elapsed - bb.delay;
          if (localElapsed <= 0) continue;
          var localT = Math.min(1, localElapsed / crawlMs);

          // Ease-out for the head travelling along the grid
          var travel = 1 - Math.pow(1 - localT, 2.5);
          var revealLen = travel * bb.total;

          // Overall pulse fade: solid through 80% of duration, then fade out
          var pulseT = elapsed / duration;
          var alpha;
          if (pulseT < 0.05)      alpha = pulseT / 0.05;
          else if (pulseT > 0.82) alpha = (1 - pulseT) / 0.18;
          else                    alpha = 1;
          alpha = Math.max(0, Math.min(1, alpha)) * 0.95;

          var revealed = slicePolyline(bb.pts, bb.prefix, revealLen);
          if (!revealed || revealed.length < 2) continue;

          // Outer wide soft stroke + inner bright core for "electric" feel
          drawBolt(ctx, revealed, bb.color, bb.width * 3.0, alpha * 0.22);
          drawBolt(ctx, revealed, bb.color, bb.width,       alpha);
          // Bright white-hot core
          drawBolt(ctx, revealed, '#ffffff', Math.max(0.6, bb.width * 0.4), alpha * 0.80);
        }

        // Sparks are drawn on top of bolts so they read as foreground noise.
        renderSparks(ctx, now);

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          ctx.clearRect(0, 0, W, H);
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function cleanupPulse() {
    overlay.classList.remove('is-firing');
    ring.classList.remove('is-firing');
    if (ring2) ring2.classList.remove('is-firing');
    if (substrate) substrate.classList.remove('is-charged');
  }

  // ============================================================
  // Hover crawl: subtle, looping grid flare emerging from behind
  // the image while the bullseye is hovered. Uses the SAME canvas
  // as the click-pulse but a separate loop / state. Mutually
  // exclusive with the click-pulse (firePulse stops it on start).
  // ============================================================

  var hoverCrawlState = {
    active:     false,
    rafId:      null,
    bolts:      [],      // currently in-flight crawl bolts
    fadeStart:  0,        // performance.now() when mouseleave triggered fade; 0 = not fading
    _onResize:  null
  };

  function spawnCrawlBolt(ox, oy, maxR, now, primaryDir) {
    var palette = ['#b026ff', '#c8ff00', '#00d9ff'];
    // primaryDir provided by caller so the burst covers all 4 sides evenly
    var d = primaryDir;
    var perpAxis = (d & 1) === 0 ? 'y' : 'x';
    var j = (Math.floor(Math.random() * 5) - 2) * 20; // -40..+40
    var sx = ox + (perpAxis === 'x' ? j : 0);
    var sy = oy + (perpAxis === 'y' ? j : 0);
    // Modest reach: 32%–55% of diagonal, so bolts creep just past the
    // image frame and into the substrate without crossing the screen.
    var len = maxR * (0.32 + Math.random() * 0.23);
    var pts = makeGridBolt(sx, sy, d, len, 20);

    // Pre-compute polyline prefix sums (needed for slicePolyline below)
    var prefix = [0]; var total = 0;
    for (var q = 1; q < pts.length; q++) {
      total += Math.hypot(pts[q].x - pts[q-1].x, pts[q].y - pts[q-1].y);
      prefix.push(total);
    }

    return {
      pts:        pts,
      prefix:     prefix,
      total:      total,
      dir:        d,
      color:      palette[Math.floor(Math.random() * palette.length)],
      width:      0.8 + Math.random() * 0.7,    // thinner than click bolts
      bornAt:     now,
      // Stagger the start so the 8 bolts don't all grow in lockstep
      startDelay: Math.random() * 350,
      // Grow over ~1100ms then HOLD INDEFINITELY (no fadeMs).
      // mouseleave triggers a separate fade.
      growMs:     1000 + Math.random() * 300
    };
  }

  function startHoverCrawl() {
    if (prefersReduced) return;
    if (hoverCrawlState.active) return;
    hoverCrawlState.active   = true;
    hoverCrawlState.bolts    = [];
    hoverCrawlState.fadeStart = 0;   // 0 = not fading; set on mouseleave
    overlay.classList.add('is-firing');

    var ctx  = canvas.getContext('2d');
    var W, H, maxR, ox, oy;

    function recomputeOrigin() {
      W = window.innerWidth;
      H = window.innerHeight;
      maxR = Math.hypot(W, H);
      var rect = link.getBoundingClientRect();
      ox = rect.left + rect.width  / 2;
      oy = rect.top  + rect.height / 2;
    }
    recomputeOrigin();

    // Single burst at hover-start: 2 bolts per cardinal direction = 8 bolts
    // total. They grow once and hold their full length until mouseleave.
    var now0 = performance.now();
    for (var d = 0; d < 4; d++) {
      hoverCrawlState.bolts.push(spawnCrawlBolt(ox, oy, maxR, now0, d));
      hoverCrawlState.bolts.push(spawnCrawlBolt(ox, oy, maxR, now0, d));
    }

    function tick(now) {
      if (!hoverCrawlState.active) return;
      ctx.clearRect(0, 0, W, H);

      // mouseleave triggers a 500ms fade for all bolts together.
      var FADE_MS = 500;
      var fadingT = 0;
      if (hoverCrawlState.fadeStart > 0) {
        fadingT = Math.min(1, (now - hoverCrawlState.fadeStart) / FADE_MS);
      }

      var anyAlive = false;
      for (var i = 0; i < hoverCrawlState.bolts.length; i++) {
        var b = hoverCrawlState.bolts[i];
        var localAge = now - b.bornAt - b.startDelay;
        if (localAge < 0) { anyAlive = true; continue; }  // not started yet

        // Phase 1: grow (ease-out reveal along the polyline). Once at
        // 100%, the bolt holds. No spontaneous fade.
        var revealFrac;
        if (localAge < b.growMs) {
          revealFrac = 1 - Math.pow(1 - (localAge / b.growMs), 2.5);
        } else {
          revealFrac = 1;
        }
        var revealLen = revealFrac * b.total;

        // Opacity: brief fade-in over 200ms, then 1.0 forever, except
        // during mouseleave fade which multiplies everything.
        var alpha;
        if (localAge < 200)      alpha = localAge / 200;
        else                     alpha = 1;
        alpha *= (1 - fadingT);   // fade to 0 on mouseleave
        alpha *= 0.65;             // overall subtle baseline

        if (alpha <= 0) continue;
        anyAlive = true;

        var revealed = slicePolylineLocal(b.pts, b.prefix, revealLen);
        if (revealed && revealed.length >= 2) {
          drawBolt(ctx, revealed, b.color, b.width * 3.0, alpha * 0.18);
          drawBolt(ctx, revealed, b.color, b.width,       alpha * 0.85);
          drawBolt(ctx, revealed, '#ffffff', Math.max(0.5, b.width * 0.35), alpha * 0.55);
        }
      }

      // Terminate when faded out completely
      if (hoverCrawlState.fadeStart > 0 && fadingT >= 1) {
        hoverCrawlState.active = false;
        hoverCrawlState.rafId  = null;
        hoverCrawlState.bolts  = [];
        ctx.clearRect(0, 0, W, H);
        overlay.classList.remove('is-firing');
        return;
      }
      // Or if nothing is alive (shouldn't happen pre-fade, but safe)
      if (!anyAlive && hoverCrawlState.fadeStart > 0) {
        hoverCrawlState.active = false;
        hoverCrawlState.rafId  = null;
        ctx.clearRect(0, 0, W, H);
        overlay.classList.remove('is-firing');
        return;
      }

      hoverCrawlState.rafId = requestAnimationFrame(tick);
    }

    // Track window resizes so origin stays correct
    var onResize = function () { recomputeOrigin(); };
    window.addEventListener('resize', onResize);
    hoverCrawlState._onResize = onResize;

    hoverCrawlState.rafId = requestAnimationFrame(tick);
  }

  function stopHoverCrawl(immediate) {
    if (!hoverCrawlState.active) return;
    if (immediate) {
      // Used by the click handler to hand the canvas off cleanly.
      if (hoverCrawlState.rafId) cancelAnimationFrame(hoverCrawlState.rafId);
      hoverCrawlState.rafId    = null;
      hoverCrawlState.active   = false;
      hoverCrawlState.bolts    = [];
      hoverCrawlState.fadeStart = 0;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      overlay.classList.remove('is-firing');
    } else {
      // Used by mouseleave: trigger a graceful fade-out.
      if (hoverCrawlState.fadeStart === 0) {
        hoverCrawlState.fadeStart = performance.now();
      }
    }
    if (hoverCrawlState._onResize) {
      window.removeEventListener('resize', hoverCrawlState._onResize);
      hoverCrawlState._onResize = null;
    }
  }

  // slicePolyline is defined inside firePulse's closure; replicate a small
  // version here so the hover loop doesn't depend on firePulse running.
  function slicePolylineLocal(pts, prefix, reveal) {
    if (reveal <= 0) return null;
    if (reveal >= prefix[prefix.length - 1]) return pts;
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      if (prefix[i] <= reveal) {
        out.push(pts[i]);
      } else {
        var segLen   = prefix[i] - prefix[i-1];
        var needed   = reveal  - prefix[i-1];
        var t = needed / segLen;
        out.push({
          x: pts[i-1].x + (pts[i].x - pts[i-1].x) * t,
          y: pts[i-1].y + (pts[i].y - pts[i-1].y) * t
        });
        break;
      }
    }
    return out;
  }

  // Terminal text element + message constants.
  // The terminal status line lives in panel--mb. We drive its colour
  // and text via body classes (is-armed / is-firing) so the CSS cascade
  // handles styling without each handler reaching across the DOM.
  var terminalText = document.getElementById('splash-terminal-text');
  var TERM_IDLE   = 'SYSTEM READY // HOVER LOGO TO ARM';
  var TERM_ARMED  = 'SYSTEM ARMED // CLICK TO ENTER';
  var TERM_FIRED  = 'AUTHENTICATING // ENTERING GRID';
  function setTerminal(msg) {
    if (terminalText) terminalText.textContent = msg;
  }

  // Boot sequence gate. Hover handlers ignore terminal updates while
  // false; runPowerUp() flips this to true at the end of the sequence.
  var powerUpComplete = false;

  // Hover wiring on the image-button itself (no separate bullseye wrapper).
  // After the boot sequence finishes, hover arms the system, click fires.
  // During the boot sequence the hover handlers are wired but the boot
  // messages take precedence in the terminal (see runPowerUp below).
  link.addEventListener('mouseenter', function () {
    startHoverCrawl();
    if (!powerUpComplete) return;       // ignore during boot
    document.body.classList.add('is-armed');
    document.body.classList.remove('is-firing');
    setTerminal(TERM_ARMED);
  });
  link.addEventListener('mouseleave', function () {
    stopHoverCrawl(false);              // gentle: 500ms fade
    if (!powerUpComplete) return;
    document.body.classList.remove('is-armed');
    if (!link.classList.contains('is-entering')) {
      setTerminal(TERM_IDLE);
    }
  });

  // Click handler: play the pulse, swap logo → "Entering the page", then navigate.
  link.addEventListener('click', function (e) {
    // Allow modifier-clicks (new tab / new window) to behave normally.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;

    e.preventDefault();
    var href = link.getAttribute('href') || 'nav.html';

    if (prefersReduced) {
      window.location.href = href;
      return;
    }

    // Hand the canvas off from the hover crawl to the click pulse cleanly.
    stopHoverCrawl(true);

    // Mark the button as entering. CSS cascades to:
    //   - hide the image and show the entering overlay
    //   - hide the hover caption
    link.classList.add('is-entering');
    document.body.classList.remove('is-armed');
    document.body.classList.add('is-firing');
    setTerminal(TERM_FIRED);

    // Safety: if the animation hangs for any reason, navigate anyway.
    // Total pulse is 3200ms; allow a little headroom.
    var navigated = false;
    function go() {
      if (navigated) return;
      navigated = true;
      cleanupPulse();
      window.location.href = href;
    }
    setTimeout(go, 3700);

    firePulse().then(go);
  });

  // ============================================================
  // Power-up boot sequence (3.5s total)
  // ------------------------------------------------------------
  // Animates the terminal-log panel and the power-bar in concert:
  //   • 6 boot lines appear one at a time (~580ms apart)
  //   • Each line carries an OK/WARN tag at the right
  //   • Power bar fills from 0% to 100% over the full duration
  //   • At 100%: bar locks "READY" (pulsing lime), terminal status
  //     flips to TERM_IDLE, powerUpComplete = true (hover unlocks)
  // ============================================================
  var POWER_UP_MS = 3500;
  var BOOT_LINES = [
    { msg: 'NODE_VAULT // ONLINE',         tag: 'OK',   cls: '' },
    { msg: 'HELIX_STACK // ACTIVE',        tag: 'OK',   cls: '' },
    { msg: 'MSVtx_FEED // CONNECTED',      tag: 'OK',   cls: '' },
    { msg: 'GEO_TEXTURE // STREAMING',     tag: 'OK',   cls: '' },
    { msg: 'CRUCIBLE_MODEL // VALIDATED',  tag: 'OK',   cls: '' },
    { msg: 'AUTH_TOKEN // PRESENT',        tag: 'OK',   cls: '' }
  ];

  function runPowerUp() {
    var logEl    = document.getElementById('terminal-log');
    var barEl    = document.getElementById('power-bar');
    var pctEl    = document.getElementById('power-pct');
    var termTag  = document.getElementById('term-tag');
    var statusEl = document.getElementById('stat-status');

    if (!logEl) { powerUpComplete = true; return; }
    if (termTag) termTag.textContent = '// BOOTING';

    var perLine = POWER_UP_MS / BOOT_LINES.length;

    BOOT_LINES.forEach(function (entry, i) {
      setTimeout(function () {
        var line = document.createElement('div');
        line.className = 'term-line';
        line.innerHTML =
          '<span class="prompt">&gt;</span>' +
          '<span class="msg">' + entry.msg + '</span>' +
          '<span class="ok">[ ' + entry.tag + ' ]</span>';
        logEl.appendChild(line);
        line.offsetHeight;                         // force reflow
        line.classList.add('is-visible');
        logEl.scrollTop = logEl.scrollHeight;
        setTerminal(entry.msg);
      }, i * perLine + 80);
    });

    // ----- Segmented power bar -----
    // 20 tick blocks. Each segment has a FIXED colour by position, so the
    // bar shows a left-to-right gradient (red → orange → yellow → green)
    // as it fills. Reads as a real charge scale: the colour where the
    // charge stops tells you how full the cell is.
    var SEG_COUNT = 20;
    var segs = [];

    // Charge palette stops along 0..1 used to colour segments by position.
    // Sequence: red → yellow → blue → green (left to right across the bar).
    var CHARGE_STOPS = [
      { p: 0.00, r: 255, g:  56, b:  56 },   // red    (empty)
      { p: 0.33, r: 255, g: 220, b:   0 },   // yellow
      { p: 0.66, r:  40, g: 140, b: 255 },   // blue
      { p: 1.00, r:  60, g: 230, b:  70 }    // green  (full)
    ];
    function chargeColor(t) {
      t = Math.max(0, Math.min(1, t));
      for (var i = 1; i < CHARGE_STOPS.length; i++) {
        var b = CHARGE_STOPS[i];
        var a = CHARGE_STOPS[i - 1];
        if (t <= b.p) {
          var f = (t - a.p) / (b.p - a.p);
          return {
            r: Math.round(a.r + (b.r - a.r) * f),
            g: Math.round(a.g + (b.g - a.g) * f),
            b: Math.round(a.b + (b.b - a.b) * f)
          };
        }
      }
      var last = CHARGE_STOPS[CHARGE_STOPS.length - 1];
      return { r: last.r, g: last.g, b: last.b };
    }

    if (barEl) {
      barEl.innerHTML = '';
      for (var s = 0; s < SEG_COUNT; s++) {
        var seg = document.createElement('div');
        seg.className = 'power-bar-seg';
        // Static colour assigned by segment POSITION along the bar
        var c = chargeColor(s / (SEG_COUNT - 1));
        seg.style.setProperty('--seg-color',
          'rgba(' + c.r + ',' + c.g + ',' + c.b + ', 0.95)');
        barEl.appendChild(seg);
        segs.push(seg);
      }
    }

    // Charge readout — large percentage display below the bar.
    // Updated alongside the existing small pctEl in the bar label.
    var chargeReadout = document.getElementById('power-readout');

    // Advance the leading segment in lockstep with the boot duration.
    // 20 segments over 3500ms = 175ms per segment.
    var perSeg = POWER_UP_MS / SEG_COUNT;
    var idx = 0;
    var segTimer = setInterval(function () {
      if (idx > 0) segs[idx - 1].classList.remove('is-leading');
      if (idx < SEG_COUNT) {
        segs[idx].classList.add('is-on', 'is-leading');
        idx++;
        var pct = Math.round((idx / SEG_COUNT) * 100);
        if (pctEl)         pctEl.textContent = pct + '%';
        if (chargeReadout) chargeReadout.textContent = pct + '%';
      } else {
        clearInterval(segTimer);
      }
    }, perSeg);

    // After the full sequence, lock to READY state
    setTimeout(function () {
      segs.forEach(function (el) { el.classList.remove('is-leading'); });
      if (barEl)         barEl.classList.add('is-ready');
      if (pctEl)         pctEl.textContent = 'READY';
      if (chargeReadout) chargeReadout.textContent = 'READY';
      if (termTag)       termTag.textContent = '// READY';
      if (statusEl)      statusEl.textContent = 'READY';
      setTerminal(TERM_IDLE);
      document.body.classList.add('is-powered');
      powerUpComplete = true;
    }, POWER_UP_MS + 80);
  }

  // Kick off the power-up after a short delay so the page paints first.
  setTimeout(runPowerUp, 200);

  // ============================================================
  // Data port widgets (right-bottom panel)
  // ------------------------------------------------------------
  // Two specialty visualizations, one per port. The BEAM system
  // drives each widget's `displayV` during a lock. Between locks
  // the widgets continue rendering with the last value (no random
  // walk — the beam IS the data source).
  //
  //   PORT_A (cyan):  Multi-channel time series.
  //     • signal  (primary, the beam readout)
  //     • deriv   (its time-derivative)
  //     • envel   (volatility envelope: signal ± rolling std-dev)
  //
  //   PORT_B (lime):  Hyperbolic transform visualizer.
  //     Draws a live hyperbola (x²/a² − y²/b² = 1) with eccentricity
  //     drifting. A moving sample point traces the right branch,
  //     parameterized t = displayV / 100. Asymptotes drawn dashed.
  // ============================================================
  function initWidgets() {
    var widgets = [];
    var palette = {
      cyan: { stroke: '#00d9ff', fill: 'rgba(0,217,255,0.18)',  rgb: '0,217,255'  },
      lime: { stroke: '#c8ff00', fill: 'rgba(200,255,0,0.16)',  rgb: '200,255,0'  }
    };

    var canvases = document.querySelectorAll('.widget-canvas');
    if (!canvases.length) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvases.forEach(function (canvas) {
      var kind = canvas.getAttribute('data-widget');     // 'bayesian' | 'hyperbola'
      var color = palette[canvas.getAttribute('data-color')] || palette.cyan;
      var widgetEl = canvas.closest('.widget');
      var portName = widgetEl ? widgetEl.getAttribute('data-port') : null;
      var valEl = widgetEl ? widgetEl.querySelector('.widget-val') : null;

      function fit() {
        var r = canvas.getBoundingClientRect();
        canvas.width  = Math.max(60, Math.floor(r.width  * dpr));
        canvas.height = Math.max(30, Math.floor(r.height * dpr));
      }
      fit();
      window.addEventListener('resize', fit);

      // Per-widget state. The BEAM system reads/writes:
      //   w.locked       – is the port actively scanning?
      //   w.v / displayV – live reading 0..100 (used by hyperbola sweep)
      //   w.lastTrial    – { cycleId, success, reading } — Bayesian feeds
      //                    on this and consumes via cycleId tracking.
      var state = {
        kind: kind,
        canvas: canvas,
        el: widgetEl,
        valEl: valEl,
        color: color,
        name: portName,
        locked: false,
        v: 50,
        displayV: 50,
        // ---------- Bayesian (Beta–Binomial) state ----------
        // Beta(α₀, β₀) prior — start mildly informative around 0.5.
        // After each scan: α ← α + success, β ← β + failure.
        bayes: {
          prior_alpha: 2,
          prior_beta:  2,
          alpha:       2,
          beta:        2,
          trials:      0,
          successes:   0,
          lastCycleId: 0,
          history:     []   // recent posterior means for sparkline trail
        },
        // ---------- Hyperbola sweep state ----------
        // Anchored params — frozen at the most recent scan reading so
        // the curve stops drifting once a lock completes. Sweep angle
        // theta rotates continuously; stats accumulate over sweep cycles.
        hyperbola: {
          a:           1.0,
          b:           0.7,
          theta:       0,         // current sweep angle (radians)
          omega:       0.6,       // rad/s
          lastCycleId: 0,
          thetaHits:   [],        // angles at which lock-events fired
          // Aggregate sweep stats
          sweepCount:  0,
          maxSec:      1,
          maxTan:      0
        }
      };
      widgets.push(state);
    });

    // ====================================================================
    // Render: Bayesian Beta–Binomial tracker
    // --------------------------------------------------------------------
    // Each scan emits one Bernoulli trial via w.lastTrial. We compare its
    // cycleId against w.bayes.lastCycleId — if different, we consume the
    // trial: α ← α + s, β ← β + (1 − s). The Beta(α, β) PDF is drawn over
    // p ∈ [0, 1]; the prior is overlaid as a faint reference outline.
    // Posterior mean μ = α/(α+β), variance σ² = αβ/((α+β)²(α+β+1)), and
    // a normal-approx 95% CI μ ± 1.96·σ are reported in the corner.
    // ====================================================================
    function logBeta(a, b) {
      return logGamma(a) + logGamma(b) - logGamma(a + b);
    }
    // Stirling-series log-Gamma (Lanczos would be overkill for our α,β
    // which stay modest). Accurate to ~1e-8 for x ≥ 0.5.
    function logGamma(x) {
      // Shift small args up using Γ(x) = Γ(x+1)/x recursion, then series.
      var shift = 0;
      while (x < 8) { shift -= Math.log(x); x += 1; }
      var xi = 1 / x;
      var xi2 = xi * xi;
      var s = (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI);
      // Bernoulli-series correction
      s += xi * (1/12 - xi2 * (1/360 - xi2 * (1/1260 - xi2 / 1680)));
      return s + shift;
    }
    function betaPdf(p, a, b) {
      if (p <= 0 || p >= 1) return 0;
      var lp = (a - 1) * Math.log(p) + (b - 1) * Math.log(1 - p) - logBeta(a, b);
      return Math.exp(lp);
    }

    function drawBayesian(w, now) {
      var ctx = w.canvas.getContext('2d');
      var W = w.canvas.width, H = w.canvas.height;
      ctx.clearRect(0, 0, W, H);
      var col = w.color;
      var B = w.bayes;

      // --- Consume new Bernoulli trial if the BEAM emitted one ---
      var trial = w.lastTrial;
      if (trial && trial.cycleId !== B.lastCycleId) {
        B.lastCycleId = trial.cycleId;
        B.alpha += trial.success;
        B.beta  += (1 - trial.success);
        B.trials    += 1;
        B.successes += trial.success;
        // Record posterior mean snapshot for the trail
        var m = B.alpha / (B.alpha + B.beta);
        B.history.push(m);
        if (B.history.length > 60) B.history.shift();
      }

      var padL = 32 * dpr, padR = 8 * dpr;
      var padT = 14 * dpr, padBT = 14 * dpr;
      var plotW = W - padL - padR;
      var plotH = H - padT - padBT;

      // X axis: p ∈ [0,1]
      function px(p) { return padL + p * plotW; }
      function py(d, dMax) { return padT + (1 - d / dMax) * plotH; }

      // Sample both PDFs across [0,1]
      var N = 96;
      var prior = new Float64Array(N + 1);
      var post  = new Float64Array(N + 1);
      var maxV = 0;
      for (var i = 0; i <= N; i++) {
        var p = (i + 0.5) / (N + 1);   // avoid 0 & 1 endpoints
        prior[i] = betaPdf(p, B.prior_alpha, B.prior_beta);
        post[i]  = betaPdf(p, B.alpha, B.beta);
        if (prior[i] > maxV) maxV = prior[i];
        if (post[i]  > maxV) maxV = post[i];
      }
      if (maxV <= 0) maxV = 1;
      // Add headroom so the peak doesn't kiss the top
      maxV *= 1.10;

      // --- Faint grid (4 horizontal bands + p=0.5 line) ---
      ctx.strokeStyle = 'rgba(0,217,255,0.07)';
      ctx.lineWidth = 1;
      for (var g = 1; g < 4; g++) {
        var y = padT + (g / 4) * plotH;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      }
      // x-tick marks at p = 0, 0.25, 0.5, 0.75, 1
      ctx.strokeStyle = 'rgba(0,217,255,0.20)';
      [0, 0.25, 0.5, 0.75, 1].forEach(function (p) {
        var x = px(p);
        ctx.beginPath();
        ctx.moveTo(x, padT + plotH);
        ctx.lineTo(x, padT + plotH + 4 * dpr);
        ctx.stroke();
      });
      // p=0.5 vertical guide
      ctx.strokeStyle = 'rgba(176,38,255,0.30)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px(0.5), padT); ctx.lineTo(px(0.5), padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- Prior outline (purple, dashed) ---
      ctx.strokeStyle = 'rgba(176,38,255,0.65)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (var k = 0; k <= N; k++) {
        var pp = (k + 0.5) / (N + 1);
        var xx = px(pp), yy = py(prior[k], maxV);
        if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // --- 95% credible interval shading (normal approx) ---
      var mean = B.alpha / (B.alpha + B.beta);
      var n = B.alpha + B.beta;
      var variance = (B.alpha * B.beta) / (n * n * (n + 1));
      var sd = Math.sqrt(variance);
      var ci_lo = Math.max(0, mean - 1.96 * sd);
      var ci_hi = Math.min(1, mean + 1.96 * sd);
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.10)';
      ctx.fillRect(px(ci_lo), padT, px(ci_hi) - px(ci_lo), plotH);

      // --- Posterior fill + stroke ---
      ctx.beginPath();
      ctx.moveTo(padL, padT + plotH);
      for (var j = 0; j <= N; j++) {
        var pj = (j + 0.5) / (N + 1);
        ctx.lineTo(px(pj), py(post[j], maxV));
      }
      ctx.lineTo(padL + plotW, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.28)';
      ctx.fill();

      ctx.strokeStyle = col.stroke;
      ctx.lineWidth = 1.8 * dpr;
      ctx.beginPath();
      for (var jj = 0; jj <= N; jj++) {
        var pjj = (jj + 0.5) / (N + 1);
        var xj = px(pjj), yj = py(post[jj], maxV);
        if (jj === 0) ctx.moveTo(xj, yj); else ctx.lineTo(xj, yj);
      }
      ctx.stroke();

      // --- Mean marker ---
      var mx = px(mean);
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(mx, padT); ctx.lineTo(mx, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      // Mean dot at curve top
      var meanY = py(betaPdf(mean, B.alpha, B.beta), maxV);
      ctx.fillStyle = col.stroke;
      ctx.beginPath();
      ctx.arc(mx, meanY, (w.locked ? 4.5 : 3) * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx, meanY, 9 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.20)';
      ctx.fill();

      // --- Stats overlay (top-left + top-right) ---
      ctx.font = (9 * dpr) + 'px monospace';
      ctx.fillStyle = 'rgba(0,217,255,0.85)';
      ctx.textAlign = 'left';
      ctx.fillText('n=' + B.trials + '  s=' + B.successes,
                   padL + 2 * dpr, padT - 3 * dpr);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.95)';
      ctx.fillText('μ=' + mean.toFixed(3) +
                   '  σ=' + sd.toFixed(3),
                   padL + plotW, padT - 3 * dpr);

      // Bottom-right: α, β + 95% CI
      ctx.fillStyle = 'rgba(0,217,255,0.50)';
      ctx.textAlign = 'left';
      ctx.fillText('α=' + B.alpha.toFixed(1) + ' β=' + B.beta.toFixed(1),
                   padL + 2 * dpr, H - 4 * dpr);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.85)';
      ctx.fillText('95% CI [' + ci_lo.toFixed(2) + ', ' + ci_hi.toFixed(2) + ']',
                   padL + plotW, H - 4 * dpr);

      // Y axis label (rotated p density)
      ctx.fillStyle = 'rgba(0,217,255,0.40)';
      ctx.textAlign = 'left';
      ctx.fillText('p(θ)', 4 * dpr, padT + 6 * dpr);

      // Update the widget header readout — posterior mean as %
      if (w.valEl) {
        w.valEl.textContent = 'μ=' + (mean * 100).toFixed(1) + '%';
      }
    }

    // ====================================================================
    // Render: Anchored hyperbola + unit-circle sweep
    // --------------------------------------------------------------------
    // The hyperbola x²/a² − y²/b² = 1 is anchored — a and b update only
    // on a fresh scan (via lastTrial.cycleId). A unit circle sits on top
    // at the origin. A radial sweep arm rotates at ω rad/s through θ;
    // when |cos θ| is well above 1/(big number) we project to the
    // hyperbola at x = a·sec θ, y = b·tan θ. Reports current θ (deg),
    // sec, tan, sweep count, and running maxima.
    // ====================================================================
    function drawHyperbolaSweep(w, now) {
      var ctx = w.canvas.getContext('2d');
      var W = w.canvas.width, H = w.canvas.height;
      ctx.clearRect(0, 0, W, H);
      var col = w.color;
      var hyp = w.hyperbola;
      var cx = W * 0.5, cy = H * 0.5;
      var X_MAX = 3.0;
      var scale = (Math.min(W, H) * 0.40) / X_MAX;

      // --- Anchor a, b on each new scan ---
      var trial = w.lastTrial;
      if (trial && trial.cycleId !== hyp.lastCycleId) {
        hyp.lastCycleId = trial.cycleId;
        // Map reading 0..100 → a ∈ [0.6, 1.4], b ∈ [0.5, 1.2].
        // Successes and failures pull a and b in opposite directions
        // slightly so the curve visibly reacts to the scan outcome.
        var r = trial.reading;
        hyp.a = 0.6 + (r / 100) * 0.8;
        hyp.b = 0.5 + ((trial.success ? 0.7 : 0.3)) * 0.7;
        hyp.thetaHits.push(hyp.theta);
        if (hyp.thetaHits.length > 24) hyp.thetaHits.shift();
        hyp.sweepCount += 1;
      }

      // Advance sweep
      var dt = Math.min(0.05, (now - (hyp.lastNow || now)) / 1000);
      hyp.lastNow = now;
      hyp.theta += hyp.omega * dt;
      if (hyp.theta >= 2 * Math.PI) {
        hyp.theta -= 2 * Math.PI;
      }
      var theta = hyp.theta;
      var a = hyp.a, b = hyp.b;

      // --- Faint axes ---
      ctx.strokeStyle = 'rgba(0,217,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy); ctx.lineTo(W, cy);
      ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
      ctx.stroke();

      // --- Asymptotes (dashed) ---
      var slope = b / a;
      ctx.strokeStyle = 'rgba(176,38,255,0.40)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, cy + cx * slope);
      ctx.lineTo(W, cy - (W - cx) * slope);
      ctx.moveTo(0, cy - cx * slope);
      ctx.lineTo(W, cy + (W - cx) * slope);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- Hyperbola branches (both, parametric x = ±a·cosh(s)) ---
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth = 1.8 * dpr;
      function drawBranch(sign) {
        ctx.beginPath();
        var first = true;
        for (var s = -2.5; s <= 2.5; s += 0.06) {
          var x = sign * a * Math.cosh(s);
          var y = b * Math.sinh(s);
          var ppx = cx + x * scale;
          var ppy = cy - y * scale;
          if (ppx < -10 || ppx > W + 10) continue;
          if (first) { ctx.moveTo(ppx, ppy); first = false; }
          else        { ctx.lineTo(ppx, ppy); }
        }
        ctx.stroke();
      }
      drawBranch(1);
      drawBranch(-1);

      // --- Unit circle anchored at origin ---
      // Circle of radius = a (so it sits at the vertex of the right branch
      // and reads as the "auxiliary circle" of the hyperbola — sec θ then
      // naturally projects from circle to hyperbola horizontally).
      var rCircle = a * scale;
      ctx.strokeStyle = 'rgba(' + col.rgb + ',0.90)';
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, rCircle, 0, Math.PI * 2);
      ctx.stroke();
      // Soft fill so the circle reads as a distinct layer above the
      // hyperbola.
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.06)';
      ctx.beginPath();
      ctx.arc(cx, cy, rCircle, 0, Math.PI * 2);
      ctx.fill();

      // --- Sweep arm: ray from origin at angle theta ---
      var armLen = Math.max(W, H);
      var armDx = Math.cos(theta);
      var armDy = -Math.sin(theta);     // canvas Y inverts
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + armDx * armLen, cy + armDy * armLen);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- Intersection: arm ∩ circle (always exists) ---
      var circX = cx + armDx * rCircle;
      var circY = cy + armDy * rCircle;
      ctx.fillStyle = col.stroke;
      ctx.beginPath();
      ctx.arc(circX, circY, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(circX, circY, 9 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.22)';
      ctx.fill();

      // --- Hyperbola point at this theta: (a sec θ, b tan θ) ---
      // Defined only where |cos θ| > threshold to avoid the asymptote
      // blow-up. We draw the vertical drop from the circle x-coord down
      // to the hyperbola — this is the classic geometric construction:
      //   x_hyp = a · sec θ = (a / cos θ) = x of arm ∩ vertical-line-at-circle
      // Equivalent here: drop vertically from the circle intersect.
      var cosT = Math.cos(theta);
      var sinT = Math.sin(theta);
      var validHyp = Math.abs(cosT) > 0.18;
      var secT = 1 / cosT;
      var tanT = sinT / cosT;
      if (validHyp) {
        var hx = cx + (a * secT) * scale;
        var hy = cy - (b * tanT) * scale;
        // Update running stats
        if (Math.abs(secT) > hyp.maxSec) hyp.maxSec = Math.abs(secT);
        if (Math.abs(tanT) > hyp.maxTan) hyp.maxTan = Math.abs(tanT);
        // Connector: circle-intersect ↓ to hyperbola point
        if (hx >= 0 && hx <= W) {
          ctx.strokeStyle = 'rgba(' + col.rgb + ',0.55)';
          ctx.lineWidth = 1 * dpr;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(circX, circY); ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.setLineDash([]);
          // Hyperbola hit point
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(hx, hy, 3.2 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(hx, hy, 8 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fill();
        }
      }

      // --- Recent θ-hits as faint tick marks around the circle ---
      ctx.strokeStyle = 'rgba(' + col.rgb + ',0.65)';
      ctx.lineWidth = 1.3 * dpr;
      hyp.thetaHits.forEach(function (th, idx) {
        var age = (hyp.thetaHits.length - idx) / hyp.thetaHits.length;
        ctx.globalAlpha = 0.25 + age * 0.6;
        var tx0 = cx + Math.cos(th) * (rCircle - 5 * dpr);
        var ty0 = cy - Math.sin(th) * (rCircle - 5 * dpr);
        var tx1 = cx + Math.cos(th) * (rCircle + 5 * dpr);
        var ty1 = cy - Math.sin(th) * (rCircle + 5 * dpr);
        ctx.beginPath();
        ctx.moveTo(tx0, ty0); ctx.lineTo(tx1, ty1);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      // --- Stats overlay ---
      ctx.font = (9 * dpr) + 'px monospace';
      var degT = (theta * 180 / Math.PI).toFixed(1);
      // Top row: theta + sweep count
      ctx.fillStyle = 'rgba(0,217,255,0.85)';
      ctx.textAlign = 'left';
      ctx.fillText('θ=' + degT + '°  sweeps=' + hyp.sweepCount,
                   6 * dpr, 11 * dpr);
      // Top right: sec, tan
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.95)';
      if (validHyp) {
        ctx.fillText('sec=' + secT.toFixed(2) + '  tan=' + tanT.toFixed(2),
                     W - 6 * dpr, 11 * dpr);
      } else {
        ctx.fillText('sec=∞  (asymptote)', W - 6 * dpr, 11 * dpr);
      }
      // Bottom row: a, b
      ctx.fillStyle = 'rgba(0,217,255,0.50)';
      ctx.textAlign = 'left';
      ctx.fillText('a=' + a.toFixed(2) + '  b=' + b.toFixed(2),
                   6 * dpr, H - 4 * dpr);
      // Bottom right: running maxima
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(' + col.rgb + ',0.85)';
      ctx.fillText('max|sec|=' + hyp.maxSec.toFixed(2) +
                   '  max|tan|=' + hyp.maxTan.toFixed(2),
                   W - 6 * dpr, H - 4 * dpr);

      // Widget header readout — current θ in degrees
      if (w.valEl) {
        w.valEl.textContent = 'θ=' + degT + '°';
      }
    }

    // ---------- Render loop ----------
    function loop(now) {
      widgets.forEach(function (w) {
        if (w.kind === 'bayesian') drawBayesian(w, now);
        else if (w.kind === 'hyperbola') drawHyperbolaSweep(w, now);
      });
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // Expose for the BEAM system to mutate w.locked / w.v / w.displayV /
    // w.lastTrial. The widgets self-poll for new lastTrial cycleIds.
    window._splashWidgets = widgets;
  }
  initWidgets();

  // ============================================================
  // BEAM system — sustained data link from each port to the globe
  // ------------------------------------------------------------
  // Per-port state machine:
  //   IDLE       → wait briefly, then pick a globe target (lat/lon)
  //   LOCK_IN    → spike grows OUT of the globe surface (250ms);
  //                beam fades in concurrent
  //   HOLD       → beam steady, readout values stream (~2000ms)
  //   LOCK_OUT   → spike retracts (250ms), beam fades to nothing
  //   (back to IDLE briefly, then re-target)
  //
  // Targets are stored as world-space points on the unit sphere
  // (Vector3 with length 1.0). Each frame they're transformed by
  // the globe's current rotation, then projected to viewport coords
  // via the orthographic camera. The beam draws straight from the
  // port's right edge to the projected spike tip.
  //
  // The spike itself is a Three.js cylinder, child of globeMesh
  // so it rotates with the globe. Position = unit-sphere point,
  // orientation = quaternion that rotates +Y onto the surface
  // normal at that point. Scale.y = current growth (0 → 0.10).
  // ============================================================
  function initBeams() {
    var canvasEl   = document.getElementById('probe-canvas');
    var trendsPanel = document.getElementById('trends-panel');
    var globeRef    = window._splashGlobe;
    if (!canvasEl || !trendsPanel || !globeRef) {
      console.warn('[splash] beam system: missing deps');
      return;
    }

    var ctx = canvasEl.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function fit() {
      canvasEl.width  = Math.floor(window.innerWidth  * dpr);
      canvasEl.height = Math.floor(window.innerHeight * dpr);
      canvasEl.style.width  = window.innerWidth  + 'px';
      canvasEl.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fit();
    window.addEventListener('resize', fit);

    // Palette — right-column lasers use red/green (distinct from the
    // page's cyan/lime/purple). PORT_A (cpu) = green, PORT_B (mem) = red.
    var COLORS = {
      cpu: { r: 0,   g: 255, b: 102, hex: 0x00ff66 },
      mem: { r: 255, g: 51,  b: 68,  hex: 0xff3344 }
    };
    // Max spike extension as a fraction of the globe radius (1.0 = full
    // radius). 0.22 = a noticeably thick antenna spike during HOLD, so
    // the lock point reads clearly even from across the dashboard.
    var SPIKE_MAX_LEN = 0.22;

    // ----- Build per-port state, including a 3D spike attached to globeMesh -----
    var ports = [];
    var globePanel = document.querySelector('.panel--rt');
    var widgetsArr = window._splashWidgets || [];

    // Two ports: cyan (PORT_A / cpu) and lime (PORT_B / mem).
    // Each port has a "node" — a small dot that rides along the
    // perimeter of the globe panel border, fires lasers from its
    // current position. Node walks the perimeter parameterised by
    // t ∈ [0, PERIM) where PERIM = 2*(W + H).
    ['cpu', 'mem'].forEach(function (portName) {
      var color = COLORS[portName] || COLORS.cpu;
      var widget = widgetsArr.filter(function (w) { return w.name === portName; })[0];

      // The 3D spike — a chunkier cylinder along its local Y axis.
      // Parented to globeMesh so it rotates with the globe.
      // Radii bumped (0.018 base / 0.004 tip) so the spike reads as a
      // proper pin coming off the globe rather than a hair.
      var spikeGeo = new THREE.CylinderGeometry(0.018, 0.004, 1.0, 10);
      spikeGeo.translate(0, 0.5, 0);
      var spikeMat = new THREE.MeshBasicMaterial({
        color: color.hex,
        transparent: true,
        opacity: 0.90,
        depthWrite: false
      });
      var spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.visible = false;
      spike.scale.set(1, 0.001, 1);
      globeRef.globeMesh.add(spike);

      ports.push({
        name: portName,
        widget: widget,      // for setting locked / displayV
        color: color,
        spike: spike,
        // Roaming node parameters
        node: {
          t: portName === 'cpu' ? 0 : 0.5,
          vel: (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.04),
          lastFlip: 0,
          x: 0, y: 0
        },
        // State machine. HOLD and GAP are re-rolled each cycle in the
        // transition() function so the two ports drift independently —
        // sometimes both locked, sometimes one alone, with visible lulls
        // where the widgets sit dormant before the next scan.
        state: 'IDLE',
        stateStart: 0,
        target: new THREE.Vector3(1, 0, 0),
        durations: {
          IDLE:     0,
          LOCK_IN:  350,
          HOLD:     5500,        // ≥5s; re-rolled per cycle
          LOCK_OUT: 350,
          GAP:      1200         // re-rolled per cycle
        },
        // Surface ripples — rings expanding from the lock point during HOLD.
        // We spawn one every RIPPLE_INTERVAL ms; each lives RIPPLE_LIFE ms.
        ripples: [],
        lastRipple: 0
      });
    });

    // Ripple timing constants
    var RIPPLE_INTERVAL = 500;     // ms between spawns during HOLD
    var RIPPLE_LIFE     = 1100;    // ms per ripple from birth to fade-out
    var RIPPLE_MAX_R    = 38;      // px — final radius before vanishing

    // ----- Helpers -----
    // Random unit-sphere point biased toward the northern hemisphere
    // (where most continents are) so locks land on visible land most often.
    function randomGlobeTarget() {
      var u = Math.random();
      var v = Math.random();
      var theta = 2 * Math.PI * u;
      var phi = Math.acos(2 * v - 1) * 0.85 + 0.1;
      return new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      );
    }

    // Orient a spike's +Y axis to point along a given direction.
    var TMP_UP = new THREE.Vector3(0, 1, 0);
    function orientSpike(spike, target) {
      spike.position.copy(target);
      var q = new THREE.Quaternion();
      q.setFromUnitVectors(TMP_UP, target);
      spike.quaternion.copy(q);
    }

    // Project world-space point → viewport pixels (orthographic camera)
    var TMP_VEC = new THREE.Vector3();
    function projectToViewport(worldPt, camera, canvasRect) {
      TMP_VEC.copy(worldPt).project(camera);
      var x = canvasRect.left + (TMP_VEC.x * 0.5 + 0.5) * canvasRect.width;
      var y = canvasRect.top  + (-TMP_VEC.y * 0.5 + 0.5) * canvasRect.height;
      return { x: x, y: y };
    }

    // Compute a node's viewport position given its t∈[0,1) along the
    // perimeter of the globe panel. The panel's bounding rect is
    // re-read each frame (cheap) so it stays correct after resize.
    function getNodePosition(node) {
      var r = globePanel.getBoundingClientRect();
      var W = r.width;
      var H = r.height;
      var perim = 2 * (W + H);
      // Map t∈[0,1) → length along perimeter ∈ [0, perim)
      var s = ((node.t % 1) + 1) % 1 * perim;
      // Walk: top edge (L→R, length W), right edge (T→B, length H),
      //       bottom edge (R→L, length W), left edge (B→T, length H).
      var x, y;
      if (s < W) {
        x = r.left + s;
        y = r.top;
      } else if (s < W + H) {
        x = r.right;
        y = r.top + (s - W);
      } else if (s < 2 * W + H) {
        x = r.right - (s - W - H);
        y = r.bottom;
      } else {
        x = r.left;
        y = r.bottom - (s - 2 * W - H);
      }
      node.x = x;
      node.y = y;
      return { x: x, y: y };
    }

    // Move each node along the perimeter. Velocity occasionally flips
    // direction to keep the motion feeling alive (random walk).
    // The node FREEZES while the port is actively scanning (LOCK_IN /
    // HOLD / LOCK_OUT) so the beam stays visually pinned to its origin —
    // it only resumes drifting once the port is back in GAP or IDLE.
    function updateNodes(dt, now) {
      ports.forEach(function (port) {
        if (port.state === 'LOCK_IN' ||
            port.state === 'HOLD' ||
            port.state === 'LOCK_OUT') {
          return;   // anchored during the scan
        }
        var n = port.node;
        // Advance position (wrap mod 1)
        n.t += n.vel * dt;
        n.t = ((n.t % 1) + 1) % 1;
        // Occasionally flip direction
        if (now - n.lastFlip > 2500 + Math.random() * 3500) {
          n.vel = (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.05);
          n.lastFlip = now;
        }
      });
    }

    // ----- State transitions -----
    // Helper to toggle .is-locked on the widget's DOM element.
    function setLocked(port, locked) {
      if (port.widget) {
        port.widget.locked = locked;
        if (port.widget.el) {
          port.widget.el.classList.toggle('is-locked', locked);
        }
      }
    }

    function transition(port, newState, now) {
      port.state = newState;
      port.stateStart = now;
      if (newState === 'LOCK_IN') {
        // Re-roll this cycle's HOLD: 5.0s–7.5s, so the scan always
        // satisfies the 5-second minimum but doesn't lock identically
        // every time.
        port.durations.HOLD = 5000 + Math.random() * 2500;
        port.target = randomGlobeTarget();
        orientSpike(port.spike, port.target);
        port.spike.visible = true;
        port.spike.scale.y = 0.001;
        port.ripples = [];
        port.lastRipple = 0;
        setLocked(port, true);
      } else if (newState === 'HOLD') {
        // spike at full extension
        port.spike.scale.y = SPIKE_MAX_LEN;
        // Seed the readout value — a fresh "reading" from this lock
        if (port.widget) {
          port.widget.v = 30 + Math.random() * 55;
          port.widget.displayV = port.widget.v;
          // Emit one Bernoulli trial for this scan: success if the
          // sampled reading exceeds 50. The Bayesian widget consumes
          // this on each HOLD entry to update its Beta posterior.
          // We tag it with a cycle id so consumers don't double-count.
          port.widget.lastTrial = {
            cycleId: now,
            success: port.widget.v > 50 ? 1 : 0,
            reading: port.widget.v
          };
        }
      } else if (newState === 'LOCK_OUT') {
        // (animated retract in frame())
      } else if (newState === 'GAP') {
        // Re-roll this cycle's GAP: 1.2s–5.5s. Wider range = ports
        // drift out of phase, so the user sees independent activity —
        // sometimes both widgets active, sometimes one alone, sometimes
        // a brief lull where both sit dormant.
        port.durations.GAP = 1200 + Math.random() * 4300;
        // Hide the spike entirely between locks
        port.spike.visible = false;
        port.spike.scale.y = 0.001;
        setLocked(port, false);
      } else if (newState === 'IDLE') {
        port.spike.visible = false;
        setLocked(port, false);
      }
    }

    // ----- Update + draw loop -----
    var prevNow = performance.now();
    function frame(now) {
      var dt = Math.min(0.1, (now - prevNow) / 1000);   // seconds, capped
      prevNow = now;

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Only run beams after power-up completes
      if (!powerUpComplete) {
        requestAnimationFrame(frame);
        return;
      }

      // Step the roaming nodes (perimeter walkers)
      updateNodes(dt, now);

      var globeCanvas = globeRef.renderer.domElement;
      var canvasRect = globeCanvas.getBoundingClientRect();

      ports.forEach(function (port) {
        // Refresh node viewport position (and cache it on the node)
        getNodePosition(port.node);

        // Initial kick-off — start each port at a strongly staggered
        // random offset so they don't lock in unison, and the user sees
        // independent activity from the first cycle onward.
        if (port.state === 'IDLE' && port.stateStart === 0) {
          port.stateStart = now +
            (port.name === 'mem' ? 1800 + Math.random() * 1200
                                 : Math.random() * 400);
        }

        var elapsed = now - port.stateStart;

        // Advance state machine
        switch (port.state) {
          case 'IDLE':
            if (elapsed > 0) transition(port, 'LOCK_IN', now);
            break;
          case 'LOCK_IN':
            if (elapsed >= port.durations.LOCK_IN) {
              transition(port, 'HOLD', now);
            } else {
              // Animate spike growing out of globe (ease-out)
              var p = elapsed / port.durations.LOCK_IN;
              var eased = 1 - Math.pow(1 - p, 2);
              port.spike.scale.y = SPIKE_MAX_LEN * Math.max(0.05, eased);
            }
            break;
          case 'HOLD':
            if (elapsed >= port.durations.HOLD) {
              transition(port, 'LOCK_OUT', now);
            } else {
              if (port.widget) {
                port.widget.displayV = Math.max(0, Math.min(100,
                  port.widget.v + (Math.random() - 0.5) * 4
                ));
              }
              // Spawn a new ripple every RIPPLE_INTERVAL ms during HOLD.
              // The ripple expands from the spike-tip projected coords
              // each frame, so it stays anchored to the lock point even
              // as the globe rotates.
              if (now - port.lastRipple >= RIPPLE_INTERVAL) {
                port.ripples.push({ bornAt: now });
                port.lastRipple = now;
              }
            }
            break;
          case 'LOCK_OUT':
            if (elapsed >= port.durations.LOCK_OUT) {
              transition(port, 'GAP', now);
            } else {
              var p2 = elapsed / port.durations.LOCK_OUT;
              port.spike.scale.y = SPIKE_MAX_LEN * Math.max(0.001, 1 - p2);
            }
            break;
          case 'GAP':
            if (elapsed >= port.durations.GAP) {
              transition(port, 'LOCK_IN', now);
            }
            break;
        }

        // --- Always draw the node dot itself (so it's visible even
        // during GAP/IDLE when no beam is firing) ---
        var col = port.color;
        var nx = port.node.x, ny = port.node.y;
        // Soft outer glow
        ctx.beginPath();
        ctx.arc(nx, ny, 9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',0.18)';
        ctx.fill();
        // Inner ring
        ctx.beginPath();
        ctx.arc(nx, ny, 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Bright core
        ctx.beginPath();
        ctx.arc(nx, ny, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',1)';
        ctx.fill();

        // Draw the beam if we're in LOCK_IN, HOLD, or LOCK_OUT
        if (port.state !== 'IDLE' && port.state !== 'GAP') {
          // Spike tip in world coords: target * (1 + scale.y), then
          // through globeMesh.matrixWorld.
          var localTip = new THREE.Vector3();
          localTip.copy(port.target).multiplyScalar(1.0 + port.spike.scale.y);
          localTip.applyMatrix4(globeRef.globeMesh.matrixWorld);
          var tip = projectToViewport(localTip, globeRef.camera, canvasRect);
          var origin = { x: nx, y: ny };

          // Beam alpha: full during HOLD, ramped during LOCK_IN/OUT
          var alpha = 1.0;
          if (port.state === 'LOCK_IN') {
            alpha = elapsed / port.durations.LOCK_IN;
          } else if (port.state === 'LOCK_OUT') {
            alpha = 1 - (elapsed / port.durations.LOCK_OUT);
          }
          alpha = Math.max(0, Math.min(1, alpha));

          // Back-hemisphere cull
          var hidden = false;
          var rotated = new THREE.Vector3().copy(port.target)
                        .applyMatrix4(globeRef.globeMesh.matrixWorld);
          if (rotated.z < -0.05) hidden = true;

          if (!hidden) {
            // ---- Surface ripples ----
            // Expanding rings centered on the projected lock point.
            // Drawn FIRST (under the beam) so the beam reads on top.
            // Each ripple's radius is a function of its age; alpha fades
            // out with the same curve. We also expire dead ripples here.
            if (port.ripples.length) {
              var stillAlive = [];
              for (var ri = 0; ri < port.ripples.length; ri++) {
                var rp = port.ripples[ri];
                var ageMs = now - rp.bornAt;
                if (ageMs >= RIPPLE_LIFE) continue;
                var rt = ageMs / RIPPLE_LIFE;        // 0..1
                var radius = 4 + rt * RIPPLE_MAX_R;
                var aFade = (1 - rt) * 0.85;
                // Outer ring stroke
                ctx.beginPath();
                ctx.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
                ctx.strokeStyle =
                  'rgba(' + col.r + ',' + col.g + ',' + col.b + ',' + aFade + ')';
                ctx.lineWidth = 1.6 * (1 - rt * 0.55);
                ctx.stroke();
                // Soft glow ring just outside
                ctx.beginPath();
                ctx.arc(tip.x, tip.y, radius + 2, 0, Math.PI * 2);
                ctx.strokeStyle =
                  'rgba(' + col.r + ',' + col.g + ',' + col.b + ',' + (aFade * 0.35) + ')';
                ctx.lineWidth = 4;
                ctx.stroke();
                stillAlive.push(rp);
              }
              port.ripples = stillAlive;
            }

            // Beam width scales up during HOLD so the lock reads as a
            // chunky pin line coming off the globe — not a hair stroke.
            var widthBoost = (port.state === 'HOLD') ? 1.0 : 0.55;

            // Outer glow stroke
            ctx.beginPath();
            ctx.moveTo(origin.x, origin.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.strokeStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b +
                              ',' + (alpha * 0.20) + ')';
            ctx.lineWidth = 14 * widthBoost;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Mid stroke
            ctx.beginPath();
            ctx.moveTo(origin.x, origin.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.strokeStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b +
                              ',' + (alpha * 0.65) + ')';
            ctx.lineWidth = 5.5 * widthBoost;
            ctx.stroke();

            // Inner hot core
            ctx.beginPath();
            ctx.moveTo(origin.x, origin.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.90) + ')';
            ctx.lineWidth = 2.0 * widthBoost;
            ctx.stroke();

            // Tip target reticle (during HOLD)
            if (port.state === 'HOLD') {
              ctx.strokeStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',0.85)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(tip.x, tip.y, 8, 0, Math.PI * 2);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(tip.x - 14, tip.y); ctx.lineTo(tip.x - 4, tip.y);
              ctx.moveTo(tip.x + 4,  tip.y); ctx.lineTo(tip.x + 14, tip.y);
              ctx.moveTo(tip.x, tip.y - 14); ctx.lineTo(tip.x, tip.y - 4);
              ctx.moveTo(tip.x, tip.y + 4 ); ctx.lineTo(tip.x, tip.y + 14);
              ctx.stroke();
            }
          } else {
            // Target is on the back hemisphere — abort the lock early
            if (port.state === 'HOLD') {
              transition(port, 'LOCK_OUT', now);
            }
          }
        }
      });

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  initBeams();

})();
