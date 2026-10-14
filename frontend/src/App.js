import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { toast } from "sonner";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import axios from "axios";
import { Toaster } from "@/components/ui/sonner";

// Pages publiques (chargées d'emblée : la page des annonces est l'entrée de l'application et la cible du site WordPress)
import ListingsPage from "@/pages/ListingsPage";
import EmbedListingsPage from "@/pages/EmbedListingsPage";
import { MentionsLegalesPage, PrivacyPage, CguPage, ReportPage } from "@/pages/LegalPages";
import NotFound from "@/pages/NotFound";
import EmailVerificationBanner from "@/components/EmailVerificationBanner";
// Bandeau du mode test : ne s'affiche que si GET /config renvoie test_mode (MODE-TEST-ET-APP.md §B.3)
import TestModeBanner from "@/components/test/TestModeBanner";
import { SessionContext } from "@/components/layout/session";
import { canonicalSearch, legacyListingsPath, LISTINGS_PATH } from "@/components/shared/listingFilters";
import { initAnalytics } from "@/lib/analytics";
import { loginRedirectPath } from "@/lib/axiosAuth";
import { homePathFor } from "@/lib/navigation";
import { testPanelHeaders } from "@/lib/testMode";

// Pages chargées à la demande (code-splitting) : le visiteur de l'accueil ne télécharge pas
// les tableaux de bord, l'administration ni le lecteur PDF. Routes : docs/refonte-2026-10/API.md §10 et
// MODE-TEST-ET-APP.md (page des annonces sur /, module /embed/annonces, panneau /test).
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const RegisterPage = lazy(() => import("@/pages/RegisterPage"));
const ConfirmEmailPage = lazy(() => import("@/pages/ConfirmEmailPage"));
const EstimatePage = lazy(() => import("@/pages/EstimatePage"));
const SellerDashboard = lazy(() => import("@/pages/SellerDashboard"));
const BuyerDashboard = lazy(() => import("@/pages/BuyerDashboard"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const CreateListing = lazy(() => import("@/pages/CreateListing"));
const MandatePage = lazy(() => import("@/pages/MandatePage"));
const CompanyDetail = lazy(() => import("@/pages/CompanyDetail"));
const MessagesPage = lazy(() => import("@/pages/MessagesPage"));
const DataroomPage = lazy(() => import("@/pages/DataroomPage"));
const ClosingPage = lazy(() => import("@/pages/ClosingPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const PresidentAcceptPage = lazy(() => import("@/pages/PresidentAcceptPage"));
const FollowupPage = lazy(() => import("@/pages/FollowupPage"));
const KYCCallbackPage = lazy(() => import("@/components/KYCVerification").then((m) => ({ default: m.KYCCallbackPage })));
// Mode test (MODE-TEST-ET-APP.md §B) : panneau /test chargé à la demande
const TestModePage = lazy(() => import("@/pages/TestModePage"));

// Toasts en bas au centre : en haut à droite, ils recouvraient les actions des barres collantes (Déconnexion, Lancer les
// tâches, Messages…). La messagerie a une zone de saisie fixée en bas : les toasts s'affichent au-dessus d'elle.
const AppToaster = () => {
  const { pathname } = useLocation();
  const offset = pathname.startsWith('/messages') ? { bottom: 120 } : undefined;
  return <Toaster position="bottom-center" richColors closeButton offset={offset} mobileOffset={offset} />;
};

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen" role="status" aria-label="Chargement">
    <div className="spinner"></div>
  </div>
);

// Vide (défaut) = même domaine : /api proxifié par nginx
const BACKEND_URL = String(process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
export const API = `${BACKEND_URL}/api`;

export const axiosInstance = axios.create({
  baseURL: API,
});

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Mode test : clé du panneau (?cle=…) renvoyée au serveur (connexion rapide, admin démo, données de démonstration)
  Object.entries(testPanelHeaders()).forEach(([name, value]) => {
    config.headers[name] = value;
  });
  return config;
});

// 403 « e-mail non confirmé » (API.md : detail {code:'email_not_verified'} ou « Confirmez d'abord… ») :
// le compte stocké est marqué non confirmé et l'application affiche le bandeau de confirmation.
export const EMAIL_NOT_VERIFIED_EVENT = "cession:email-not-verified";
const isEmailNotVerified = (error) => {
  if (error.response?.status !== 403) return false;
  const detail = error.response?.data?.detail;
  if (detail && typeof detail === "object" && detail.code === "email_not_verified") return true;
  return typeof detail === "string" && detail.startsWith("Confirmez d'abord");
};

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || "";
    const isAuthAttempt = url.includes("/auth/login") || url.includes("/auth/register");
    // skipAuthRedirect : requêtes secondaires des pages publiques (non-lus, favoris) qu'une session expirée ne doit
    // pas transformer en redirection vers /login
    if (error.response?.status === 401 && !isAuthAttempt && !error.config?.skipAuthRedirect) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = loginRedirectPath(window.location);
    }
    if (isEmailNotVerified(error)) {
      try {
        const saved = JSON.parse(localStorage.getItem("user") || "null");
        if (saved && saved.email_verified !== false) {
          localStorage.setItem("user", JSON.stringify({ ...saved, email_verified: false }));
        }
      } catch (e) {
        // compte stocké illisible : le bandeau s'affichera à la prochaine connexion
      }
      window.dispatchEvent(new CustomEvent(EMAIL_NOT_VERIFIED_EVENT));
    }
    return Promise.reject(error);
  }
);

