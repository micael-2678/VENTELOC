import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Plus, Building2, Eye, Heart, Users, Euro, FileSignature, FolderOpen, BarChart3, MapPin, Handshake, Calculator,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePrivateSeo } from '@/lib/seo';
import AppHeader from '@/components/layout/AppHeader';
import { formatEur } from '@/lib/format';
import { listingTitle } from '@/components/shared';
import { departementLabel, tradeLabel } from '@/lib/referentiels';
import { mandateStatusSentence, formatDateTimeFr } from '@/lib/mandate';
import {
  fetchSellerProperties, fetchMandateStatus, fetchAccessRequests, fetchOffers, fetchStats, fetchClosings, fetchKyc, fetchConversations, closingStatus,
} from '@/components/seller/api';
import { StatusBadge, BlockingReasons, ModerationFlags } from '@/components/seller/ListingStatusBadge';
import { badgeClass } from '@/components/seller/listingStatus';
import TodoBlock from '@/components/seller/TodoBlock';
import ListingActions from '@/components/seller/ListingActions';
import AccessRequests from '@/components/seller/AccessRequests';
import OffersPanel from '@/components/seller/OffersPanel';
import MandatePanel from '@/components/seller/MandatePanel';
import DataroomPanel from '@/components/seller/DataroomPanel';

const TABS = [
  { id: 'buyers', label: 'Repreneurs', icon: Users },
  { id: 'offers', label: 'Offres', icon: Euro },
  { id: 'mandate', label: 'Mandat', icon: FileSignature },
  { id: 'dataroom', label: 'Dossier', icon: FolderOpen },
  { id: 'stats', label: 'Statistiques', icon: BarChart3 },
];

