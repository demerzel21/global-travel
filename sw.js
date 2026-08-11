/* The Group Passport — offline support.
   Stale-while-revalidate: serve from cache instantly, refresh in the
   background, so the site opens with no connection and stays current.
   When the background refresh finds newer traveler data, open pages get a
   message so they can offer a refresh instead of silently showing old stamps. */
const CACHE = "group-passport-v2";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./assets/world-map.js",
  "./assets/countries.js",
  "./data/travelers.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/icon-180.png",
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

const notifyDataUpdated = () =>
  self.clients.matchAll({ includeUncontrolled: true }).then((cs) =>
    cs.forEach((c) => c.postMessage({ type: "data-updated" })));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // only same-origin GETs — GitHub API saves and issue pages pass straight through
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isData = url.pathname.endsWith("/data/travelers.js");
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(e.request, { ignoreSearch: true });
    // snapshot the cached body NOW — after the page consumes it, it can't be read
    const cachedCopy = isData && cached ? cached.clone() : null;
    const network = fetch(e.request)
      .then(async (res) => {
        if (res && res.ok) {
          const resCopy = res.clone();
          if (cachedCopy) {
            const [oldText, newText] = await Promise.all([cachedCopy.text(), res.clone().text()]);
            if (oldText !== newText) notifyDataUpdated();
          }
          c.put(e.request, resCopy);
        }
        return res;
      })
      .catch(() => null);
    if (cached) return cached; // network refresh continues in the background
    const fresh = await network;
    return fresh || new Response("Offline and not cached yet.", { status: 503 });
  })());
});
