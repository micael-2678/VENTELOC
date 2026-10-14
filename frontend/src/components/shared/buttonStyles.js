// Classes des boutons de la coque et de la page des annonces, entièrement en utilitaires Tailwind : les anciennes
// règles .btn-primary / .btn-secondary / .badge de src/App.css (chargées après index.css) écraseraient sinon les
// marges et couleurs voulues (voir HANDOFF-modetest-app-annonces.md).
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2';
const BASE = `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-60 disabled:pointer-events-none ${FOCUS}`;

export const BTN_PRIMARY = `${BASE} bg-brand-navy text-white hover:bg-brand-navy-light`;
export const BTN_SECONDARY = `${BASE} border border-brand-navy bg-white text-brand-navy hover:bg-brand-surface`;
export const BTN_QUIET = `${BASE} border border-brand-line bg-white text-brand-navy hover:border-brand-navy/40`;
// Pastille (badge) : mêmes proportions que .badge de index.css
export const PILL = 'inline-flex items-center gap-1 max-w-full rounded-full px-2.5 py-0.5 text-xs font-medium';
