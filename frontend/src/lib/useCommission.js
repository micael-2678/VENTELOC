import { useEffect, useState } from 'react';
import { COMMISSION, commissionConfig } from '@/lib/offer';

// Barème des honoraires servi par l'API (GET /config → `commission`, docs/venteloc/API.md §8). Une requête par
// chargement de l'application, partagée par toutes les pages ; tant qu'elle n'a pas répondu (ou si elle échoue), les
// valeurs par défaut de lib/offer.js s'appliquent (3 % HT, minimum 3 000 € HT, TVA 20 %).
// Requête par fetch (sans jeton, sans redirection sur 401), comme useLegalInfo.

const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const CONFIG_URL = `${BACKEND_URL}/api/config`;

let cached = null;
let pending = null;

export const fetchCommissionConfig = () => {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = (typeof fetch === 'function' ? fetch(CONFIG_URL, { credentials: 'omit' }) : Promise.reject(new Error('fetch indisponible')))
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data === 'object' && data.commission && typeof data.commission === 'object') {
          cached = commissionConfig(data.commission);
        }
        return cached;
      })
      .catch(() => null)
      .finally(() => { pending = null; });
  }
  return pending;
};

// Tests : oublie le barème mémorisé
export const resetCommissionCache = () => {
  cached = null;
  pending = null;
};

// Barème courant : { ratePercentHT, minimumHT, vatRate, payer… } (valeurs par défaut tant que /config n'a pas répondu)
export const useCommission = () => {
  const [cfg, setCfg] = useState(cached || COMMISSION);
  useEffect(() => {
    let alive = true;
    if (!cached) fetchCommissionConfig().then((c) => { if (alive && c) setCfg(c); });
    return () => { alive = false; };
  }, []);
  return cfg;
};

export default useCommission;
