// Big Dog Gotta Eat service worker.
// Strategy: NETWORK-FIRST for the shell (HTML/CSS/JS/assets) so content is never
// stale, with a cached copy kept as an offline fallback. API data is network-only
// (never cached, always live). Bump CACHE on shell changes to evict old entries.
const CACHE = "bigdog-v8";
const SHELL = [
  "/", "/index.html", "/history.html", "/hof.html", "/schedule.html", "/stats.html",
  "/players.html", "/player.html", "/season.html",
  "/css/styles.css",
  "/js/common.js", "/js/stats.js",
  "/js/pages/index.js", "/js/pages/history.js", "/js/pages/hof.js", "/js/pages/schedule.js",
  "/js/pages/stats.js", "/js/pages/players.js", "/js/pages/player.js",
  "/js/pages/season.js",
  "/assets/logo.jpg", "/assets/chicago-flag.svg", "/assets/blackout-usa.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})) // tolerate a missing file
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // API: always network; never cache (keep stats/scores fresh).
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Shell/static: network-first (never stale), updating the cache on success;
  // fall back to cache (then index.html) when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html")))
  );
});
