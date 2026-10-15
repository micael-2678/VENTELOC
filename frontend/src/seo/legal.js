// Mise en forme des informations légales (GET /api/public/legal-info), partagée par React et
// scripts/prerender.mjs. Pas d'import : fichier chargé sans bundler par le script.
// Plus aucune mention « à compléter » (SPEC §1) : chaque ligne a une valeur ou n'est pas affichée.

// Valeurs connues, utilisées tant que l'API n'a pas répondu (et au pré-rendu si l'API est injoignable).
// Mentions LCEN (art. 6-III et 19) : dénomination, siège, RCS, capital, directeur de la publication, téléphone,
// e-mail, n° de TVA. La présidente n'apparaît qu'aux mentions légales, comme directrice de la publication
// (obligation légale) ; aucune autre page ne nomme de personne physique.
// Téléphone : `telephone` de l'API (LEGAL_PHONE) sinon REACT_APP_LEGAL_PHONE au build ; n° de TVA : `tva` de
// l'API (LEGAL_TVA). Chacun n'est affiché que s'il est renseigné.
export const LEGAL_FALLBACK = {
  denomination: 'AlterEgo',
  forme_juridique: 'Société par actions simplifiée',
  capital: '2000',
  adresse: '43 rue Massenet, 78500 Sartrouville',
  rcs_ville: 'Versailles',
  siren: '952180230',
  carte_t: 'CPI 7801 2025 000 000 049',
  carte_t_valid_until: '28/07/2028',
  carte_t_issuer: 'CCI Paris Île-de-France',
  // Seule mention portée par la carte (l'API complète la liste si la carte en porte d'autres)
  carte_t_activities: ['Transactions sur immeubles et fonds de commerce'],
  representant: 'Romane DA SILVA RIBEIRO',
  // Accès littéral à process.env.REACT_APP_* : remplacé par CRA au build, fourni par le bac à sable du pré-rendu
  telephone: String(process.env.REACT_APP_LEGAL_PHONE || '').trim(),
  tva: String(process.env.REACT_APP_LEGAL_TVA || '').trim(),
  // Marque et e-mail de contact : fournis par l'API (GET /api/public/legal-info) ou par lib/brand.js
  // (les consommateurs passent BRAND.name / BRAND.contactEmail en surcharge : mergeLegal({ ...info, marque, email }))
  email: '',
  hebergeur: '',
  marque: '',
  // RC professionnelle (assureur + n° de police), médiateur de la consommation, mention loi Hoguet sur les fonds
  rc_pro: '',
  mediateur: '',
  fonds_mention: 'AlterEgo SAS déclare ne recevoir ni détenir d\'autres fonds, effets ou valeurs que ceux représentatifs de sa rémunération.',
};

export const RC_PRO_FALLBACK = 'RC professionnelle souscrite conformément à la loi Hoguet';

const clean = (v) => String(v == null ? '' : v).trim();

export const formatSiren = (v) => {
  const digits = clean(v).replace(/\s/g, '');
  return /^\d{9}$/.test(digits) ? digits.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : clean(v);
};

const formatCapital = (v) => {
  const s = clean(v);
  if (!s) return '';
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(n)) return s;
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
};

// « AlterEgo » → « AlterEgo SAS » (dénomination affichée avec sa forme abrégée)
export const legalDisplayName = (info) => {
  const i = mergeLegal(info);
  if (/\bSAS\b/i.test(i.denomination)) return i.denomination;
  return /par actions simplifiée/i.test(i.forme_juridique) ? `${i.denomination} SAS` : i.denomination;
};

export const mergeLegal = (info) => {
  const out = { ...LEGAL_FALLBACK };
  Object.keys(info || {}).forEach((k) => {
    if (Array.isArray(info[k])) {
      const list = info[k].map(clean).filter(Boolean);
      if (list.length) out[k] = list;
    } else if (clean(info[k])) out[k] = clean(info[k]);
  });
  // Une valeur volontairement vide côté API (ex. carte T non encore délivrée) reste vide
  // (capital et représentant légal sont des mentions LCEN obligatoires : une valeur vide garde la valeur connue)
  if (info && 'carte_t' in info) out.carte_t = clean(info.carte_t);
  if (info && 'hebergeur' in info) out.hebergeur = clean(info.hebergeur);
  // Téléphone : la clé `phone` est acceptée comme synonyme de `telephone`
  if (!clean(info && info.telephone) && clean(info && info.phone)) out.telephone = clean(info.phone);
  if (!/[.!]$/.test(out.fonds_mention)) out.fonds_mention = `${out.fonds_mention}.`;
  return out;
};

// RC professionnelle : assureur + n° de police si renseignés, sinon la mention légale
export const rcProText = (info) => clean(mergeLegal(info).rc_pro) || RC_PRO_FALLBACK;
// Médiateur de la consommation : '' s'il n'est pas renseigné (rien n'est affiché)
export const mediateurText = (info) => clean(mergeLegal(info).mediateur);

// « n° CPI … — Transactions sur immeubles et fonds de commerce — délivrée par la CCI…, valable jusqu'au … »
export const carteTText = (raw) => {
  const i = mergeLegal(raw);
  if (!i.carte_t) return '';
  const acts = Array.isArray(i.carte_t_activities) ? i.carte_t_activities.join(' ; ') : clean(i.carte_t_activities);
  const issued = [
    i.carte_t_issuer ? `délivrée par la ${i.carte_t_issuer}` : '',
    i.carte_t_valid_until ? `valable jusqu'au ${i.carte_t_valid_until}` : '',
  ].filter(Boolean).join(', ');
  return [`n° ${i.carte_t}`, acts, issued].filter(Boolean).join(' — ');
};