// Statistiques d'une annonce : seuls les compteurs non nuls sont affichés (jamais de « 0 »)
const StatsPanel = ({ property, stats, closings }) => {
  const items = [
    { key: 'views', label: 'Vues de l\'annonce', value: Number(stats?.views ?? property.views) || 0, icon: Eye },
    { key: 'favorites', label: 'Mises en favori', value: Number(stats?.favorites_count) || 0, icon: Heart },
    { key: 'contacts', label: 'Repreneurs en contact', value: Number(stats?.unique_contacts ?? property.contacts_count) || 0, icon: Users },
    { key: 'offers', label: 'Offres reçues', value: Number(stats?.offers_count) || 0, icon: Euro },
  ].filter((i) => i.value > 0);
  const mine = (closings || []).filter((c) => c.property_id === property.id);
  return (
    <div className="space-y-5" data-testid="stats-panel">
      {items.length ? (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {items.map((i) => (
            <div key={i.key} className="rounded-xl bg-brand-surface p-4 min-w-0">
              <dt className="flex items-center gap-1.5 text-sm text-gray-600"><i.icon className="w-4 h-4 shrink-0" aria-hidden="true" />{i.label}</dt>
              <dd className="text-2xl font-bold text-brand-navy tabular">{i.value.toLocaleString('fr-FR')}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-gray-600">
          {property.status === 'published'
            ? 'Aucune consultation enregistrée pour l\'instant : les repreneurs reçoivent les nouvelles annonces chaque semaine et dès qu\'elles correspondent à leurs alertes.'
            : 'Les statistiques apparaissent dès que l\'annonce est en ligne.'}
        </p>
      )}
      {property.published_at && <p className="text-sm text-gray-500">En ligne depuis le {formatDateTimeFr(property.published_at)}.</p>}
      {mine.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-brand-navy mb-2"><Handshake className="w-4 h-4" aria-hidden="true" />Étapes de vente</h3>
          <ul className="space-y-2">
            {mine.map((c) => {
              const st = closingStatus(c);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-line px-3 py-2 text-sm min-w-0">
                  <span className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className={badgeClass(st.tone)}>{st.label}</span>
                    <span className="text-gray-700">{c.buyer_name || 'Repreneur'}{c.declared?.final_price ? ` · ${formatEur(c.declared.final_price)}` : ''}{c.expected_date ? ` · signature prévue le ${formatDateTimeFr(c.expected_date)}` : ''}</span>
                  </span>
                  <Link to={`/vente/${c.id}`} className="btn-link">Suivre la vente</Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

const SellerDashboard = ({ user, setUser }) => {
  usePrivateSeo('Espace vendeur');
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState([]);
  const [mandates, setMandates] = useState({});
  const [requests, setRequests] = useState({});
  const [offers, setOffers] = useState({});
  const [stats, setStats] = useState({});
  const [conversations, setConversations] = useState([]);
  const [closings, setClosings] = useState([]);
  const [kyc, setKyc] = useState(null);
  const [selectedId, setSelectedId] = useState(searchParams.get('annonce') || '');
  const [tab, setTab] = useState(searchParams.get('onglet') || 'buyers');

  const load = useCallback(async () => {
    const [list, convs, cls, k] = await Promise.all([fetchSellerProperties(), fetchConversations(user?.id), fetchClosings(), fetchKyc()]);
    setProperties(list);
    setConversations(convs);
    setClosings(cls);
    setKyc(k);
    const perProperty = await Promise.all(list.map(async (c) => {
      const [m, r, o, s] = await Promise.all([fetchMandateStatus(c.id), fetchAccessRequests(c.id), fetchOffers(c.id), fetchStats(c.id)]);
      return [c.id, { m, r, o, s }];
    }));
    const nextM = {}; const nextR = {}; const nextO = {}; const nextS = {};
    perProperty.forEach(([id, { m, r, o, s }]) => { nextM[id] = m; nextR[id] = r; nextO[id] = o; nextS[id] = s; });
    setMandates(nextM);
    setRequests(nextR);
    setOffers(nextO);
    setStats(nextS);
    setLoading(false);
    if (!list.length) setSelectedId('');
    else if (list.length === 1) setSelectedId(list[0].id);
  }, [user?.id]);

  useEffect(() => { load().catch(() => { setLoading(false); toast.error('Chargement de votre espace impossible pour le moment.'); }); }, [load]);

  const select = (id, nextTab) => {
    setSelectedId(id);
    if (nextTab) setTab(nextTab);
    setSearchParams((p) => { const n = new URLSearchParams(p); n.set('annonce', id); if (nextTab) n.set('onglet', nextTab); return n; }, { replace: true });
    setTimeout(() => document.getElementById('listing-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const selected = properties.find((c) => c.id === selectedId) || null;

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement"><div className="spinner" /></div>;
  }

  return (
    <div className="min-h-screen bg-brand-surface">
      <AppHeader user={user} setUser={setUser} />

      <main id="contenu" className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div className="min-w-0">
            <p className="eyebrow mb-1">Espace vendeur</p>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-brand-navy break-words">
              {user?.first_name ? `Bonjour ${user.first_name}` : 'Mon espace vendeur'}
            </h1>
          </div>
          <Link to="/seller/create" className="btn-primary shrink-0" data-testid="new-listing">
            <Plus className="w-5 h-5" aria-hidden="true" />
            {properties.length ? 'Nouvelle annonce' : 'Déposer mon annonce anonyme'}
          </Link>
        </header>

        <TodoBlock
          user={user}
          kyc={kyc}
          properties={properties}
          requestsByProperty={requests}
          offersByProperty={offers}
          conversations={conversations}
          closings={closings}
          mandatesByProperty={Object.fromEntries(Object.entries(mandates).map(([id, m]) => [id, m?.mandat || null]))}
          onSelect={select}
          onChanged={load}
        />

        <section aria-labelledby="listings-title" className="mb-8">
          <h2 id="listings-title" className="font-display text-xl font-bold text-brand-navy mb-3">Mes annonces</h2>
          {properties.length === 0 ? (
            <div className="card p-6 sm:p-8" data-testid="no-listings">
              <Building2 className="w-10 h-10 text-brand-navy/40 mb-3" aria-hidden="true" />
              <p className="font-semibold text-brand-navy text-lg">Vous n'avez pas encore d'annonce</p>
              <p className="text-sm text-gray-700 mt-1 mb-4">Trois écrans courts, enregistrés à chaque étape. Votre annonce reste anonyme : nom et coordonnées ne sont révélés qu'après accord de confidentialité signé par un repreneur à l'identité vérifiée.</p>
              <div className="flex flex-wrap gap-3">
                <Link to="/seller/create" className="btn-primary">Déposer mon annonce anonyme</Link>
                <Link to="/estimer" className="btn-secondary"><Calculator className="w-4 h-4" aria-hidden="true" />Estimer mon entreprise d'abord</Link>
              </div>
            </div>
          ) : (
            // Deux colonnes seulement à partir de deux annonces : une annonce seule prend toute la largeur
            <ul className={`grid gap-4 ${properties.length > 1 ? 'lg:grid-cols-2' : ''}`}>
              {properties.map((c) => {
                const st = stats[c.id];
                const m = mandates[c.id];
                const pendingReq = (requests[c.id] || []).filter((r) => r.status === 'pending').length;
                const pendingOffers = (offers[c.id] || []).filter((o) => o.status === 'pending').length;
                const counters = [
                  (Number(st?.views ?? c.views) || 0) > 0 ? `${Number(st?.views ?? c.views).toLocaleString('fr-FR')} vue${Number(st?.views ?? c.views) > 1 ? 's' : ''}` : '',
                  (Number(st?.favorites_count) || 0) > 0 ? `${st.favorites_count} favoris` : '',
                  (Number(st?.unique_contacts ?? c.contacts_count) || 0) > 0 ? `${Number(st?.unique_contacts ?? c.contacts_count)} repreneurs en contact` : '',
                ].filter(Boolean);
                const active = selectedId === c.id;
                return (
                  <li key={c.id} className={`card p-4 sm:p-5 min-w-0 flex flex-col gap-3 ${active ? 'ring-2 ring-brand-blue' : ''}`} data-testid={`listing-${c.id}`}>
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0">
                        <h3 className="font-display text-lg font-bold text-brand-navy leading-snug break-words">{listingTitle(c)}</h3>
                        <p className="text-sm text-gray-600 break-words">
                          {(c.trades || []).map((t) => tradeLabel(t, true)).filter(Boolean).join(', ') || (c.rge_types || []).slice(0, 2).join(', ')}
                        </p>
                      </div>
                      <StatusBadge property={c} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
                      <span className="font-bold text-brand-navy text-lg tabular">{c.asking_price > 0 ? formatEur(c.asking_price) : 'Prix à renseigner'}</span>
                      {(c.region || c.department) && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" aria-hidden="true" />{[c.region, departementLabel(c.department)].filter(Boolean).join(' · ')}</span>}
                    </div>
                    <BlockingReasons property={c} compact />
                    <ModerationFlags property={c} />
                    <p className="text-sm text-gray-600">{mandateStatusSentence(m?.mandat)}</p>
                    {(counters.length > 0 || pendingReq > 0 || pendingOffers > 0) && (
                      <p className="text-sm text-gray-700">
                        {counters.join(' · ')}
                        {pendingReq > 0 && <span className="ml-2 badge badge-warning">{pendingReq > 1 ? `${pendingReq} demandes à traiter` : '1 demande à traiter'}</span>}
                        {pendingOffers > 0 && <span className="ml-2 badge badge-warning">{pendingOffers > 1 ? `${pendingOffers} offres à traiter` : '1 offre à traiter'}</span>}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button type="button" onClick={() => select(c.id)} className="rounded-xl bg-brand-navy hover:bg-brand-navy-light text-white" data-testid={`open-${c.id}`}>
                        Suivre cette annonce
                      </Button>
                      <ListingActions property={c} presentedBuyers={m?.presented_buyers} closings={closings} mandat={m?.mandat} onChanged={load} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selected && (
          <section id="listing-detail" className="card" aria-labelledby="detail-title" data-testid="listing-detail">
            <div className="border-b border-brand-line px-4 sm:px-6 pt-4">
              <div className="flex items-start justify-between gap-3 mb-3 min-w-0">
                <h2 id="detail-title" className="font-display text-xl font-bold text-brand-navy break-words min-w-0">{listingTitle(selected)}</h2>
                <StatusBadge property={selected} />
              </div>
              <Tabs value={tab} onValueChange={(v) => select(selected.id, v)}>
                <TabsList className="flex flex-wrap justify-start h-auto gap-1 bg-transparent p-0">
                  {TABS.map((t) => {
                    const count = t.id === 'buyers' ? (requests[selected.id] || []).filter((r) => r.status === 'pending').length
                      : t.id === 'offers' ? (offers[selected.id] || []).filter((o) => o.status === 'pending').length : 0;
                    return (
                      <TabsTrigger key={t.id} value={t.id} className="rounded-xl data-[state=active]:bg-brand-navy data-[state=active]:text-white text-sm px-3 py-2">
                        <t.icon className="w-4 h-4 mr-1.5" aria-hidden="true" />
                        {t.label}
                        {count > 0 && <span className="ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand-amber text-white text-xs font-bold tabular">{count}</span>}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                <div className="py-5">
                  <TabsContent value="buyers" className="mt-0 space-y-6">
                    <div>
                      <h3 className="font-semibold text-brand-navy mb-2">Demandes de dossier</h3>
                      <AccessRequests requests={requests[selected.id]} propertyId={selected.id} onChanged={load} />
                    </div>
                    <div className="text-sm text-gray-600">
                      Les conversations avec les repreneurs sont dans la <Link to="/messages" className="btn-link">messagerie</Link>.
                      {conversations.filter((cv) => cv.property_id === selected.id).length > 0 && ` ${conversations.filter((cv) => cv.property_id === selected.id).length} conversation(s) pour cette annonce.`}
                    </div>
                  </TabsContent>
                  <TabsContent value="offers" className="mt-0">
                    <OffersPanel offers={offers[selected.id]} closings={closings} onChanged={load} />
                  </TabsContent>
                  <TabsContent value="mandate" className="mt-0">
                    <MandatePanel property={selected} mandat={mandates[selected.id]?.mandat || null} presentedBuyers={mandates[selected.id]?.presented_buyers} onChanged={load} />
                  </TabsContent>
                  <TabsContent value="dataroom" className="mt-0">
                    <DataroomPanel propertyId={selected.id} />
                  </TabsContent>
                  <TabsContent value="stats" className="mt-0">
                    <StatsPanel property={selected} stats={stats[selected.id]} closings={closings} />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default SellerDashboard;
