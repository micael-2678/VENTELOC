import { Building2, ShieldCheck, Clock, CalendarDays, MapPin, Users } from 'lucide-react';
import { formatDateFr } from '@/components/shared/formatters';
import { cn } from '@/lib/utils';

// Ce que l'open data et la liste ADEME disent d'un SIRET (préremplissage de l'estimateur, de l'inscription et
// de l'annonce). Lecture seule ; `result` vient de useCompanyLookup / normalizeCompanyLookup.
const Row = ({ icon: Icon, label, children }) => (
  <div className="flex items-start gap-2 min-w-0">
    <Icon className="w-4 h-4 mt-0.5 text-gray-500 shrink-0" aria-hidden="true" />
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-brand-navy break-words">{children}</dd>
    </div>
  </div>
);

export const RgeQualificationList = ({ qualifications, compact = false }) => (
  <ul className={cn('space-y-1.5', compact && 'text-sm')} data-testid="rge-qualifications">
    {qualifications.map((q, i) => (
      <li key={`${q.name}-${q.organisme}-${q.dateFin || i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
        <span className="font-medium text-brand-navy break-words">{q.name}</span>
        {q.organisme && <span className="text-sm text-gray-600">· {q.organisme}</span>}
        {q.dateFin && <span className="text-sm text-gray-600 tabular">· valable jusqu'au {formatDateFr(q.dateFin) || q.dateFin}</span>}
      </li>
    ))}
  </ul>
);

const CompanyPrefillCard = ({ result, className = '', showRge = true, title = 'Votre entreprise d\'après les bases publiques' }) => {
  if (!result) return null;
  const { company, rge } = result;
  const etatLabel = company.etat ? (company.sirenActive === false || /cess|ferm/i.test(company.etat) ? 'Cessée' : 'En activité') : '';

  return (
    <section className={cn('rounded-2xl border border-brand-line bg-brand-surface p-4 sm:p-5 min-w-0', className)} aria-label={title} data-testid="company-prefill">
      <div className="flex items-start gap-3 min-w-0">
        <span className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-white border border-brand-line text-brand-navy" aria-hidden="true">
          <Building2 className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{title}</p>
          {company.found ? (
            <>
              <p className="font-display text-lg font-bold text-brand-navy leading-snug break-words mt-0.5">{company.name}</p>
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {company.nafLabel && <Row icon={Building2} label={`Activité${company.naf ? ` (NAF ${company.naf})` : ''}`}>{company.nafLabel}</Row>}
                {company.creationDate && <Row icon={CalendarDays} label="Création">{formatDateFr(company.creationDate) || company.creationDate}</Row>}
                {(company.staffLabel || company.staffCount !== null) && (
                  <Row icon={Users} label="Effectif">{company.staffLabel || `${company.staffCount} salarié${company.staffCount > 1 ? 's' : ''}`}</Row>
                )}
                {(company.departmentLabel || company.department || company.region) && (
                  <Row icon={MapPin} label="Localisation">
                    {[company.departmentLabel ? `${company.departmentLabel}${company.department ? ` (${company.department})` : ''}` : company.department, company.region].filter(Boolean).join(' · ')}
                  </Row>
                )}
              </dl>
              {etatLabel && (
                <p className="mt-2">
                  <span className={cn('badge', etatLabel === 'En activité' ? 'badge-verified' : 'badge-warning')}>{etatLabel}</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-700 mt-1 leading-relaxed">
              {company.available
                ? "Ce SIRET n'apparaît pas dans l'annuaire des entreprises. Vous pouvez continuer : les informations seront saisies à la main."
                : "L'annuaire des entreprises n'a pas répondu : vérification différée, vous pouvez continuer sans attendre."}
            </p>
          )}
        </div>
      </div>

      {showRge && (
        <div className="mt-4 pt-4 border-t border-brand-line min-w-0" data-testid="company-prefill-rge">
          {rge.found && rge.qualifications.length > 0 ? (
            <>
              <p className="flex flex-wrap items-center gap-2 mb-2">
                <span className="badge badge-verified"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />RGE vérifié ADEME</span>
                <span className="text-xs text-gray-500">{rge.qualifications.length} qualification{rge.qualifications.length > 1 ? 's' : ''} lue{rge.qualifications.length > 1 ? 's' : ''} sur la liste publique</span>
              </p>
              <RgeQualificationList qualifications={rge.qualifications} compact />
            </>
          ) : rge.available ? (
            <p className="text-sm text-gray-700 leading-relaxed">
              <span className="badge badge-declared mr-2">Non RGE</span>
              Aucune qualification RGE sur la liste ADEME pour ce SIRET. Ce n'est pas bloquant : toutes les entreprises du bâtiment sont les bienvenues.
            </p>
          ) : (
            <p className="text-sm text-brand-amber leading-relaxed flex items-start gap-2">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>Vérification RGE différée : la base ADEME n'a pas répondu. Vos qualifications seront contrôlées plus tard, sans vous bloquer.</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default CompanyPrefillCard;
