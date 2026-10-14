// Score de complétude du profil acquéreur (SPEC §4, API.md §1) : même barème que buyer_profile_score() côté serveur.
// project_type 15 · budget_max 15 · apport 10 · financing 10 · zones 10 · property_types 10 · min_yield 10 ·
// horizon 10 · téléphone 10 = 100. `siren_verified` reste un badge (« société vérifiée »), sans points.
// Contact possible dès 40 ; acceptation automatique des demandes de dossier dès 50.

export const SCORE_CONTACT_MIN = 40;
export const SCORE_AUTO_ACCEPT_MIN = 50;

// Rendement brut minimum visé : 0 à 20 % (API.md §1)
export const MIN_YIELD_MAX = 20;

export const HORIZONS = [
  { id: '0-6', label: 'Sous 6 mois' },
  { id: '6-12', label: 'Dans 6 à 12 mois' },
  { id: '12+', label: 'Dans plus de 12 mois' },
];
export const horizonLabel = (id) => (HORIZONS.find((h) => h.id === id) || {}).label || '';

export const SCORE_WEIGHTS = [
  { key: 'project_type', points: 15, label: 'Type de projet' },
  { key: 'budget_max', points: 15, label: 'Budget maximum' },
  { key: 'apport', points: 10, label: 'Apport' },
  { key: 'financing', points: 10, label: 'Financement' },
  { key: 'zones', points: 10, label: 'Zones recherchées' },
  { key: 'property_types', points: 10, label: 'Types de biens recherchés' },
  { key: 'min_yield', points: 10, label: 'Rendement minimum visé' },
  { key: 'horizon', points: 10, label: 'Horizon d\'achat' },
  { key: 'phone', points: 10, label: 'Téléphone' },
];

const toNumber = (v) => {
  if (v === null || v === undefined) return NaN;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  if (!s) return NaN;
  return Number(s);
};

const filled = (key, profile, phone) => {
  if (key === 'phone') return String(phone || '').replace(/\D/g, '').length >= 9;
  const v = profile ? profile[key] : undefined;
  if (Array.isArray(v)) return v.length > 0;
  if (key === 'budget_max' || key === 'apport' || key === 'min_yield') {
    const n = toNumber(v);
    return Number.isFinite(n) && n > 0;
  }
  if (v === null || v === undefined) return false;
  return String(v).trim() !== '';
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
  property_types: [],
  min_yield: '',
  horizon: '',
  siren: '',
  company_name: '',
  experience: '',
};

// Valeurs du formulaire → corps `buyer_profile` de l'API (nombres, listes, chaînes vides retirées)
export const buyerProfilePayload = (profile) => {
  const p = profile || {};
  const num = (v) => {
    const n = toNumber(v);
    return Number.isFinite(n) ? n : null;
  };
  const yieldValue = num(p.min_yield);
  const out = {
    project_type: p.project_type || null,
    budget_max: num(p.budget_max),
    apport: num(p.apport),
    financing: p.financing || null,
    zones: Array.isArray(p.zones) ? p.zones : [],
    property_types: Array.isArray(p.property_types) ? p.property_types : [],
    min_yield: yieldValue === null ? null : Math.max(0, Math.min(MIN_YIELD_MAX, Math.round(yieldValue * 10) / 10)),
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
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    ...EMPTY_BUYER_PROFILE,
    project_type: p.project_type || '',
    budget_max: str(p.budget_max),
    apport: str(p.apport),
    financing: p.financing || '',
    zones: Array.isArray(p.zones) ? p.zones : [],
    property_types: Array.isArray(p.property_types) ? p.property_types : [],
    min_yield: str(p.min_yield).replace('.', ','),
    horizon: p.horizon || '',
    siren: p.siren || '',
    company_name: p.company_name || '',
    experience: p.experience || '',
    siren_verified: p.siren_verified === true,
  };
};
