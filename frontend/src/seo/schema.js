// Données structurées JSON-LD (schema.org), partagées par React (useSeo) et scripts/prerender.mjs.
// Fichier chargé sans bundler par le script : pas d'import, uniquement des `export const`.
// La marque (BRAND) et l'entité juridique (LEGAL) viennent de src/lib/brand.js et sont passées en paramètre :
// rien n'est écrit en dur ici (SPEC §1, §5.2 : Organization avec carte T).

const CTX = 'https://schema.org';

const FALLBACK_BRAND = { name: 'VenteLoc', legalName: 'AlterEgo SAS', contactEmail: '' };
const FALLBACK_LEGAL = {
  denomination: 'AlterEgo SAS',
  sirenDigits: '952180230',
  adresse: '43 rue Massenet, 78500 Sartrouville',
  carteT: 'CPI 7801 2025 000 000 049',
  carteTIssuer: 'CCI Paris Île-de-France',
  carteTActivity: 'Transactions sur immeubles et fonds de commerce',
};

// « 43 rue Massenet, 78500 Sartrouville » → { streetAddress, postalCode, addressLocality }
const postalAddress = (adresse) => {
  const m = /^(.*?),\s*(\d{5})\s+(.+)$/.exec(String(adresse || ''));
  return {
    '@type': 'PostalAddress',
    streetAddress: m ? m[1] : String(adresse || ''),
    postalCode: m ? m[2] : '',
    addressLocality: m ? m[3] : '',
    addressCountry: 'FR',
  };
};

// Organisation qui opère la plateforme : marque + entité juridique (AlterEgo SAS, SIREN, carte T).
export const organizationLd = (site, brand, legal) => {
  const b = { ...FALLBACK_BRAND, ...(brand || {}) };
  const l = { ...FALLBACK_LEGAL, ...(legal || {}) };
  return {
    '@context': CTX,
    '@type': 'Organization',
    '@id': `${site}/#organization`,
    name: b.name,
    legalName: l.denomination,
    url: `${site}/`,
    logo: `${site}/logo-512.png`,
    description: `Place de marché de biens immobiliers déjà loués, de propriétaire à investisseur, opérée par ${l.denomination}, titulaire de la carte professionnelle T : vendeurs et biens vérifiés, acquéreurs qualifiés, engagement de confidentialité et offres d'achat signés en ligne.`,
    ...(b.contactEmail ? { email: b.contactEmail } : {}),
    address: postalAddress(l.adresse),
    areaServed: 'FR',
    identifier: [
      { '@type': 'PropertyValue', propertyID: 'SIREN', value: l.sirenDigits },
      { '@type': 'PropertyValue', propertyID: 'Carte professionnelle T', value: l.carteT },
    ],
    hasCredential: {
      '@type': 'EducationalOccupationalCredential',
      name: `Carte professionnelle T n° ${l.carteT}`,
      credentialCategory: `Carte professionnelle (loi n° 70-9 du 2 janvier 1970) — ${l.carteTActivity}`,
      recognizedBy: { '@type': 'Organization', name: l.carteTIssuer },
    },
    brand: { '@type': 'Brand', name: b.name },
  };
};

// Site web (la page d'accueil est la liste des annonces)
export const websiteLd = (site, brand) => {
  const b = { ...FALLBACK_BRAND, ...(brand || {}) };
  return {
    '@context': CTX,
    '@type': 'WebSite',
    '@id': `${site}/#website`,
    name: b.name,
    url: `${site}/`,
    inLanguage: 'fr-FR',
    publisher: { '@id': `${site}/#organization` },
  };
};

// items : [{ name, path }] — le premier élément est généralement l'accueil
export const breadcrumbLd = (site, items) => ({
  '@context': CTX,
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: `${site}${it.path}`,
  })),
});

// Annonces de la page affichée (données dynamiques, côté React uniquement) : [{ name, path }]
export const itemListLd = (site, items) => ({
  '@context': CTX,
  '@type': 'ItemList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    url: `${site}${it.path}`,
  })),
});
