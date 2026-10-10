// Network-first for app files so updates show up right away; falls back to cache when offline.
// Requests skip the browser's HTTP cache ("no-cache" revalidates with the server): GitHub Pages lets
// files be cached for 10 minutes, which could pair a new index.html with old scripts.
const CACHE = "guitaric-v28";
const ASSETS = ["./", "index.html", "css/style.css", "js/icons.js", "js/core.js", "js/songs.js", "js/tab.js", "js/analyze.js", "js/metronome.js", "js/player.js", "js/practice.js", "js/editor.js", "js/tabedit.js", "js/songfile.js", "js/app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
