// Marque et entité juridique. Le nom de marque et l'URL ne sont jamais écrits en dur dans les pages :
// importer BRAND (nom, URL, e-mail) et LEGAL (AlterEgo SAS, carte T, mentions obligatoires).
//
// Variables de build (CRA) : REACT_APP_BRAND_NAME (défaut « CessionBâtiment »),
// REACT_APP_SITE_URL (défaut https://cessionbatiment.fr), REACT_APP_CONTACT_EMAIL
// (défaut contact@<domaine du site>). Les mêmes variables sont lues par scripts/prerender.mjs.
//
// Pas d'import : ce fichier est aussi chargé sans bundler par le pré-rendu (bac à sable node:vm
// qui fournit `process.env`).

const clean = (value, fallback) => {
  const s = String(value == null ? '' : value).trim();
  return s || fallback;
};

const siteUrl = clean(process.env.REACT_APP_SITE_URL, 'https://cessionbatiment.fr').replace(/\/+$/, '');
const siteHost = siteUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

export const BRAND = {
  // Nom commercial affiché (logo, titres, e-mails côté front)
  name: clean(process.env.REACT_APP_BRAND_NAME, 'CessionBâtiment'),
  // Entité qui opère la plateforme (carte T) ; aucune personne physique n'apparaît sur le site
  legalName: 'AlterEgo SAS',
  siteUrl,
  siteHost,
  tagline: 'Cession d\'entreprises du bâtiment, en toute confidentialité',
  // Verticale historique conservée (pages /…-rge, hub RGE)
  verticalName: 'CessionRGE',
  contactEmail: clean(process.env.REACT_APP_CONTACT_EMAIL, `contact@${siteHost}`),
};

// « CessionBâtiment » → { head: 'Cession', tail: 'Bâtiment' } : la partie après la première majuscule
// interne est mise en couleur par le logo. Sans majuscule interne : { head: nom, tail: '' }.
export const splitBrandName = (name) => {
  const s = String(name || '');
  for (let i = 1; i < s.length; i += 1) {
    const ch = s[i];
    if (ch !== ch.toLowerCase() && ch === ch.toUpperCase() && /\p{L}/u.test(ch)) {
      return { head: s.slice(0, i), tail: s.slice(i) };
    }
  }
  return { head: s, tail: '' };
};

// Entité juridique (spécification §1). Les valeurs variables (RC pro, médiateur, hébergeur, capital)
// viennent de l'API GET /api/public/legal-info ; voir rcProText() et mediateurText() pour les replis.
export const LEGAL = {
  denomination: 'AlterEgo SAS',
  formeJuridique: 'Société par actions simplifiée',
  rcs: 'RCS Versailles',
  rcsVille: 'Versailles',
  siren: '952 180 230',
  sirenDigits: '952180230',
  adresse: '43 rue Massenet, 78500 Sartrouville',
  carteT: 'CPI 7801 2025 000 000 049',
  carteTIssuer: 'CCI Paris Île-de-France',
  carteTActivity: 'Transactions sur immeubles et fonds de commerce',
  carteTText: 'Carte professionnelle T n° CPI 7801 2025 000 000 049 délivrée par la CCI Paris Île-de-France '
    + '— Transactions sur immeubles et fonds de commerce',
  // Mention obligatoire (loi Hoguet) : aucun fonds détenu pour le compte des parties
  fondsMention: 'AlterEgo SAS déclare ne recevoir ni détenir d\'autres fonds, effets ou valeurs que ceux '
    + 'représentatifs de sa rémunération.',
  // Art. 6 loi Hoguet : aucune somme n'est due avant la conclusion de l'opération
  hoguetArt6: 'Aucune somme d\'argent n\'est exigible avant la signature de l\'acte de cession '
    + '(art. 6, loi n° 70-9 du 2 janvier 1970).',
  tribunal: 'Tribunal de commerce de Versailles',
  rcProFallback: 'RC professionnelle souscrite conformément à la loi Hoguet',
};

// RC professionnelle : assureur + n° de police si renseignés (LEGAL_RC_PRO côté API), sinon la mention légale
export const rcProText = (value) => clean(value, LEGAL.rcProFallback);
// Médiateur de la consommation : rien n'est affiché s'il n'est pas renseigné (LEGAL_MEDIATEUR)
export const mediateurText = (value) => clean(value, '');

// Signature courte pour pieds de page et e-mails : « CessionBâtiment · AlterEgo SAS »
export const brandSignature = () => `${BRAND.name} · ${BRAND.legalName}`;
