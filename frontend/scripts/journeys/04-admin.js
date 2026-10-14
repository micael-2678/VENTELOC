// Parcours admin VenteLoc : connexion avec code reçu par e-mail, onglet « À faire » (justificatifs de propriété à
// contrôler : aperçu, Valider, Refuser avec motif ; relecture 48 h des annonces publiées automatiquement), retrait motivé
// d'une annonce, registre des mandats, factures, écran du lundi (KPI), tâches ; mobile 390 px.
// À lancer après 02-seller.js / 03-buyer.js (facture et annonces à relire présentes).
const L = require('./lib');

// Bien loué publié par l'API pour un vendeur (identité vérifiée, e-mail confirmé) : brouillon complet (SPEC §3),
// justificatif de propriété déposé (multipart), mandat signé par code, publication automatique (SPEC §5.4).
const PROPERTY = {
  property_type: 'appartement', owner_type: 'personne-physique', address: '8 rue des Essais', postal_code: '35000', city: 'Rennes',
  surface: 38, rooms: 2, floor: 2, elevator: false, construction_year: 1975, is_copro: true, copro_lots: 24, copro_charges_annual: 960, copro_procedure: false,
  dpe_class: 'D', ges_class: 'D', energy_cost_min: 700, energy_cost_max: 980,
  lease_type: 'habitation-vide', rent_monthly: 590, charges_monthly: 60, lease_start: '2022-09-01', deposit: 590, indexation: 'irl',
  tenant_payment_status: 'a-jour', has_gli: false, has_guarantor: true, property_tax: 720, non_recoverable_charges: 480, management: 'direct',
  asking_price: 128000, sale_object: 'bien', sale_reason: 'arbitrage', auto_accept_dataroom: false,
  description: 'Appartement de deux pièces au deuxième étage d\'une copropriété bien tenue, proche des commerces et du métro. '
    + 'Locataire en place depuis septembre 2022, loyers payés à l\'échéance, caution solidaire. Séjour lumineux, chambre sur cour, '
    + 'cuisine séparée, salle d\'eau refaite en 2021. Charges de copropriété maîtrisées, aucun travaux votés.',
};
const publishProperty = async (sellerUser, overrides = {}, docType = 'titre-propriete') => {
  const token = sellerUser.token;
  const created = await L.api('POST', '/properties', { token, body: { ...PROPERTY, ...overrides } });
  if (created.status !== 200) throw new Error(`POST /properties ${created.status} ${JSON.stringify(created.data)}`);
  const id = created.data.id;
  const form = new FormData();
  form.append('doc_type', docType);
  form.append('file', new Blob(['%PDF-1.4\n% justificatif de test\n'], { type: 'application/pdf' }), 'justificatif.pdf');
  const proof = await fetch(`${L.API}/properties/${id}/ownership-proof`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  if (!proof.ok) throw new Error(`ownership-proof ${proof.status}`);
  await L.api('PUT', `/properties/${id}`, { token, body: { mandant_address: { line1: '4 rue du Port', postal_code: '35000', city: 'Rennes' }, mandant_capacity: 'proprietaire', sale_object: 'bien' } });
  const gen = await L.api('POST', '/seller/mandat/generate', { token, params: { property_id: id } });
  if (!gen.data || !gen.data.contract_id) throw new Error(`generate ${gen.status} ${JSON.stringify(gen.data)}`);
  const since = L.emailCount();
  await L.api('POST', '/signatures/request-code', { token, body: { contract_id: gen.data.contract_id } });
  const code = await L.waitEmailCode(sellerUser.user.email, /code de signature/i, since);
  const signed = await L.api('POST', `/seller/mandat/${gen.data.contract_id}/sign`, { token, body: { otp_code: code } });
  if (signed.status !== 200) throw new Error(`sign ${signed.status} ${JSON.stringify(signed.data)}`);
  return { id, listing_status: signed.data.listing_status, registry_number: signed.data.registry_number };
};

(async () => {
  const browser = await L.launch();
  const errors = [];
  const s = L.seed();
  const adminEmail = s.admin.user.email;
  // Trois biens du vendeur 2 (publiés automatiquement, justificatif à contrôler, relecture 48 h ouverte) : un à valider,
  // un dont le justificatif est refusé, un à retirer
  const toReview = await publishProperty(s.seller2, { city: 'Rennes', postal_code: '35000' });
  const toReject = await publishProperty(s.seller2, { city: 'Brest', postal_code: '29200', address: '3 quai des Tests', asking_price: 98000, rent_monthly: 470 }, 'taxe-fonciere');
  const toRemove = await publishProperty(s.seller2, { property_type: 'parking', city: 'Caen', postal_code: '14000', address: '1 place du Test', surface: 12, rooms: null, lease_type: 'parking', dpe_class: 'non-soumis', ges_class: null, energy_cost_min: null, energy_cost_max: null, asking_price: 22000, rent_monthly: 95, deposit: 95, is_copro: false });
  L.check('préparation : trois biens publiés automatiquement (justificatif déposé, relecture ouverte)', [toReview, toReject, toRemove].every((x) => x.listing_status === 'published'), JSON.stringify([toReview, toReject, toRemove]));
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
  L.check('admin : ni veille BODACC ni onglet Incidents', !/BODACC|Incidents/.test(t) && (await p.getByTestId('admin-tab-incidents').count()) === 0);
  await L.shot(p, 'admin-todo-desktop.png');

  // ---- Justificatifs de propriété à contrôler : aperçu, Valider, Refuser avec motif
  const proofs = p.getByTestId('todo-section-ownership_proofs');
  L.check('admin : section « Justificatifs de propriété à contrôler »', (await proofs.count()) === 1 && /Justificatifs de propriété à contrôler/.test(await proofs.innerText()), (await L.text(p)).slice(0, 300));
  const proofRows = await proofs.locator('[data-testid^=todo-row-]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('todo-row-', '')));
  const rowFor = async (propertyId) => {
    for (const rid of proofRows) {
      const fiche = proofs.getByTestId(`todo-row-${rid}`).locator(`a[href="/annonce/${propertyId}"]`);
      if (await fiche.count()) return rid;
    }
    return null;
  };
  const okRow = await rowFor(toReview.id);
  const koRow = await rowFor(toReject.id);
  L.check('admin : une ligne par justificatif déposé', !!okRow && !!koRow, JSON.stringify(proofRows));
  if (okRow) {
    const popup = p.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await p.getByTestId(`todo-proof-${okRow}`).click();
    const opened = await popup;
    L.check('admin : aperçu du justificatif ouvert (fichier authentifié)', !!opened || !(await L.toasts(p)).includes('pas pu'), await L.toasts(p));
    if (opened) await opened.close();
    const since1 = L.emailCount();
    await p.getByTestId(`todo-action-${okRow}-ownership_verify`).click();
    await L.sleep(1200);
    const own = (await L.api('GET', `/properties/${toReview.id}`)).data;
    L.check('admin : justificatif validé → badge « Propriétaire vérifié » (ownership.status verified)', own.ownership && own.ownership.status === 'verified', JSON.stringify(own.ownership));
    L.check('admin : e-mail « justificatif validé » au vendeur', !!L.findEmail(s.seller2.user.email, /justificatif|propriét/i, since1));
  }
  if (koRow) {
    await p.getByTestId(`todo-action-${koRow}-ownership_reject`).click();
    await p.getByTestId('ownership-reject-dialog').waitFor();
    L.check('admin : refus sans motif impossible', await p.getByTestId('ownership-reject-dialog-confirm').isDisabled());
    await p.getByTestId('ownership-reject-dialog-note').fill('Avis de taxe foncière illisible : déposez le titre de propriété.');
    await p.getByTestId('ownership-reject-dialog-confirm').click();
    await L.sleep(1200);
    const ko = (await L.api('GET', `/properties/${toReject.id}/ownership-proof`, { token: s.admin.token })).data || {};
    const status = (ko.ownership || ko).status;
    L.check('admin : justificatif refusé avec motif (status rejected)', status === 'rejected', JSON.stringify(ko).slice(0, 200));
  }
  await L.shot(p, 'admin-ownership-desktop.png');
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
  await p.getByTestId('removal-reason').selectOption('bien-non-loue');
  await p.getByTestId('removal-text').fill('Le parking est libre de toute location d\'après les pièces fournies.');
  await confirmBtn.click();
  await L.sleep(1500);
  const c2 = (await L.api('GET', `/properties/${toRemove.id}`, { token: s.admin.token })).data;
  L.check('admin : annonce retirée avec motif (statut removed, mandat caduc)', c2.status === 'removed' && c2.moderation && c2.moderation.reason === 'bien-non-loue' && !c2.mandat_signed, JSON.stringify({ s: c2.status, m: c2.moderation, mandat: c2.mandat_signed }));
  L.check('admin : e-mail de retrait au vendeur', !!L.findEmail(s.seller2.user.email, /retir/i, since2));
  L.check('admin : fiche publique retirée (404)', (await L.api('GET', `/properties/${toRemove.id}`)).status === 404);
  t = await p.getByTestId(`property-${toRemove.id}`).innerText();
  L.check('admin : statut lisible « Retirée » + motif affiché', /Retirée|retirée/.test(t) && /libre de toute location/i.test(t), t.slice(0, 200));
  t = await p.getByTestId(`property-ownership-${toReview.id}`).innerText();
  L.check('admin : colonne « Justificatif » (Propriétaire vérifié, type de pièce)', /Propriétaire vérifié/.test(t) && /Titre de propriété/.test(t), t);
  await L.shot(p, 'admin-properties-desktop.png');

  // ---- Registre des mandats
  await p.getByTestId('admin-tab-mandates').click();
  await p.getByTestId('admin-mandates').waitFor({ timeout: 15000 });
  await L.sleep(800);
  t = await p.getByTestId('admin-mandates').innerText();
  L.check('admin : registre des mandats (numéros, vendeur, mandat simple v1)', /N° /.test(t) && /Vendeur/.test(t) && /Mandat simple v1/.test(t), t.slice(0, 300));

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
  L.check('admin : KPI « Justificatifs de propriété à contrôler », sans BODACC', (await p.getByTestId('kpi-ownership_pending').count()) === 1 && !/BODACC|NDA|cédant/.test(t));
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
  L.check('admin : utilisateurs avec score acquéreur et identité', /Profil acquéreur complet à \d+ %/.test(t) && /Identité vérifiée|vérifiée/.test(t) && !/null null/.test(t), t.slice(0, 200));
  L.check('admin : vocabulaire VenteLoc (ni cédant ni repreneur)', !/cédant|repreneur/i.test(t));
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
