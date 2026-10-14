// Formulaire d'annonce en 3 écrans (SPEC §4.2.2) : constantes, bornes, aides, contrôle anti-coordonnées,
// préremplissage (estimateur en sessionStorage, open data) et construction des charges utiles de l'API.
import { RGE_CATEGORIES, RGE_TYPES, MAX_TRADES, rgeIdFor, tradesForRge, normalizeDepartement, regionForDepartement } from '@/lib/referentiels';

export const ESTIMATE_STORAGE_KEY = 'estimate';
export const STEPS = [
  { id: 1, label: 'Entreprise', short: 'Entreprise' },
  { id: 2, label: 'Chiffres clés', short: 'Chiffres' },
  { id: 3, label: 'Cession et aperçu', short: 'Cession' },
];

export const LEGAL_STRUCTURES = [
  { value: 'SARL', label: 'SARL' },
  { value: 'EURL', label: 'EURL' },
  { value: 'SAS', label: 'SAS' },
  { value: 'SASU', label: 'SASU' },
  { value: 'SA', label: 'SA' },
  { value: 'SNC', label: 'SNC' },
  { value: 'EI', label: 'Entreprise individuelle (EI, micro-entreprise)' },
  { value: 'AUTRE', label: 'Autre forme' },
];

export const SALE_OBJECTS = [
  { value: 'titres', label: 'Cession des titres (parts ou actions de la société)', short: 'Titres' },
  { value: 'fonds', label: 'Cession du fonds de commerce (clientèle, matériel, contrats)', short: 'Fonds de commerce' },
  { value: 'indifferent', label: 'Indifférent : à décider avec le repreneur', short: 'Titres ou fonds' },
];

export const SALE_REASONS = [
  { value: 'retraite', label: 'Départ à la retraite' },
  { value: 'reconversion', label: 'Reconversion ou nouveau projet' },
  { value: 'sante', label: 'Raison de santé' },
  { value: 'autre', label: 'Autre raison' },
];

export const HANDOVER_OPTIONS = [0, 1, 3, 6, 12, 24].map((m) => ({ value: m, label: m === 0 ? 'Aucun accompagnement' : m === 1 ? '1 mois' : `${m} mois` }));

// Cases « ce qui rassure un repreneur » (SPEC §4.2.2 écran 3)
export const REASSURANCE = [
  { key: 'has_maintenance_contracts', label: 'Contrats d\'entretien récurrents', hint: 'Un chiffre d\'affaires prévisible : le premier levier de valeur.' },
  { key: 'technical_referent_stays', label: 'Le référent technique reste', hint: 'Indispensable pour conserver les qualifications RGE après la cession.' },
  { key: 'key_staff_stays', label: 'L\'équipe clé reste', hint: 'Chefs d\'équipe, conducteurs de travaux, bureau d\'études.' },
  { key: 'decennale_ok', label: 'Assurance décennale à jour, sans sinistre en cours', hint: 'Évite les décotes de dernière minute et facilite le transfert.' },
];

// Bornes de saisie (SPEC : chiffres bornés, marge et dette bornées)
export const BOUNDS = {
  ca: { min: 0, max: 100000000 },
  ebitda: { min: -100000000, max: 100000000 },
  margin: { min: 0, max: 100 },
  debt: { min: 0, max: 100000000 },
  pipeline: { min: 0, max: 100000000 },
  charges: { min: 0, max: 100000000 },
  price: { min: 1, max: 100000000 },
  staff: { min: 0, max: 10000 },
  handover: { min: 0, max: 24 },
  description: { min: 200, max: 1500 },
};

export const ACCOUNTANT_NOTE = 'Si vous ne l\'avez pas sous la main, laissez vide : à préciser avec votre comptable.';

