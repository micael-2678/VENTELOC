import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { parseInline } from '@/seo/inline';
import { commissionRows, commissionSentenceFor } from '@/lib/offer';
import { editorLines, mergeLegal } from '@/seo/legal';
import { fillText } from '@/seo';

// Briques d'affichage des contenus éditoriaux (src/seo/content.json : pages légales, estimation, page Vendre).
// Le HTML statique du pré-rendu (scripts/prerender.mjs) reproduit ces mêmes structures et classes.
// Tous les textes passent par fillText : jetons d'offre ({{commissionSentence}}) et de marque ({{brand}}).

export { fillText };

export const RichText = ({ text }) => (
  <>
    {parseInline(fillText(text)).map((seg, i) => {
      if (seg.type === 'strong') return <strong key={i}>{seg.text}</strong>;
      if (seg.type === 'link') {
        return seg.href.startsWith('/')
          ? <Link key={i} to={seg.href}>{seg.text}</Link>
          : <a key={i} href={seg.href} rel="noopener">{seg.text}</a>;
      }
      return <span key={i}>{seg.text}</span>;
    })}
  </>
);

// items : [{ name, path }] — le dernier élément est la page courante
export const Breadcrumbs = ({ items, tone = 'dark' }) => (
  <nav aria-label="Fil d'Ariane" className="mb-4">
    <ol className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${tone === 'light' ? 'text-gray-300' : 'text-gray-500'}`}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <li key={it.path} className="flex items-center gap-2 min-w-0">
            {last ? (
              <span aria-current="page" className={tone === 'light' ? 'text-white' : 'text-gray-800'}>{it.name}</span>
            ) : (
              <>
                <Link to={it.path} className="hover:underline">{it.name}</Link>
                <span aria-hidden="true">›</span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

// Barème des honoraires (TTC d'abord) : liste de lignes, sans débordement mobile
export const CommissionTable = ({ cfg }) => (
  <div data-testid="commission-table">
    <ul className="not-prose space-y-2 mb-3">
      {commissionRows(cfg).map((r) => (
        <li key={r.label} className="rounded-xl border border-brand-line bg-brand-surface p-3 min-w-0">
          <p className="text-sm text-gray-600">{r.label}</p>
          <p className="font-semibold text-brand-navy tabular">{r.value}</p>
        </li>
      ))}
    </ul>
    <p className="text-sm text-gray-600 mt-2">{commissionSentenceFor(cfg)}</p>
  </div>
);

export const Toc = ({ sections }) => (
  <nav aria-label="Sommaire" className="rounded-2xl border border-brand-line bg-brand-surface p-5 mb-8">
    <p className="font-display font-bold text-brand-navy mb-2">Sommaire</p>
    <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700 marker:text-brand-teal">
      {sections.map((s) => (
        <li key={s.id}><a href={`#${s.id}`} className="hover:text-brand-teal hover:underline">{s.title}</a></li>
      ))}
    </ol>
  </nav>
);

// Marque et e-mail : l'API (SITE_NAME, LEGAL_EMAIL) prime, sinon lib/brand.js (jamais en dur dans les pages)
export const brandedLegal = (legalInfo) => ({
  ...(legalInfo || {}),
  marque: (legalInfo && legalInfo.marque) || BRAND.name,
  email: (legalInfo && legalInfo.email) || BRAND.contactEmail,
});

const LegalBlock = ({ kind, legalInfo }) => {
  const info = mergeLegal(brandedLegal(legalInfo));
  if (kind === 'controller') {
    return (
      <p>
        Le responsable du traitement est la société <strong>{info.denomination}</strong>
        {info.forme_juridique ? `, ${info.forme_juridique}` : ''}{info.adresse ? `, ${info.adresse}` : ''}, qui exploite la marque {info.marque}.
      </p>
    );
  }
  if (kind === 'contact' && info.email) {
    return (
      <p>Pour exercer vos droits ou pour toute question sur vos données, écrivez-nous à <a href={`mailto:${info.email}`}>{info.email}</a>.</p>
    );
  }
  if (kind === 'editor') {
    return (
      <ul>
        {editorLines(brandedLegal(legalInfo)).map((l) => (
          <li key={l.label}><strong>{l.label}</strong> : {l.href ? <a href={l.href}>{l.value}</a> : l.value}</li>
        ))}
      </ul>
    );
  }
  return null;
};

// Sections d'article : [{ id, title, blocks: [{p}|{h3}|{ul}|{ol}|{note}|{commissionTable}|{legal}] }]
export const ArticleSections = ({ sections, legalInfo }) => (
  <>
    {sections.map((s) => (
      <section key={s.id} aria-labelledby={s.id}>
        <h2 id={s.id}>{fillText(s.title)}</h2>
        {s.blocks.map((b, i) => {
          if (b.p) return <p key={i}><RichText text={b.p} /></p>;
          if (b.h3) return <h3 key={i}>{fillText(b.h3)}</h3>;
          if (b.ul) return <ul key={i}>{b.ul.map((li) => <li key={li}><RichText text={li} /></li>)}</ul>;
          if (b.ol) return <ol key={i}>{b.ol.map((li) => <li key={li}><RichText text={li} /></li>)}</ol>;
          if (b.note) {
            return (
              <p key={i} className="not-prose flex gap-3 rounded-xl border border-brand-teal-line bg-brand-teal-soft p-4 text-[0.95rem] text-gray-700">
                <Info className="w-5 h-5 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true" />
                <span><RichText text={b.note} /></span>
              </p>
            );
          }
          if (b.commissionTable) return <CommissionTable key={i} />;
          if (b.legal) return <LegalBlock key={i} kind={b.legal} legalInfo={legalInfo} />;
          return null;
        })}
      </section>
    ))}
  </>
);
