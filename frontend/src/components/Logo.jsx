import { Link } from 'react-router-dom';
import { logoMarkSvg } from '@/seo/brand';
import { BRAND, splitBrandName } from '@/lib/brand';

// Pictogramme seul (maison + clé)
export const LogoMark = ({ size = 32, className = '' }) => (
  <span
    className={`inline-flex shrink-0 ${className}`}
    style={{ width: size, height: size }}
    // SVG statique interne (aucune donnée utilisateur)
    dangerouslySetInnerHTML={{ __html: logoMarkSvg(size) }}
  />
);

// Nom de marque en texte : la partie après la majuscule interne est colorée (« Vente » + « Loc » en teal).
// Le vert reste réservé aux badges de vérification. tone : "dark" (sur fond clair) | "light" (sur fond sombre)
export const BrandName = ({ name = BRAND.name, tone = 'dark', className = '' }) => {
  const { head, tail } = splitBrandName(name);
  return (
    <span className={className}>
      {head}
      {tail && <span className={tone === 'light' ? 'text-teal-300' : 'text-brand-teal'}>{tail}</span>}
    </span>
  );
};

// Wordmark (BRAND.name) + pictogramme. tone : "dark" (sur fond clair) | "light" (sur fond sombre)
const Logo = ({ to = '/', tone = 'dark', size = 'md', className = '' }) => {
  const mark = size === 'sm' ? 26 : size === 'lg' ? 40 : 32;
  const text = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-xl sm:text-2xl';
  const content = (
    <>
      <LogoMark size={mark} />
      <span className={`font-display font-extrabold tracking-tight leading-none ${text} ${tone === 'light' ? 'text-white' : 'text-brand-navy'}`}>
        <BrandName tone={tone} />
      </span>
    </>
  );
  if (!to) return <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>{content}</span>;
  return (
    <Link to={to} className={`inline-flex items-center gap-2 min-w-0 ${className}`} aria-label={`${BRAND.name} – accueil`}>
      {content}
    </Link>
  );
};

export default Logo;
