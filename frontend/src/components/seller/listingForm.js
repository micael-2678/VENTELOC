// Formulaire d'annonce en 3 écrans (docs/venteloc/SPEC.md §3 et §5.2) : le bien, la location, la vente.
// Constantes, bornes, aides, contrôle anti-coordonnées, préremplissage depuis l'estimateur (sessionStorage), validation
// par écran (alignée sur les contrôles de publication §5.4) et construction des charges utiles de l'API
// (POST /properties au premier écran, PUT /properties/{id} ensuite).
import {
  PROPERTY_TYPES, OWNER_TYPES, departementFromPostalCode, normalizeDepartement, propertyTitle, grossYield, netYield,
} from '@/lib/referentiels';

export const ESTIMATE_STORAGE_KEY = 'estimate';
export const STEPS = [
  { id: 1, label: 'Le bien', short: 'Le bien' },
  { id: 2, label: 'La location', short: 'Location' },
  { id: 3, label: 'La vente', short: 'Vente' },
];

// Propriétaire en société : dénomination et SIRET demandés (confidentiels), vente des parts possible
export const COMPANY_OWNERS = ['sci', 'societe'];
export const isCompanyOwner = (ownerType) => COMPANY_OWNERS.includes(ownerType);

// Types de biens d'habitation : DPE avec une classe A à G (ou « DPE vierge ») et estimation des dépenses d'énergie
export const HOUSING_TYPES = ['appartement', 'maison', 'immeuble', 'residence-geree'];
export const isHousingType = (type) => HOUSING_TYPES.includes(type);
// Pièces, étage, ascenseur : seulement pour les logements
export const hasRooms = (type) => ['appartement', 'maison', 'residence-geree'].includes(type);
export const hasFloor = (type) => ['appartement', 'residence-geree', 'bureaux', 'local-commercial', 'parking'].includes(type);
export const hasUnits = (type, leaseType) => type === 'immeuble' || leaseType === 'plusieurs-baux';

// Bail le plus courant pour un type de bien (préremplissage, modifiable)
export const defaultLeaseFor = (type) => ({
  appartement: 'habitation-vide',
  maison: 'habitation-vide',
  immeuble: 'plusieurs-baux',
  'residence-geree': 'residence-geree',
  'local-commercial': 'commercial',
  bureaux: 'commercial',
  parking: 'parking',
}[type] || '');

export const INDEXATIONS = [
  { value: 'irl', label: 'IRL (indice de référence des loyers)' },
  { value: 'ilc', label: 'ILC (indice des loyers commerciaux)' },
  { value: 'ilat', label: 'ILAT (indice des activités tertiaires)' },
  { value: 'aucune', label: 'Aucune indexation' },
];

export const MANAGEMENTS = [
  { value: 'direct', label: 'Je gère moi-même' },
  { value: 'agence', label: 'Gestion confiée à une agence' },
  { value: 'exploitant', label: 'Exploitant de résidence' },
];

export const GES_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// Bornes de saisie
export const BOUNDS = {
  surface: { min: 1, max: 100000 },
  rooms: { min: 1, max: 50 },
  floor: { min: -5, max: 100 },
  units: { min: 1, max: 1000 },
  year: { min: 1500, max: new Date().getFullYear() + 3 },
  amount: { min: 0, max: 100000000 },
  rent: { min: 1, max: 1000000 },
  price: { min: 1, max: 100000000 },
  description: { min: 200, max: 1500 },
};

// Rendement brut plausible pour un bien loué : hors de cette fourchette, alerte (non bloquante)
export const YIELD_RANGE = { min: 2, max: 15 };

