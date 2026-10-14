import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Send, Loader2, CheckCircle } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { ArticleSections, Breadcrumbs, RichText, Toc, fillText } from '@/components/seo/Content';
import { useLegalInfo } from '@/components/seo/useLegalInfo';
import { useSeo, SITE_URL } from '@/lib/seo';
import { BRAND } from '@/lib/brand';
import { content } from '@/seo';
import { formatDateFr, formatDateShort } from '@/seo/inline';
import { breadcrumbLd } from '@/seo/schema';
import { mentionsSections } from '@/seo/legal';

// Pages légales (SPEC §1 et §5.2) : mentions complètes (LEGAL + GET /public/legal-info), confidentialité avec
// durées réelles, CGU (modération, signalement, comptes, contenus), page /signaler. Textes dans
// src/seo/content.json ; le pré-rendu reproduit le même balisage. Plus aucun « à compléter ».

export { useLegalInfo };

const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const EVENTS_URL = `${BACKEND_URL}/api/events`;

const LegalShell = ({ user, page, children, updated, wide = false }) => {
  const crumbs = [{ name: 'Accueil', path: '/' }, { name: page.h1, path: page.path }];
  useSeo(fillText(page.title), fillText(page.description), { path: page.path, jsonLd: breadcrumbLd(SITE_URL, crumbs) });
  return (
    <AppLayout user={user}>
      <div className={`${wide ? 'max-w-4xl' : 'max-w-3xl'} mx-auto px-4 sm:px-6 py-10 sm:py-14 min-w-0`}>
        <Breadcrumbs items={crumbs} />
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy mb-4">{page.h1}</h1>
        {updated && (
          <p className="text-sm text-gray-600 mb-6" data-testid="legal-version">
            Version du <time dateTime={updated}>{formatDateShort(updated)}</time> · dernière mise à jour le {formatDateFr(updated)}
          </p>
        )}
        {children}
      </div>
    </AppLayout>
  );
};

export const MentionsLegalesPage = ({ user }) => {
  const page = content.legal.mentions;
  const raw = useLegalInfo();
  const sections = mentionsSections(raw, page.sections);
  return (
    <LegalShell user={user} page={page}>
      <div className="prose-cr" data-testid="mentions-legales">
        <ArticleSections sections={sections} legalInfo={raw} />
      </div>
    </LegalShell>
  );
};

export const PrivacyPage = ({ user }) => {
  const page = content.legal.privacy;
  const raw = useLegalInfo();
  return (
    <LegalShell user={user} page={page} updated={page.updated}>
      <div className="prose-cr" data-testid="privacy-policy">
        <p>{fillText(page.intro)}</p>
        <Toc sections={page.sections} />
        <ArticleSections sections={page.sections} legalInfo={raw} />
      </div>
    </LegalShell>
  );
};

export const CguPage = ({ user }) => {
  const page = content.legal.cgu;
  const raw = useLegalInfo();
  return (
    <LegalShell user={user} page={page} updated={page.updated}>
      <div className="prose-cr" data-testid="cgu">
        <p><RichText text={page.intro} /></p>
        <Toc sections={page.sections} />
        <ArticleSections sections={page.sections} legalInfo={raw} />
      </div>
    </LegalShell>
  );
};

// Signalement (CGU §7) : formulaire → POST /events {name:'report'} + lien e-mail prérempli en repli et en complément
const inputClass = 'w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30';

