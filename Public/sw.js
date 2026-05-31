// ── Service Worker SAU/SMUR Aubagne ─────────────────────────────────────────
// Cache-first pour les assets statiques, network-first pour les données
const CACHE_NAME = "sau-smur-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
];

// Installation : mise en cache des assets statiques
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activation : supprimer les anciens caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch : stratégie network-first avec fallback cache
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Ne pas intercepter les requêtes Supabase (on laisse passer, géré dans l'app)
  if (url.hostname.includes("supabase")) return;

  // Pour les navigations (HTML) : network-first avec fallback sur /index.html
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Pour les assets JS/CSS/images : cache-first
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/)
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          return res;
        });
      })
    );
    return;
  }

  // Par défaut : network-first
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