// Textes d'aide (info-bulles)
export const HELP = {
  address: 'Numéro et voie. Elle n\'apparaît jamais sur l\'annonce : seuls la ville, le département et le quartier sont publics. L\'adresse est révélée aux acquéreurs à l\'identité vérifiée qui ont signé l\'engagement de confidentialité.',
  company: 'La dénomination et le SIRET de la société propriétaire restent confidentiels : ils figurent sur le mandat et ne sont révélés qu\'après l\'engagement de confidentialité. Le SIRET sert à vérifier que la société est active.',
  surface: 'Surface habitable (loi Carrez pour un lot de copropriété) ou surface utile pour un local.',
  copro: 'Mentions obligatoires d\'une annonce de lot de copropriété (art. L721-1 du Code de la construction et de l\'habitation).',
  copro_charges_annual: 'Montant annuel moyen de votre quote-part des charges courantes (budget prévisionnel), sur l\'appel de charges ou le relevé du syndic.',
  copro_procedure: 'Le syndicat des copropriétaires fait-il l\'objet d\'une procédure (mandataire ad hoc ou administrateur provisoire, art. 29-1 A ou 29-1 de la loi du 10 juillet 1965) ?',
  dpe: 'Sur la première page de votre DPE. Un logement doit afficher sa classe énergie et l\'estimation des dépenses annuelles d\'énergie.',
  energy_cost: 'Fourchette « estimation des coûts annuels d\'énergie » indiquée sur le DPE.',
  rent_monthly: 'Loyer hors charges du bail en cours (tous les lots pour un immeuble).',
  charges_monthly: 'Provisions sur charges récupérables payées chaque mois par le locataire.',
  deposit: 'Le dépôt de garantie suit le bail : il est réglé entre vous et l\'acquéreur chez le notaire.',
  property_tax: 'Montant de la dernière taxe foncière (hors taxe d\'enlèvement des ordures ménagères si elle est refacturée au locataire).',
  non_recoverable_charges: 'Charges que vous payez sans les refacturer : part non récupérable de la copropriété, assurance propriétaire non occupant, frais de gestion.',
  tenant_payment_status: 'Déclaratif, sur les 12 derniers mois. Le relevé des loyers (quittances) sera demandé dans le dossier du bien.',
  asking_price: 'Prix de vente honoraires inclus : les honoraires sont à votre charge et réglés par le notaire sur ce prix. Vous restez libre d\'accepter ou de refuser chaque offre.',
  description: 'Atouts du bien et de son emplacement, état, environnement, historique de la location. Sans nom ni coordonnées (ni les vôtres ni celles du locataire), sans adresse exacte.',
  auto_accept_dataroom: 'Les acquéreurs dont le projet est renseigné (profil complété à 50 % au moins) poursuivent sans attendre votre accord : identité vérifiée, engagement de confidentialité, origine des fonds, puis accès au dossier.',
};

export const TENANT_DATA_WARNING = 'Ne saisissez aucun nom ni coordonnée du locataire.';

