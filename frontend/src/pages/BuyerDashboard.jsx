import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Bell, FolderLock, Heart, PenTool, Search, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { axiosInstance } from '@/App';
import { usePrivateSeo } from '@/lib/seo';
import { SEARCH_PATH } from '@/lib/referentiels';
import { ListingCard } from '@/components/shared';
import { apiErrorMessage } from '@/components/account/errors';
import ConnectedShell from '@/components/buyer/ConnectedShell';
import PipelineList from '@/components/buyer/PipelineList';
import OffersList from '@/components/buyer/OffersList';
import AlertsPanel from '@/components/buyer/AlertsPanel';
import {
  fetchProfile, fetchKyc, fetchConversations, fetchMyOffers, fetchClosings, fetchFavorites, fetchAlerts, fetchAccessStatus, fetchCompany,
  buildPipeline,
} from '@/components/buyer/api';

// Espace repreneur (SPEC §4.3 point 7) : « Mes dossiers » (pipeline par étape), offres, alertes, favoris,
// profil de projet à compléter. Aucun crédit, aucun compteur à zéro, aucune troisième présentation des annonces.

const MIN_SCORE_TO_CONTACT = 40;
const MAX_LOOKUPS = 30;

const Section = ({ id, title, icon: Icon, count, children, action }) => (
  <section className="card p-5 sm:p-6 min-w-0" aria-labelledby={`${id}-title`} id={id}>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h2 id={`${id}-title`} className="font-display text-lg sm:text-xl font-bold text-brand-navy flex items-center gap-2">
        <Icon className="w-5 h-5 text-gray-500 shrink-0" aria-hidden="true" />
        {title}
        {count > 0 && <span className="badge badge-info tabular">{count}</span>}
      </h2>
      {action}
    </div>
    {children}
  </section>
);

