import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Send, MessageSquare, Lock, Unlock, FolderOpen, Loader2, ChevronDown, ChevronUp, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { axiosInstance } from '@/App';
import { goBack, homePathFor } from '@/lib/navigation';
import { usePrivateSeo } from '@/lib/seo';
import AppHeader from '@/components/layout/AppHeader';
import PageBar from '@/components/layout/PageBar';
import { BuyerCard } from '@/components/shared';
import { SEARCH_PATH } from '@/lib/referentiels';
import { formatDateTimeMinutesFr, formatDateTimeFr } from '@/lib/mandate';
import { apiErrorMessage, isEmailNotVerifiedError } from '@/components/account/errors';
import { fetchConversations, accessStatus } from '@/components/seller/api';
import { badgeClass } from '@/components/seller/listingStatus';

const MAX_LENGTH = 5000;

// Messages d'une conversation (API.md §3) ; forme historique tolérée (messages déjà embarqués)
const loadMessages = async (conversation, userId) => {
  if (conversation.legacy) return conversation.messages || [];
  const res = await axiosInstance.get('/messages', { params: { conversation_id: conversation.id } });
  const list = Array.isArray(res.data) ? res.data : [];
  return list.map((m) => ({ ...m, is_mine: typeof m.is_mine === 'boolean' ? m.is_mine : m.sender_id === userId, kind: m.kind || (m.sender_id === 'system' ? 'system' : 'message') }))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
};

