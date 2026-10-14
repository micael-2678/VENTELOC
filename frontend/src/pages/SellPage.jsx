import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, Calculator, CalendarCheck, ChevronDown, FileSignature, FolderLock, Handshake, KeyRound, Lock, ShieldCheck,
  TrendingUp, UserCheck, Users,
} from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { useSession } from '@/components/layout/session';
import { depositPathFor } from '@/components/layout/AppHeader';
import { Breadcrumbs, RichText, fillText } from '@/components/seo/Content';
import { useSeo, SITE_URL } from '@/lib/seo';
import { content } from '@/seo';
import { breadcrumbLd } from '@/seo/schema';
import { COMMISSION, computeCommission, commissionRows, commissionSentenceFor, formatEuros, formatPercent } from '@/lib/offer';
import { useCommission } from '@/lib/useCommission';
import { trackEvent } from '@/lib/analytics';

// /vendre (docs/venteloc/SPEC.md §5.1) : page « vendeur » de l'application. Pourquoi vendre loué, ce que fait la
// plateforme, ce que vous ne payez pas (honoraires TTC puis HT, calculateur), sécurité, FAQ (5 questions), puis
// « Estimer mon bien » (/estimer) et « Déposer mon annonce » (/register?role=seller, ou /seller/create si vendeur
// connecté). Textes dans src/seo/content.json (sell) ; le pré-rendu reproduit la même page (H1, intro, FAQ).

const PATH = '/vendre';
const WHY_ICONS = [CalendarCheck, TrendingUp, KeyRound];
const DO_ICONS = [BadgeCheck, Users, FileSignature, FolderLock, Handshake];

// FAQPage JSON-LD (questions et réponses en texte brut)
export const faqLd = (faq) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: fillText(f.a).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') },
  })),
});

// Calculateur d'honoraires : prix de vente → honoraires TTC (HT) et montant perçu
export const FeesCalculator = ({ cfg }) => {
  const id = useId();
  const [price, setPrice] = useState(String(COMMISSION.examplePrice));
  const p = Number(String(price).replace(/\D/g, '')) || 0;
  const c = computeCommission(p, cfg);
  return (
    <div className="rounded-2xl border border-brand-line bg-white p-5 min-w-0" data-testid="fees-calculator">
      <label htmlFor={`${id}-price`} className="block text-sm font-semibold text-brand-navy mb-1">Prix de vente de votre bien</label>
      <div className="relative">
        <input
          id={`${id}-price`}
          type="text"
          inputMode="numeric"
          value={p ? p.toLocaleString('fr-FR') : ''}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, '').slice(0, 9))}
          className="w-full rounded-xl border border-brand-line bg-white px-4 py-3 pr-10 text-brand-navy tabular focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
          data-testid="fees-price-input"
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true">€</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3" aria-live="polite">
        <div className="rounded-xl bg-brand-teal-soft border border-brand-teal-line/70 p-3 min-w-0">
          <dt className="text-xs font-medium text-brand-teal-dark">Honoraires TTC, à l'acte</dt>
          <dd className="font-display text-xl font-extrabold text-brand-teal-dark tabular" data-testid="fees-ttc">{p ? formatEuros(c.ttc) : '—'}</dd>
          <dd className="text-xs text-gray-700 tabular" data-testid="fees-ht">{p ? `soit ${formatEuros(c.ht)} HT` : ''}</dd>
        </div>
        <div className="rounded-xl bg-brand-surface border border-brand-line p-3 min-w-0">
          <dt className="text-xs font-medium text-gray-600">Vous percevez</dt>
          <dd className="font-display text-xl font-extrabold text-brand-navy tabular" data-testid="fees-net">{p ? formatEuros(c.netSeller) : '—'}</dd>
          <dd className="text-xs text-gray-600">avant vos autres frais</dd>
        </div>
      </dl>
      {p > 0 && c.appliedMinimum && <p className="text-xs text-gray-600 mt-2" data-testid="fees-minimum">Minimum de {formatEuros(c.minimumTTC)} TTC appliqué.</p>}
      {p > 0 && !c.appliedMinimum && <p className="text-xs text-gray-600 mt-2">Soit {formatPercent(c.effectivePercentTTC)} TTC du prix, réglés par le notaire sur le prix le jour de l'acte.</p>}
    </div>
  );
};

const FaqItem = ({ item, index }) => {
  const [open, setOpen] = useState(index === 0);
  const id = useId();
  return (
    <li className="border-b border-brand-line last:border-b-0">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${id}-answer`}
          className="w-full flex items-center justify-between gap-3 py-4 text-left font-semibold text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal rounded"
        >
          {item.q}
          <ChevronDown className={`w-5 h-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </h3>
      {open && <p id={`${id}-answer`} className="pb-4 text-gray-700 leading-relaxed"><RichText text={item.a} /></p>}
    </li>
  );
};

