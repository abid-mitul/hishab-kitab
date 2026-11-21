/* Hishab Kitab service worker — offline app shell */
var VERSION = 'hk-v3';
var SHELL = ['./', './index.html', './css/styles.css?v=2', './js/config.js?v=2', './js/i18n.js?v=2', './js/app.js?v=2',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './js/vendor/chart.umd.min.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                                  // API calls (POST) always go to network
  var url = new URL(req.url);
  if (/script\.google|googleusercontent/.test(url.hostname)) return;  // never cache API
  // Network-first for our own files (so updates arrive), cache fallback when offline
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: false }).then(function (r) { return r || caches.match('./index.html'); });
    }));
    return;
  }
  // Cache-first for CDN assets (Chart.js, fonts)
  e.respondWith(caches.match(req).then(function (r) {
    return r || fetch(req).then(function (res) {
      var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); return res;
    });
  }));
});
