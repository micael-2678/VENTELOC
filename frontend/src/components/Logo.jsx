import { Link } from 'react-router-dom';
import { logoMarkSvg, LOGO_SRC, LOGO_RATIO } from '@/seo/brand';
import { BRAND } from '@/lib/brand';

// Pictogramme compact (favicons, emplacements trop petits pour le logo)
export const LogoMark = ({ size = 32, className = '' }) => (
  <span
    className={`inline-flex shrink-0 ${className}`}
    style={{ width: size, height: size }}
    // SVG statique interne (aucune donnée utilisateur)
    dangerouslySetInnerHTML={{ __html: logoMarkSvg(size) }}
  />
);

// Nom du service en texte (BRAND.name), dans la police des titres de la charte, en encre (ou blanc sur encre)
export const BrandName = ({ name = BRAND.name, className = '' }) => <span className={className}>{name}</span>;

// Logo AlterEgo (fichier fourni, jamais recoloré ni déformé) + filet + nom du service.
// tone : "dark" (logo noir, sur papier, blanc, sable) | "light" (logo blanc, sur encre uniquement)
const SIZES = { sm: 22, md: 28, lg: 36 };
const Logo = ({ to = '/', tone = 'dark', size = 'md', className = '', withName = true }) => {
  const h = SIZES[size] || SIZES.md;
  const content = (
    <>
      <img
        src={tone === 'light' ? LOGO_SRC.light : LOGO_SRC.dark}
        alt="AlterEgo"
        width={Math.round(h * LOGO_RATIO)}
        height={h}
        style={{ height: h, width: 'auto' }}
        className="shrink-0"
        data-testid="logo-alterego"
      />
      {withName && (
        <>
          <span aria-hidden="true" className={`self-stretch w-px my-0.5 ${tone === 'light' ? 'bg-white/30' : 'bg-brand-line'}`} />
          <span className={`font-display font-extrabold tracking-[-0.025em] leading-none ${size === 'lg' ? 'text-2xl' : 'text-lg'} ${tone === 'light' ? 'text-white' : 'text-brand-ink'}`}>
            <BrandName />
          </span>
        </>
      )}
    </>
  );
  if (!to) return <span className={`inline-flex items-center gap-3 min-w-0 ${className}`}>{content}</span>;
  return (
    <Link to={to} className={`inline-flex items-center gap-3 min-w-0 rounded-md ${className}`} aria-label={`${BRAND.name} par AlterEgo – accueil`}>
      {content}
    </Link>
  );
};

export default Logo;
