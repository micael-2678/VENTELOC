import { cn } from '@/lib/utils';
import { SCORE_CONTACT_MIN, SCORE_AUTO_ACCEPT_MIN } from './profileScore';

// « Profil complet à 80 % » : jauge + ce qu'elle ouvre (contact dès 40 %, acceptation automatique dès 50 %).
const tone = (score) => (score >= 70 ? 'bg-brand-navy' : score >= SCORE_CONTACT_MIN ? 'bg-brand-blue' : 'bg-brand-amber');

const ScoreMeter = ({ score, missing = [], className = '', compact = false }) => {
  const s = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const next = missing.filter((m) => m.key !== 'siren_verified');
  return (
    <div className={cn('rounded-2xl border border-brand-line bg-white p-4 min-w-0', className)} data-testid="profile-score">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display font-bold text-brand-navy">
          {s > 0 ? <>Profil complet à <span className="tabular" data-testid="profile-score-value">{s} %</span></> : <span data-testid="profile-score-value">Profil de projet à compléter</span>}
        </p>
        <p className={cn('text-xs font-semibold shrink-0', s >= SCORE_CONTACT_MIN ? 'text-brand-green-dark' : 'text-brand-amber')}>
          {s >= SCORE_AUTO_ACCEPT_MIN ? 'Dossiers acceptés automatiquement' : s >= SCORE_CONTACT_MIN ? 'Contact possible' : `Contact dès ${SCORE_CONTACT_MIN} %`}
        </p>
      </div>
      <div role="meter" aria-label="Profil complété" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s}
        className="relative mt-2 h-2.5 w-full rounded-full bg-brand-surface border border-brand-line overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', tone(s))} style={{ width: `${s}%` }} />
        <span className="absolute inset-y-0 w-px bg-brand-navy/40" style={{ left: `${SCORE_CONTACT_MIN}%` }} aria-hidden="true" />
        <span className="absolute inset-y-0 w-px bg-brand-navy/40" style={{ left: `${SCORE_AUTO_ACCEPT_MIN}%` }} aria-hidden="true" />
      </div>
      {!compact && (
        <p className="text-xs text-gray-600 mt-2 leading-relaxed">
          À partir de {SCORE_CONTACT_MIN} % vous pouvez contacter un cédant ; à partir de {SCORE_AUTO_ACCEPT_MIN} %, les cédants qui l'ont choisi acceptent votre demande de dossier automatiquement.
          {next.length > 0 && (
            <> Pour progresser : {next.slice(0, 3).map((m) => `${m.label.toLowerCase()} (+${m.points})`).join(', ')}.</>
          )}
          {missing.some((m) => m.key === 'siren_verified') && <> Un SIREN vérifié sur l'open data ajoute 10 % après l'enregistrement.</>}
        </p>
      )}
    </div>
  );
};

export default ScoreMeter;