const BuyerDashboard = ({ user, setUser }) => {
  usePrivateSeo('Espace repreneur');
  const [profile, setProfile] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [offers, setOffers] = useState([]);
  const [closings, setClosings] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [accessByCompany, setAccessByCompany] = useState({});
  const [companies, setCompanies] = useState({});
  const [loading, setLoading] = useState(true);

  const reloadOffers = useCallback(async () => {
    const [o, cl] = await Promise.all([fetchMyOffers(), fetchClosings()]);
    setOffers(o);
    setClosings(cl);
  }, []);
  const reloadAlerts = useCallback(async () => setAlerts(await fetchAlerts()), []);

  const load = useCallback(async () => {
    const [p, k, conv, o, cl, fav, al] = await Promise.all([
      fetchProfile(), fetchKyc(), fetchConversations(user?.id), fetchMyOffers(), fetchClosings(), fetchFavorites(), fetchAlerts(),
    ]);
    setProfile(p);
    setKyc(k);
    setConversations(conv);
    setOffers(o);
    setClosings(cl);
    setFavorites(fav);
    setAlerts(al);
    if (p && typeof setUser === 'function' && p.profile_score !== user?.profile_score) {
      try { localStorage.setItem('user', JSON.stringify({ ...user, ...p })); } catch (e) { /* stockage indisponible */ }
      setUser({ ...user, ...p });
    }
    // Statut d'accès et titre de chaque annonce du pipeline (quelques dossiers par repreneur)
    const ids = [];
    const push = (id) => { if (id && !ids.includes(id) && ids.length < MAX_LOOKUPS) ids.push(id); };
    conv.forEach((c) => push(c.company_id));
    o.forEach((x) => push(x.company_id));
    cl.forEach((x) => push(x.company_id));
    const known = {};
    fav.forEach((f) => { if (f.company?.id) known[f.company.id] = f.company; });
    const [statuses, details] = await Promise.all([
      Promise.all(ids.map((id) => fetchAccessStatus(id, user).then((s) => [id, s]))),
      Promise.all(ids.filter((id) => !known[id]).map((id) => fetchCompany(id).then((c) => [id, c]))),
    ]);
    const access = {};
    statuses.forEach(([id, s]) => { if (s) access[id] = s; });
    details.forEach(([id, c]) => { if (c) known[id] = c; });
    setAccessByCompany(access);
    setCompanies(known);
    setLoading(false);
  }, [user, setUser]);

  useEffect(() => { load(); }, [load]);

  const pipeline = useMemo(
    () => buildPipeline({ conversations, accessByCompany, offers, closings, companies }),
    [conversations, accessByCompany, offers, closings, companies],
  );
  const score = Number.isFinite(Number(profile?.profile_score)) ? Number(profile.profile_score) : (Number.isFinite(Number(user?.profile_score)) ? Number(user.profile_score) : null);
  const profileIncomplete = score !== null && score < MIN_SCORE_TO_CONTACT;
  const identityVerified = kyc?.verified === true || user?.identity_verified === true;
  const favoriteCompanies = favorites.map((f) => f.company).filter((c) => c && c.id);
  const openOffers = offers.filter((o) => ['pending_signature', 'countered'].includes(o.status));

  const removeFavorite = async (companyId) => {
    try {
      await axiosInstance.delete(`/favorites/${companyId}`);
      setFavorites((list) => list.filter((f) => f.company_id !== companyId && f.company?.id !== companyId));
      toast.success('Retirée de vos favoris');
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <ConnectedShell
      user={user}
      setUser={setUser}
      eyebrow="Espace repreneur"
      title={user?.first_name ? `Bonjour ${user.first_name}` : 'Mes dossiers'}
      wide
      actions={(
        <Link to={SEARCH_PATH} className="btn-primary px-4 py-2.5 text-sm" data-testid="search-cta">
          <Search className="w-4 h-4" aria-hidden="true" />
          Voir les entreprises à vendre
        </Link>
      )}
    >
      {profileIncomplete && (
        <div className="notice-amber mb-6 flex flex-col sm:flex-row sm:items-center gap-3" role="status" data-testid="profile-incomplete">
          <UserRound className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p className="flex-1">
            Votre profil de projet est complété à <strong className="tabular">{score} %</strong> : {MIN_SCORE_TO_CONTACT} % sont nécessaires pour présenter votre projet à un cédant (type de projet, budget, apport, financement, zones, métiers, horizon).
          </p>
          <Link to="/profile" className="btn-primary px-4 py-2 text-sm shrink-0">Compléter mon profil</Link>
        </div>
      )}
      {openOffers.length > 0 && (
        <div className="notice-amber mb-6 flex flex-col sm:flex-row sm:items-center gap-3" role="status" data-testid="offers-todo">
          <PenTool className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p className="flex-1">
            {openOffers.length === 1 ? 'Une offre attend votre signature ou votre réponse.' : `${openOffers.length} offres attendent votre signature ou votre réponse.`}
          </p>
          <a href="#offres" className="btn-primary px-4 py-2 text-sm shrink-0">Voir mes offres</a>
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6 min-w-0">
        <div className="space-y-6 min-w-0">
          <Section id="dossiers" title="Mes dossiers" icon={FolderLock} count={pipeline.length}>
            <PipelineList rows={pipeline} />
          </Section>

          <Section id="offres" title="Mes offres" icon={PenTool} count={offers.length}>
            <OffersList offers={offers} onChanged={reloadOffers} />
          </Section>
        </div>

        <div className="space-y-6 min-w-0">
          <section className="card p-5 sm:p-6 min-w-0" aria-labelledby="profil-title">
            <h2 id="profil-title" className="font-display text-lg font-bold text-brand-navy flex items-center gap-2 mb-3"><UserRound className="w-5 h-5 text-gray-500" aria-hidden="true" />Mon profil de repreneur</h2>
            {score !== null && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                  <span>Profil complété</span>
                  <span className="font-semibold text-brand-navy tabular">{score} %</span>
                </div>
                <div role="meter" aria-label="Profil complété" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} className="h-2 w-full rounded-full bg-brand-surface border border-brand-line overflow-hidden">
                  <div className={`h-full rounded-full ${score >= 70 ? 'bg-brand-navy' : score >= MIN_SCORE_TO_CONTACT ? 'bg-brand-blue' : 'bg-brand-amber'}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
                </div>
              </div>
            )}
            <p className="text-sm text-gray-700 flex items-start gap-2">
              <ShieldCheck className={`w-4 h-4 mt-0.5 shrink-0 ${identityVerified ? 'text-brand-green' : 'text-gray-400'}`} aria-hidden="true" />
              <span>{identityVerified ? 'Identité vérifiée.' : 'Identité à vérifier au moment de signer un accord de confidentialité, pas avant.'}</span>
            </p>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">Les cédants voient votre carte repreneur (projet, budget, financement, zones, horizon, société vérifiée), jamais votre nom avant l&apos;accord de confidentialité.</p>
            <Link to="/profile" className="btn-link text-sm mt-3">Modifier mon profil</Link>
          </section>

          <Section id="alertes" title="Mes alertes" icon={Bell} count={alerts.length}>
            <AlertsPanel alerts={alerts} onChanged={reloadAlerts} />
          </Section>

          <Section id="favoris" title="Mes favoris" icon={Heart} count={favoriteCompanies.length}>
            {favoriteCompanies.length === 0 ? (
              <p className="text-sm text-gray-600">Aucun favori. Le cœur sur une annonce la garde ici. <Link to={SEARCH_PATH} className="btn-link text-sm">Parcourir les annonces</Link></p>
            ) : (
              <ul className="space-y-3" data-testid="favorites-list">
                {favoriteCompanies.map((c) => (
                  <li key={c.id} className="min-w-0">
                    <ListingCard company={c} compact source="favorites" />
                    <button type="button" onClick={() => removeFavorite(c.id)} className="btn-link text-sm mt-1 text-gray-600" aria-label={`Retirer des favoris : ${c.title || 'annonce'}`}>
                      <Trash2 className="w-4 h-4" aria-hidden="true" />Retirer
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </ConnectedShell>
  );
};

export default BuyerDashboard;
