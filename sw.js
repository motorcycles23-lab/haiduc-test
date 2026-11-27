/* Haiduc Bear — service worker (v2): aplicație instalabilă + funcționare offline.
   - aplicația și bibliotecile se păstrează pe telefon (merg fără internet după prima vizită online);
   - dalele hărții pe care le-ai privit se păstrează (maximum 700), ca zona respectivă să se vadă și offline;
   - datele Firebase (semnalările LIVE) NU sunt interceptate: rămân mereu live, doar când ai internet. */
const CACHE = "haiduc-bear-v2";
const TILE_CACHE = "haiduc-bear-tiles-v1";
const TILE_HOST = "server.arcgisonline.com";
const TILE_LIMIT = 700;
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
const LIB_URLS = [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"
];
const LIB_HOSTS = ["cdn.tailwindcss.com", "unpkg.com", "www.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Bibliotecile externe, încă din prima vizită, ca aplicația să pornească și fără internet (erorile nu opresc instalarea)
    await Promise.allSettled(LIB_URLS.map(async (u) => {
      const res = await fetch(u, { mode: "no-cors" });
      await cache.put(u, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

let tilePuts = 0;
async function trimTiles(cache) {
  if (++tilePuts % 25 !== 0) return;
  const keys = await cache.keys();
  const extra = keys.length - TILE_LIMIT;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]); // cele mai vechi primele
}

async function tileResponse(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // Cerere CORS (răspuns neopac) ca să putem salva dala; dacă serverul nu o permite, folosim cererea normală, fără salvare
    const res = await fetch(req.url, { mode: "cors", credentials: "omit" }).catch(() => null);
    if (res && res.ok) {
      await cache.put(req.url, res.clone());
      trimTiles(cache);
      return res;
    }
    return await fetch(req);
  } catch (err) {
    return new Response("", { status: 504, statusText: "offline" }); // dală lipsă offline: rămâne goală
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pagina: rețeaua mai întâi (actualizările apar imediat); fără internet, versiunea păstrată
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html").then((hit) => hit || caches.match(req)))
    );
    return;
  }

  // Dalele hărții: din cache dacă le-ai mai văzut
  if (url.hostname === TILE_HOST) {
    e.respondWith(tileResponse(req));
    return;
  }

  // Bibliotecile (Leaflet, Tailwind, Firebase JS): din cache, reîmprospătate în fundal
  if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => hit || Response.error());
          return hit || net;
        })
      )
    );
    return;
  }

  // Fișierele proprii (iconițe, manifest): cache întâi
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
  // Restul (Firebase, alte site-uri): trec direct prin rețea, neatinse
});