// ------------------------------------------------------------------------------------------------
// Contrôle anti-coordonnées (description, textes libres) ; le serveur masque aussi côté API
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
// Estimateur (/estimer → « Déposer mon annonce ») : lecture tolérante de sessionStorage.estimate
// Forme écrite par EstimatePage : { inputs: {property_type, lease_type, department, surface, rent_monthly…}, result: {low, high, mid} }
const numOrNull = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export const readEstimateSession = () => {
  try {
    const raw = sessionStorage.getItem(ESTIMATE_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const inputs = data.inputs && typeof data.inputs === 'object' ? data.inputs : data;
    const result = data.result && typeof data.result === 'object' ? data.result : {};
    return {
      inputs: {
        property_type: PROPERTY_TYPES.some((t) => t.id === inputs.property_type) ? inputs.property_type : '',
        lease_type: String(inputs.lease_type || ''),
        department: normalizeDepartement(inputs.department),
        surface: numOrNull(inputs.surface),
        rent_monthly: numOrNull(inputs.rent_monthly),
        charges_monthly: numOrNull(inputs.charges_monthly),
        property_tax: numOrNull(inputs.property_tax),
        non_recoverable_charges: numOrNull(inputs.non_recoverable_charges),
        asking_price: numOrNull(inputs.asking_price),
      },
      result: { low: numOrNull(result.low), high: numOrNull(result.high), mid: numOrNull(result.mid) },
    };
  } catch (e) {
    return null;
  }
};

export const clearEstimateSession = () => {
  try { sessionStorage.removeItem(ESTIMATE_STORAGE_KEY); } catch (e) { /* stockage indisponible */ }
};

// ------------------------------------------------------------------------------------------------
// État du formulaire (valeurs de saisie en chaînes ; oui/non en 'oui' | 'non' | '')
export const emptyForm = () => ({
  // Écran 1 — le bien
  property_type: '',
  owner_type: '',
  company_name: '',
  siret: '',
  address: '',
  postal_code: '',
  city: '',
  department: '',
  district: '',
  surface: '',
  rooms: '',
  floor: '',
  elevator: '',
  construction_year: '',
  units_count: '',
  units_rented: '',
  is_copro: '',
  copro_lots: '',
  copro_charges_annual: '',
  copro_procedure: '',
  dpe_class: '',
  ges_class: '',
  energy_cost_min: '',
  energy_cost_max: '',
  dpe_date: '',
  // Écran 2 — la location
  lease_type: '',
  rent_monthly: '',
  charges_monthly: '',
  lease_start: '',
  lease_end: '',
  tenant_since: '',
  deposit: '',
  indexation: '',
  last_revision: '',
  tenant_payment_status: '',
  has_gli: '',
  has_guarantor: '',
  property_tax: '',
  non_recoverable_charges: '',
  management: '',
  operator_lease_end: '',
  // Écran 3 — la vente
  asking_price: '',
  sale_object: '',
  sale_reason: '',
  availability_note: '',
  description: '',
  equipment: '',
  recent_works: '',
  auto_accept_dataroom: false,
});

const str = (v) => (v === null || v === undefined ? '' : String(v));
const numStr = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '' : String(v));
const isoDate = (v) => {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};
export const triFrom = (v) => (v === true ? 'oui' : v === false ? 'non' : '');
export const triTo = (v) => (v === 'oui' ? true : v === 'non' ? false : undefined);

// Formulaire depuis une annonce existante (reprise d'un brouillon, modification)
export const formFromProperty = (property) => {
  const c = property || {};
  const form = emptyForm();
  const out = { ...form };
  ['property_type', 'owner_type', 'company_name', 'address', 'city', 'district', 'dpe_class', 'ges_class', 'lease_type', 'indexation',
    'tenant_payment_status', 'management', 'sale_object', 'sale_reason', 'availability_note', 'description', 'equipment', 'recent_works']
    .forEach((k) => { out[k] = str(c[k]); });
  ['surface', 'rooms', 'floor', 'construction_year', 'units_count', 'units_rented', 'copro_lots', 'copro_charges_annual', 'energy_cost_min',
    'energy_cost_max', 'rent_monthly', 'charges_monthly', 'deposit', 'property_tax', 'non_recoverable_charges', 'asking_price']
    .forEach((k) => { out[k] = numStr(c[k]); });
  ['dpe_date', 'lease_start', 'lease_end', 'tenant_since', 'last_revision', 'operator_lease_end'].forEach((k) => { out[k] = isoDate(c[k]); });
  ['elevator', 'is_copro', 'copro_procedure', 'has_gli', 'has_guarantor'].forEach((k) => { out[k] = triFrom(c[k]); });
  out.siret = str(c.siret).replace(/\D/g, '');
  out.postal_code = str(c.postal_code).replace(/\D/g, '').slice(0, 5);
  out.department = normalizeDepartement(c.department) || departementFromPostalCode(out.postal_code);
  out.auto_accept_dataroom = !!c.auto_accept_dataroom;
  return out;
};

// Préremplissage depuis l'estimateur : seulement les champs encore vides
export const applyEstimateToForm = (form, estimate) => {
  if (!estimate || !estimate.inputs) return form;
  const next = { ...form };
  const i = estimate.inputs;
  ['property_type', 'lease_type'].forEach((k) => { if (i[k] && !next[k]) next[k] = i[k]; });
  if (i.department && !next.department && !next.postal_code) next.department = i.department;
  ['surface', 'rent_monthly', 'charges_monthly', 'property_tax', 'non_recoverable_charges', 'asking_price'].forEach((k) => {
    if (i[k] !== null && i[k] !== undefined && next[k] === '') next[k] = String(i[k]);
  });
  return next;
};

