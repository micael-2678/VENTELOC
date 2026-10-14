import React from 'react';
import { trackEvent } from '@/lib/analytics';
import { BRAND } from '@/lib/brand';

// Garde-fou global (SPEC §7.4 et §7.6) : si un composant lève une erreur au rendu, l'utilisateur voit une
// page d'erreur en français avec un bouton « Recharger » au lieu d'un écran blanc, et l'erreur est
// comptée côté serveur (POST /api/events {name: 'front_error', props: {message}}) sans aucun prestataire.
// Monté dans src/index.js autour de <App/>, donc hors du routeur : liens en <a href>, pas <Link>.

const MAX_MESSAGE = 300;

const contactEmail = () => (BRAND && BRAND.contactEmail) || '';

export const reportFrontError = (error, info) => {
  const message = String((error && (error.message || error.toString())) || 'Erreur inconnue').slice(0, MAX_MESSAGE);
  const component = String((info && info.componentStack) || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0] || '';
  trackEvent('front_error', { message, component: component.slice(0, 120) });
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    try {
      reportFrontError(error, info);
    } catch (e) {
      // La remontée d'erreur ne doit jamais provoquer une seconde erreur
    }
    if (typeof this.props.onError === 'function') this.props.onError(error, info);
  }

  handleReload() {
    if (typeof window !== 'undefined' && window.location) window.location.reload();
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    const email = contactEmail();
    return (
      <main className="min-h-screen bg-brand-surface flex items-center justify-center px-4 py-12" data-testid="error-boundary">
        <div className="card w-full max-w-lg p-6 sm:p-8 text-center">
          <p className="eyebrow mb-3">Erreur d&apos;affichage</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-brand-navy mb-3">
            Cette page n&apos;a pas pu s&apos;afficher
          </h1>
          <p className="text-gray-600 mb-6 leading-relaxed">
            Un incident technique s&apos;est produit de notre côté ; il vient d&apos;être signalé à l&apos;équipe.
            Vos données ne sont pas perdues : rechargez la page pour reprendre où vous en étiez.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button type="button" className="btn-primary" onClick={this.handleReload}>
              Recharger la page
            </button>
            <a href="/" className="btn-secondary">
              Retour à l&apos;accueil
            </a>
          </div>
          {email && (
            <p className="text-sm text-gray-500 mt-6">
              Si le problème persiste, écrivez-nous :{' '}
              <a href={`mailto:${email}`} className="text-brand-blue font-semibold hover:underline">{email}</a>
            </p>
          )}
        </div>
      </main>
    );
  }
}

export default ErrorBoundary;
