import { pictoSvg } from '@/seo/pictos';

// Pictogramme au trait de la charte AlterEgo (src/seo/pictos.js) : couleur du texte, 28 px par défaut
const Picto = ({ name, size = 28, className = '' }) => (
  <span
    className={`inline-flex shrink-0 ${className}`}
    style={{ width: size, height: size }}
    // SVG statique interne (aucune donnée utilisateur)
    dangerouslySetInnerHTML={{ __html: pictoSvg(name, size) }}
  />
);

export default Picto;
