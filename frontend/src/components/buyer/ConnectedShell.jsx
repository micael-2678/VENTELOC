import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import AppHeader from '@/components/layout/AppHeader';

// Gabarit des pages connectées du parcours repreneur, de la data room et de l'étape de vente (les deux rôles) :
// en-tête commun de l'application (AppHeader : Annonces, Messages, Mon espace, menu du compte), titre, lien de retour.
// Aucun débordement mobile : conteneur min-w-0.

const ConnectedShell = ({ user, setUser, title, eyebrow, backTo, backLabel = 'Retour', actions, children, wide = false }) => (
  <div className="min-h-screen bg-brand-surface">
    <AppHeader user={user} setUser={setUser} />

    <main id="contenu" className={`${wide ? 'max-w-7xl' : 'max-w-5xl'} mx-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0`}>
      {backTo && (
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-brand-navy mb-4" data-testid="back-link">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      {(title || actions) && (
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6 min-w-0">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
            {title && <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-navy tracking-tight break-words">{title}</h1>}
          </div>
          {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </main>
  </div>
);

export default ConnectedShell;