const SellPage = ({ user: userProp }) => {
  const session = useSession();
  const user = userProp !== undefined ? userProp : session.user;
  const cfg = useCommission();
  const page = content.sell;
  const crumbs = [{ name: 'Accueil', path: '/' }, { name: 'Vendre un bien loué', path: PATH }];
  useSeo(fillText(page.title), fillText(page.description), { path: PATH, jsonLd: [breadcrumbLd(SITE_URL, crumbs), faqLd(page.faq)] });
  const depositTo = depositPathFor(user);
  const isBuyer = user && user.role !== 'seller';

  const ctas = (where) => (
    <div className="flex flex-col sm:flex-row gap-3">
      <Link to="/estimer" onClick={() => trackEvent('hero_cta_seller', { cta: `sell_estimate_${where}` })} className="btn-secondary" data-testid={`sell-estimate-${where}`}>
        <Calculator className="w-4 h-4" aria-hidden="true" />{page.ctaEstimate}
      </Link>
      {!isBuyer && (
        <Link to={depositTo} onClick={() => trackEvent('hero_cta_seller', { cta: `sell_deposit_${where}` })} className="btn-primary" data-testid={`sell-deposit-${where}`}>
          {page.ctaDeposit}<ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );

  return (
    <AppLayout user={user} className="bg-brand-surface">
      <section className="bg-white border-b border-brand-line pt-8 pb-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 min-w-0">
          <Breadcrumbs items={crumbs} />
          <p className="eyebrow mb-2">Propriétaires bailleurs</p>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy leading-tight tracking-tight" data-testid="sell-h1">{page.h1}</h1>
          <p className="text-lg text-gray-700 mt-3 leading-relaxed max-w-3xl">{fillText(page.intro)}</p>
          <div className="mt-6">{ctas('hero')}</div>
          {isBuyer && <p className="mt-3 text-sm text-gray-600">Vous êtes connecté avec un compte acquéreur : pour vendre, créez un compte vendeur distinct.</p>}
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-12 min-w-0">
        <section aria-labelledby="why-title">
          <h2 id="why-title" className="section-title mb-5">{page.whyTitle}</h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {page.why.map((w, i) => {
              const Icon = WHY_ICONS[i] || KeyRound;
              return (
                <li key={w.title} className="card p-5 min-w-0">
                  <Icon className="w-6 h-6 text-brand-teal mb-3" aria-hidden="true" />
                  <h3 className="font-display text-lg font-bold text-brand-navy">{w.title}</h3>
                  <p className="text-sm text-gray-700 mt-1 leading-relaxed">{w.text}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="do-title">
          <h2 id="do-title" className="section-title mb-5">{fillText(page.doTitle)}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {page.do.map((d, i) => {
              const Icon = DO_ICONS[i] || ShieldCheck;
              return (
                <li key={d} className="flex items-start gap-3 rounded-2xl border border-brand-line bg-white p-4 min-w-0">
                  <Icon className="w-5 h-5 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true" />
                  <span className="text-gray-800 leading-relaxed"><RichText text={d} /></span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="cost-title" className="grid lg:grid-cols-[3fr_2fr] gap-6 items-start" data-testid="sell-costs">
          <div className="min-w-0">
            <h2 id="cost-title" className="section-title mb-3">{page.costTitle}</h2>
            <p className="text-gray-700 leading-relaxed">{page.costIntro}</p>
            <dl className="mt-5 divide-y divide-brand-line rounded-2xl border border-brand-line bg-white" data-testid="commission-rows">
              {commissionRows(cfg).map((r) => (
                <div key={r.label} className="flex flex-col sm:flex-row sm:justify-between gap-1 px-4 py-3 min-w-0">
                  <dt className="text-sm text-gray-600">{r.label}</dt>
                  <dd className="text-sm font-semibold text-brand-navy tabular sm:text-right break-words">{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-gray-600 mt-3 leading-relaxed" data-testid="commission-sentence">{commissionSentenceFor(cfg)}</p>
          </div>
          <FeesCalculator cfg={cfg} />
        </section>

        <section aria-labelledby="security-title">
          <h2 id="security-title" className="section-title mb-5">{page.securityTitle}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {page.security.map((s, i) => (
              <li key={s} className="flex items-start gap-3 rounded-2xl border border-brand-line bg-white p-4 min-w-0">
                {i === 0 ? <ShieldCheck className="w-5 h-5 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true" /> : i === 2 ? <Lock className="w-5 h-5 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true" /> : <UserCheck className="w-5 h-5 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true" />}
                <span className="text-sm text-gray-800 leading-relaxed break-words">{fillText(s)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="faq-title" data-testid="sell-faq">
          <h2 id="faq-title" className="section-title mb-3">{page.faqTitle}</h2>
          <ul className="rounded-2xl border border-brand-line bg-white px-4 sm:px-6">
            {page.faq.map((f, i) => <FaqItem key={f.q} item={f} index={i} />)}
          </ul>
        </section>

        <section aria-labelledby="cta-title" className="rounded-2xl bg-brand-navy text-white p-6 sm:p-8 min-w-0">
          <h2 id="cta-title" className="font-display text-2xl font-bold">{page.ctaTitle}</h2>
          <p className="text-gray-200 mt-2 leading-relaxed max-w-2xl">{page.ctaText}</p>
          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <Link to="/estimer" className="btn-secondary border-white" data-testid="sell-estimate-bottom"><Calculator className="w-4 h-4" aria-hidden="true" />{page.ctaEstimate}</Link>
            {!isBuyer && <Link to={depositTo} className="btn-primary" data-testid="sell-deposit-bottom">{page.ctaDeposit}<ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>}
          </div>
        </section>
      </div>
    </AppLayout>
  );
};

export default SellPage;