// Textes d'aide (info-bulles) des chiffres clés
export const HELP = {
  ca_n: `Chiffre d'affaires hors taxes du dernier exercice clos (ligne « Production vendue » ou « Chiffre d'affaires net » de votre compte de résultat). ${ACCOUNTANT_NOTE}`,
  ca_n1: `Chiffre d'affaires HT de l'exercice précédent. ${ACCOUNTANT_NOTE}`,
  ca_n2: `Chiffre d'affaires HT d'il y a deux exercices. ${ACCOUNTANT_NOTE}`,
  ebitda: `Excédent brut d'exploitation : ce que l'activité dégage avant amortissements, intérêts et impôts. Si vous ne le connaissez pas, indiquez votre résultat net. ${ACCOUNTANT_NOTE}`,
  margin: `Marge brute en pourcentage du chiffre d'affaires : (ventes − achats de matériaux et sous-traitance) ÷ ventes. Dans le bâtiment, souvent entre 30 et 60 %. ${ACCOUNTANT_NOTE}`,
  debt: `Dettes financières restant dues (emprunts bancaires, crédits-bails, comptes courants). Hors dettes fournisseurs courantes. ${ACCOUNTANT_NOTE}`,
  pipeline: 'Montant HT des devis signés non encore facturés (carnet de commandes). Un carnet de plus de trois mois se valorise.',
  fixed_charges: `Charges annuelles hors matériaux : salaires chargés, loyers, assurances, matériel et véhicules. ${ACCOUNTANT_NOTE}`,
  asking_price: 'Prix de cession souhaité, hors stock et trésorerie selon l\'objet retenu. Il reste indicatif : vous acceptez ou refusez librement chaque offre.',
  staff_count: 'Salariés en équivalent temps plein, vous compris si vous êtes salarié de la société.',
  rge_validity: 'Date de fin de validité de votre qualification RGE principale (sur le certificat ou l\'annuaire ADEME).',
  description: 'Histoire de l\'entreprise, types de chantiers, clientèle, atouts, organisation. Sans nom, adresse, téléphone, e-mail ni site web : votre annonce reste anonyme jusqu\'à l\'accord de confidentialité.',
  handover_months: 'Durée pendant laquelle vous acceptez d\'accompagner le repreneur après la vente (présentation des clients, passation technique).',
  auto_accept_dataroom: 'Les repreneurs dont le projet est renseigné (profil complété à 50 % au moins) accèdent à la suite du parcours sans attendre votre validation : identité vérifiée, accord de confidentialité, puis déclaration d\'origine des fonds.',
};

