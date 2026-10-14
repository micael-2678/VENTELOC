// Accès aux contenus éditoriaux partagés (côté React). Le script de pré-rendu lit le même JSON.
import content from '@/seo/content.json';
import { fillOffer } from '@/lib/offer';
import { BRAND, LEGAL } from '@/lib/brand';
import { fillBrand } from '@/seo/inline';

export { content };

// Remplace les jetons d'offre ({{commissionSentence}}…) puis de marque ({{brand}}, {{legalName}}…)
export const BRAND_TOKENS = { ...LEGAL, ...BRAND };
export const fillText = (text) => fillBrand(fillOffer(text), BRAND_TOKENS);
