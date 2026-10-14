import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LayoutDashboard, LogOut, Menu, MessageSquare, User, X } from 'lucide-react';
import Logo from '@/components/Logo';
import { axiosInstance } from '@/App';
import { homePathFor } from '@/lib/navigation';
import content from '@/seo/content.json';
import { useSession, clearStoredSession } from '@/components/layout/session';
import { BTN_PRIMARY } from '@/components/shared/buttonStyles';

// En-tête unique de l'application (MODE-TEST-ET-APP.md §A.4) : logo → /, « Annonces », « Vendre mon entreprise »,
// puis « Connexion » / « Créer un compte », ou « Messages » (pastille des non-lus), « Mon espace » et le menu du compte
// (Profil, Déconnexion). Mobile : menu déroulant. En-tête statique (pas de sticky qui recouvrirait les titres).
// Le pré-rendu (scripts/prerender.mjs) reproduit le balisage de l'état déconnecté.

const h = content.header;

export const sellPathFor = (user) => (user?.role === 'seller' ? '/seller/create' : '/register?role=seller');
// « Vendre mon entreprise » : visiteur ou cédant (jamais un repreneur ni un administrateur connecté)
export const canSell = (user) => !user || user.role === 'seller';

// Non-lus : une requête au plus par minute et par compte, partagée entre les pages
const UNREAD_TTL_MS = 60000;
let unreadCache = { userId: null, at: 0, count: 0 };

const countUnread = (data) => {
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.conversations) ? data.conversations : []);
  return list.reduce((sum, c) => sum + (Number(c && c.unread_count) || 0), 0);
};

