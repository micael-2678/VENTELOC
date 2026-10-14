import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Inbox, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { axiosInstance } from '@/App';
import { apiErrorMessage } from '@/components/account/errors';
import { BTN_QUIET, BTN_SECONDARY } from '@/components/shared/buttonStyles';
import TestPanelSection from '@/components/test/TestPanelSection';

// Boîte mail de test (MODE-TEST-ET-APP.md §B.2.10, §B.3) : e-mails capturés au lieu d'être envoyés.
// GET /test/emails?limit=&to= → [{id, to, from, subject, created_at}] (X-Total-Count) ; GET /test/emails/{id} → html ;
// DELETE /test/emails (admin). L'aperçu est affiché dans un iframe sandbox="" (ni script, ni formulaire, ni navigation
// du parent) ; les liens de l'e-mail (confirmation, réinitialisation…) sont repris en dessous pour être ouverts.

// « CessionBâtiment <contact@…> » → « CessionBâtiment » (adresse complète dans l'aperçu)
const senderName = (from) => {
  const raw = String(from || '').trim();
  const name = raw.replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '').trim();
  return name ? `De ${name}` : (raw ? `De ${raw}` : '');
};

const LIMIT = 50;
const MAX_LINKS = 8;
// Relecture automatique de la boîte tant que l'onglet est visible (un e-mail émis par une action apparaît seul)
export const INBOX_REFRESH_MS = 15000;
// En dessous de cette largeur, l'aperçu est sous la liste : il est amené à l'écran à l'ouverture d'un e-mail
const WIDE_LAYOUT_QUERY = '(min-width: 1024px)';

const isNarrowLayout = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && !window.matchMedia(WIDE_LAYOUT_QUERY).matches;

export const formatEmailDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Liens http(s) de l'e-mail, sans doublon (texte du lien ou adresse)
export const extractEmailLinks = (html) => {
  if (!html || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set();
  const links = [];
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    if (!/^https?:\/\//i.test(href) || seen.has(href) || links.length >= MAX_LINKS) return;
    seen.add(href);
    links.push({ href, text: (a.textContent || '').replace(/\s+/g, ' ').trim() || href });
  });
  return links;
};