// ------------------------------------------------------------------------------------------------
// Rendements en direct (écrans 2 et 3) : brut sur le loyer HC, net si la taxe foncière ou les charges sont saisies
const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export const liveYields = (form) => {
  const rent = n(form.rent_monthly);
  const price = n(form.asking_price);
  const costsKnown = form.property_tax !== '' || form.non_recoverable_charges !== '';
  return {
    gross: grossYield(rent, price),
    net: costsKnown ? netYield(rent, price, n(form.property_tax) || 0, n(form.non_recoverable_charges) || 0) : null,
    annualRent: rent > 0 ? Math.round(rent * 12) : null,
  };
};

// Alerte (non bloquante) si le rendement brut sort de 2 % à 15 % : 'low' | 'high' | null
export const yieldAlert = (gross) => {
  if (gross === null || gross === undefined || !Number.isFinite(Number(gross))) return null;
  if (gross < YIELD_RANGE.min) return 'low';
  if (gross > YIELD_RANGE.max) return 'high';
  return null;
};

// ------------------------------------------------------------------------------------------------
// Validation par écran → { champ: message } (mêmes exigences que la publication automatique, SPEC §5.4)
const inRange = (v, b) => v === null || (Number.isFinite(v) && v >= b.min && v <= b.max);
const fmt = (x) => Number(x).toLocaleString('fr-FR');
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

export const validateStep = (step, form) => {
  const errors = {};
  if (step === 1) {
    if (!form.property_type) errors.property_type = 'Choisissez le type de bien.';
    if (!form.owner_type) errors.owner_type = 'Indiquez à qui appartient le bien.';
    if (isCompanyOwner(form.owner_type)) {
      if (!String(form.company_name || '').trim()) errors.company_name = 'Indiquez la dénomination de la société.';
      if (String(form.siret || '').replace(/\D/g, '').length !== 14) errors.siret = 'Un SIRET compte 14 chiffres.';
    }
    if (!/^\d{5}$/.test(String(form.postal_code || ''))) errors.postal_code = 'Code postal à 5 chiffres.';
    else if (!departementFromPostalCode(form.postal_code)) errors.postal_code = 'Code postal inconnu.';
    if (!String(form.city || '').trim()) errors.city = 'Indiquez la ville.';
    if (form.property_type !== 'parking') {
      if (form.surface === '') errors.surface = 'Indiquez la surface.';
      else if (!inRange(n(form.surface), BOUNDS.surface)) errors.surface = `Surface entre ${BOUNDS.surface.min} et ${fmt(BOUNDS.surface.max)} m².`;
    }
    if (form.rooms !== '' && !inRange(n(form.rooms), BOUNDS.rooms)) errors.rooms = `Entre ${BOUNDS.rooms.min} et ${BOUNDS.rooms.max} pièces.`;
    if (form.floor !== '' && !inRange(n(form.floor), BOUNDS.floor)) errors.floor = 'Étage entre -5 et 100.';
    if (form.construction_year !== '' && !inRange(n(form.construction_year), BOUNDS.year)) errors.construction_year = `Année entre ${BOUNDS.year.min} et ${BOUNDS.year.max}.`;
    if (form.units_count !== '' && !inRange(n(form.units_count), BOUNDS.units)) errors.units_count = 'Nombre de lots positif attendu.';
    if (form.units_rented !== '' && form.units_count !== '' && n(form.units_rented) > n(form.units_count)) errors.units_rented = 'Pas plus de lots loués que de lots.';
    if (!form.is_copro) errors.is_copro = 'Indiquez si le bien est en copropriété.';
    if (form.is_copro === 'oui') {
      if (!(n(form.copro_lots) > 0)) errors.copro_lots = 'Indiquez le nombre de lots de la copropriété.';
      if (form.copro_charges_annual === '' || !inRange(n(form.copro_charges_annual), BOUNDS.amount)) errors.copro_charges_annual = 'Indiquez votre quote-part annuelle de charges.';
      if (!form.copro_procedure) errors.copro_procedure = 'Indiquez si une procédure est en cours.';
    }
    if (!form.dpe_class) errors.dpe_class = 'Indiquez la classe énergie du DPE.';
    else if (isHousingType(form.property_type) && form.dpe_class === 'non-soumis') errors.dpe_class = 'Un logement doit afficher sa classe énergie (ou « DPE vierge »).';
    if (isHousingType(form.property_type) && /^[A-G]$/.test(form.dpe_class)) {
      if (!(n(form.energy_cost_min) > 0) || !(n(form.energy_cost_max) > 0)) errors.energy_cost = 'Indiquez l\'estimation des dépenses annuelles d\'énergie (fourchette du DPE).';
      else if (n(form.energy_cost_min) > n(form.energy_cost_max)) errors.energy_cost = 'Le montant bas doit être inférieur au montant haut.';
    }
  }
  if (step === 2) {
    if (!form.lease_type) errors.lease_type = 'Choisissez le type de bail.';
    if (form.rent_monthly === '' || !inRange(n(form.rent_monthly), BOUNDS.rent)) errors.rent_monthly = 'Indiquez le loyer mensuel hors charges.';
    if (!isDate(form.lease_start)) errors.lease_start = 'Indiquez la date de prise d\'effet du bail en cours.';
    if (isDate(form.lease_start) && isDate(form.lease_end) && form.lease_end < form.lease_start) errors.lease_end = 'L\'échéance doit suivre le début du bail.';
    ['charges_monthly', 'deposit', 'property_tax', 'non_recoverable_charges'].forEach((k) => {
      if (form[k] !== '' && !inRange(n(form[k]), BOUNDS.amount)) errors[k] = 'Montant positif attendu.';
    });
  }
  if (step === 3) {
    const price = n(form.asking_price);
    if (price === null || !inRange(price, BOUNDS.price)) errors.asking_price = 'Indiquez le prix de vente (en euros).';
    if (!form.sale_object) errors.sale_object = 'Indiquez ce que vous vendez.';
    else if (form.sale_object !== 'bien' && !isCompanyOwner(form.owner_type)) errors.sale_object = 'La cession de parts n\'est possible que pour un bien détenu par une société.';
    const d = descriptionIssues(form.description);
    if (d.empty) errors.description = `Présentez votre bien en ${BOUNDS.description.min} à ${fmt(BOUNDS.description.max)} caractères.`;
    else if (d.tooShort) errors.description = `Encore ${BOUNDS.description.min - d.length} caractères au minimum.`;
    else if (d.tooLong) errors.description = `${d.length - BOUNDS.description.max} caractères de trop.`;
    else if (d.contacts.length) errors.description = `Retirez ${d.contacts.join(', ')} : les coordonnées ne sont jamais publiées.`;
    ['equipment', 'recent_works', 'availability_note'].forEach((k) => {
      const found = findContactDetails(form[k]);
      if (found.length) errors[k] = `Retirez ${found.join(', ')}.`;
    });
  }
  return errors;
};