// ------------------------------------------------------------------------------------------------
// Contrôle anti-coordonnées (description) : e-mail, téléphone, URL ; le serveur masque aussi côté API
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i;
const PHONE_RE = /(?:(?:\+|00)\s*33\s*[\s.-]?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+|\b[\w-]+\.(?:fr|com|net|org|eu|io|pro|bzh|paris|info|biz)\b(?:\/[^\s]*)?/i;

export const findContactDetails = (text) => {
  const s = String(text || '');
  const found = [];
  if (EMAIL_RE.test(s)) found.push('une adresse e-mail');
  if (PHONE_RE.test(s)) found.push('un numéro de téléphone');
  if (URL_RE.test(s)) found.push('une adresse de site web');
  return found;
};

export const descriptionIssues = (text) => {
  const s = String(text || '').trim();
  const contacts = findContactDetails(s);
  return {
    length: s.length,
    empty: s.length === 0,
    tooShort: s.length > 0 && s.length < BOUNDS.description.min,
    tooLong: s.length > BOUNDS.description.max,
    contacts,
    ok: s.length >= BOUNDS.description.min && s.length <= BOUNDS.description.max && contacts.length === 0,
  };
};

// ------------------------------------------------------------------------------------------------
// Domaines ADEME (texte libre) → ids de RGE_CATEGORIES
export const rgeIdsFromAdeme = (domaines, qualifications = []) => {
  const mapped = new Set();
  const texts = [...(Array.isArray(domaines) ? domaines : []), ...(Array.isArray(qualifications) ? qualifications : [])]
    .map((d) => (typeof d === 'string' ? d : d?.domaine || d?.name || ''))
    .filter(Boolean);
  texts.forEach((text) => {
    const d = text.toLowerCase();
    if (d.includes('isolation') && d.includes('intérieur')) mapped.add('isolation_interieur');
    if (d.includes('isolation') && d.includes('extérieur') && d.includes('mur')) mapped.add('isolation_exterieur');
    if (d.includes('toiture') || d.includes('terrasse')) mapped.add('isolation_toiture');
    if (d.includes('combles')) mapped.add('isolation_combles');
    if (d.includes('plancher')) mapped.add('isolation_plancher');
    if (d.includes('fenêtre') || d.includes('volet') || d.includes('porte') || d.includes('menuiserie')) mapped.add('menuiserie');
    if (d.includes('bois') && (d.includes('chauffage') || d.includes('appareil') || d.includes('poêle') || d.includes('insert') || d.includes('granul'))) mapped.add('chauffage_bois');
    if (d.includes('chaudière') && (d.includes('gaz') || d.includes('fioul') || d.includes('condensation'))) mapped.add('chauffage_gaz');
    if (d.includes('pompe') && d.includes('chaleur') && d.includes('air') && d.includes('eau')) mapped.add('pac_air_eau');
    if (d.includes('pompe') && d.includes('chaleur') && d.includes('air/air')) mapped.add('pac_air_air');
    if (d.includes('pompe') && d.includes('chaleur') && (d.includes('géotherm') || d.includes('eau/eau'))) mapped.add('pac_eau_eau');
    if (d.includes('chauffe-eau') && d.includes('thermodynamique')) mapped.add('chauffe_eau_thermo');
    if (d.includes('solaire') && d.includes('combiné')) mapped.add('solaire_combine');
    else if (d.includes('solaire') && d.includes('thermique')) mapped.add('solaire_thermique');
    if (d.includes('photovoltaïque') || d.includes('photovoltaique')) mapped.add('photovoltaique');
    if (d.includes('ventilation') || d.includes('vmc')) mapped.add('ventilation');
    if (d.includes('audit')) mapped.add('audit_energetique');
    if (d.includes('borne') || d.includes('recharge')) mapped.add('borne_recharge');
    const direct = rgeIdFor(text);
    if (direct) mapped.add(direct);
  });
  return RGE_CATEGORIES.filter((c) => mapped.has(c.id)).map((c) => c.id);
};

export const rgeLabelsFromIds = (ids) => (Array.isArray(ids) ? ids : []).map((id) => RGE_TYPES.find((t) => t.id === id)?.value || id);
export const rgeIdsFromLabels = (labels) => (Array.isArray(labels) ? labels : []).map((l) => rgeIdFor(l)).filter(Boolean);

// ------------------------------------------------------------------------------------------------
// Estimateur (/estimer → « Déposer mon annonce anonyme ») : lecture tolérante de sessionStorage.estimate
export const readEstimateSession = () => {
  try {
    const raw = sessionStorage.getItem(ESTIMATE_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    // Deux formes écrites par EstimatePage : {inputs:{ca,ebe,staff…}, result:{low,high,mid}} ou, à plat,
    // {ca, ebe, staff, maintenance_contracts…, low, high, mid} (HANDOFF compte-estimateur §2.3)
    const inputs = data.inputs || data.form || data;
    const company = data.company || {};
    const result = data.result || data.estimate || data;
    const rge = data.rge || {};
    const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
    return {
      siret: String(data.siret || company.siret || inputs.siret || '').replace(/\D/g, '').slice(0, 14),
      company,
      rge,
      inputs: {
        ca: num(inputs.ca ?? inputs.ca_n),
        ebe: num(inputs.ebe ?? inputs.ebitda),
        staff: num(inputs.staff ?? inputs.staff_count),
        maintenance_contracts: !!(inputs.maintenance_contracts ?? inputs.has_maintenance_contracts),
        team_stays: !!(inputs.team_stays ?? inputs.technical_referent_stays),
        owner_dispensable: !!inputs.owner_dispensable,
      },
      result: { low: num(result.low), high: num(result.high), mid: num(result.mid) },
    };
  } catch (e) {
    return null;
  }
};

export const clearEstimateSession = () => {
  try { sessionStorage.removeItem(ESTIMATE_STORAGE_KEY); } catch (e) { /* stockage indisponible */ }
};

// ------------------------------------------------------------------------------------------------
// État du formulaire
export const emptyForm = () => ({
  siret: '',
  company_name: '',
  trades: [],
  rge_ids: [],
  rge_validity: '',
  other_qualifications: [],
  region: '',
  department: '',
  staff_count: '',
  creation_date: '',
  legal_structure: '',
  ca_n: '',
  ca_n1: '',
  ca_n2: '',
  ebitda: '',
  margin: '',
  debt: '',
  pipeline: '',
  fixed_charges: { salaries: '', rent: '', insurance: '', equipment: '' },
  asking_price: '',
  sale_object: '',
  sale_reason: '',
  handover_months: '',
  has_maintenance_contracts: false,
  technical_referent_stays: false,
  key_staff_stays: false,
  decennale_ok: false,
  auto_accept_dataroom: false,
  equipment: '',
  premises: '',
  description: '',
});

const str = (v) => (v === null || v === undefined ? '' : String(v));
const numStr = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '' : String(v));
const isoDate = (v) => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

// Formulaire depuis une annonce existante (reprise d'un brouillon, modification)
export const formFromCompany = (company) => {
  const c = company || {};
  const form = emptyForm();
  const fc = c.fixed_charges || {};
  return {
    ...form,
    siret: str(c.siret).replace(/\D/g, ''),
    company_name: str(c.company_name),
    trades: Array.isArray(c.trades) && c.trades.length ? c.trades.slice(0, MAX_TRADES) : tradesForRge(c.rge_types),
    rge_ids: rgeIdsFromLabels(c.rge_types),
    rge_validity: isoDate(c.rge_validity),
    other_qualifications: Array.isArray(c.other_qualifications) ? c.other_qualifications : [],
    region: str(c.region),
    department: normalizeDepartement(c.department),
    staff_count: numStr(c.staff_count),
    creation_date: isoDate(c.creation_date),
    legal_structure: str(c.legal_structure),
    ca_n: numStr(c.ca_n), ca_n1: numStr(c.ca_n1), ca_n2: numStr(c.ca_n2),
    ebitda: numStr(c.ebitda), margin: numStr(c.margin), debt: numStr(c.debt), pipeline: numStr(c.pipeline),
    fixed_charges: { salaries: numStr(fc.salaries), rent: numStr(fc.rent), insurance: numStr(fc.insurance), equipment: numStr(fc.equipment) },
    asking_price: numStr(c.asking_price),
    sale_object: str(c.sale_object) || (c.sale_type === 'parts' ? 'titres' : c.sale_type === 'fonds' ? 'fonds' : c.sale_type === 'mixte' ? 'indifferent' : ''),
    sale_reason: str(c.sale_reason),
    handover_months: numStr(c.handover_months),
    has_maintenance_contracts: !!c.has_maintenance_contracts,
    technical_referent_stays: !!c.technical_referent_stays,
    key_staff_stays: !!c.key_staff_stays,
    decennale_ok: !!c.decennale_ok,
    auto_accept_dataroom: !!c.auto_accept_dataroom,
    equipment: str(c.equipment),
    premises: str(c.premises),
    description: str(c.description),
  };
};

// Préremplissage depuis l'estimateur et la fiche open data (normalizeCompanyLookup de components/account/siret)
export const applyEstimateToForm = (form, estimate) => {
  if (!estimate) return form;
  const next = { ...form };
  if (estimate.siret && !next.siret) next.siret = estimate.siret;
  const i = estimate.inputs || {};
  if (i.ca !== null && i.ca !== undefined && next.ca_n === '') next.ca_n = String(i.ca);
  if (i.ebe !== null && i.ebe !== undefined && next.ebitda === '') next.ebitda = String(i.ebe);
  if (i.staff !== null && i.staff !== undefined && next.staff_count === '') next.staff_count = String(i.staff);
  if (i.maintenance_contracts) next.has_maintenance_contracts = true;
  if (i.team_stays) next.technical_referent_stays = true;
  return next;
};

export const applyLookupToForm = (form, lookup) => {
  if (!lookup) return form;
  const next = { ...form };
  const c = lookup.company || {};
  if (c.found) {
    if (c.name) next.company_name = c.name;
    if (c.department && !next.department) next.department = normalizeDepartement(c.department);
    if (!next.region) next.region = c.region || regionForDepartement(next.department);
    if (c.creationDate && !next.creation_date) next.creation_date = isoDate(c.creationDate);
    if (c.staffCount !== null && c.staffCount !== undefined && next.staff_count === '') next.staff_count = String(c.staffCount);
    if (c.legalStructure && !next.legal_structure) next.legal_structure = c.legalStructure;
    if (Array.isArray(c.trades) && c.trades.length && !next.trades.length) next.trades = c.trades.slice(0, MAX_TRADES);
  }
  const r = lookup.rge || {};
  if (r.found) {
    const ids = rgeIdsFromAdeme(r.domaines, r.qualifications);
    if (ids.length) {
      next.rge_ids = Array.from(new Set([...next.rge_ids, ...ids]));
      if (!next.trades.length) next.trades = tradesForRge(rgeLabelsFromIds(next.rge_ids));
    }
    const ends = (r.qualifications || []).map((q) => q.dateFin).filter(Boolean).sort();
    if (ends.length && !next.rge_validity) next.rge_validity = isoDate(ends[ends.length - 1]);
  }
  return next;
};

// ------------------------------------------------------------------------------------------------
// Validation par écran → { champ: message }
const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const inRange = (v, b) => v === null || (Number.isFinite(v) && v >= b.min && v <= b.max);
const fmt = (x) => Number(x).toLocaleString('fr-FR');

export const validateStep = (step, form) => {
  const errors = {};
  if (step === 1) {
    if (!form.trades.length) errors.trades = 'Choisissez au moins un métier.';
    if (form.trades.length > MAX_TRADES) errors.trades = `${MAX_TRADES} métiers au maximum.`;
    if (!form.region) errors.region = 'Indiquez la région.';
    if (form.staff_count !== '' && !inRange(n(form.staff_count), BOUNDS.staff)) errors.staff_count = `Effectif entre ${BOUNDS.staff.min} et ${fmt(BOUNDS.staff.max)}.`;
    if (form.siret && form.siret.length !== 14) errors.siret = 'Un SIRET compte 14 chiffres.';
  }
  if (step === 2) {
    ['ca_n', 'ca_n1', 'ca_n2'].forEach((k) => {
      if (!inRange(n(form[k]), BOUNDS.ca)) errors[k] = `Montant entre 0 et ${fmt(BOUNDS.ca.max)} €.`;
    });
    if (!inRange(n(form.ebitda), BOUNDS.ebitda)) errors.ebitda = `Montant entre −${fmt(BOUNDS.ebitda.max)} et ${fmt(BOUNDS.ebitda.max)} €.`;
    if (!inRange(n(form.margin), BOUNDS.margin)) errors.margin = 'Pourcentage entre 0 et 100.';
    if (!inRange(n(form.debt), BOUNDS.debt)) errors.debt = `Montant entre 0 et ${fmt(BOUNDS.debt.max)} €.`;
    if (!inRange(n(form.pipeline), BOUNDS.pipeline)) errors.pipeline = `Montant entre 0 et ${fmt(BOUNDS.pipeline.max)} €.`;
    Object.keys(form.fixed_charges || {}).forEach((k) => {
      if (!inRange(n(form.fixed_charges[k]), BOUNDS.charges)) errors[`fixed_charges.${k}`] = 'Montant positif attendu.';
    });
  }
  if (step === 3) {
    const price = n(form.asking_price);
    if (price === null || !inRange(price, BOUNDS.price)) errors.asking_price = 'Indiquez un prix demandé (en euros).';
    if (!form.sale_object) errors.sale_object = 'Indiquez ce que vous cédez.';
    if (!form.sale_reason) errors.sale_reason = 'Indiquez le motif de la cession.';
    if (form.handover_months !== '' && !inRange(n(form.handover_months), BOUNDS.handover)) errors.handover_months = 'Entre 0 et 24 mois.';
    const d = descriptionIssues(form.description);
    if (d.empty) errors.description = `Présentez votre entreprise en ${BOUNDS.description.min} à ${fmt(BOUNDS.description.max)} caractères.`;
    else if (d.tooShort) errors.description = `Encore ${BOUNDS.description.min - d.length} caractères au minimum.`;
    else if (d.tooLong) errors.description = `${d.length - BOUNDS.description.max} caractères de trop.`;
    else if (d.contacts.length) errors.description = `Retirez ${d.contacts.join(', ')} : l'annonce doit rester anonyme.`;
  }
  return errors;
};

// ------------------------------------------------------------------------------------------------
// Charges utiles de l'API
const num0 = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Number(v));
const numOrUndef = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export const legacySaleType = (saleObject) => ({ titres: 'parts', fonds: 'fonds', indifferent: 'mixte' }[saleObject] || '');