const useUnreadCount = (user) => {
  const userId = user?.id || null;
  const enabled = Boolean(userId) && (user.role === 'buyer' || user.role === 'seller');
  const [count, setCount] = useState(() => (enabled && unreadCache.userId === userId ? unreadCache.count : 0));
  useEffect(() => {
    if (!enabled) return undefined;
    if (unreadCache.userId === userId && Date.now() - unreadCache.at < UNREAD_TTL_MS) {
      setCount(unreadCache.count);
      return undefined;
    }
    let alive = true;
    // skipAuthRedirect : une session expirée ne doit pas renvoyer vers /login depuis une page publique
    Promise.resolve()
      .then(() => axiosInstance.get('/messages/conversations', { skipAuthRedirect: true }))
      .then((res) => {
        const n = countUnread(res && res.data);
        unreadCache = { userId, at: Date.now(), count: n };
        if (alive) setCount(n);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled, userId]);
  return enabled ? count : 0;
};

const navClass = ({ isActive }) => `inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
  isActive ? 'text-brand-navy bg-brand-surface' : 'text-gray-700 hover:text-brand-navy hover:bg-brand-surface'
}`;

const UnreadBadge = ({ count, className = '' }) => (count > 0 ? (
  <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand-amber text-white text-xs font-bold tabular ${className}`} data-testid="header-unread">
    {count > 99 ? '99+' : count}
    <span className="sr-only"> message{count > 1 ? 's' : ''} non lu{count > 1 ? 's' : ''}</span>
  </span>
) : null);

// Menu du compte : bouton divulgateur (Échap ou clic extérieur pour fermer)
const AccountMenu = ({ user, onLogout }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || h.account;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={menuId}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-brand-navy hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
        data-testid="account-menu-btn"
      >
        <User className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span className="sr-only">{h.account}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} className="absolute right-0 mt-2 w-60 rounded-xl border border-brand-line bg-white shadow-lg p-1.5 z-50" data-testid="account-menu">
          <p className="px-3 py-2 text-sm text-gray-600 truncate border-b border-brand-line mb-1">{name}</p>
          <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-navy hover:bg-brand-surface">
            <User className="w-4 h-4" aria-hidden="true" />{h.profile}
          </Link>
          <button type="button" onClick={onLogout} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-navy hover:bg-brand-surface text-left" data-testid="logout-btn">
            <LogOut className="w-4 h-4" aria-hidden="true" />{h.logout}
          </button>
        </div>
      )}
    </div>
  );
};

const AppHeader = ({ user: userProp, setUser: setUserProp }) => {
  const session = useSession();
  const user = userProp !== undefined ? userProp : session.user;
  const setUser = setUserProp || session.setUser;
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadCount(user);

  useEffect(() => { setOpen(false); }, [pathname]);

  const logout = () => {
    clearStoredSession();
    unreadCache = { userId: null, at: 0, count: 0 };
    if (typeof setUser === 'function') setUser(null);
    setOpen(false);
    navigate('/');
  };

  const sellTo = sellPathFor(user);
  const space = user ? homePathFor(user) : '/';
  // Administrateur : ni « Vendre mon entreprise » ni messagerie (il n'a ni annonce ni conversation). Repreneur :
  // pas de « Vendre mon entreprise » (il faudrait un compte cédant distinct)
  const isAdmin = user?.role === 'admin';
  const showSell = canSell(user);

  return (
    <header className="bg-white border-b border-brand-line" data-testid="app-header">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-brand-navy focus:shadow">
        {h.skip}
      </a>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-6 min-w-0">
          <Logo />
          <nav aria-label="Navigation principale" className="hidden md:flex items-center gap-1">
            <NavLink to="/" end className={navClass} data-testid="nav-listings">{h.listings}</NavLink>
            {showSell && <NavLink to={sellTo} className={navClass} data-testid="nav-sell">{h.sell}</NavLink>}
          </nav>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {user ? (
            <>
              {!isAdmin && (
                <NavLink to="/messages" className={(s) => `${navClass(s)} gap-1.5`} data-testid="nav-messages">
                  <MessageSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="sr-only lg:not-sr-only">{h.messages}</span>
                  <UnreadBadge count={unread} />
                </NavLink>
              )}
              <Link to={space} className={`${BTN_PRIMARY} hidden md:inline-flex px-4 py-2 text-sm`} data-testid="nav-space">
                <LayoutDashboard className="w-4 h-4" aria-hidden="true" />{h.space}
              </Link>
              <div className="hidden md:block"><AccountMenu user={user} onLogout={logout} /></div>
            </>
          ) : (
            <>
              <Link to="/login" className="hidden sm:inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium text-brand-navy hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue" data-testid="nav-login">{h.login}</Link>
              <Link to="/register" className={`${BTN_PRIMARY} hidden md:inline-flex px-4 py-2 text-sm`} data-testid="nav-register">{h.register}</Link>
            </>
          )}
          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl text-brand-navy hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            aria-expanded={open}
            aria-controls="menu-mobile"
            aria-label={open ? h.menuClose : h.menuOpen}
            onClick={() => setOpen((v) => !v)}
            data-testid="mobile-menu-btn"
          >
            {open ? <X className="w-6 h-6" aria-hidden="true" /> : <Menu className="w-6 h-6" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="menu-mobile" aria-label="Menu" className="md:hidden border-t border-brand-line bg-white px-4 pb-4 pt-2" data-testid="mobile-menu">
          <ul className="space-y-1">
            <li><NavLink to="/" end className={({ isActive }) => `block px-3 py-3 rounded-lg font-medium ${isActive ? 'bg-brand-surface text-brand-navy' : 'text-gray-800 hover:bg-brand-surface'}`}>{h.listings}</NavLink></li>
            {showSell && <li><Link to={sellTo} className="block px-3 py-3 rounded-lg font-medium text-gray-800 hover:bg-brand-surface">{h.sell}</Link></li>}
            {user ? (
              <>
                <li><Link to={space} className="block px-3 py-3 rounded-lg font-medium text-gray-800 hover:bg-brand-surface">{h.space}</Link></li>
                <li><Link to="/profile" className="block px-3 py-3 rounded-lg font-medium text-gray-800 hover:bg-brand-surface">{h.profile}</Link></li>
                <li>
                  <button type="button" onClick={logout} className="w-full text-left px-3 py-3 rounded-lg font-medium text-gray-800 hover:bg-brand-surface" data-testid="mobile-logout">{h.logout}</button>
                </li>
              </>
            ) : (
              <>
                <li><Link to="/login" className="block px-3 py-3 rounded-lg font-medium text-gray-800 hover:bg-brand-surface" data-testid="mobile-login">{h.login}</Link></li>
                <li><Link to="/register" className="block px-3 py-3 rounded-lg font-medium text-gray-800 hover:bg-brand-surface">{h.register}</Link></li>
              </>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
};

export default AppHeader;
