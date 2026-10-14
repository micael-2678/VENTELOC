// Score de complétude du profil repreneur (API.md §1) : même barème que buyer_profile_score() côté serveur.
// project_type 15 · budget_max 15 · apport 10 · financing 10 · zones 10 · trades 10 · horizon 10 · phone 10 ·
// SIREN vérifié 10 (posé par le serveur via l'open data : jamais compté localement sans `siren_verified`).
// Contact possible dès 40 ; acceptation automatique des demandes de dossier dès 50.

export const SCORE_CONTACT_MIN = 40;
export const SCORE_AUTO_ACCEPT_MIN = 50;

export const SCORE_WEIGHTS = [
  { key: 'project_type', points: 15, label: 'Type de projet' },
  { key: 'budget_max', points: 15, label: 'Budget maximum' },
  { key: 'apport', points: 10, label: 'Apport' },
  { key: 'financing', points: 10, label: 'Financement' },
  { key: 'zones', points: 10, label: 'Zones recherchées' },
  { key: 'trades', points: 10, label: 'Métiers recherchés' },
  { key: 'horizon', points: 10, label: 'Horizon' },
  { key: 'phone', points: 10, label: 'Téléphone' },
  { key: 'siren_verified', points: 10, label: 'Société vérifiée (SIREN)' },
];

const filled = (key, profile, phone) => {
  if (key === 'phone') return String(phone || '').replace(/\D/g, '').length >= 9;
  if (key === 'siren_verified') return profile?.siren_verified === true;
  const v = profile ? profile[key] : undefined;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  if (key === 'budget_max' || key === 'apport') return Number(s) > 0;
  return true;
};

// → { score, missing: [{key, points, label}], done: [...] }
export const computeProfileScore = (profile, phone) => {
  let score = 0;
  const missing = [];
  const done = [];
  SCORE_WEIGHTS.forEach((w) => {
    if (filled(w.key, profile, phone)) {
      score += w.points;
      done.push(w);
    } else {
      missing.push(w);
    }
  });
  return { score: Math.max(0, Math.min(100, score)), missing, done };
};

export const EMPTY_BUYER_PROFILE = {
  project_type: '',
  budget_max: '',
  apport: '',
  financing: '',
  zones: [],
  trades: [],
  horizon: '',
  siren: '',
  company_name: '',
  experience: '',
};

// Valeurs du formulaire → corps `buyer_profile` de l'API (nombres, listes, chaînes vides retirées)
export const buyerProfilePayload = (profile) => {
  const p = profile || {};
  const num = (v) => {
    const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) && String(v || '').trim() !== '' ? n : null;
  };
  const out = {
    project_type: p.project_type || null,
    budget_max: num(p.budget_max),
    apport: num(p.apport),
    financing: p.financing || null,
    zones: Array.isArray(p.zones) ? p.zones : [],
    trades: Array.isArray(p.trades) ? p.trades : [],
    horizon: p.horizon || null,
  };
  const siren = String(p.siren || '').replace(/\D/g, '');
  if (siren) out.siren = siren;
  if (String(p.company_name || '').trim()) out.company_name = String(p.company_name).trim();
  if (String(p.experience || '').trim()) out.experience = String(p.experience).trim().slice(0, 600);
  return out;
};

// Profil renvoyé par l'API → valeurs du formulaire
export const buyerProfileFromUser = (profile) => {
  const p = profile || {};
  return {
    ...EMPTY_BUYER_PROFILE,
    project_type: p.project_type || '',
    budget_max: p.budget_max == null ? '' : String(p.budget_max),
    apport: p.apport == null ? '' : String(p.apport),
    financing: p.financing || '',
    zones: Array.isArray(p.zones) ? p.zones : [],
    trades: Array.isArray(p.trades) ? p.trades : [],
    horizon: p.horizon || '',
    siren: p.siren || '',
    company_name: p.company_name || '',
    experience: p.experience || '',
    siren_verified: p.siren_verified === true,
  };
};