// ------------------------------------------------------------------------------------------------
// Charges utiles de l'API (champs vides omis ; montants en nombres ; oui/non en booléens)
const numOrUndef = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));
const textOrUndef = (v) => (String(v || '').trim() ? String(v).trim() : undefined);
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// Écran 1 (POST /properties à la création, PUT ensuite)
export const step1Payload = (form) => {
  const company = isCompanyOwner(form.owner_type);
  const copro = form.is_copro === 'oui';
  const department = departementFromPostalCode(form.postal_code) || normalizeDepartement(form.department);
  return compact({
    property_type: form.property_type || undefined,
    owner_type: form.owner_type || undefined,
    company_name: company ? textOrUndef(form.company_name) : undefined,
    siret: company && form.siret ? String(form.siret).replace(/\D/g, '') : undefined,
    address: textOrUndef(form.address),
    postal_code: form.postal_code || undefined,
    city: textOrUndef(form.city),
    department: department || undefined,
    district: textOrUndef(form.district),
    surface: numOrUndef(form.surface),
    rooms: hasRooms(form.property_type) ? numOrUndef(form.rooms) : undefined,
    floor: hasFloor(form.property_type) ? numOrUndef(form.floor) : undefined,
    elevator: hasFloor(form.property_type) ? triTo(form.elevator) : undefined,
    construction_year: numOrUndef(form.construction_year),
    units_count: numOrUndef(form.units_count),
    units_rented: numOrUndef(form.units_rented),
    is_copro: triTo(form.is_copro),
    copro_lots: copro ? numOrUndef(form.copro_lots) : undefined,
    copro_charges_annual: copro ? numOrUndef(form.copro_charges_annual) : undefined,
    copro_procedure: copro ? triTo(form.copro_procedure) : undefined,
    dpe_class: form.dpe_class || undefined,
    ges_class: form.ges_class || undefined,
    energy_cost_min: numOrUndef(form.energy_cost_min),
    energy_cost_max: numOrUndef(form.energy_cost_max),
    dpe_date: form.dpe_date || undefined,
  });
};

