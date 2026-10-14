// Parcours admin : connexion avec code reçu par e-mail, onglet « À faire » (relecture 48 h des annonces publiées
// automatiquement), retrait motivé d'une annonce, factures, écran du lundi (KPI), tâches ; mobile 390 px.
// À lancer après 02-seller.js / 03-buyer.js (facture et annonces à relire présentes).
const L = require('./lib');

(async () => {
  const browser = await L.launch();
  const errors = [];
  const s = L.seed();
  const adminEmail = s.admin.user.email;
  // Deux annonces fraîches du cédant 2 (publiées automatiquement, relecture 48 h ouverte) : une à valider, une à retirer
  const toReview = await L.publishListing(s.seller2, L.uniqueSiret('771'), { trades: ['electricite'], region: 'Bretagne', department: '29' });
  const toRemove = await L.publishListing(s.seller2, L.uniqueSiret('772'), { trades: ['carrelage-sols'], region: 'Normandie', department: '14', asking_price: 90000 });
  L.check('préparation : deux annonces publiées automatiquement (relecture ouverte)', toReview.listing_status === 'published' && toRemove.listing_status === 'published', JSON.stringify([toReview, toRemove]));
  const p = await L.makePage(browser, { errors });

  // ---- Connexion avec code
  await p.goto(L.FRONT + '/login', { waitUntil: 'networkidle' });
  await p.getByTestId('login-email-input').fill(adminEmail);
  await p.getByTestId('login-password-input').fill('AdminTest123!');
  const since = L.emailCount();
  await p.getByTestId('login-submit-btn').click();
  await p.getByTestId('login-otp-form').waitFor({ timeout: 15000 });
  L.check('admin : code de connexion demandé', true);
  const code = await L.waitEmailCode(adminEmail, /code de connexion/i, since);
  L.check('admin : code reçu par e-mail (jamais dans l\'objet)', !!code && !/\d{6}/.test((L.findEmail(adminEmail, /code de connexion/i, since) || {}).subject || ''));
  await p.getByTestId('login-otp-input').fill(code);
  await p.getByTestId('login-otp-submit').click();
  await p.waitForURL(/\/admin\/dashboard/, { timeout: 15000 });
  L.check('admin : connecté → /admin/dashboard', true);

  // ---- À faire (onglet par défaut)
  await p.getByTestId('admin-todo').waitFor({ timeout: 15000 });
  let t = await L.text(p);
  L.check('admin : onglet « À faire » par défaut', /À faire/.test(t) && (await p.getByTestId('admin-tab-todo').getAttribute('data-state')) === 'active');
  const review = p.getByTestId('todo-section-listings_review');
  L.check('admin : annonces publiées à relire (48 h) listées', (await review.count()) === 1 && (await review.locator('[data-testid^=todo-row-]').count()) >= 1, String(await review.locator('[data-testid^=todo-row-]').count().catch(() => 0)));
  L.check('admin : compteur de lignes à traiter', /\d+ lignes? à traiter/.test(t));
  L.check('admin : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  await L.shot(p, 'admin-todo-desktop.png');
  // Valider une annonce relue depuis « À faire » (action appelée telle quelle)
  const firstRow = review.getByTestId(`todo-row-${toReview.id}`);
  const validateBtn = firstRow.getByRole('button', { name: /^Valider$/ }).first();
  if (await validateBtn.count()) {
    await validateBtn.click();
    await L.sleep(1200);
    const c1 = (await L.api('GET', `/properties/${toReview.id}`, { token: s.admin.token })).data;
    L.check('admin : « Valider » clôt la relecture (moderation.status ok)', c1.moderation && c1.moderation.status === 'ok', JSON.stringify(c1.moderation));
  } else {
    L.check('admin : bouton Valider présent dans la relecture', false, 'absent');
  }

  // ---- Retrait motivé (annonce 2)
  await p.getByTestId('admin-tab-properties').click();
  await p.getByTestId('admin-properties').waitFor({ timeout: 15000 });
  await L.sleep(800);
  const since2 = L.emailCount();
  await p.getByTestId(`property-remove-${toRemove.id}`).click();
  await p.getByTestId('removal-dialog').waitFor();
  await p.getByTestId('removal-reason').selectOption('autre');
  const confirmBtn = p.getByTestId('removal-dialog-confirm');
  L.check('admin : motif « autre » exige un texte', await confirmBtn.isDisabled());
  await p.getByTestId('removal-reason').selectOption('hors_perimetre');
  await p.getByTestId('removal-text').fill('Activité principale hors bâtiment d\'après les pièces fournies.');
  await confirmBtn.click();
  await L.sleep(1500);
  const c2 = (await L.api('GET', `/properties/${toRemove.id}`, { token: s.admin.token })).data;
  L.check('admin : annonce retirée avec motif (statut removed, mandat caduc)', c2.status === 'removed' && c2.moderation && c2.moderation.reason === 'hors_perimetre' && !c2.mandat_signed, JSON.stringify({ s: c2.status, m: c2.moderation, mandat: c2.mandat_signed }));
  L.check('admin : e-mail de retrait au cédant', !!L.findEmail(s.seller2.user.email, /retir/i, since2));
  L.check('admin : fiche publique retirée (404)', (await L.api('GET', `/properties/${toRemove.id}`)).status === 404);
  t = await p.getByTestId(`property-${toRemove.id}`).innerText();
  L.check('admin : statut lisible « Retirée » + motif affiché', /Retirée|retirée/.test(t) && /hors/i.test(t), t.slice(0, 200));
  await L.shot(p, 'admin-properties-desktop.png');

  // ---- Factures
  await p.getByTestId('admin-tab-invoices').click();
  await L.sleep(1200);
  t = await L.text(p);
  const invoices = (await L.api('GET', '/admin/invoices', { token: s.admin.token })).data;
  const list = Array.isArray(invoices) ? invoices : invoices.invoices || [];
  L.check('admin : facture(s) listée(s) avec numéro et montant', list.length >= 1 && list.every((i) => new RegExp(i.number).test(t)), `${list.length} facture(s) · ${t.slice(0, 200)}`);
  if (list.length) {
    const inv = list[0];
    const dl = p.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await p.getByTestId(`invoice-pdf-${inv.id}`).first().click();
    L.check('admin : PDF de facture téléchargé', !!(await dl));
    await p.getByTestId(`invoice-paid-${inv.id}`).first().click();
    await p.getByTestId('paid-dialog').waitFor();
    L.check('admin : « Marquer payée » prérempli avec le montant TTC', Number(await p.getByTestId('paid-amount').inputValue()) === Number(inv.total_ttc), await p.getByTestId('paid-amount').inputValue());
    await p.getByTestId('paid-dialog-confirm').click();
    await L.sleep(1200);
    const after = (await L.api('GET', '/admin/invoices', { token: s.admin.token })).data;
    const paid = (Array.isArray(after) ? after : after.invoices || []).find((i) => i.id === inv.id);
    L.check('admin : facture marquée payée', paid && paid.status === 'paid' && !!paid.paid_on, JSON.stringify(paid).slice(0, 150));
  }

  // ---- Métriques (écran du lundi)
  await p.getByTestId('admin-tab-metrics').click();
  await p.getByTestId('admin-metrics').waitFor({ timeout: 15000 });
  await L.sleep(1500);
  t = await p.getByTestId('admin-metrics').innerText();
  L.check('admin : tableau des KPI (semaine, précédente, cible)', (await p.getByTestId('kpi-table').count()) === 1 && /Cible/.test(t) && (await p.locator('[data-testid^=kpi-listings_published]').count()) === 1, t.slice(0, 200));
  L.check('admin : KPI 6 et 7 « suivi hors plateforme » sans valeur inventée', /hors plateforme/i.test(t));
  L.check('admin : revenu facturé / encaissé affiché', /factur|encaiss/i.test(t));
  await p.getByTestId('cost-amount').fill('165');
  await p.getByTestId('cost-note').fill('Hébergement, Stripe Identity, nom de domaine');
  await p.getByTestId('cost-save').click();
  await L.sleep(1000);
  const costs = (await L.api('GET', '/admin/costs', { token: s.admin.token })).data;
  L.check('admin : coût du mois enregistré (PUT /admin/costs)', (costs.costs || costs).some((c) => Number(c.amount) === 165), JSON.stringify(costs).slice(0, 150));
  await L.shot(p, 'admin-metrics-desktop.png');

  // ---- Tâches planifiées
  await p.getByTestId('admin-run-jobs').click();
  await L.sleep(3000);
  const toast = await L.toasts(p);
  L.check('admin : « Lancer les tâches » exécuté (résumé)', /tâche|job|exécut|Aucune/i.test(toast) || /tâche/i.test(await L.text(p)), toast);

  // ---- Utilisateurs
  await p.getByTestId('admin-tab-users').click();
  await p.getByTestId('admin-users').waitFor({ timeout: 15000 });
  await L.sleep(800);
  t = await L.text(p);
  L.check('admin : utilisateurs avec score repreneur et identité', /Profil repreneur complet à \d+ %/.test(t) && /Identité vérifiée|vérifiée/.test(t) && !/null null/.test(t), t.slice(0, 200));
  await p.context().close();

  // ---- Mobile 390
  const m = await L.makePage(browser, { errors, viewport: { width: 390, height: 844 }, user: s.admin });
  await m.goto(L.FRONT + '/admin/dashboard', { waitUntil: 'networkidle' });
  await m.getByTestId('admin-todo').waitFor({ timeout: 15000 });
  let o = await L.noOverflow(m, 390);
  L.check('mobile admin : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await L.shot(m, 'admin-todo-mobile.png');
  await m.goto(L.FRONT + '/admin/dashboard?tab=invoices', { waitUntil: 'networkidle' });
  await L.sleep(1000);
  o = await L.noOverflow(m, 390);
  L.check('mobile admin factures : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await m.context().close();

  L.check('aucune erreur JS / 5xx', errors.length === 0, errors.join(' ; '));
  const ok = L.summary();
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