const TestInbox = ({ user }) => {
  const isAdmin = user?.role === 'admin';
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const detailRef = useRef(null);

  // `silent` : relecture automatique, sans indicateur ni message d'erreur (la relecture suivante réessaiera)
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const params = { limit: LIMIT };
      if (isAdmin && appliedFilter) params.to = appliedFilter;
      const res = await axiosInstance.get('/test/emails', { params });
      const list = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.emails) ? res.data.emails : []);
      setEmails(list);
      const header = Number(res.headers?.['x-total-count']);
      setTotal(Number.isFinite(header) && header > 0 ? header : list.length);
    } catch (e) {
      if (!silent) setError(apiErrorMessage(e, 'La boîte mail de test n\'a pas pu être lue.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isAdmin, appliedFilter]);

  useEffect(() => {
    if (user?.id) load();
  }, [user?.id, load]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load({ silent: true });
    }, INBOX_REFRESH_MS);
    return () => clearInterval(timer);
  }, [user?.id, load]);

  // Petit écran : l'e-mail ouvert s'affiche sous la liste, hors de la vue ; on y fait défiler la page
  useEffect(() => {
    if (!detail || !detailRef.current || !isNarrowLayout() || typeof detailRef.current.scrollIntoView !== 'function') return;
    detailRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [detail]);

  const open = async (id) => {
    if (id === selectedId && detail) return;
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await axiosInstance.get(`/test/emails/${encodeURIComponent(id)}`);
      setDetail(res.data || null);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Cet e-mail n\'a pas pu être ouvert.'));
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      const res = await axiosInstance.delete('/test/emails');
      const deleted = Number(res.data?.deleted) || 0;
      toast.success(deleted > 0 ? `Boîte de test vidée (${deleted} e-mail${deleted > 1 ? 's' : ''} supprimé${deleted > 1 ? 's' : ''}).` : 'La boîte de test était déjà vide.');
      setConfirmClear(false);
      setSelectedId(null);
      setDetail(null);
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'La boîte de test n\'a pas pu être vidée.'));
    } finally {
      setClearing(false);
    }
  };

  const links = useMemo(() => extractEmailLinks(detail?.html), [detail]);

  return (
    <TestPanelSection
      id="test-inbox"
      title="Boîte mail de test"
      icon={Inbox}
      intro={isAdmin
        ? 'Tous les e-mails émis par l\'application en mode test (vous êtes administrateur). Filtrez par destinataire si besoin.'
        : `Les e-mails adressés à ${user?.email || 'votre adresse'} : confirmation, codes de signature, relances…`}
      testId="test-inbox"
    >
      <div className="flex flex-wrap items-end gap-2 mb-4">
        {isAdmin && (
          <form
            className="flex flex-wrap items-end gap-2 min-w-0"
            onSubmit={(e) => { e.preventDefault(); setAppliedFilter(filter.trim().toLowerCase()); }}
          >
            <div className="min-w-0">
              <label htmlFor="test-inbox-to" className="block text-sm font-medium text-gray-700 mb-1">Destinataire</label>
              <input
                id="test-inbox-to"
                type="email"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="adresse@exemple.fr"
                className="w-64 max-w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm text-brand-navy focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                data-testid="test-inbox-filter"
              />
            </div>
            <button type="submit" className={`${BTN_QUIET} px-3 py-2 text-sm`}>
              <Search className="w-4 h-4" aria-hidden="true" />
              Filtrer
            </button>
          </form>
        )}
        <button type="button" onClick={() => load()} disabled={loading} className={`${BTN_SECONDARY} px-3 py-2 text-sm`} data-testid="test-inbox-refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Actualiser
        </button>
        {isAdmin && !confirmClear && (
          <button type="button" onClick={() => setConfirmClear(true)} className={`${BTN_QUIET} px-3 py-2 text-sm text-red-700`} data-testid="test-inbox-clear">
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Vider
          </button>
        )}
      </div>

      {confirmClear && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p className="font-semibold">Supprimer tous les e-mails de la boîte de test, pour tous les comptes ?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={clearAll} disabled={clearing} className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-3 py-2 font-semibold text-white hover:bg-red-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2" data-testid="test-inbox-clear-confirm">
              {clearing && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              Oui, vider la boîte
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className={`${BTN_QUIET} px-3 py-2 text-sm`}>Annuler</button>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-700" role="alert">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] min-w-0">
        <div className="min-w-0">
          {appliedFilter && (
            <p className="text-sm text-gray-600 mb-2 break-words">Destinataire : <strong>{appliedFilter}</strong></p>
          )}
          {loading && emails.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-gray-600" role="status">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Lecture de la boîte…
            </p>
          ) : emails.length === 0 ? (
            <p className="text-sm text-gray-600" data-testid="test-inbox-empty">
              Aucun e-mail pour l'instant. Les e-mails apparaissent ici dès qu'une action en envoie un (inscription, code de signature, relance…).
            </p>
          ) : (
            <>
              {/* Liste à hauteur bornée (défilement interne) : la page reste lisible avec des dizaines d'e-mails */}
              <ul className="divide-y divide-brand-line rounded-xl border border-brand-line overflow-y-auto max-h-[28rem]" data-testid="test-inbox-list">
                {emails.map((m) => {
                  const active = m.id === selectedId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => open(m.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`w-full text-left px-3 py-2.5 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue ${active ? 'bg-brand-blue-soft' : 'bg-white hover:bg-brand-surface'}`}
                        data-testid="test-inbox-item"
                      >
                        <span className="block font-semibold text-sm text-brand-navy break-words">{m.subject || '(sans objet)'}</span>
                        <span className="block text-sm text-gray-600 truncate">
                          {[senderName(m.from), formatEmailDate(m.created_at)].filter(Boolean).join(' · ')}
                        </span>
                        {isAdmin && m.to && <span className="block text-sm text-gray-500 truncate">À {m.to}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {total > emails.length && (
                <p className="text-sm text-gray-600 mt-2">Les {emails.length} plus récents sur {total}.</p>
              )}
            </>
          )}
        </div>

        <div className="min-w-0 scroll-mt-4" aria-live="polite" ref={detailRef}>
          {detailLoading && (
            <p className="flex items-center gap-2 text-sm text-gray-600" role="status">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Ouverture de l'e-mail…
            </p>
          )}
          {!detailLoading && detail && (
            <div className="min-w-0" data-testid="test-inbox-preview">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-brand-navy break-words min-w-0">{detail.subject}</p>
                <button
                  type="button"
                  onClick={() => { setDetail(null); setSelectedId(null); }}
                  className={`${BTN_QUIET} lg:hidden shrink-0 px-2 py-1 text-sm`}
                  data-testid="test-inbox-back"
                >
                  Retour à la boîte
                </button>
              </div>
              <p className="text-sm text-gray-600 break-words mb-2">
                À {detail.to}{detail.created_at ? ` · ${formatEmailDate(detail.created_at)}` : ''}
              </p>
              {links.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-semibold text-brand-navy mb-1">Liens de l'e-mail</p>
                  <ul className="space-y-1">
                    {links.map((l) => (
                      <li key={l.href} className="min-w-0">
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-start gap-1 text-sm text-brand-blue underline underline-offset-2 break-all rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                        >
                          <ExternalLink className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                          {l.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <iframe
                title={`Aperçu de l'e-mail : ${detail.subject || 'sans objet'}`}
                sandbox=""
                srcDoc={detail.html || '<p>(e-mail vide)</p>'}
                className="w-full h-[60vh] min-h-[360px] rounded-xl border border-brand-line bg-white"
                data-testid="test-inbox-iframe"
              />
            </div>
          )}
          {!detailLoading && !detail && emails.length > 0 && (
            <p className="text-sm text-gray-600">Choisissez un e-mail pour l'afficher.</p>
          )}
        </div>
      </div>
    </TestPanelSection>
  );
};

export default TestInbox;
