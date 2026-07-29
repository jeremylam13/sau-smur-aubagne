import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// ── Enregistrement du service worker + mise à jour automatique ───────────────
// Objectif : quand une nouvelle version est déployée, l'app la détecte au
// lancement et se met à jour toute seule (fini l'ancienne version figée).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(reg => {

      // Vérifie s'il y a une nouvelle version à chaque lancement
      reg.update();

      // Quand une nouvelle version du SW est trouvée...
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          // Nouvelle version prête ET une ancienne était déjà active
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            // On demande au nouveau SW de prendre la main immédiatement
            newWorker.postMessage("SKIP_WAITING");
          }
        });
      });
    }).catch(() => {});

    // Quand le nouveau SW a pris le contrôle, on recharge une seule fois
    // pour afficher la version fraîche.
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