// Bandeaux au-dessus de l'en-tête : mode test (affiché seulement en mode test), e-mail à confirmer. Aucun bandeau
// dans le module intégré au site WordPress (/embed/…).
const AppBanners = ({ user, setUser, emailUnverified }) => {
  const { pathname } = useLocation();
  if (pathname.startsWith("/embed/")) return null;
  return (
    <>
      <TestModeBanner />
      {emailUnverified && <EmailVerificationBanner user={user} setUser={setUser} />}
    </>
  );
};

// Page réservée à un autre rôle : retour à l'espace du compte connecté, avec l'explication
const ROLE_ONLY_LABEL = { seller: "cédant", buyer: "repreneur", admin: "administrateur" };
export const roleRestrictionMessage = (allowedRoles) => {
  const labels = (allowedRoles || []).map((r) => ROLE_ONLY_LABEL[r]).filter(Boolean);
  return labels.length ? `Cette page est réservée aux comptes ${labels.join(" ou ")}.` : "Cette page n'est pas accessible avec ce compte.";
};

const RoleRedirect = ({ user, allowedRoles }) => {
  useEffect(() => {
    toast.info(roleRestrictionMessage(allowedRoles), { id: "role-restriction" });
  }, [allowedRoles]);
  return <Navigate to={homePathFor(user)} replace />;
};

// Page connectée : un visiteur non connecté (lien reçu par e-mail ouvert sur un autre appareil…) passe par la
// connexion puis revient sur la page demandée (?redirect=)
export const ProtectedRoute = ({ user, loading, children, allowedRoles }) => {
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={loginRedirectPath(location)} replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <RoleRedirect user={user} allowedRoles={allowedRoles} />;
  }
  return children;
};

// Anciennes URL de recherche (/entreprises-a-vendre, /search, /buyer/search) → page des annonces, filtres conservés
// et traduits (metiers, rge_type, max_price, region en toutes lettres…). nginx répond déjà 301 ; cette redirection
// couvre la navigation interne et le serveur de développement.
const ListingsRedirect = () => {
  const { search } = useLocation();
  const canonical = canonicalSearch(search);
  const query = canonical === null ? search.replace(/^\?/, "") : canonical;
  return <Navigate to={query ? `${LISTINGS_PATH}?${query}` : LISTINGS_PATH} replace />;
};

