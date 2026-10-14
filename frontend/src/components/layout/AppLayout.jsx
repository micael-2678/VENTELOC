import AppHeader from '@/components/layout/AppHeader';
import AppFooter from '@/components/layout/AppFooter';

// Gabarit commun des pages publiques : en-tête, contenu principal (#contenu, cible du lien d'évitement), pied de page.
const AppLayout = ({ user, setUser, children, className = 'bg-white' }) => (
  <div className={`min-h-screen flex flex-col overflow-x-hidden ${className}`}>
    <AppHeader user={user} setUser={setUser} />
    <main id="contenu" className="flex-1 min-w-0">{children}</main>
    <AppFooter />
  </div>
);

export default AppLayout;
