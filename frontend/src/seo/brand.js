// Pictogramme de la marque (maison + clé : un bien loué qui change de propriétaire), partagé par le composant Logo,
// le pré-rendu (scripts/prerender.mjs) et les favicons (public/favicon.svg). Pas d'import : chargé sans bundler.
// Couleurs : fond navy #0b1220, maison blanche, clé teal (#2dd4bf, lisible sur fond sombre ; l'action du site est
// #0f766e).
export const LOGO_MARK_PATHS =
  '<rect width="32" height="32" rx="8" fill="#0b1220"/>' +
  '<path d="M6.3 15.1 16 7.4l9.7 7.7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M9.1 13.3v10.6h13.8V13.3" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="13.1" cy="18.6" r="2.3" fill="none" stroke="#2dd4bf" stroke-width="1.8"/>' +
  '<path d="M15.4 18.6h5.2M18.6 18.6v2M20.6 18.6v1.5" fill="none" stroke="#2dd4bf" stroke-width="1.8" stroke-linecap="round"/>';

export const logoMarkSvg = (size = 32, className = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"${className ? ` class="${className}"` : ''} aria-hidden="true" focusable="false">${LOGO_MARK_PATHS}</svg>`;
