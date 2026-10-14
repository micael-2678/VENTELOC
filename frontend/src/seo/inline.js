// Utilitaires de texte partagés par React et par scripts/prerender.mjs.
// Fichier chargé sans bundler par le script : pas d'import, uniquement des `export const`.

// Balisage léger des contenus éditoriaux : **gras** et [lien](/chemin)
// -> [{ type: 'text'|'strong'|'link', text, href }]
export const parseInline = (value) => {
  const text = String(value == null ? '' : value);
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'strong', text: m[1] });
    else out.push({ type: 'link', text: m[2], href: m[3] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
};

// Texte brut (sans balisage) : méta-descriptions, JSON-LD
export const stripInline = (value) => parseInline(value).map((s) => s.text).join('');

// Jetons de marque dans les contenus éditoriaux (src/seo/*.json) : le nom de marque et l'URL ne sont
// jamais écrits en dur (SPEC §1). {{brand}} = BRAND.name, {{vertical}} = BRAND.verticalName (CessionRGE,
// verticale RGE conservée), {{legalName}} = AlterEgo SAS, {{contactEmail}}, {{siteHost}}.
// Les jetons d'offre ({{commissionSentence}}…) sont remplacés par fillOffer (src/lib/offer.js), avant.
export const fillBrand = (value, brand) => {
  const b = brand || {};
  const map = {
    hoguetArt6: b.hoguetArt6,
    fondsMention: b.fondsMention,
    carteT: b.carteT,
    brand: b.name,
    vertical: b.verticalName,
    legalName: b.legalName,
    contactEmail: b.contactEmail,
    siteHost: b.siteHost,
    siteUrl: b.siteUrl,
  };
  return String(value == null ? '' : value).replace(/\{\{(brand|vertical|legalName|contactEmail|siteHost|siteUrl|hoguetArt6|fondsMention|carteT)\}\}/g, (m, key) => (map[key] ? String(map[key]) : m));
};

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// « 2026-09-25 » -> « 25 septembre 2026 » (sans Intl : rendu identique Node / navigateur)
export const formatDateFr = (iso) => {
  const [y, mo, d] = String(iso || '').split('-').map((n) => parseInt(n, 10));
  if (!y || !mo || !d) return '';
  return `${d === 1 ? '1er' : d} ${MONTHS[mo - 1]} ${y}`;
};

// « 2026-09-25 » -> « 25/09/2026 » (bandeau « version du JJ/MM/AAAA » des textes contractuels)
export const formatDateShort = (iso) => {
  const [y, mo, d] = String(iso || '').split('-');
  if (!y || !mo || !d) return '';
  return `${d}/${mo}/${y}`;
};