// Champs de l'écran 1 (PUT /companies/{id})
export const step1Payload = (form) => compact({
  siret: form.siret || undefined,
  company_name: form.company_name || undefined,
  trades: form.trades,
  rge_types: rgeLabelsFromIds(form.rge_ids),
  rge_validity: form.rge_validity || undefined,
  other_qualifications: form.other_qualifications,
  region: form.region || undefined,
  department: form.department || undefined,
  staff_count: numOrUndef(form.staff_count),
  creation_date: form.creation_date || undefined,
  legal_structure: form.legal_structure || undefined,
});

export const step2Payload = (form) => compact({
  ca_n: numOrUndef(form.ca_n),
  ca_n1: numOrUndef(form.ca_n1),
  ca_n2: numOrUndef(form.ca_n2),
  ebitda: numOrUndef(form.ebitda),
  margin: numOrUndef(form.margin),
  debt: numOrUndef(form.debt),
  pipeline: numOrUndef(form.pipeline),
  fixed_charges: {
    salaries: num0(form.fixed_charges?.salaries),
    rent: num0(form.fixed_charges?.rent),
    insurance: num0(form.fixed_charges?.insurance),
    equipment: num0(form.fixed_charges?.equipment),
  },
});

export const step3Payload = (form) => compact({
  asking_price: numOrUndef(form.asking_price),
  sale_object: form.sale_object || undefined,
  sale_type: legacySaleType(form.sale_object) || undefined,
  sale_reason: form.sale_reason || undefined,
  handover_months: numOrUndef(form.handover_months),
  has_maintenance_contracts: !!form.has_maintenance_contracts,
  technical_referent_stays: !!form.technical_referent_stays,
  key_staff_stays: !!form.key_staff_stays,
  decennale_ok: !!form.decennale_ok,
  auto_accept_dataroom: !!form.auto_accept_dataroom,
  equipment: form.equipment || undefined,
  premises: form.premises || undefined,
  description: form.description.trim() || undefined,
});

