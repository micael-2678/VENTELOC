// Parcours public (MODE-TEST-ET-APP.md §A) : page des annonces sur / (H1, filtres dans l'URL, état vide sans « 0 »,
// alerte), fiche anonyme, anciennes URL redirigées, module /embed/annonces, pages légales, 404, mobile 390 px
// (page des annonces, panneau de filtres, fiche) sans débordement horizontal.
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
  L.check('annonces : H1 « Entreprises du bâtiment à vendre »', h1.trim() === 'Entreprises du bâtiment à vendre', h1);
  L.check('annonces : phrase d\'accroche', /Annonces anonymes de cédants vérifiés\. Contact gratuit pour les repreneurs\./.test(t));
  L.check('annonces : cartes du jeu de données', (await p.getByTestId('listing-card').count()) >= 2, String(await p.getByTestId('listing-card').count()));
  L.check('annonces : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  L.check('annonces : en-tête Annonces / Vendre mon entreprise / Connexion', (await p.getByTestId('nav-listings').count()) === 1
    && /register\?role=seller/.test(await p.getByTestId('nav-sell').getAttribute('href') || '') && (await p.getByTestId('nav-login').count()) === 1);
  L.check('annonces : encart cédant vers l\'inscription', /register\?role=seller/.test(await p.getByTestId('seller-callout').first().locator('a').getAttribute('href') || ''));
  L.check('annonces : pied de page légal (AlterEgo, carte T)', /AlterEgo/.test(await p.getByTestId('footer-legal').innerText()) && /carte professionnelle T/i.test(await p.getByTestId('footer-legal').innerText()));
  const prices = await p.getByTestId('listing-card-price').allInnerTexts();
  L.check('cartes : prix lisibles (séparateur de milliers visible, jamais l\'espace fine U+202F)', prices.length > 0
    && prices.every((x) => /^\d{1,3}(\u00a0\d{3})+\u00a0€$/.test(x.trim()) && !x.includes('\u202f')), prices.join(' | '));
  await L.shot(p, 'listings-desktop.png');

  // Filtre région Bretagne (colonne latérale) → URL ?region=bretagne, 1 résultat (RENOV OUEST)
  await p.goto(L.FRONT + '/mentions-legales', { waitUntil: 'networkidle' });
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=listing-card]');
  await p.getByTestId('filter-region').first().selectOption({ label: 'Bretagne' });
  await p.waitForURL(/region=bretagne/);
  await L.sleep(800);
  L.check('filtres : région dans l\'URL', /region=bretagne/.test(p.url()), p.url());
  L.check('filtres : 1 résultat en Bretagne', (await p.getByTestId('listing-card').count()) === 1, String(await p.getByTestId('listing-card').count()));
  L.check('filtres : puce « Bretagne »', /Bretagne/.test(await p.getByTestId('active-filters').innerText()));
  L.check('filtres : H1 de la recherche « … à vendre en Bretagne »', /à vendre en Bretagne$/.test((await p.locator('h1').first().innerText()).trim()));
  await p.getByTestId('sort-select').selectOption('prix_asc');
  await p.waitForURL(/tri=prix_asc/);
  // Réglages de filtres sans entrée d'historique : Retour ramène à la page précédente (ici les mentions légales)
  await p.goBack({ waitUntil: 'networkidle' });
  L.check('filtres : Retour → page d\'origine (pas le réglage précédent)', /^\/mentions-legales\/?$/.test(new URL(p.url()).pathname), p.url());
  // Lien filtré (WordPress) : ?metier=
  await p.goto(L.FRONT + '/?metier=pac-clim-cvc', { waitUntil: 'networkidle' });
  await L.sleep(500);
  L.check('lien filtré : métier pac-clim-cvc → 1 résultat', (await p.getByTestId('listing-card').count()) === 1);
  L.check('lien filtré : H1 « Entreprises de PAC, climatisation à vendre »', (await p.locator('h1').first().innerText()).trim() === 'Entreprises de PAC, climatisation à vendre');
  // Chiffre d'affaires et effectif minimum : filtrés par le serveur (min_ca, min_staff), total exact
  await p.goto(L.FRONT + '/?ca_min=500000', { waitUntil: 'networkidle' });
  await L.sleep(500);
  L.check('lien filtré : CA ≥ 500 000 € → 1 résultat (800 k€)', (await p.getByTestId('listing-card').count()) === 1
    && /^1 annonce$/.test((await p.getByTestId('results-count').innerText()).trim()), await p.getByTestId('results-count').innerText().catch(() => ''));
  await p.goto(L.FRONT + '/?effectif_min=5&tri=prix_asc', { waitUntil: 'networkidle' });
  await L.sleep(500);
  L.check('lien filtré : effectif ≥ 5 → 1 résultat (8 salariés)', (await p.getByTestId('listing-card').count()) === 1);
  // Aucun résultat → état vide sans 0 + alerte + « Effacer les filtres »
  await p.goto(L.FRONT + '/?metier=piscine-paysage', { waitUntil: 'networkidle' });
  await L.sleep(500);
  t = await L.text(p);
  L.check('état vide « Aucune annonce ne correspond pour l\'instant » + alerte', /Aucune annonce ne correspond pour l'instant/.test(t) && (await p.getByTestId('alert-form').count()) >= 1, t.slice(0, 200));
  L.check('état vide : aucun « 0 » affiché', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  await p.getByTestId('empty-reset').click();
  await p.waitForURL((u) => u.pathname === '/' && !u.search);
  L.check('état vide : « Effacer les filtres » → /', new URL(p.url()).search === '', p.url());

  // ---- Fiche (visiteur)
  await p.waitForSelector(`a[href="/company/${s.company_id}"]`);
  await p.locator(`a[href="/company/${s.company_id}"]`).first().click();
  await p.waitForURL(new RegExp(`/company/${s.company_id}`));
  await p.waitForSelector('[data-testid=company-header]');
  t = await L.text(p);
  L.check('fiche : titre anonyme', /Entreprise de PAC/.test(t) && !/SECRET ENERGIE/.test(t), t.slice(0, 200));
  L.check('fiche : prix, CA, EBE affichés', /450\s?000/.test(t) && /800\s?000/.test(t) && /120\s?000/.test(t));
  L.check('fiche : fil d\'Ariane vers les annonces', (await p.locator('nav[aria-label="Fil d\'Ariane"] a[href="/"]').count()) === 1);
  L.check('fiche : CTA « Présenter mon projet au cédant »', /Présenter mon projet/.test(await p.getByTestId('contact-seller-btn').first().innerText()));
  L.check('fiche : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  await p.getByTestId('contact-seller-btn').first().click();
  await p.waitForURL(/\/(login|register)/);
  L.check('fiche : visiteur renvoyé vers connexion/inscription', /\/(login|register)/.test(p.url()), p.url());
  await p.goto(L.FRONT + `/company/${s.company_id}`, { waitUntil: 'networkidle' });
  await L.shot(p, 'company-desktop.png');

  // ---- Anciennes URL → page des annonces (301 nginx ou redirection côté client)
  const redirects = [
    ['/entreprises-a-vendre?metiers=pac-clim-cvc', '/?metier=pac-clim-cvc'],
    ['/search?rge_type=Pompes%20%C3%A0%20chaleur%20air%2Feau', '/?metier=pac-clim-cvc&rge=1'],
    ['/entreprises-batiment-a-vendre/metier/menuiserie', '/?metier=menuiserie'],
    ['/entreprises-rge-a-vendre/region/bretagne', '/?region=bretagne&rge=1'],
    ['/guides/combien-vaut-entreprise-batiment', '/'],
  ];
  for (const [from, to] of redirects) {
    await p.goto(L.FRONT + from, { waitUntil: 'networkidle' });
    await L.sleep(300);
    const u = new URL(p.url());
    const got = `${u.pathname}${u.search}`;
    const same = u.pathname === '/' && JSON.stringify([...new URLSearchParams(u.search)].sort()) === JSON.stringify([...new URLSearchParams(to.split('?')[1] || '')].sort());
    L.check(`redirection ${from} → ${to}`, same, got);
  }
  // Anciennes pages « vendre » : entrée du parcours cédant (estimateur), pas la liste des annonces
  await p.goto(L.FRONT + '/vendre-mon-entreprise-batiment', { waitUntil: 'networkidle' });
  await L.sleep(300);
  L.check('redirection /vendre-mon-entreprise-batiment → /estimer', new URL(p.url()).pathname === '/estimer', p.url());

  // ---- Module intégrable
  await p.goto(L.FRONT + '/embed/annonces?limit=1', { waitUntil: 'networkidle' });
  await L.sleep(400);
  L.check('embed : 1 carte, sans en-tête', (await p.getByTestId('listing-card').count()) === 1 && (await p.getByTestId('app-header').count()) === 0);
  L.check('embed : liens target=_top', (await p.locator('[data-testid=listing-card-link][target=_top]').count()) === 1 && (await p.getByTestId('embed-all').getAttribute('target')) === '_top');
  L.check('embed : liens marqués utm_source=wordpress', /utm_source=wordpress&utm_medium=embed/.test(await p.getByTestId('listing-card-link').first().getAttribute('href') || '')
    && /utm_source=wordpress/.test(await p.getByTestId('embed-all').getAttribute('href') || ''));

  // ---- Pages légales, 404
  await p.goto(L.FRONT + '/mentions-legales', { waitUntil: 'networkidle' });
  t = await L.text(p);
  L.check('mentions : AlterEgo, carte T, sans « à compléter »', /AlterEgo/.test(t) && /carte/i.test(t) && !/à compléter/.test(t));
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
  await p.locator('#mobile-metier-menuiserie').check();
  await p.waitForFunction(() => /Afficher 1 annonce$/.test((document.querySelector('[data-testid=mobile-filters-apply]') || {}).innerText || ''), null, { timeout: 5000 }).catch(() => {});
  L.check('mobile : le bouton du panneau annonce le nombre d\'annonces', /Afficher 1 annonce$/.test((await p.getByTestId('mobile-filters-apply').innerText()).trim()), await p.getByTestId('mobile-filters-apply').innerText());
  await p.getByTestId('mobile-filters-apply').click();
  await p.waitForURL(/metier=menuiserie/);
  L.check('mobile : filtre appliqué depuis le panneau', /metier=menuiserie/.test(p.url()), p.url());
  await p.goto(L.FRONT + `/company/${s.company_id}`, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=company-header]');
  o = await L.noOverflow(p, 390);
  L.check('mobile fiche : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await L.shot(p, 'company-mobile.png');
  await p.context().close();

  L.check('aucune erreur JS / 5xx', errors.length === 0, errors.join(' ; '));
  const ok = L.summary();
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
