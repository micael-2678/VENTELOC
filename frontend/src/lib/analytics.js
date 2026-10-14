// Statistiques de fréquentation maison (SPEC §6.2) : chaque événement est envoyé à l'API
// (POST /api/events {name, path, props}) sans cookie, sans identifiant stocké dans le navigateur et sans
// prestataire tiers (Plausible supprimé). Le serveur n'enregistre jamais l'adresse IP (empreinte du jour).
//
// API conservée pour les appels existants : initAnalytics(), trackEvent(name, props) ; ajout : trackPageView(path).
// Les noms acceptés par le serveur forment une liste fermée (backend/events.py) ; les anciens libellés français
// sont traduits vers cette liste, les autres sont ignorés silencieusement.

const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const EVENTS_URL = `${BACKEND_URL}/api/events`;

// Même liste que backend/events.py (EVENT_NAMES)
export const EVENT_NAMES = [
  'page_view',
  'hero_cta_seller',
  'estimate_started',
  'estimate_completed',
  'calc_used',
  'alert_created',
  'listing_card_click',
  'contact_sent',
  'register_started',
  'register_completed',
  'front_error',
  'report',
  'listing_created',
  'mandate_signed',
  'nda_signed',
  'offer_signed',
];

// Anciens noms d'événements (libellés Plausible) → noms de la liste fermée
const LEGACY_NAMES = {
  'Premier contact': 'contact_sent',
  'Alerte créée': 'alert_created',
  'Inscription': 'register_completed',
};

const MAX_PROPS = 10;
const MAX_PROP_LENGTH = 500;
const PROP_KEY = /^[a-z][a-z0-9_]{0,31}$/;

const normalizeName = (name) => {
  const s = String(name == null ? '' : name).trim();
  if (EVENT_NAMES.includes(s)) return s;
  return LEGACY_NAMES[s] || '';
};

// Clés simples (a-z, 0-9, _), valeurs scalaires tronquées : identique à sanitize_props côté serveur
export const sanitizeProps = (props) => {
  const out = {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
  Object.keys(props).forEach((rawKey) => {
    if (Object.keys(out).length >= MAX_PROPS) return;
    const key = String(rawKey).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!PROP_KEY.test(key)) return;
    const value = props[rawKey];
    if (value === null || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (value !== undefined) out[key] = String(typeof value === 'object' ? JSON.stringify(value) : value).slice(0, MAX_PROP_LENGTH);
  });
  return out;
};

export const currentPath = () => {
  if (typeof window === 'undefined' || !window.location) return '/';
  return window.location.pathname || '/';
};

// Sans REACT_APP_BACKEND_URL, l'URL est relative (/api/events) : même domaine, proxifié par nginx.
const canSend = () => {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
  // Aperçu de l'éditeur (iframe) : aucune statistique
  return !window.__CESSIONRGE_EDITOR__;
};

// Envoi « fire and forget » : keepalive pour survivre à un changement de page, jamais de cookie, jamais d'exception
export const sendEvent = (name, props, path) => {
  const eventName = normalizeName(name);
  if (!eventName || !canSend()) return false;
  const body = JSON.stringify({ name: eventName, path: path || currentPath(), props: sanitizeProps(props) });
  try {
    fetch(EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
      mode: 'cors',
    }).catch(() => {});
  } catch (e) {
    // no-op : la mesure d'audience ne doit jamais bloquer l'application
    return false;
  }
  return true;
};

export const trackEvent = (name, props) => sendEvent(name, props);

let lastPageView = { path: '', at: 0 };

// Une page vue par chemin ; les doublons rapprochés (StrictMode, pushState + hook de route) sont ignorés
export const trackPageView = (path) => {
  const p = path || currentPath();
  const now = Date.now();
  if (lastPageView.path === p && now - lastPageView.at < 1000) return false;
  lastPageView = { path: p, at: now };
  return sendEvent('page_view', undefined, p);
};

let initialized = false;

// Première page vue + navigations de l'application (react-router : history.pushState / replaceState / popstate)
export const initAnalytics = () => {
  if (initialized || typeof window === 'undefined' || !window.history) return;
  initialized = true;
  trackPageView();
  const wrap = (method, onlyIfPathChanged) => {
    const original = window.history[method];
    if (typeof original !== 'function') return;
    window.history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      window.setTimeout(() => {
        const p = currentPath();
        if (onlyIfPathChanged && p === lastPageView.path) return;
        trackPageView(p);
      }, 0);
      return result;
    };
  };
  wrap('pushState', false);
  wrap('replaceState', true);
  window.addEventListener('popstate', () => window.setTimeout(() => trackPageView(), 0));
};
