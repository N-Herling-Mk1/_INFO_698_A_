/* ============================================================
   INFO 698 // CAPSTONE — splash.js
   - meta.json text injection (unchanged from v1)
   - click-pulse: electric bolts radiating across the grid when
     the bullseye logo is clicked, then navigate to nav.html
   ============================================================ */

(function () {
  'use strict';

  // ---------- Clock + meta-driven text (unchanged behaviour) ----------
  AresData.startClock('ts');

  AresData.load('meta.json').then(function (meta) {
    var s = meta.site || {};

    setText('splash-tagline', '— ' + (s.institution || '') + ' —');
    setText('splash-program', s.program || '');
    setText('stat-cycle',     s.cycle    || '');
    setText('stat-operator', (s.operator || '').toUpperCase());
    setText('hud-version',    s.version  || '');

    if (s.status) {
      var el = document.getElementById('stat-status');
      if (el) {
        el.innerHTML =
          '<span style="display:inline-block; width:6px; height:6px; ' +
          'background:var(--ares-lime); border-radius:50%; margin-right:6px;"></span>' +
          s.status;
      }
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
    fillStyle:      'outline',   // 'outline' | 'filled' | 'both'
    coastWidth:     2.0,
    coastAlpha:     0.95,
    fillAlpha:      0.15,
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

  var bullseye    = document.getElementById('splash-bullseye');
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
      var rect = globeCanvas.getBoundingClientRect();
      var size = Math.max(120, Math.min(rect.width, rect.height));
      var dpr  = Math.min(window.devicePixelRatio || 1, 2);
      globeCanvas.width  = Math.floor(size * dpr);
      globeCanvas.height = Math.floor(size * dpr);
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
      startedAt: performance.now(),
      revealed: false
    };
  }

  var globe = initGlobe();

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
  var entering   = document.getElementById('splash-entering');
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
  var terminalText = document.getElementById('splash-terminal-text');
  var TERM_IDLE  = 'HOVER LOGO TO ARM SYSTEM';
  var TERM_ARMED = 'SYSTEM ARMED // CLICK TO ENTER';
  var TERM_FIRED = 'AUTHENTICATING // ENTERING GRID';
  function setTerminal(msg) {
    if (terminalText) terminalText.textContent = msg;
  }

  // Wire hover crawl into the bullseye hover (in addition to alignArcs).
  if (bullseye) {
    bullseye.addEventListener('mouseenter', function () {
      alignArcs();
      startHoverCrawl();
      setTerminal(TERM_ARMED);
    });
    bullseye.addEventListener('mouseleave', function () {
      releaseArcs();
      stopHoverCrawl(false);    // gentle: 500ms fade
      // Only revert text if we're not in the middle of a click.
      if (!bullseye.classList.contains('is-entering')) {
        setTerminal(TERM_IDLE);
      }
    });
  }

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

    // Reveal the "Entering the page" overlay. We do this on the BULLSEYE
    // container (not the link) so the class can cascade to both the
    // overlay and the image-hide rule in one place. We also drop hover
    // alignment classes so the breathe animation pauses and the static
    // entering-spinner takes the user's full attention.
    if (bullseye) {
      bullseye.classList.remove('is-aligning', 'is-aligned');
      bullseye.classList.add('is-entering');
    }
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
})();