const Bubble = ({ message, mine }) => {
  if (message.kind === 'system' || message.sender_id === 'system') {
    return (
      <div className="flex justify-center my-2" data-testid="system-message">
        <p className="max-w-md text-center text-sm text-gray-700 bg-brand-surface border border-brand-line rounded-xl px-4 py-2 whitespace-pre-line break-words">{message.content}</p>
      </div>
    );
  }
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`} data-testid="message">
      <div className={`max-w-[85%] sm:max-w-md rounded-2xl px-4 py-3 min-w-0 ${mine ? 'bg-brand-navy text-white' : 'bg-white border border-brand-line text-gray-900'}`}>
        {!mine && <p className="text-xs font-semibold text-gray-500 mb-1 break-words">{message.sender_label || 'Repreneur'}</p>}
        <p className="whitespace-pre-line break-words">{message.content}</p>
        <p className={`text-xs mt-1 ${mine ? 'text-white/70' : 'text-gray-500'}`}>{formatDateTimeMinutesFr(message.created_at)}</p>
      </div>
    </div>
  );
};

const ConversationItem = ({ conversation, active, onSelect, isSeller }) => (
  <li>
    <button
      type="button"
      onClick={() => onSelect(conversation)}
      aria-current={active ? 'true' : undefined}
      className={`w-full text-left rounded-xl p-3 transition-colors min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${active ? 'bg-brand-blue-soft border-2 border-brand-navy' : 'bg-white border-2 border-transparent hover:bg-brand-surface'}`}
      data-testid={`conversation-${conversation.id}`}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <span className="font-semibold text-sm text-brand-navy truncate">{isSeller ? conversation.other_party_label || 'Repreneur' : conversation.property_title || 'Annonce'}</span>
        {conversation.unread_count > 0 && (
          <span className="shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand-amber text-white text-xs font-bold tabular" aria-label={`${conversation.unread_count} non lus`}>{conversation.unread_count}</span>
        )}
      </div>
      {isSeller && conversation.property_title && <p className="text-xs text-gray-500 truncate">{conversation.property_title}</p>}
      {!isSeller && conversation.other_party_label && <p className="text-xs text-gray-500 truncate">{conversation.other_party_label}</p>}
      <p className="text-sm text-gray-600 truncate mt-1">{conversation.last_message || '—'}</p>
      {conversation.last_at && <p className="text-xs text-gray-500 mt-0.5">{formatDateTimeFr(conversation.last_at)}</p>}
    </button>
  </li>
);

const MessagesPage = ({ user }) => {
  usePrivateSeo('Messagerie');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSeller = user?.role === 'seller';
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [mobileView, setMobileView] = useState('list'); // 'list' | 'thread' (sous md)
  const endRef = useRef(null);
  // Côté cédant, la carte repreneur est dépliée à la première ouverture de chaque conversation
  const cardSeen = useRef(new Set());

  const loadList = useCallback(async () => {
    const list = await fetchConversations(user?.id);
    setConversations(list);
    setLoading(false);
    return list;
  }, [user?.id]);

  // Ouverture : liste, puis la conversation demandée (?conversation=) ou la première
  useEffect(() => {
    loadList().then((list) => {
      const wanted = searchParams.get('conversation');
      const found = (wanted && list.find((c) => c.id === wanted || c.property_id === wanted)) || null;
      if (found) {
        setCurrent(found);
        setMobileView('thread');
      } else if (list.length && window.innerWidth >= 768) {
        setCurrent(list[0]);
      }
    });
  }, [loadList]);

  useEffect(() => {
    if (!current) return;
    const first = isSeller && !!current.buyer_card && !cardSeen.current.has(current.id);
    cardSeen.current.add(current.id);
    setShowCard(first);
  }, [current, isSeller]);

  // Fil de la conversation courante + marquage « lu »
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setLoadingThread(true);
    loadMessages(current, user?.id)
      .then((list) => { if (!cancelled) setMessages(list); })
      .catch(() => { if (!cancelled) toast.error('Impossible de charger cette conversation.'); })
      .finally(() => { if (!cancelled) setLoadingThread(false); });
    if (current.unread_count > 0) {
      axiosInstance.put(`/messages/conversations/${current.id}/read`).catch(() => {});
      setConversations((cs) => cs.map((c) => (c.id === current.id ? { ...c, unread_count: 0 } : c)));
    }
    return () => { cancelled = true; };
  }, [current, user?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const select = (conversation) => {
    setCurrent(conversation);
    setMobileView('thread');
    setSearchParams((p) => { const n = new URLSearchParams(p); n.set('conversation', conversation.id); return n; }, { replace: true });
  };

  const send = async (e) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !current || sending) return;
    if (content.length > MAX_LENGTH) {
      toast.error(`Message trop long (${MAX_LENGTH} caractères au maximum).`);
      return;
    }
    setSending(true);
    try {
      const body = current.legacy
        ? { receiver_id: current.receiver_id, property_id: current.property_id, content }
        : { conversation_id: current.id, content };
      const res = await axiosInstance.post('/messages', body);
      const sent = res.data || {};
      setMessages((m) => [...m, { ...sent, is_mine: true, kind: sent.kind || 'message', content: sent.content || content, created_at: sent.created_at || new Date().toISOString() }]);
      setDraft('');
      const list = await loadList();
      const refreshed = list.find((c) => c.id === current.id);
      if (refreshed && !refreshed.legacy) setCurrent((c) => ({ ...c, ...refreshed, unread_count: 0 }));
      else if (refreshed?.legacy) setMessages(refreshed.messages || []);
    } catch (err) {
      if (!isEmailNotVerifiedError(err)) toast.error(apiErrorMessage(err, 'L\'envoi a échoué.'));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement"><div className="spinner" /></div>;
  }

  const access = current ? accessStatus({ status: current.access_status }) : null;
  const revealed = !!current?.identity_revealed;
  const dashboardLink = current ? `/seller/dashboard?annonce=${encodeURIComponent(current.property_id)}&onglet=buyers` : '/seller/dashboard';

  return (
    <div className="min-h-screen bg-brand-surface flex flex-col">
      <AppHeader user={user} />
      <PageBar onBack={() => goBack(navigate, homePathFor(user))} title="Messagerie" />

      <main id="contenu" className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1 flex flex-col min-h-0">
        {conversations.length === 0 ? (
          <div className="card p-8 sm:p-12 text-center" data-testid="no-conversations">
            <MessageSquare className="w-12 h-12 text-brand-navy/30 mx-auto mb-4" aria-hidden="true" />
            <p className="font-semibold text-brand-navy text-lg mb-1">Aucune conversation pour le moment</p>
            <p className="text-sm text-gray-600 mb-5">
              {isSeller
                ? 'Dès qu\'un repreneur vous présente son projet depuis votre annonce, la conversation apparaît ici avec sa carte repreneur.'
                : 'Présentez votre projet à un cédant depuis une annonce : la conversation apparaît ici.'}
            </p>
            <Link to={isSeller ? '/seller/dashboard' : SEARCH_PATH} className="btn-primary">{isSeller ? 'Voir mes annonces' : 'Voir les entreprises à vendre'}</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-[18rem_1fr] lg:grid-cols-[22rem_1fr] gap-4 flex-1 min-h-0" style={{ minHeight: 'calc(100vh - 12rem)' }}>
            <aside className={`card p-3 overflow-y-auto min-w-0 ${mobileView === 'thread' ? 'hidden md:block' : 'block'}`} aria-label="Conversations">
              <h2 className="font-display text-lg font-bold text-brand-navy px-1 mb-2">Conversations</h2>
              <ul className="space-y-1">
                {conversations.map((c) => <ConversationItem key={c.id} conversation={c} active={current?.id === c.id} onSelect={select} isSeller={isSeller} />)}
              </ul>
            </aside>

            <section className={`card flex flex-col min-w-0 min-h-0 ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}`} aria-label="Fil de la conversation">
              {!current ? (
                <div className="flex-1 flex items-center justify-center text-gray-600 p-6 text-sm">Sélectionnez une conversation.</div>
              ) : (
                <>
                  <header className="p-3 sm:p-4 border-b border-brand-line space-y-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <button type="button" onClick={() => setMobileView('list')} className="md:hidden rounded-lg p-1.5 hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue shrink-0" aria-label="Retour à la liste">
                        <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-brand-navy break-words">{isSeller ? current.other_party_label || 'Repreneur' : current.property_title || 'Annonce'}</p>
                        <p className="text-sm text-gray-600 break-words flex items-center gap-1">
                          <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                          {isSeller ? (current.property_title || 'Votre annonce') : (current.other_party_label || 'Vendeur')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 justify-end shrink-0">
                        <Link to={`/property/${current.property_id}`} className="btn-link text-sm">Annonce</Link>
                        {isSeller ? (
                          <Link to={dashboardLink} className="btn-link text-sm"><FolderOpen className="w-4 h-4" aria-hidden="true" />Demande de dossier</Link>
                        ) : (
                          <Link to={`/dataroom/${current.property_id}`} className="btn-link text-sm"><FolderOpen className="w-4 h-4" aria-hidden="true" />Dossier</Link>
                        )}
                      </div>
                    </div>

                    <p className={`flex items-start gap-2 text-sm rounded-xl px-3 py-2 ${revealed ? 'bg-brand-green-soft text-brand-green-dark' : 'bg-brand-surface text-gray-700'}`} data-testid="identity-banner">
                      {revealed ? <Unlock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> : <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
                      <span>
                        {revealed
                          ? 'Accord de confidentialité signé : identités et nom de la société révélés aux deux parties.'
                          : 'Identités révélées après l\'accord de confidentialité. D\'ici là, les coordonnées écrites dans les messages sont masquées et les échanges restent sur la plateforme.'}
                        {current.access_status && access && <span className="ml-1">· Dossier : <span className={badgeClass(access.tone)}>{access.label}</span></span>}
                      </span>
                    </p>

                    {isSeller && current.buyer_card && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowCard((v) => !v)}
                          aria-expanded={showCard}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded"
                          data-testid="toggle-buyer-card"
                        >
                          {showCard ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
                          {showCard ? 'Masquer la carte repreneur' : 'Voir la carte repreneur'}
                        </button>
                        {showCard && <div className="mt-2"><BuyerCard buyer={current.buyer_card} title={current.buyer_card.label || current.other_party_label || 'Repreneur'} compact /></div>}
                      </div>
                    )}
                  </header>

                  <div className="flex-1 overflow-y-auto p-3 sm:p-5 bg-brand-surface/60 min-h-0" data-testid="thread">
                    {loadingThread ? (
                      <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-brand-navy" aria-hidden="true" /></div>
                    ) : (
                      <div className="space-y-3">
                        {messages.map((m) => <Bubble key={m.id} message={m} mine={m.is_mine} />)}
                        {messages.length === 0 && <p className="text-center text-sm text-gray-600 py-8">Aucun message pour l'instant.</p>}
                        <div ref={endRef} />
                      </div>
                    )}
                  </div>

                  <form onSubmit={send} className="p-3 sm:p-4 border-t border-brand-line">
                    <label htmlFor="message-input" className="sr-only">Votre message</label>
                    <div className="flex items-end gap-2">
                      <textarea
                        id="message-input"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }}
                        placeholder="Écrivez votre message… (sans coordonnées avant l'accord de confidentialité)"
                        rows={2}
                        maxLength={MAX_LENGTH}
                        className="flex-1 min-w-0 rounded-xl border border-brand-line px-4 py-3 text-base resize-none focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                        data-testid="message-input"
                      />
                      <Button type="submit" disabled={sending || !draft.trim()} className="rounded-xl bg-brand-navy hover:bg-brand-navy-light text-white h-12 px-4" aria-label="Envoyer" data-testid="send-message">
                        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default MessagesPage;
