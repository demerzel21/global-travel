/* The Group Passport — offline support.
   Stale-while-revalidate: serve from cache instantly, refresh in the
   background, so the site opens with no connection and stays current. */
const CACHE = "group-passport-v1";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./assets/world-map.js",
  "./assets/countries.js",
  "./data/travelers.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // only same-origin GETs — GitHub API saves and issue pages pass straight through
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request)
      .then((res) => {
        if (res && res.ok) c.put(e.request, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) return cached; // network refresh continues in the background
    const fresh = await network;
    return fresh || new Response("Offline and not cached yet.", { status: 503 });
  })());
});
