// Network-first for app files so updates show up right away; falls back to cache when offline.
const CACHE = "guitaric-v13";
const ASSETS = ["./", "index.html", "css/style.css", "js/core.js", "js/songs.js", "js/tab.js", "js/analyze.js", "js/metronome.js", "js/player.js", "js/practice.js", "js/editor.js", "js/tabedit.js", "js/songfile.js", "js/app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
