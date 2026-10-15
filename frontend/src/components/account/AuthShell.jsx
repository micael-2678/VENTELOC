import Logo from '@/components/Logo';
import { cn } from '@/lib/utils';

// Gabarit des pages de compte (connexion, inscription, mot de passe, confirmation d'e-mail) :
// carte centrée, logo AlterEgo et nom du service, titre et sous-titre. Jamais de nom de marque en dur.
const AuthShell = ({ title, subtitle, children, width = 'max-w-md', footer, testId }) => (
  <div className="min-h-screen bg-brand-surface flex items-center justify-center px-4 py-10 sm:py-14">
    <div className={cn('card w-full p-6 sm:p-8 min-w-0', width)} data-testid={testId}>
      <div className="text-center mb-8">
        <div className="flex justify-center mb-6">
          <Logo size="md" />
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-brand-navy tracking-tight">{title}</h1>
        {subtitle && <p className="text-gray-600 mt-2 leading-relaxed">{subtitle}</p>}
      </div>
      {children}
      {footer && <div className="mt-6 text-center text-gray-600">{footer}</div>}
    </div>
  </div>
);

export default AuthShell;
