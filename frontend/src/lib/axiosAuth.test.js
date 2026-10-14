// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/lib/axiosAuth.test.js
import { loginRedirectPath } from '@/lib/axiosAuth';

describe('loginRedirectPath (401 → /login?redirect=…)', () => {
  test('mémorise la page en cours, requête comprise', () => {
    expect(loginRedirectPath({ pathname: '/seller/mandat/c1', search: '' })).toBe('/login?redirect=%2Fseller%2Fmandat%2Fc1');
    expect(loginRedirectPath({ pathname: '/seller/dashboard', search: '?annonce=c1&onglet=offers' }))
      .toBe(`/login?redirect=${encodeURIComponent('/seller/dashboard?annonce=c1&onglet=offers')}`);
  });

  test('pas de redirect depuis /login, l\'accueil ou un chemin non interne', () => {
    expect(loginRedirectPath({ pathname: '/login', search: '?redirect=%2Fx' })).toBe('/login');
    expect(loginRedirectPath({ pathname: '/', search: '' })).toBe('/login');
    expect(loginRedirectPath({ pathname: '//evil.example', search: '' })).toBe('/login');
    expect(loginRedirectPath(undefined)).toBe('/login');
  });
});
