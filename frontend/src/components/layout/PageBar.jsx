import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// Bandeau de page sous l'en-tête commun (AppHeader) des espaces connectés : lien ou bouton de retour, titre de la page
// et actions propres à la page (« Brouillon enregistré », etc.). Statique, sans débordement mobile (titre tronqué,
// libellé du retour masqué sous 640 px).
const backClass = 'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-600 hover:text-brand-navy hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue shrink-0';

const PageBar = ({ backTo, onBack, backLabel = 'Retour', title, children, width = 'max-w-7xl', testId = 'page-bar' }) => {
  const back = (
    <>
      <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{backLabel}</span>
    </>
  );
  return (
    <div className="bg-white border-b border-brand-line" data-testid={testId}>
      <div className={`${width} mx-auto px-4 sm:px-6 py-2 flex items-center gap-2 sm:gap-3 min-w-0`}>
        {backTo && <Link to={backTo} className={backClass} data-testid="back-btn">{back}</Link>}
        {!backTo && onBack && <button type="button" onClick={onBack} className={backClass} data-testid="back-btn">{back}</button>}
        {(backTo || onBack) && title && <span className="h-5 w-px bg-brand-line shrink-0" aria-hidden="true" />}
        {title && <p className="font-display text-base sm:text-lg font-bold text-brand-navy truncate min-w-0">{title}</p>}
        {children && <div className="ml-auto flex items-center gap-2 shrink-0">{children}</div>}
      </div>
    </div>
  );
};

export default PageBar;
