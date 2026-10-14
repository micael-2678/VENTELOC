import React from "react";
import ReactDOM from "react-dom/client";
// Polices auto-hébergées (aucune requête vers Google Fonts, pas de transfert d'adresse IP à un tiers) :
// Inter 400-700 pour le texte, Manrope 700/800 pour les titres. Sous-ensemble latin (couvre le français : é, œ, €).
// Les fichiers @fontsource déclarent font-display: swap.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
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
