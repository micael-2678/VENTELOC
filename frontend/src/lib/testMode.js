import { useEffect, useState } from 'react';

// Mode test (docs/refonte-2026-10/MODE-TEST-ET-APP.md §B.1) : le front lit `test_mode` dans GET /api/config, sans
// variable de build. Le résultat est gardé en mémoire (une requête par chargement de l'application, partagée entre
// tous les composants) et dans sessionStorage : un rechargement de page affiche tout de suite le dernier état connu,
// puis la réponse de /config le confirme ou le corrige (mode test désactivé entre-temps, par exemple).
// Requête par fetch, comme useLegalInfo : pas d'en-tête d'authentification, pas de redirection sur 401.
//
// Clé du panneau de test (TEST_PANEL_KEY côté serveur) : le fondateur ouvre l'application avec ?cle=… ; la clé est lue
// dès le chargement de ce module (avant le premier rendu), mémorisée dans le navigateur, retirée de l'adresse et renvoyée
// dans l'en-tête X-Test-Key (/config, puis toutes les requêtes de l'instance axios). /config indique alors si le panneau
// est accessible (`test_panel_access`) et si l'admin démo l'est (`test_panel_admin`).

const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const CONFIG_URL = `${BACKEND_URL}/api/config`;
const STORAGE_KEY = 'cession:test_mode';
const PANEL_KEY_STORAGE = 'cession:test_panel_key';
export const TEST_PANEL_KEY_HEADER = 'X-Test-Key';
export const TEST_PANEL_KEY_PARAM = 'cle';

const CLOSED = { testMode: false, panelAccess: false, panelAdmin: false };
let known = null; // { testMode, panelAccess, panelAdmin } | null (inconnu)
let confirmed = false; // /config a répondu pendant ce chargement
let pending = null;
const listeners = new Set();

// ---- Clé du panneau ----------------------------------------------------------------------------

export const getTestPanelKey = () => {
  try {
    return localStorage.getItem(PANEL_KEY_STORAGE) || '';
  } catch (e) {
    return '';
  }
};

// Lit ?cle= dans l'adresse : clé mémorisée puis retirée de la barre d'adresse (jamais partagée par un copier-coller)
export const captureTestPanelKey = (win = typeof window !== 'undefined' ? window : null) => {
  if (!win?.location) return '';
  let params;
  try {
    params = new URLSearchParams(win.location.search || '');
  } catch (e) {
    return '';
  }
  const key = (params.get(TEST_PANEL_KEY_PARAM) || '').trim();
  if (!key) return '';
  try {
    localStorage.setItem(PANEL_KEY_STORAGE, key);
  } catch (e) {
    // stockage indisponible : la clé ne vaut que pour ce chargement (en mémoire via l'en-tête de /config)
  }
  params.delete(TEST_PANEL_KEY_PARAM);
  const query = params.toString();
  try {
    win.history?.replaceState?.(win.history.state, '', `${win.location.pathname}${query ? `?${query}` : ''}${win.location.hash || ''}`);
  } catch (e) {
    // adresse non modifiable (iframe sandbox) : sans conséquence
  }
  return key;
};

let capturedKey = captureTestPanelKey();
const panelKey = () => getTestPanelKey() || capturedKey;

// En-têtes à ajouter à une requête : X-Test-Key si une clé est connue
export const testPanelHeaders = () => {
  const key = panelKey();
  return key ? { [TEST_PANEL_KEY_HEADER]: key } : {};
};

// ---- État du mode test -------------------------------------------------------------------------

const normalize = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const testMode = raw.testMode === true;
  return { testMode, panelAccess: testMode && raw.panelAccess === true, panelAdmin: testMode && raw.panelAdmin === true };
};

const readStored = () => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === '0') return { ...CLOSED };
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    // stockage indisponible ou valeur illisible : la requête décidera
  }
  return null;
};

const store = (value) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, value.testMode ? JSON.stringify(value) : '0');
  } catch (e) {
    // stockage indisponible : la valeur reste en mémoire pour ce chargement
  }
};

const same = (a, b) => Boolean(a && b) && a.testMode === b.testMode && a.panelAccess === b.panelAccess && a.panelAdmin === b.panelAdmin;

const publish = (value) => {
  const changed = !same(known, value);
  known = value;
  if (changed) listeners.forEach((fn) => fn(value));
};

// Réponse de /config → état. Champs du panneau absents (serveur antérieur) : panneau ouvert, comme avant la clé.
export const testModeFromConfig = (data) => {
  const testMode = data?.test_mode === true;
  if (!testMode) return { ...CLOSED };
  const panelAccess = data.test_panel_access !== false;
  return { testMode, panelAccess, panelAdmin: panelAccess && data.test_panel_admin !== false };
};

// Lit /config une fois par chargement ; renvoie une promesse du booléen « mode test ». Une erreur réseau ne force pas
// le mode test : on garde le dernier état connu (faux par défaut).
export const loadTestMode = () => {
  if (confirmed) return Promise.resolve(Boolean(known?.testMode));
  if (!pending) {
    pending = Promise.resolve()
      .then(() => (typeof fetch === 'function' ? fetch(CONFIG_URL, { credentials: 'omit', headers: testPanelHeaders() }) : null))
      .then((res) => (res && res.ok && typeof res.json === 'function' ? res.json() : null))
      .then((data) => {
        if (data && typeof data === 'object') {
          const value = testModeFromConfig(data);
          confirmed = true;
          store(value);
          publish(value);
        }
        return Boolean(known?.testMode);
      })
      .catch(() => Boolean(known?.testMode))
      .finally(() => { pending = null; });
  }
  return pending;
};

// Dernière valeur connue, synchrone (mémoire, sinon sessionStorage) : faux tant que rien n'est connu
export const isTestMode = () => {
  if (known === null) known = readStored();
  return known?.testMode === true;
};

// { testMode, loading, panelAccess, panelAdmin } : loading vaut vrai tant qu'aucune valeur n'est connue (ni mémoire,
// ni session, ni /config). panelAccess : panneau /test et lien du bandeau ; panelAdmin : connexion à l'admin démo.
export const useTestMode = () => {
  const [value, setValue] = useState(() => {
    isTestMode();
    return known;
  });
  useEffect(() => {
    let alive = true;
    const onChange = (v) => { if (alive) setValue(v); };
    listeners.add(onChange);
    // Valeur publiée entre le premier rendu et l'abonnement (React ignore une valeur identique)
    setValue(known);
    if (!confirmed) {
      loadTestMode().then(() => {
        // /config injoignable et rien en mémoire : on sort de l'état de chargement avec « pas de mode test »
        if (alive && known === null) setValue({ ...CLOSED });
      });
    }
    return () => {
      alive = false;
      listeners.delete(onChange);
    };
  }, []);
  return {
    testMode: value?.testMode === true,
    loading: value === null,
    panelAccess: value?.panelAccess === true,
    panelAdmin: value?.panelAdmin === true,
  };
};

// Tests unitaires : oublie la valeur en mémoire et en session (et la clé du panneau)
export const resetTestModeCache = () => {
  known = null;
  confirmed = false;
  pending = null;
  capturedKey = '';
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PANEL_KEY_STORAGE);
  } catch (e) {
    // stockage indisponible
  }
};

export default useTestMode;