export const ReportPage = ({ user }) => {
  const page = content.legal.report;
  const idPrefix = useId();
  const [form, setForm] = useState({ reason: page.reasons[0].value, reference: '', description: '', email: '' });
  const [status, setStatus] = useState('idle'); // idle | sending | done | error
  const [validation, setValidation] = useState('');

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const reasonLabel = (page.reasons.find((r) => r.value === form.reason) || page.reasons[0]).label;
  const mailBody = [`Motif : ${reasonLabel}`, `Référence : ${form.reference || '—'}`, '', form.description, '', form.email ? `Contact : ${form.email}` : ''].join('\n');
  const mailto = `mailto:${BRAND.contactEmail}?subject=${encodeURIComponent(page.mailSubject)}&body=${encodeURIComponent(mailBody)}`;

  const submit = async (e) => {
    e.preventDefault();
    if (form.description.trim().length < 10) {
      setValidation('Décrivez le problème en quelques phrases (10 caractères au moins).');
      return;
    }
    setValidation('');
    setStatus('sending');
    try {
      const res = await fetch(EVENTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          name: 'report',
          path: page.path,
          props: {
            reason: form.reason,
            reference: form.reference.trim().slice(0, 500),
            description: form.description.trim().slice(0, 500),
            email: form.email.trim().slice(0, 200),
          },
        }),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch (err) {
      setStatus('error');
    }
  };

  return (
    <LegalShell user={user} page={page} wide>
      <p className="text-gray-700 leading-relaxed max-w-3xl mb-8">{fillText(page.intro)}</p>
      <div className="grid lg:grid-cols-[3fr_2fr] gap-8 items-start">
        {status === 'done' ? (
          <div className="card p-6 sm:p-8 min-w-0" role="status" data-testid="report-success">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-6 h-6 text-brand-green-dark shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-display text-xl font-bold text-brand-navy mb-2">{page.successTitle}</p>
                <p className="text-gray-600 leading-relaxed">{page.successText}</p>
                <a href={mailto} className="btn-secondary mt-5 py-2.5 text-sm"><Mail className="w-4 h-4" aria-hidden="true" />{page.mailto}</a>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="card p-6 sm:p-8 space-y-5 min-w-0" data-testid="report-form">
            <div>
              <label htmlFor={`${idPrefix}-reason`} className="block text-sm font-semibold text-brand-navy mb-1">{page.reasonLabel}</label>
              <select id={`${idPrefix}-reason`} name="reason" value={form.reason} onChange={update('reason')} className={inputClass}>
                {page.reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${idPrefix}-reference`} className="block text-sm font-semibold text-brand-navy mb-1">{page.referenceLabel}</label>
              <input id={`${idPrefix}-reference`} name="reference" type="text" value={form.reference} onChange={update('reference')} className={inputClass} aria-describedby={`${idPrefix}-reference-help`} />
              <p id={`${idPrefix}-reference-help`} className="text-sm text-gray-500 mt-1">{page.referenceHelp}</p>
            </div>
            <div>
              <label htmlFor={`${idPrefix}-description`} className="block text-sm font-semibold text-brand-navy mb-1">{page.descriptionLabel}</label>
              <textarea id={`${idPrefix}-description`} name="description" rows={5} value={form.description} onChange={update('description')} maxLength={500} required className={inputClass} aria-invalid={validation ? 'true' : undefined} aria-describedby={`${idPrefix}-description-help`} />
              <p id={`${idPrefix}-description-help`} className="text-sm text-gray-500 mt-1">{page.descriptionHelp} <span className="tabular">{form.description.length}/500</span></p>
            </div>
            <div>
              <label htmlFor={`${idPrefix}-email`} className="block text-sm font-semibold text-brand-navy mb-1">{page.emailLabel}</label>
              <input id={`${idPrefix}-email`} name="email" type="email" autoComplete="email" value={form.email} onChange={update('email')} className={inputClass} aria-describedby={`${idPrefix}-email-help`} />
              <p id={`${idPrefix}-email-help`} className="text-sm text-gray-500 mt-1">{page.emailHelp}</p>
            </div>
            {validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}
            {status === 'error' && (
              <p role="alert" className="text-sm text-brand-amber bg-brand-amber-soft border border-amber-200 rounded-xl px-4 py-3">{page.errorText}</p>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button type="submit" className="btn-primary py-3" disabled={status === 'sending'} data-testid="report-submit">
                {status === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                {page.submit}
              </button>
              <a href={mailto} className="btn-secondary py-3" data-testid="report-mailto"><Mail className="w-4 h-4" aria-hidden="true" />{page.mailto}</a>
            </div>
          </form>
        )}
        <aside className="card p-6 min-w-0">
          <h2 className="font-display text-lg font-bold text-brand-navy mb-3">{page.afterTitle}</h2>
          <ol className="space-y-3 text-sm text-gray-700 leading-relaxed">
            {page.after.map((t, i) => (
              <li key={t} className="flex gap-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-navy text-white text-xs font-bold tabular shrink-0" aria-hidden="true">{i + 1}</span>
                <span><RichText text={t} /></span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-gray-600 mt-5">
            Les règles de modération sont décrites dans les <Link to="/cgu" className="underline underline-offset-2 hover:text-brand-navy">conditions générales d&apos;utilisation</Link>.
          </p>
        </aside>
      </div>
    </LegalShell>
  );
};
