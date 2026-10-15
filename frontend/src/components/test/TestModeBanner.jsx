import { Link, useLocation } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { useTestMode } from '@/lib/testMode';

// Bandeau du mode test (MODE-TEST.md §3) : une ligne ambre en haut de toutes les pages, non collante.
// Avec la clé du panneau (ou sans clé exigée) : message complet et lien vers le panneau /test. Sans la clé (visiteur
// venu du site WordPress pendant l'essai) : « annonces fictives » seulement, sans lien. Rien hors mode test.
const TestModeBanner = () => {
  const { testMode, panelAccess } = useTestMode();
  const { pathname } = useLocation();
  if (!testMode) return null;
  const onPanel = pathname === '/test';
  if (!panelAccess) {
    return (
      <div role="region" aria-label="Mode test" className="bg-brand-amber-soft border-b border-brand-amber/30 text-brand-navy" data-testid="test-mode-banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-2 min-w-0 text-sm leading-snug">
          <FlaskConical className="w-4 h-4 shrink-0 text-brand-amber" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate">
            <strong className="font-semibold">Mode test</strong> : annonces fictives
            <span className="hidden sm:inline">, documents sans valeur juridique</span>.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      role="region"
      aria-label="Mode test"
      className="bg-brand-amber-soft border-b border-brand-amber/30 text-brand-navy"
      data-testid="test-mode-banner"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-2 min-w-0 text-sm leading-snug">
        <FlaskConical className="w-4 h-4 shrink-0 text-brand-amber" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate">
          <strong className="font-semibold">Mode test</strong>
          <span className="hidden sm:inline"> : identité simulée, e-mails dans la boîte de test, documents sans valeur juridique.</span>
          <span className="sm:hidden"> : rien n'est réel.</span>
        </p>
        {!onPanel && (
          <Link
            to="/test"
            className="shrink-0 font-semibold underline underline-offset-2 hover:text-brand-amber rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            data-testid="test-mode-banner-link"
          >
            Panneau de test
          </Link>
        )}
      </div>
    </div>
  );
};

export default TestModeBanner;
