// Données d'affichage d'un bien loué (cartes, fiche, aperçu du vendeur, tableaux de bord) : titre, localisation,
// rendements, décence énergétique, badge « Propriétaire vérifié ». Toujours à partir de l'annonce publique
// (docs/venteloc/API.md §2) : jamais d'adresse exacte, de nom de vendeur ni de dénomination de société.
import {
  propertyTitle, propertyTypeById, leaseTypeLabel, departementLabel, normalizeDepartement, dpeRentalStatus, grossYield,
  netYield, isHousingLease, propertyTypeLabel,
} from '@/lib/referentiels';

const hasNumber = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const positive = (v) => (hasNumber(v) && Number(v) > 0 ? Number(v) : null);

// Titre affiché : celui généré par le serveur, sinon la même règle (taxonomy.property_title)
export const listingTitle = (property) => {
  if (property?.title) return String(property.title);
  return propertyTitle({
    propertyType: property?.property_type,
    city: property?.city,
    department: property?.department,
    surface: property?.surface,
    rooms: property?.rooms,
    unitsCount: property?.units_count,
  });
};

// Ligne de localisation des cartes : « Lyon · Rhône (69) » (quartier facultatif en tête : « Lyon, Jean Macé · Rhône (69) »)
export const listingLocation = (property, { district = false } = {}) => {
  const city = String(property?.city || '').trim();
  const where = district && property?.district ? `${city}${city ? ', ' : ''}${String(property.district).trim()}` : city;
  const dep = normalizeDepartement(property?.department) ? departementLabel(property.department) : '';
  return [where, dep].filter(Boolean).join(' · ') || String(property?.region || '');
};

// Rendements en % : valeurs calculées par le serveur, sinon même calcul que taxonomy (loyer HC × 12 / prix ;
// net de taxe foncière et de charges non récupérables, seulement si l'une des deux est renseignée)
export const listingYields = (property) => {
  const p = property || {};
  const gross = positive(p.gross_yield) ?? grossYield(p.rent_monthly, p.asking_price);
  const costsKnown = hasNumber(p.property_tax) || hasNumber(p.non_recoverable_charges);
  const net = hasNumber(p.net_yield) ? Number(p.net_yield) : (costsKnown ? netYield(p.rent_monthly, p.asking_price, p.property_tax, p.non_recoverable_charges) : null);
  return { gross: gross > 0 ? gross : null, net: net !== null && net > 0 ? net : null };
};

// Loyers annuels hors charges
export const annualRent = (property) => (positive(property?.rent_monthly) ? Math.round(Number(property.rent_monthly) * 12) : null);

// Badge vert « Propriétaire vérifié » : seulement si le justificatif de propriété a été validé (SPEC §5.1)
export const ownershipVerified = (property) => property?.ownership?.status === 'verified'
  || property?.property_checks?.ownership_verified === true;

// Année d'entrée du locataire : « Locataire en place depuis 2019 » (tenant_since, sinon début du bail)
export const tenantSinceYear = (property) => {
  const raw = String(property?.tenant_since || property?.lease_start || '');
  const m = /^(\d{4})/.exec(raw);
  return m ? Number(m[1]) : null;
};

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// « 2025-01-01 » → « 1ᵉʳ janvier 2025 »
export const longDateFr = (iso) => {
  const [y, mo, d] = String(iso || '').slice(0, 10).split('-').map((n) => parseInt(n, 10));
  if (!y || !mo || !d) return '';
  return `${d === 1 ? '1ᵉʳ' : d} ${MONTHS[mo - 1]} ${y}`;
};

// Décence énergétique (loi Climat et résilience) : `dpe_rental` du serveur, sinon même règle que
// taxonomy.dpe_rental_status. → { status: 'interdit'|'echeance', date, text } ou null (rien à signaler)
export const dpeAlert = (property, today) => {
  const p = property || {};
  const cls = String(p.dpe_class || '').toUpperCase();
  const fromApi = p.dpe_rental && typeof p.dpe_rental === 'object' ? p.dpe_rental : null;
  const r = fromApi && fromApi.status ? fromApi : dpeRentalStatus(cls, p.lease_type, today);
  if (!r || !['interdit', 'echeance'].includes(r.status)) return null;
  const date = longDateFr(r.date);
  const text = r.status === 'interdit'
    ? `Logement classé ${cls} : depuis le ${date} il ne peut plus faire l'objet d'un nouveau bail ni d'un renouvellement. Le bail en cours continue jusqu'à son terme.`
    : `Logement classé ${cls} : à partir du ${date}, il ne pourra plus faire l'objet d'un nouveau bail ni d'un renouvellement. Le bail en cours continue jusqu'à son terme ; des travaux d'amélioration énergétique sont à prévoir.`;
  return { status: r.status, date: r.date, text };
};

// Pluriels des types de biens (titres des recherches ciblées : « Appartements loués à vendre en Bretagne »)
export const PROPERTY_TYPE_PLURALS = {
  appartement: 'Appartements loués',
  maison: 'Maisons louées',
  immeuble: 'Immeubles de rapport',
  'residence-geree': 'Lots en résidence gérée',
  'local-commercial': 'Locaux commerciaux loués',
  bureaux: 'Bureaux loués',
  parking: 'Parkings loués',
  autre: 'Biens loués',
};

// Types sans DPE exigé à l'annonce (SPEC §5.4 : « non soumis » accepté) et sans surface obligatoire
export const NON_HOUSING_TYPES = ['local-commercial', 'bureaux', 'parking', 'autre'];
export const isHousingType = (typeId) => propertyTypeById(typeId)?.category === 'habitation' || typeId === 'residence-geree';

// Puces courtes d'une annonce : type de bien et type de bail (« Appartement », « Location meublée »)
export const listingChips = (property) => [
  propertyTypeLabel(property?.property_type, true),
  leaseTypeLabel(property?.lease_type, true),
].filter(Boolean);

// Bail d'habitation (loi de 1989) : mentions DPE et décence énergétique applicables
export const housingLease = (property) => isHousingLease(property?.lease_type);