// POST /companies : création du brouillon au premier écran. Le modèle de création attend encore des montants
// (anciens champs obligatoires) : ils sont envoyés à zéro et complétés aux écrans suivants par PUT.
export const createPayload = (form) => ({
  rge_types: rgeLabelsFromIds(form.rge_ids),
  rge_validity: form.rge_validity || '',
  ca_n: num0(form.ca_n), ca_n1: num0(form.ca_n1), ca_n2: num0(form.ca_n2),
  margin: num0(form.margin), ebitda: num0(form.ebitda),
  creation_date: form.creation_date || '',
  staff_count: Math.round(num0(form.staff_count)),
  legal_structure: form.legal_structure || '',
  pipeline: num0(form.pipeline),
  fixed_charges: { salaries: 0, rent: 0, insurance: 0, equipment: 0 },
  debt: num0(form.debt),
  asking_price: num0(form.asking_price),
  sale_type: legacySaleType(form.sale_object),
  region: form.region || '',
  ...step1Payload(form),
});

export const stepPayload = (step, form) => (step === 1 ? step1Payload(form) : step === 2 ? step2Payload(form) : step3Payload(form));

// Premier écran incomplet d'une annonce reprise (pour ouvrir le brouillon au bon endroit)
export const firstIncompleteStep = (form) => {
  if (Object.keys(validateStep(1, form)).length) return 1;
  if (form.ca_n === '' && form.ebitda === '') return 2;
  if (Object.keys(validateStep(3, form)).length) return 3;
  return 3;
};

// Données du composant ListingPreview à partir du formulaire (aperçu anonyme)
export const fmtEur = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? '' : `${Math.round(Number(v)).toLocaleString('fr-FR')} €`);