// Anciennes pages d'atterrissage (hubs bâtiment et RGE par métier, région, activité) → annonces filtrées
const HubRedirect = ({ kind }) => {
  const { slug } = useParams();
  return <Navigate to={legacyListingsPath(kind, slug)} replace />;
};

// Anciennes URL à paramètre de chemin → pages existantes qui lisent ?token=
const TokenQueryRedirect = ({ to, extra = "" }) => {
  const { token } = useParams();
  return <Navigate to={`${to}?token=${encodeURIComponent(token || "")}${extra}`} replace />;
};

// Entrée du parcours cédant (MODE-TEST-ET-APP.md §A.2) : cible des anciennes pages « vendre mon entreprise »
export const SELLER_ENTRY_PATH = "/estimer";

// Table des routes (exportée pour les tests : src/pages/__tests__/redirects.test.jsx)
export const AppRoutes = ({ user, setUser, loading }) => (
  <Routes>
    {/* Pages publiques */}
    <Route path="/" element={<ListingsPage user={user} />} />
    <Route path="/embed/annonces" element={<EmbedListingsPage />} />
    <Route path="/company/:id" element={<CompanyDetail user={user} />} />
    <Route path="/estimer" element={<EstimatePage user={user} />} />
    <Route path="/mentions-legales" element={<MentionsLegalesPage user={user} />} />
    <Route path="/confidentialite" element={<PrivacyPage user={user} />} />
    <Route path="/cgu" element={<CguPage user={user} />} />
    <Route path="/signaler" element={<ReportPage user={user} />} />
    <Route path="/test" element={<TestModePage user={user} setUser={setUser} />} />

    {/* Anciennes URL (pages marketing sorties de l'application, MODE-TEST-ET-APP.md §A.1) : jamais de 404 */}
    <Route path="/entreprises-a-vendre" element={<ListingsRedirect />} />
    <Route path="/search" element={<ListingsRedirect />} />
    <Route path="/buyer/search" element={<ListingsRedirect />} />
    <Route path="/entreprises-batiment-a-vendre" element={<Navigate to={LISTINGS_PATH} replace />} />
    <Route path="/entreprises-batiment-a-vendre/metier/:slug" element={<HubRedirect kind="metier" />} />
    <Route path="/entreprises-batiment-a-vendre/region/:slug" element={<HubRedirect kind="region" />} />
    <Route path="/entreprises-rge-a-vendre" element={<HubRedirect kind="rge" />} />
    <Route path="/entreprises-rge-a-vendre/activite/:slug" element={<HubRedirect kind="rge-activite" />} />
    <Route path="/entreprises-rge-a-vendre/region/:slug" element={<HubRedirect kind="rge-region" />} />
    {["/reprendre-une-entreprise-batiment", "/reprendre-une-entreprise-rge", "/guides", "/guides/*",
      "/verifier-entreprise-rge"].map((path) => (
      <Route key={path} path={path} element={<Navigate to={LISTINGS_PATH} replace />} />
    ))}
    {/* Anciennes pages « vendre » : le cédant arrive sur l'entrée de son parcours (estimation), pas sur la liste des
        annonces (nginx renvoie vers la page WordPress quand MARKETING_URL est défini) */}
    {["/vendre-mon-entreprise-batiment", "/vendre-mon-entreprise-rge"].map((path) => (
      <Route key={path} path={path} element={<Navigate to={SELLER_ENTRY_PATH} replace />} />
    ))}

    {/* Compte */}
    <Route path="/login" element={<LoginPage setUser={setUser} />} />
    <Route path="/register" element={<RegisterPage setUser={setUser} />} />
    <Route path="/mot-de-passe-oublie" element={<ResetPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/reset-password/:token" element={<TokenQueryRedirect to="/reset-password" />} />
    <Route path="/confirmer-email/:token" element={<ConfirmEmailPage user={user} setUser={setUser} />} />
    <Route path="/president/:token" element={<PresidentAcceptPage user={user} setUser={setUser} />} />
    <Route path="/president/accept/:token" element={<PresidentAcceptPage user={user} setUser={setUser} />} />
    <Route path="/suivi" element={<FollowupPage />} />
    <Route path="/suivi/:token" element={<TokenQueryRedirect to="/suivi" />} />

    {/* KYC Callback Route */}
    <Route path="/kyc/callback" element={
      <ProtectedRoute user={user} loading={loading}>
        <KYCCallbackPage user={user} />
      </ProtectedRoute>
    } />

    {/* Espace cédant */}
    <Route path="/seller/dashboard" element={
      <ProtectedRoute user={user} loading={loading} allowedRoles={["seller"]}>
        <SellerDashboard user={user} setUser={setUser} />
      </ProtectedRoute>
    } />
    <Route path="/seller/create" element={
      <ProtectedRoute user={user} loading={loading} allowedRoles={["seller"]}>
        <CreateListing user={user} />
      </ProtectedRoute>
    } />
    <Route path="/seller/edit/:id" element={
      <ProtectedRoute user={user} loading={loading} allowedRoles={["seller"]}>
        <CreateListing user={user} />
      </ProtectedRoute>
    } />
    <Route path="/seller/create-listing" element={<Navigate to="/seller/create" replace />} />
    <Route path="/seller/mandat/:companyId" element={
      <ProtectedRoute user={user} loading={loading} allowedRoles={["seller"]}>
        <MandatePage user={user} />
      </ProtectedRoute>
    } />

    {/* Espace repreneur */}
    <Route path="/buyer/dashboard" element={
      <ProtectedRoute user={user} loading={loading} allowedRoles={["buyer"]}>
        <BuyerDashboard user={user} setUser={setUser} />
      </ProtectedRoute>
    } />
    <Route path="/buyer/credits" element={<Navigate to="/buyer/dashboard" replace />} />

    {/* Administration */}
    <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
    <Route path="/admin/dashboard" element={
      <ProtectedRoute user={user} loading={loading} allowedRoles={["admin"]}>
        <AdminDashboard user={user} setUser={setUser} />
      </ProtectedRoute>
    } />

    {/* Communs aux deux rôles */}
    <Route path="/messages" element={
      <ProtectedRoute user={user} loading={loading}>
        <MessagesPage user={user} />
      </ProtectedRoute>
    } />
    <Route path="/dataroom/:companyId" element={
      <ProtectedRoute user={user} loading={loading}>
        <DataroomPage user={user} setUser={setUser} />
      </ProtectedRoute>
    } />
    <Route path="/vente/:closingId" element={
      <ProtectedRoute user={user} loading={loading}>
        <ClosingPage user={user} setUser={setUser} />
      </ProtectedRoute>
    } />
    <Route path="/profile" element={
      <ProtectedRoute user={user} loading={loading}>
        <ProfilePage user={user} setUser={setUser} />
      </ProtectedRoute>
    } />

    <Route path="*" element={<NotFound user={user} />} />
  </Routes>
);

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem("user");
      }
    }
    setLoading(false);
  }, []);

  // Un 403 « e-mail non confirmé » reçu par n'importe quelle page affiche le bandeau
  useEffect(() => {
    const onNotVerified = () => setUser((u) => (u && u.email_verified !== false ? { ...u, email_verified: false } : u));
    window.addEventListener(EMAIL_NOT_VERIFIED_EVENT, onNotVerified);
    return () => window.removeEventListener(EMAIL_NOT_VERIFIED_EVENT, onNotVerified);
  }, []);

  const emailUnverified = !!user && user.email_verified === false;
  const session = useMemo(() => ({ user, setUser }), [user]);

  return (
    <div className="App">
      <SessionContext.Provider value={session}>
      <BrowserRouter>
        <AppBanners user={user} setUser={setUser} emailUnverified={emailUnverified} />
        <Suspense fallback={<PageLoader />}>
        <AppRoutes user={user} setUser={setUser} loading={loading} />
        </Suspense>
        <AppToaster />
      </BrowserRouter>
      </SessionContext.Provider>
    </div>
  );
}

export default App;
