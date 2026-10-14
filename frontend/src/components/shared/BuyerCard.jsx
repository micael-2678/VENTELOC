import { Briefcase, BadgeCheck, MapPin, Wrench, Clock, Euro } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as ref from '@/lib/referentiels';
import { formatPrice } from './formatters';

// Carte repreneur pseudonymisée (SPEC §4.3 point 4) : ce que le cédant voit d'un repreneur avant la révélation
// des identités. Jamais de nom, d'e-mail ni de téléphone : projet, budget, apport, financement, zones, métiers,
// horizon, société vérifiée (SIREN) et score de profil.

export const PROJECT_TYPES = {
  'reprise-individuelle': 'Reprise individuelle',
  'croissance-externe': 'Croissance externe (entreprise du secteur)',
  'groupe-investisseur': 'Groupe ou investisseur',
  autre: 'Autre projet',
};

export const FINANCING = {
  'fonds-propres': 'Fonds propres',
  emprunt: 'Emprunt bancaire',
  mixte: 'Apport et emprunt',
  'a-definir': 'À définir',
};

export const HORIZONS = {
  '0-6': 'Sous 6 mois',
  '6-12': 'Dans 6 à 12 mois',
  '12+': 'Dans plus de 12 mois',
};

const labelOf = (table, value, fallback = 'Non renseigné') => {
  const key = String(value == null ? '' : value).trim();
  return table[key] || (key ? key : fallback);
};

const tradeLabel = (id) => {
  try {
    const l = typeof ref.tradeLabel === 'function' ? ref.tradeLabel(id, true) : '';
    return l || String(id || '');
  } catch (e) {
    return String(id || '');
  }
};

const listText = (values, map) => {
  const arr = Array.isArray(values) ? values.map(map).filter(Boolean) : [];
  return arr.length ? arr.join(', ') : '';
};

const scoreTone = (score) => {
  if (score >= 70) return 'bg-brand-navy';
  if (score >= 40) return 'bg-brand-blue';
  return 'bg-brand-amber';
};

const Row = ({ icon: Icon, label, children }) => (
  <div className="flex items-start gap-2 min-w-0">
    <Icon className="w-4 h-4 mt-0.5 text-gray-500 shrink-0" aria-hidden="true" />
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-brand-navy break-words">{children}</dd>
    </div>
  </div>
);

const BuyerCard = ({ buyer, message, title = 'Projet de reprise', className = '', compact = false, children }) => {
  const b = buyer || {};
  const zones = listText(b.zones, (z) => String(z || ''));
  const trades = listText(b.trades, tradeLabel);
  const score = Number.isFinite(Number(b.profile_score)) ? Math.max(0, Math.min(100, Math.round(Number(b.profile_score)))) : null;
  const verified = b.siren_verified === true;
  const hasCompany = Boolean(b.company_name || b.siren);

  return (
    <article className={cn('card min-w-0', compact ? 'p-4' : 'p-5 sm:p-6', className)} data-testid="buyer-card">
      <header className="flex flex-wrap items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="eyebrow">Carte repreneur</p>
          <h3 className="font-display text-lg font-bold text-brand-navy leading-snug break-words">{title}</h3>
          <p className="text-sm text-gray-600">{labelOf(PROJECT_TYPES, b.project_type)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {verified && (
            <span className="badge badge-verified">
              <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Société vérifiée
            </span>
          )}
          {!verified && hasCompany && <span className="badge badge-declared">Société déclarée</span>}
          {b.email_verified === true && <span className="badge badge-declared">E-mail confirmé</span>}
        </div>
      </header>

      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <Row icon={Euro} label="Budget maximum">{formatPrice(b.budget_max)}</Row>
        <Row icon={Euro} label="Apport personnel">{formatPrice(b.apport)}</Row>
        <Row icon={Briefcase} label="Financement">{labelOf(FINANCING, b.financing)}</Row>
        <Row icon={Clock} label="Horizon">{labelOf(HORIZONS, b.horizon)}</Row>
        <Row icon={MapPin} label="Zones recherchées">{zones || 'Toute la France'}</Row>
        <Row icon={Wrench} label="Métiers recherchés">{trades || 'Tous les métiers du bâtiment'}</Row>
      </dl>

      {b.experience && (
        <p className="mt-4 text-sm text-gray-700 leading-relaxed break-words">
          <span className="font-semibold text-brand-navy">Expérience : </span>{String(b.experience)}
        </p>
      )}

      {score !== null && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
            <span>Profil complété</span>
            <span className="font-semibold text-brand-navy tabular">{score} %</span>
          </div>
          <div
            role="meter"
            aria-label="Profil complété"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            className="h-2 w-full rounded-full bg-brand-surface border border-brand-line overflow-hidden"
          >
            <div className={cn('h-full rounded-full', scoreTone(score))} style={{ width: `${score}%` }} />
          </div>
        </div>
      )}

      {message && (
        <blockquote className="mt-4 rounded-xl bg-brand-surface border border-brand-line p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-line break-words">
          {String(message)}
        </blockquote>
      )}

      {children && <div className="mt-4">{children}</div>}
    </article>
  );
};

export default BuyerCard;