// Lignes « Éditeur » des mentions légales : [{ label, value, href? }], sans ligne vide.
export const editorLines = (raw) => {
  const i = mergeLegal(raw);
  const mediateur = mediateurText(raw);
  const lines = [
    { label: 'Dénomination sociale', value: legalDisplayName(raw) },
    { label: 'Forme juridique', value: i.forme_juridique },
    { label: 'Capital social', value: formatCapital(i.capital) },
    { label: 'Siège social', value: i.adresse },
    { label: 'Immatriculation', value: i.siren ? `RCS ${i.rcs_ville ? `${i.rcs_ville} ` : ''}${formatSiren(i.siren)}` : '' },
    { label: 'Carte professionnelle', value: carteTText(raw) },
    // Loi Hoguet : mention obligatoire sur les fonds détenus et assurance de responsabilité civile professionnelle
    { label: 'Fonds détenus', value: i.fonds_mention },
    { label: 'Responsabilité civile professionnelle', value: rcProText(raw) },
    { label: 'Médiateur de la consommation', value: mediateur },
    { label: 'Représentant légal', value: i.representant },
    { label: 'N° TVA intracommunautaire', value: i.tva },
    { label: 'Marque exploitée', value: i.marque },
    { label: 'Téléphone', value: i.telephone, href: i.telephone ? `tel:${i.telephone.replace(/[^\d+]/g, '')}` : '' },
    { label: 'Contact', value: i.email, href: i.email ? `mailto:${i.email}` : '' },
  ];
  return lines.filter((l) => l.value);
};

// Sections de la page « Mentions légales » : éditeur, directeur de la publication, hébergeur
// (si renseigné), médiation (si renseignée), puis sections fixes de content.json. Partagé par React et le pré-rendu.
export const mentionsSections = (raw, staticSections) => {
  const info = mergeLegal(raw);
  const name = legalDisplayName(raw);
  const mediateur = mediateurText(raw);
  return [
    { id: 'editeur', title: 'Éditeur', blocks: [{ legal: 'editor' }] },
    {
      id: 'publication',
      title: 'Direction de la publication',
      // Mention LCEN obligatoire (art. 6-III) : la présidente est directrice de la publication
      blocks: [{
        p: info.representant === LEGAL_FALLBACK.representant
          ? `${info.representant}, présidente de la société ${name}, directrice de la publication.`
          : `${info.representant}, représentant légal de la société ${name}, directeur de la publication.`,
      }],
    },
    ...(info.hebergeur ? [{ id: 'hebergement', title: 'Hébergement', blocks: [{ p: info.hebergeur }] }] : []),
    ...(mediateur ? [{
      id: 'mediation',
      title: 'Médiation de la consommation',
      blocks: [{ p: `Conformément aux articles L.611-1 et suivants du Code de la consommation, tout consommateur peut recourir gratuitement au médiateur de la consommation dont relève ${name}, après une réclamation écrite restée sans réponse satisfaisante : ${mediateur}.` }],
    }] : []),
    ...(staticSections || []),
  ];
};

// Bloc légal complet (SPEC §1) :
// dénomination, capital, siège, RCS, n° de TVA (si renseigné), carte T, mention sur les fonds, RC pro, médiateur.
export const footerLegalLines = (raw) => {
  const i = mergeLegal(raw || {});
  const capital = formatCapital(i.capital);
  const carteT = i.carte_t || LEGAL_FALLBACK.carte_t;
  const acts = (Array.isArray(i.carte_t_activities) ? i.carte_t_activities : [i.carte_t_activities]).map(clean).filter(Boolean).join(' ; ');
  const mediateur = mediateurText(raw);
  return [
    [
      legalDisplayName(raw),
      capital ? `capital ${capital}` : '',
      i.adresse,
      i.siren ? `RCS ${i.rcs_ville ? `${i.rcs_ville} ` : ''}${formatSiren(i.siren)}` : '',
      i.tva ? `TVA ${i.tva}` : '',
    ].filter(Boolean).join(' · '),
    `Carte professionnelle T n° ${carteT}${i.carte_t_issuer ? ` délivrée par la ${i.carte_t_issuer}` : ''}${acts ? ` — ${acts}` : ''}`,
    i.fonds_mention,
    rcProText(raw),
    ...(mediateur ? [`Médiateur de la consommation : ${mediateur}`] : []),
  ];
};

// Ligne légale du pied de page de l'application (SPEC.md §11), partagée par AppFooter et
// scripts/prerender.mjs : exploitant, RCS et carte professionnelle T sur une seule ligne.
export const footerShortLine = (raw) => {
  const i = mergeLegal(raw || {});
  const carteT = i.carte_t || LEGAL_FALLBACK.carte_t;
  return [
    legalDisplayName(raw),
    i.siren ? `RCS ${i.rcs_ville ? `${i.rcs_ville} ` : ''}${formatSiren(i.siren)}` : '',
    `carte professionnelle T n° ${carteT}${i.carte_t_issuer ? ` (${i.carte_t_issuer})` : ''}`,
  ].filter(Boolean).join(' · ');
};
