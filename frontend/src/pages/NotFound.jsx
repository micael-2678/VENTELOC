import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { useSeo, NOINDEX } from '@/lib/seo';
import { content, fillText } from '@/seo';

// Page 404 (non indexée) : liens utiles vers les pages publiques (src/seo/content.json → notFound.links)
const NotFound = ({ user }) => {
  const nf = content.notFound;
  useSeo(fillText(nf.title), nf.text, { robots: NOINDEX });
  return (
    <AppLayout user={user} className="bg-brand-surface">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center" data-testid="not-found">
        <p className="font-display text-6xl font-extrabold text-brand-navy/15 mb-2" aria-hidden="true">404</p>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy mb-4">{nf.h1}</h1>
        <p className="text-gray-600 mb-8">{nf.text}</p>
        <ul className="grid sm:grid-cols-2 gap-3 text-left">
          {nf.links.map((l) => (
            <li key={l.to} className="min-w-0">
              <Link to={l.to} className="card-link flex items-center justify-between gap-2 bg-white rounded-xl border border-brand-line p-4 font-medium text-brand-navy hover:border-brand-navy/40">
                {l.label} <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AppLayout>
  );
};

export default NotFound;
