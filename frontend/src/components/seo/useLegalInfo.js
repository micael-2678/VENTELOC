import { useEffect, useState } from 'react';

// Informations de l'exploitant (GET /api/public/legal-info : dénomination, capital, carte T, RC pro, médiateur,
// mention sur les fonds, hébergeur…). Une seule requête par session : le résultat est partagé par le pied de
// page, les mentions légales et la confidentialité.
const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const LEGAL_INFO_URL = `${BACKEND_URL}/api/public/legal-info`;

let cached = null;
let pending = null;

export const fetchLegalInfo = () => {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = (typeof fetch === 'function' ? fetch(LEGAL_INFO_URL, { credentials: 'omit' }) : Promise.reject(new Error('fetch indisponible')))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data === 'object') cached = data;
        return cached;
      })
      .catch(() => null)
      .finally(() => { pending = null; });
  }
  return pending;
};

// null tant que l'API n'a pas répondu (les pages utilisent alors LEGAL / LEGAL_FALLBACK)
export const useLegalInfo = () => {
  const [info, setInfo] = useState(cached);
  useEffect(() => {
    let alive = true;
    if (!cached) fetchLegalInfo().then((data) => { if (alive && data) setInfo(data); });
    return () => { alive = false; };
  }, []);
  return info;
};

export default useLegalInfo;