export const step2Payload = (form) => compact({
  lease_type: form.lease_type || undefined,
  rent_monthly: numOrUndef(form.rent_monthly),
  charges_monthly: numOrUndef(form.charges_monthly),
  lease_start: form.lease_start || undefined,
  lease_end: form.lease_end || undefined,
  tenant_since: form.tenant_since || undefined,
  deposit: numOrUndef(form.deposit),
  indexation: form.indexation || undefined,
  last_revision: form.last_revision || undefined,
  tenant_payment_status: form.tenant_payment_status || undefined,
  has_gli: triTo(form.has_gli),
  has_guarantor: triTo(form.has_guarantor),
  property_tax: numOrUndef(form.property_tax),
  non_recoverable_charges: numOrUndef(form.non_recoverable_charges),
  management: form.management || undefined,
  operator_lease_end: form.property_type === 'residence-geree' || form.lease_type === 'residence-geree' ? (form.operator_lease_end || undefined) : undefined,
});

export const step3Payload = (form) => compact({
  asking_price: numOrUndef(form.asking_price),
  sale_object: form.sale_object || undefined,
  sale_reason: form.sale_reason || undefined,
  availability_note: textOrUndef(form.availability_note),
  description: textOrUndef(form.description),
  equipment: textOrUndef(form.equipment),
  recent_works: textOrUndef(form.recent_works),
  auto_accept_dataroom: !!form.auto_accept_dataroom,
});

// POST /properties : brouillon créé dès le premier écran (tous les champs sont facultatifs au brouillon)
export const createPayload = (form) => step1Payload(form);

export const stepPayload = (step, form) => (step === 1 ? step1Payload(form) : step === 2 ? step2Payload(form) : step3Payload(form));

// Premier écran incomplet d'une annonce reprise (pour ouvrir le brouillon au bon endroit)
export const firstIncompleteStep = (form) => {
  if (Object.keys(validateStep(1, form)).length) return 1;
  if (Object.keys(validateStep(2, form)).length) return 2;
  return 3;
};

// Annonce publique simulée à partir du formulaire (aperçu de la carte, sans adresse ni société)
export const previewProperty = (form) => {
  const department = departementFromPostalCode(form.postal_code) || normalizeDepartement(form.department);
  const num = (v) => (v === '' ? null : Number(v));
  const y = liveYields(form);
  return {
    id: 'apercu',
    title: propertyTitle({
      propertyType: form.property_type, city: form.city, department, surface: form.surface, rooms: form.rooms, unitsCount: form.units_count,
    }),
    property_type: form.property_type,
    owner_type: form.owner_type,
    city: form.city,
    department,
    district: form.district,
    surface: num(form.surface),
    rooms: num(form.rooms),
    lease_type: form.lease_type,
    rent_monthly: num(form.rent_monthly),
    asking_price: num(form.asking_price),
    gross_yield: y.gross,
    net_yield: y.net,
    dpe_class: form.dpe_class,
    tenant_since: form.tenant_since,
    lease_start: form.lease_start,
    published_at: new Date().toISOString(),
    photos: [],
  };
};

export const ownerTypeOptions = () => OWNER_TYPES.map((o) => ({ value: o.id, label: o.label }));

// Montant lisible (« 145 000 € ») pour les phrases d'aide ; '' si vide
export const fmtEur = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? '' : `${Math.round(Number(v)).toLocaleString('fr-FR')} €`);
