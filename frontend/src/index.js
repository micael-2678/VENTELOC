import React from "react";
import ReactDOM from "react-dom/client";
// Polices de la charte AlterEgo (Bricolage Grotesque, Instrument Sans) : fichiers auto-hébergés dans src/fonts,
// déclarés par @font-face dans index.css (font-display: swap ; aucune requête vers Google Fonts).
import "@/index.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import App from "@/App";
import { loadTestMode } from "@/lib/testMode";

// Mode test : GET /config lancé avant le premier rendu (le bandeau apparaît le plus tôt possible, moins de décalage
// de mise en page) ; la clé du panneau (?cle=…) est déjà lue par lib/testMode à son chargement
loadTestMode();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
