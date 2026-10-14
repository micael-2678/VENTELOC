import { cn } from '@/lib/utils';
import { dpeLabel } from '@/lib/referentiels';

// Pastille DPE (classe énergie A à G) aux couleurs réglementaires de l'étiquette énergie. Texte navy sur les classes
// claires (B à F), blanc sur A et G (contraste suffisant pour un texte gras). « DPE vierge » et « non soumis » : pastille
// grise en toutes lettres.
export const DPE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const WHITE_TEXT = ['A', 'G'];
const BG = { A: 'bg-dpe-A', B: 'bg-dpe-B', C: 'bg-dpe-C', D: 'bg-dpe-D', E: 'bg-dpe-E', F: 'bg-dpe-F', G: 'bg-dpe-G' };

export const isDpeLetter = (value) => DPE_LETTERS.includes(String(value || '').toUpperCase());

const DpePill = ({ value, size = 'md', withLabel = false, kind = 'DPE', className = '' }) => {
  const v = String(value || '').trim();
  if (!v) return null;
  const letter = v.toUpperCase();
  if (!isDpeLetter(letter)) {
    return (
      <span className={cn('badge badge-declared', className)} data-testid="dpe-pill" data-dpe={v}>
        {dpeLabel(v) || v}
      </span>
    );
  }
  const box = size === 'lg' ? 'w-10 h-10 text-xl' : size === 'sm' ? 'w-6 h-6 text-sm' : 'w-7 h-7 text-base';
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} data-testid="dpe-pill" data-dpe={letter}>
      {withLabel && <span className="text-xs font-semibold text-gray-600">{kind}</span>}
      <span
        className={cn('dpe-pill', box, BG[letter], WHITE_TEXT.includes(letter) ? 'text-white' : 'text-brand-navy')}
        role="img"
        aria-label={`${kind === 'GES' ? 'GES' : 'DPE'} classe ${letter}`}
      >
        {letter}
      </span>
    </span>
  );
};

// Échelle A à G, la classe du bien mise en avant (fiche) ; GES en gris (couleurs propres non reproduites)
export const DpeScale = ({ value, caption }) => {
  const current = String(value || '').toUpperCase();
  if (!isDpeLetter(current)) return null;
  return (
    <figure className="min-w-0" data-testid="dpe-scale">
      <ol className="flex flex-col gap-1" aria-label={`Échelle énergie, classe ${current}`}>
        {DPE_LETTERS.map((l, i) => {
          const active = l === current;
          return (
            <li key={l} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex items-center justify-end rounded-r-full h-6 pr-2 text-sm font-bold tabular',
                  BG[l],
                  WHITE_TEXT.includes(l) ? 'text-white' : 'text-brand-navy',
                  active ? 'ring-2 ring-brand-navy ring-offset-1' : 'opacity-60',
                )}
                style={{ width: `${28 + i * 8}%` }}
                aria-hidden={!active}
              >
                {l}
              </span>
              {active && <span className="text-sm font-semibold text-brand-navy whitespace-nowrap">Classe {l}</span>}
            </li>
          );
        })}
      </ol>
      {caption && <figcaption className="text-xs text-gray-600 mt-2">{caption}</figcaption>}
    </figure>
  );
};

export default DpePill;
