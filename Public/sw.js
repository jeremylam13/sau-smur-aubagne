// ── Service Worker SAU/SMUR Aubagne ─────────────────────────────────────────
// Stratégie : network-first partout (toujours la dernière version quand il y a
// du réseau), fallback cache pour le mode hors-ligne. Mise à jour automatique.
//
// IMPORTANT : à chaque déploiement important, incrémenter le numéro de version
// ci-dessous (v1 → v2 → v3...) pour forcer le nettoyage des anciens caches.
const CACHE_NAME = "sau-smur-v2";
const STATIC_ASSETS = [
  "/",
  "/index.html",
];

// Installation : mise en cache des assets de base + activation immédiate
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting(); // le nouveau SW prend la main sans attendre
});

// Activation : supprimer TOUS les anciens caches + prendre le contrôle
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Permet à la page de demander au SW de s'activer tout de suite
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Fetch : NETWORK-FIRST partout (la nouveauté est toujours priorisée)
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Ne pas intercepter Supabase (données live, gérées dans l'app)
  if (url.hostname.includes("supabase")) return;
  // Ne gérer que les requêtes GET
  if (event.request.method !== "GET") return;

  // Navigations HTML : réseau d'abord, cache si hors-ligne
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match("/index.html")))
    );
    return;
  }

  // Tout le reste (JS, CSS, images...) : réseau d'abord, cache en secours.
  // C'est ce qui garantit qu'on a TOUJOURS le dernier code quand il y a du réseau.
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
