import { Link } from 'react-router-dom';
import { BRAND } from '@/lib/brand';
import content from '@/seo/content.json';
import { fillText } from '@/seo';
import { footerShortLine } from '@/seo/legal';
import { useLegalInfo } from '@/components/seo/useLegalInfo';

// Pied de page minimal de l'application (MODE-TEST-ET-APP.md §A.4) : liens légaux, contact, lien vers le site vitrine
// (REACT_APP_MARKETING_URL, facultatif) et, sur une ligne, l'exploitant (AlterEgo SAS, RCS) et sa carte T.
// Le pré-rendu (scripts/prerender.mjs) reproduit le même balisage.

// URL du site WordPress, seulement si c'est une adresse http(s) valide
export const marketingUrl = (value = process.env.REACT_APP_MARKETING_URL) => {
  const s = String(value || '').trim();
  return /^https?:\/\/[^\s"<>]+$/i.test(s) ? s.replace(/\/+$/, '') : '';
};

const linkClass = 'text-gray-600 hover:text-brand-navy hover:underline underline-offset-4';

const AppFooter = () => {
  const f = content.footer;
  const legalInfo = useLegalInfo();
  const site = marketingUrl();
  return (
    <footer className="bg-white border-t border-brand-line px-4 sm:px-6 py-6" data-testid="app-footer">
      <div className="max-w-7xl mx-auto min-w-0 space-y-3 text-sm">
        <nav aria-label="Informations légales">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {f.legal.map((l) => <li key={l.to}><Link to={l.to} className={linkClass}>{l.label}</Link></li>)}
            {BRAND.contactEmail && (
              <li><a href={`mailto:${BRAND.contactEmail}`} className={linkClass}>{f.contact}</a></li>
            )}
            {site && (
              <li><a href={site} className={linkClass} data-testid="footer-site">{fillText(f.site)}</a></li>
            )}
          </ul>
        </nav>
        <p className="text-gray-500 break-words" data-testid="footer-legal">
          © {new Date().getFullYear()} {BRAND.name} · {footerShortLine(legalInfo)}
        </p>
      </div>
    </footer>
  );
};

export default AppFooter;
