// Parcours public VenteLoc (docs/venteloc/SPEC.md §5.1) : page des annonces sur / (H1, « Comment ça marche », filtres
// type / bail / région / rendement dans l'URL, tri, état vide sans « 0 », alerte), carte (rendement brut, loyer, prix
// honoraires inclus), fiche /annonce/:id (chiffres clés, DPE, honoraires, adresse jamais publiée), page /vendre
// (honoraires TTC, calculateur, FAQ), estimateur /estimer, module /embed/annonces, pages légales, 404, anciennes URL
// CessionRGE en 404, mobile 390 px sans débordement horizontal.
// Seed attendu (SEED_FILE) : property_id (bien publié), property_address (son adresse, jamais publique).
const L = require('./lib');

(async () => {
  const browser = await L.launch();
  const errors = [];
  const s = L.seed();
  let p = await L.makePage(browser, { errors });

  // ---- Page des annonces
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=listings-grid], [data-testid=listings-empty]', { timeout: 10000 });
  let t = await L.text(p);
  const h1 = await p.locator('h1').first().innerText();
  L.check('annonces : H1 « Biens loués à vendre »', h1.trim() === 'Biens loués à vendre', h1);
  L.check('annonces : phrase d\'accroche', /Investissements locatifs vendus par leurs propriétaires\./.test(t));
  L.check('annonces : « Comment ça marche » repliable', (await p.getByTestId('how-it-works-toggle').count()) === 1);
  L.check('annonces : cartes du jeu de données', (await p.getByTestId('listing-card').count()) >= 2, String(await p.getByTestId('listing-card').count()));
  L.check('annonces : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  L.check('annonces : en-tête Biens à vendre / Vendre mon bien / Connexion', (await p.getByTestId('nav-listings').count()) === 1
    && (await p.getByTestId('nav-sell').getAttribute('href')) === '/vendre' && (await p.getByTestId('nav-login').count()) === 1);
  L.check('annonces : encart vendeur vers /vendre', (await p.getByTestId('seller-callout').first().locator('a').getAttribute('href')) === '/vendre');
  L.check('annonces : pied de page légal (AlterEgo, carte T)', /AlterEgo/.test(await p.getByTestId('footer-legal').innerText()) && /carte professionnelle T/i.test(await p.getByTestId('footer-legal').innerText()));
  const prices = await p.getByTestId('listing-card-price').allInnerTexts();
  L.check('cartes : prix lisibles (séparateur de milliers visible, jamais l\'espace fine U+202F)', prices.length > 0
    && prices.every((x) => /^\d{1,3}(\u00a0\d{3})+\u00a0€$/.test(x.trim()) && !x.includes('\u202f')), prices.join(' | '));
  const yields = await p.getByTestId('listing-card-yield').allInnerTexts();
  L.check('cartes : rendement brut mis en avant', yields.length > 0 && yields.every((y) => /^\d+,\d\u00a0%$/.test(y.trim())), yields.join(' | '));
  L.check('cartes : mention « honoraires inclus, à la charge du vendeur »', /Honoraires inclus, à la charge du vendeur/.test(t));
  L.check('cartes : jamais l\'adresse exacte', !s.property_address || !t.includes(s.property_address), s.property_address);
  await L.shot(p, 'listings-desktop.png');

  // Filtres : type de bien (colonne latérale) → URL ?type=, puis rendement minimum et tri par rendement
  await p.goto(L.FRONT + '/mentions-legales', { waitUntil: 'networkidle' });
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=listing-card]');
  await p.locator('#filtres-type-appartement').check();
  await p.waitForURL(/type=appartement/);
  await L.sleep(600);
  L.check('filtres : type dans l\'URL', /type=appartement/.test(p.url()), p.url());
  L.check('filtres : puce « Appartement »', /Appartement/.test(await p.getByTestId('active-filters').innerText()));
  L.check('filtres : H1 de la recherche « Appartements loués à vendre »', /^Appartements loués à vendre/.test((await p.locator('h1').first().innerText()).trim()));
  await p.getByTestId('filter-rendement-min').first().selectOption('4');
  await p.waitForURL(/rendement_min=4/);
  await p.getByTestId('sort-select').selectOption('rendement_desc');
  await p.waitForURL(/tri=rendement_desc/);
  await L.sleep(500);
  const sorted = (await p.getByTestId('listing-card-yield').allInnerTexts()).map((y) => Number(y.replace(/[^\d,]/g, '').replace(',', '.')));
  L.check('tri « Meilleur rendement » : rendements décroissants, tous ≥ 4 %', sorted.every((y, i) => y >= 4 && (i === 0 || y <= sorted[i - 1])), sorted.join(' '));
  // Réglages de filtres sans entrée d'historique : Retour ramène à la page précédente (ici les mentions légales)
  await p.goBack({ waitUntil: 'networkidle' });
  L.check('filtres : Retour → page d\'origine (pas le réglage précédent)', /^\/mentions-legales\/?$/.test(new URL(p.url()).pathname), p.url());
  // Aucun résultat → état vide sans 0 + alerte + « Effacer les filtres »
  await p.goto(L.FRONT + '/?type=bureaux&rendement_min=20', { waitUntil: 'networkidle' });
  await L.sleep(500);
  t = await L.text(p);
  L.check('état vide « Aucun bien ne correspond pour l\'instant » + alerte', /Aucun bien ne correspond pour l'instant/.test(t) && (await p.getByTestId('alert-form').count()) >= 1, t.slice(0, 200));
  L.check('état vide : aucun « 0 » affiché', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  await p.getByTestId('empty-reset').click();
  await p.waitForURL((u) => u.pathname === '/' && !u.search);
  L.check('état vide : « Effacer les filtres » → /', new URL(p.url()).search === '', p.url());

  // ---- Fiche (visiteur)
  await p.waitForSelector(`a[href="/annonce/${s.property_id}"]`);
  await p.locator(`a[href="/annonce/${s.property_id}"]`).first().click();
  await p.waitForURL(new RegExp(`/annonce/${s.property_id}`));
  await p.waitForSelector('[data-testid=property-header]');
  t = await L.text(p);
  L.check('fiche : chiffres clés (prix, loyer, rendement brut)', /\d/.test(await p.getByTestId('asking-price').innerText()) && /€\/mois/.test(await p.getByTestId('rent-monthly').innerText()) && /%/.test(await p.getByTestId('gross-yield').innerText()));
  L.check('fiche : adresse exacte jamais publiée', !s.property_address || !t.includes(s.property_address), s.property_address);
  L.check('fiche : honoraires à la charge du vendeur, TTC puis HT', /Honoraires de négociation à la charge du vendeur : [\d\s\u202f\u00a0]+€ TTC \([\d\s\u202f\u00a0]+€ HT\)/.test(await p.getByTestId('fees').innerText()));
  L.check('fiche : section DPE', (await p.getByTestId('section-dpe').count()) === 1);
  L.check('fiche : visites encadrées (art. 4 loi de 1989)', /2 heures maximum par jour ouvrable/.test(t));
  L.check('fiche : fil d\'Ariane vers les annonces', (await p.locator('nav[aria-label="Fil d\'Ariane"] a[href="/"]').count()) === 1);
  L.check('fiche : CTA « Présenter mon projet au vendeur »', /Présenter mon projet au vendeur/.test(await p.getByTestId('contact-seller-btn').first().innerText()));
  L.check('fiche : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  L.check('fiche : vocabulaire VenteLoc', !/repreneur|cédant|\bRGE\b/i.test(t));
  await p.getByTestId('contact-seller-btn').first().click();
  await p.waitForURL(/\/(login|register)/);
  L.check('fiche : visiteur renvoyé vers connexion/inscription', /\/(login|register)/.test(p.url()), p.url());
  await p.goto(L.FRONT + `/annonce/${s.property_id}`, { waitUntil: 'networkidle' });
  await L.shot(p, 'property-desktop.png');

  // ---- Page vendeur /vendre
  await p.goto(L.FRONT + '/vendre', { waitUntil: 'networkidle' });
  t = await L.text(p);
  L.check('vendre : H1', (await p.getByTestId('sell-h1').innerText()).trim() === 'Vendez votre bien loué à un investisseur');
  L.check('vendre : honoraires TTC d\'abord', /^[\d,]+\u00a0% TTC du prix de vente \([\d,]+\u00a0% HT\)/.test((await p.getByTestId('commission-sentence').innerText()).trim()));
  await p.getByTestId('fees-price-input').fill('250000');
  L.check('vendre : calculateur (honoraires TTC, montant perçu)', /€/.test(await p.getByTestId('fees-ttc').innerText()) && /€/.test(await p.getByTestId('fees-net').innerText()));
  L.check('vendre : FAQ en 5 questions', (await p.getByTestId('sell-faq').locator('li').count()) === 5);
  L.check('vendre : CTA estimer et déposer', (await p.getByTestId('sell-estimate-hero').getAttribute('href')) === '/estimer' && (await p.getByTestId('sell-deposit-hero').getAttribute('href')) === '/register?role=seller');
  await L.shot(p, 'sell-desktop.png');

  // ---- Estimateur
  await p.goto(L.FRONT + '/estimer', { waitUntil: 'networkidle' });
  await p.getByTestId('estimate-type-select').selectOption('appartement');
  await p.getByTestId('estimate-department-select').selectOption('69');
  await p.getByTestId('estimate-rent-input').fill('780');
  await p.getByTestId('estimate-submit').click();
  await p.getByTestId('estimate-result').waitFor({ timeout: 10000 });
  L.check('estimateur : fourchette et rendement à la valeur centrale', /€/.test(await p.getByTestId('estimate-range').innerText()) && /%/.test(await p.getByTestId('estimate-yields').innerText()));

  // ---- Anciennes URL CessionRGE : 404 (nouveau domaine, aucune redirection)
  for (const from of ['/entreprises-a-vendre?metiers=isolation', '/vendre-mon-entreprise-batiment', `/property/${s.property_id}`]) {
    await p.goto(L.FRONT + from, { waitUntil: 'networkidle' });
    await L.sleep(300);
    L.check(`ancienne URL ${from} → 404`, (await p.getByTestId('not-found').count()) === 1, p.url());
  }

  // ---- Module intégrable
  await p.goto(L.FRONT + '/embed/annonces?limit=1', { waitUntil: 'networkidle' });
  await L.sleep(400);
  L.check('embed : 1 carte, sans en-tête', (await p.getByTestId('listing-card').count()) === 1 && (await p.getByTestId('app-header').count()) === 0);
  L.check('embed : liens target=_top', (await p.locator('[data-testid=listing-card-link][target=_top]').count()) === 1 && (await p.getByTestId('embed-all').getAttribute('target')) === '_top');
  L.check('embed : liens marqués utm_source=wordpress', /^\/annonce\/.+utm_source=wordpress&utm_medium=embed/.test(await p.getByTestId('listing-card-link').first().getAttribute('href') || '')
    && /utm_source=wordpress/.test(await p.getByTestId('embed-all').getAttribute('href') || ''));

  // ---- Pages légales, 404
  await p.goto(L.FRONT + '/mentions-legales', { waitUntil: 'networkidle' });
  t = await L.text(p);
  L.check('mentions : AlterEgo, carte T, honoraires, sans « à compléter »', /AlterEgo/.test(t) && /carte/i.test(t) && /à la charge du vendeur/.test(t) && !/à compléter/.test(t));
  await p.goto(L.FRONT + '/cgu', { waitUntil: 'networkidle' });
  t = await L.text(p);
  L.check('CGU : justificatif de propriété, rétractation 14 jours, offre d\'achat qui n\'emporte pas vente', /justificatif de propriété/.test(t) && /14 jours/.test(t) && /n'emporte pas vente/.test(t));
  await p.goto(L.FRONT + '/page-inexistante', { waitUntil: 'networkidle' });
  L.check('404 en français', /introuvable|n'existe/i.test(await L.text(p)));
  await p.context().close();

  // ---- Mobile 390 px
  p = await L.makePage(browser, { errors, viewport: { width: 390, height: 844 } });
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  let o = await L.noOverflow(p, 390);
  L.check('mobile annonces : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await L.shot(p, 'listings-mobile.png');
  await p.getByTestId('mobile-filters-btn').click();
  await p.getByTestId('mobile-filters').waitFor();
  o = await L.noOverflow(p, 390);
  L.check('mobile : panneau de filtres plein écran sans débordement', o.ok, `scrollWidth=${o.width}`);
  await p.locator('#mobile-type-appartement').check();
  await p.waitForFunction(() => /^Afficher \d+ biens?$|Aucun bien/.test(((document.querySelector('[data-testid=mobile-filters-apply]') || {}).innerText || '').trim()), null, { timeout: 5000 }).catch(() => {});
  L.check('mobile : le bouton du panneau annonce le nombre de biens', /^Afficher \d+ biens?$/.test((await p.getByTestId('mobile-filters-apply').innerText()).trim()), await p.getByTestId('mobile-filters-apply').innerText());
  await p.getByTestId('mobile-filters-apply').click();
  await p.waitForURL(/type=appartement/);
  L.check('mobile : filtre appliqué depuis le panneau', /type=appartement/.test(p.url()), p.url());
  for (const [url, name] of [[`/annonce/${s.property_id}`, 'property'], ['/vendre', 'sell'], ['/estimer', 'estimate']]) {
    await p.goto(L.FRONT + url, { waitUntil: 'networkidle' });
    await L.sleep(300);
    o = await L.noOverflow(p, 390);
    L.check(`mobile ${url} : aucun débordement horizontal`, o.ok, `scrollWidth=${o.width}`);
    await L.shot(p, `${name}-mobile.png`);
  }
  await p.context().close();

  L.check('aucune erreur JS / 5xx', errors.length === 0, errors.join(' ; '));
  const ok = L.summary();
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
