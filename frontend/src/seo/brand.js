// Marque : logo AlterEgo (public/brand/logo-alterego-noir.png sur papier, blanc, sable ; -blanc.png sur encre ;
// jamais recoloré, déformé ni posé sur une photo) suivi du nom du service. Le pictogramme ci-dessous ne sert qu'aux
// favicons et aux emplacements trop petits pour le logo : carré encre, maison au trait (pictogramme de la charte) et
// point brique, rappel du point final du logo. Pas d'import : chargé sans bundler (pré-rendu, favicons).
export const LOGO_SRC = { dark: '/brand/logo-alterego-noir.png', light: '/brand/logo-alterego-blanc.png' };
// Dimensions du fichier (rapport conservé : hauteur affichée × 463 / 128)
export const LOGO_RATIO = 463 / 128;

export const LOGO_MARK_PATHS =
  '<rect width="32" height="32" rx="8" fill="#141413"/>' +
  '<g transform="translate(15 16.5) scale(0.82)" fill="none" stroke="#fbf8f3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M-10 -1 L0 -10 L10 -1"/><path d="M-7 -3 V9 H7 V-3"/><path d="M-2 9 V3 H2 V9"/></g>' +
  '<circle cx="25.5" cy="24.5" r="2.4" fill="#b94e33"/>';

export const logoMarkSvg = (size = 32, className = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"${className ? ` class="${className}"` : ''} aria-hidden="true" focusable="false">${LOGO_MARK_PATHS}</svg>`;
