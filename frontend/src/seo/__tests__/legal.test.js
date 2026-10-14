// Mentions LCEN (art. 6-III et 19) et pied de page légal (SPEC §1) : capital, directrice de la publication,
// téléphone et n° de TVA affichés seulement s'ils sont renseignés, carte T limitée à la transaction.
// Exécution : cd frontend && CI=true npx craco test --watchAll=false src/seo/__tests__/legal.test.js
import { editorLines, mentionsSections, footerLegalLines, carteTText, LEGAL_FALLBACK } from '@/seo/legal';
import { content } from '@/seo';

const label = (lines, l) => (lines.find((x) => x.label === l) || {}).value;

describe('mentions légales (LCEN)', () => {
  test('capital et représentant légal toujours présents, même si l\'API renvoie une valeur vide', () => {
    for (const raw of [null, {}, { capital: '', representant: '' }]) {
      const lines = editorLines(raw);
      expect(label(lines, 'Capital social')).toBe('2 000 €');
      expect(label(lines, 'Représentant légal')).toBe('Romane DA SILVA RIBEIRO');
      const pub = mentionsSections(raw, []).find((s) => s.id === 'publication');
      expect(pub.blocks[0].p).toContain('Romane DA SILVA RIBEIRO');
      expect(pub.blocks[0].p).toContain('directrice de la publication');
    }
  });

  test('téléphone et n° de TVA : affichés seulement s\'ils sont renseignés', () => {
    const none = editorLines({});
    expect(none.map((l) => l.label)).not.toContain('Téléphone');
    expect(none.map((l) => l.label)).not.toContain('N° TVA intracommunautaire');
    const full = editorLines({ telephone: '01 23 45 67 89', tva: 'FR12952180230' });
    expect(full.find((l) => l.label === 'Téléphone')).toEqual({ label: 'Téléphone', value: '01 23 45 67 89', href: 'tel:0123456789' });
    expect(label(full, 'N° TVA intracommunautaire')).toBe('FR12952180230');
    // Synonyme `phone` accepté (LEGAL_PHONE)
    expect(label(editorLines({ phone: '+33 1 23 45 67 89' }), 'Téléphone')).toBe('+33 1 23 45 67 89');
  });

  test('hébergeur : section affichée seulement s\'il est renseigné', () => {
    expect(mentionsSections({}, []).some((s) => s.id === 'hebergement')).toBe(false);
    const s = mentionsSections({ hebergeur: 'Hébergeur X, 1 rue Y, 75000 Paris' }, []).find((x) => x.id === 'hebergement');
    expect(s.blocks[0].p).toContain('Hébergeur X');
  });

  test('carte T : seule l\'activité « Transactions sur immeubles et fonds de commerce » par défaut', () => {
    expect(LEGAL_FALLBACK.carte_t_activities).toEqual(['Transactions sur immeubles et fonds de commerce']);
    expect(carteTText({})).not.toContain('Gestion immobilière');
  });
});

describe('pied de page légal', () => {
  test('dénomination, capital, siège, RCS ; TVA ajoutée si renseignée ; aucune personne physique', () => {
    const lines = footerLegalLines(null);
    expect(lines[0]).toBe('AlterEgo SAS · capital 2 000 € · 43 rue Massenet, 78500 Sartrouville · RCS Versailles 952 180 230');
    expect(lines[1]).toBe('Carte professionnelle T n° CPI 7801 2025 000 000 049 délivrée par la CCI Paris Île-de-France — Transactions sur immeubles et fonds de commerce');
    expect(lines.join(' ')).toContain('ne recevoir ni détenir');
    expect(lines.join(' ')).toContain('loi Hoguet');
    expect(lines.join(' ')).not.toMatch(/Romane|DA SILVA/);
    expect(footerLegalLines({ tva: 'FR12952180230' })[0]).toMatch(/· TVA FR12952180230$/);
    expect(footerLegalLines({ mediateur: 'CM2C' })).toContain('Médiateur de la consommation : CM2C');
  });
});

describe('CGU et mentions légales : portée des offres, modération, DSA', () => {
  const text = (sections) => JSON.stringify(sections);

  test('l\'offre d\'achat n\'emporte pas vente ; rétractation de 10 jours de l\'acquéreur et de 14 jours du mandant', () => {
    const cgu = text(content.legal.cgu.sections);
    expect(cgu).toContain('n\'emporte pas vente');
    expect(cgu).toContain('L271-1');
    expect(cgu).toContain('délai de rétractation de 14 jours');
    expect(cgu).toContain('justificatif de propriété');
    expect(cgu).toContain('engagement de confidentialité et de non-contournement');
  });

  test('vocabulaire VenteLoc : aucun terme hérité de la cession d\'entreprises', () => {
    const all = JSON.stringify(content);
    expect(all).not.toMatch(/repreneur|cédant|bâtiment|\bRGE\b|ADEME|BODACC|offre indicative/i);
  });

  test('aucune promesse de relecture « dans les 48 heures » ; retrait contestable', () => {
    const cgu = text(content.legal.cgu.sections);
    expect(cgu).not.toMatch(/48 heures|48 h\b/);
    expect(cgu).toContain('contester le retrait');
  });

  test('point de contact unique DSA (art. 11 et 12) avec l\'e-mail de contact', () => {
    const s = content.legal.mentions.sections.find((x) => x.id === 'point-de-contact');
    expect(s).toBeDefined();
    expect(s.blocks[0].p).toContain('2022/2065');
    expect(s.blocks[0].p).toContain('{{contactEmail}}');
  });
});
