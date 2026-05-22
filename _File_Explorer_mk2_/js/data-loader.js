/* ============================================================
   INFO 698 // CAPSTONE — data-loader.js
   Faux backend: thin wrapper around fetch() for /data/*.json
   ============================================================ */

(function (global) {
  'use strict';

  // Resolve /data path relative to the page so it works from
  // both / (splash, nav) and /pages/ (section pages).
  function dataPath(file) {
    var depth = window.location.pathname.split('/').filter(Boolean);
    // If we're inside /pages/something.html, go up one level.
    var prefix = (depth.length > 1 && depth[depth.length - 2] === 'pages') ? '../' : '';
    return prefix + 'data/' + file;
  }

  function load(file) {
    return fetch(dataPath(file), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' loading ' + file);
        return res.json();
      });
  }

  function loadAll(files) {
    return Promise.all(files.map(load)).then(function (results) {
      var out = {};
      files.forEach(function (f, i) {
        out[f.replace(/\.json$/, '')] = results[i];
      });
      return out;
    });
  }

  // Live timestamp ticker, used by HUDs across pages
  function startClock(elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    function pad(n) { return String(n).padStart(2, '0'); }
    function tick() {
      var d = new Date();
      el.textContent =
        d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) +
        ' // ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    tick();
    setInterval(tick, 1000);
  }

  global.AresData = {
    load:       load,
    loadAll:    loadAll,
    dataPath:   dataPath,
    startClock: startClock
  };

})(window);
