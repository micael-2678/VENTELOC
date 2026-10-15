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
// Bandeau du mode test : ne s'affiche que si GET /config renvoie test_mode (MODE-TEST.md §3)
import TestModeBanner from "@/components/test/TestModeBanner";
import { SessionContext } from "@/components/layout/session";
import { initAnalytics } from "@/lib/analytics";
import { loginRedirectPath } from "@/lib/axiosAuth";
import { homePathFor } from "@/lib/navigation";
import { testPanelHeaders } from "@/lib/testMode";

// Pages chargées à la demande (code-splitting) : le visiteur de l'accueil ne télécharge pas
// les tableaux de bord, l'administration ni le lecteur PDF. Routes : docs/venteloc/API.md §10 (annonces sur /, fiche
// /annonce/:id, page vendeur /vendre, estimateur /estimer, module /embed/annonces, panneau /test).
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const RegisterPage = lazy(() => import("@/pages/RegisterPage"));
const ConfirmEmailPage = lazy(() => import("@/pages/ConfirmEmailPage"));
const EstimatePage = lazy(() => import("@/pages/EstimatePage"));
const SellPage = lazy(() => import("@/pages/SellPage"));
const SellerDashboard = lazy(() => import("@/pages/SellerDashboard"));
const BuyerDashboard = lazy(() => import("@/pages/BuyerDashboard"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const CreateListing = lazy(() => import("@/pages/CreateListing"));
const MandatePage = lazy(() => import("@/pages/MandatePage"));
const PropertyDetail = lazy(() => import("@/pages/PropertyDetail"));
const MessagesPage = lazy(() => import("@/pages/MessagesPage"));
const DataroomPage = lazy(() => import("@/pages/DataroomPage"));
const ClosingPage = lazy(() => import("@/pages/ClosingPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const FollowupPage = lazy(() => import("@/pages/FollowupPage"));
const KYCCallbackPage = lazy(() => import("@/components/KYCVerification").then((m) => ({ default: m.KYCCallbackPage })));
// Mode test (MODE-TEST.md) : panneau /test chargé à la demande
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
export const EMAIL_NOT_VERIFIED_EVENT = "venteloc:email-not-verified";
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
const ROLE_ONLY_LABEL = { seller: "vendeur", buyer: "acquéreur", admin: "administrateur" };
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

// Liens à paramètre de chemin (e-mails : /reset-password/:token, /suivi/:token) → pages qui lisent ?token=
const TokenQueryRedirect = ({ to, extra = "" }) => {
  const { token } = useParams();
  return <Navigate to={`${to}?token=${encodeURIComponent(token || "")}${extra}`} replace />;
};

// Table des routes (exportée pour les tests : src/pages/__tests__/redirects.test.jsx)
export const AppRoutes = ({ user, setUser, loading }) => (
  <Routes>
    {/* Pages publiques */}
    <Route path="/" element={<ListingsPage user={user} />} />
    <Route path="/embed/annonces" element={<EmbedListingsPage />} />
    <Route path="/annonce/:id" element={<PropertyDetail user={user} />} />
    <Route path="/vendre" element={<SellPage user={user} />} />
    <Route path="/estimer" element={<EstimatePage user={user} />} />
    <Route path="/mentions-legales" element={<MentionsLegalesPage user={user} />} />
    <Route path="/confidentialite" element={<PrivacyPage user={user} />} />
    <Route path="/cgu" element={<CguPage user={user} />} />
    <Route path="/signaler" element={<ReportPage user={user} />} />
    <Route path="/test" element={<TestModePage user={user} setUser={setUser} />} />

    {/* Compte */}
    <Route path="/login" element={<LoginPage setUser={setUser} />} />
    <Route path="/register" element={<RegisterPage setUser={setUser} />} />
    <Route path="/mot-de-passe-oublie" element={<ResetPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/reset-password/:token" element={<TokenQueryRedirect to="/reset-password" />} />
    <Route path="/confirmer-email/:token" element={<ConfirmEmailPage user={user} setUser={setUser} />} />
    <Route path="/suivi" element={<FollowupPage />} />
    <Route path="/suivi/:token" element={<TokenQueryRedirect to="/suivi" />} />

    {/* KYC Callback Route */}
    <Route path="/kyc/callback" element={
      <ProtectedRoute user={user} loading={loading}>
        <KYCCallbackPage user={user} />
      </ProtectedRoute>
    } />

    {/* Espace vendeur */}
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
    <Route path="/seller/mandat/:propertyId" element={
      <ProtectedRoute user={user} loading={loading} allowedRoles={["seller"]}>
        <MandatePage user={user} />
      </ProtectedRoute>
    } />

    {/* Espace acquéreur */}
    <Route path="/buyer/dashboard" element={
      <ProtectedRoute user={user} loading={loading} allowedRoles={["buyer"]}>
        <BuyerDashboard user={user} setUser={setUser} />
      </ProtectedRoute>
    } />

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
    <Route path="/dataroom/:propertyId" element={
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
