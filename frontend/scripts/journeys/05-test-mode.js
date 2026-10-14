// Parcours du mode test (MODE-TEST-ET-APP.md §B) avec un backend lancé en TEST_MODE=true, sans jeu de données :
//   TEST_MODE=true JOBS_ENABLED=false NOSEED=1 restart.sh
// bandeau → /test → données de démonstration → 8 annonces sur / → connexion rapide vendeur → inscription d'un nouveau
// vendeur → confirmation d'e-mail (bouton du bandeau) → annonce avec un SIRET fictif → identité simulée → mandat signé
// avec le code affiché (« Remplir ») → publication immédiate, registre TEST-… → repreneur démo : contact → demande de
// dossier → acceptation du cédant démo → identité simulée → NDA par code affiché → origine des fonds → data room →
// boîte mail de test → admin démo : « Mode test actif » → purge (simulation puis suppression) → / vide.
// Enfin, backend relancé SANS TEST_MODE (RESTART_CMD) : /test « Le mode test n'est pas activé », plus de bandeau,
// POST /api/test/login-as → 404.
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');

const SCRATCH = process.env.SCRATCHPAD || '/tmp/claude-0/-home-user-Cession-rge/ce38f6ec-42e9-581c-a8b8-72299bf0cff5/scratchpad';
const RESTART_CMD = process.env.RESTART_CMD || path.join(SCRATCH, 'restart.sh');
const STAMP = Date.now().toString(36);
const EMAIL = `vendeur.essai.${STAMP}@test.fr`;

// SIRET fictif : 14 chiffres dont la clé de Luhn est fausse (aucune entreprise réelle, l'annuaire ne le trouve pas)
const luhnOk = (n) => n.split('').reverse().reduce((s, ch, i) => {
  let d = Number(ch);
  if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
  return s + d;
}, 0) % 10 === 0;
const fictitiousSiret = () => {
  // SIREN et SIRET à clé fausse : l'annuaire des entreprises n'est même pas interrogé (open data indisponible = drapeau)
  let siren = ('9' + String(Date.now()).slice(-8)).slice(0, 9);
  while (luhnOk(siren)) siren = String((Number(siren) + 1) % 1e9).padStart(9, '9');
  for (let k = 10; k < 100; k++) { const s = `${siren}000${k}`; if (!luhnOk(s)) return s; }
  return `${siren}00011`;
};
const SIRET = fictitiousSiret();

// Clé du panneau de test (TEST_PANEL_KEY du backend, facultative) : le panneau s'ouvre avec /test?cle=<clé>
const KEY = process.env.TEST_PANEL_KEY || '';
const PANEL = KEY ? `/test?cle=${encodeURIComponent(KEY)}` : '/test';

const DESCRIPTION = 'Entreprise de plomberie et de chauffage installée depuis douze ans, spécialisée dans la rénovation '
  + 'énergétique de maisons individuelles : pompes à chaleur, chaudières à condensation, salles de bains adaptées. Équipe de '
  + 'cinq personnes dont un référent technique, clientèle de particuliers fidèles et contrats d\'entretien récurrents.';

// Signature par code avec le raccourci du mode test : lecture du texte, case, envoi, code affiché, « Remplir », signer
const otpSignWithTestCode = async (page) => {
  const dlg = page.getByTestId('otp-signature-dialog');
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  const toggle = page.getByTestId('otp-toggle-document');
  if (await toggle.count() && /Lire/.test(await toggle.innerText())) await toggle.click();
  const doc = page.getByTestId('otp-document');
  let docText = '';
  if (await doc.count()) {
    docText = await doc.innerText();
    for (let i = 0; i < 5; i++) {
      await doc.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll', { bubbles: true })); });
      await L.sleep(150);
      if (!(await page.getByTestId('otp-scroll-hint').count())) break;
    }
  }
  await page.getByTestId('otp-accept').click();
  await page.getByTestId('otp-request').click();
  await page.getByTestId('otp-test-code').waitFor({ timeout: 10000 });
  const shown = (await page.getByTestId('otp-test-code').innerText()).match(/\d{6}/);
  await page.getByTestId('otp-test-fill').click();
  const filled = await page.getByTestId('otp-code').inputValue();
  await page.getByTestId('otp-sign').click();
  await dlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  const err = await page.getByTestId('otp-error').innerText().catch(() => '');
  if (err) throw new Error('signature refusée : ' + err);
  return { code: shown ? shown[0] : '', filled, docText };
};

const waitVerified = async (token, timeoutMs = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const me = (await L.api('GET', '/auth/profile', { token })).data;
    if (me && me.identity_verified === true) return me;
    await L.sleep(250);
  }
  throw new Error('identité simulée non enregistrée');
};

const restartBackend = (env) => {
  const clean = { ...process.env, ...env };
  if (!env.TEST_MODE) delete clean.TEST_MODE;
  execFileSync('bash', [RESTART_CMD], { env: clean, stdio: 'ignore', timeout: 120000 });
};

(async () => {
  const browser = await L.launch();
  const errors = [];

  const cfg = await L.api('GET', '/config');
  if (!L.check('backend en mode test (GET /config → test_mode: true)', cfg.data && cfg.data.test_mode === true, JSON.stringify(cfg.data))) {
    L.summary();
    process.exit(1);
  }

  // ---- Visiteur sans la clé du panneau (venu du site WordPress) : bandeau sans lien, panneau réservé, connexion rapide refusée
  let p;
  let t;
  if (KEY) {
    p = await L.makePage(browser, { errors });
    await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
    await p.getByTestId('test-mode-banner').waitFor({ timeout: 10000 });
    t = await p.getByTestId('test-mode-banner').innerText();
    L.check('visiteur sans clé : bandeau « annonces fictives » sans lien vers le panneau', /annonces fictives/.test(t) && (await p.getByTestId('test-mode-banner-link').count()) === 0, t);
    await p.goto(`${L.FRONT}/test`, { waitUntil: 'networkidle' });
    await p.getByTestId('test-mode-restricted').waitFor({ timeout: 10000 });
    L.check('visiteur sans clé : /test « Panneau de test réservé », aucune connexion rapide', (await p.getByTestId('test-login-admin').count()) === 0);
    const denied = await L.api('POST', '/test/login-as', { body: { persona: 'admin' } });
    L.check('visiteur sans clé : POST /api/test/login-as admin → 403', denied.status === 403, String(denied.status));
    const wrong = await L.api('POST', '/test/login-as', { body: { persona: 'admin' }, headers: { 'X-Test-Key': 'mauvaise-cle' } });
    L.check('mauvaise clé : POST /api/test/login-as → 403', wrong.status === 403, String(wrong.status));
    await p.context().close();
  }

  // ---- Fondateur (clé du panneau) : bandeau, panneau, données de démonstration
  p = await L.makePage(browser, { errors });
  await p.goto(L.FRONT + (KEY ? `/?cle=${encodeURIComponent(KEY)}` : '/'), { waitUntil: 'networkidle' });
  await p.getByTestId('test-mode-banner').waitFor({ timeout: 10000 });
  if (KEY) L.check('clé du panneau retirée de l\'adresse', !/cle=/.test(p.url()), p.url());
  t = await p.getByTestId('test-mode-banner').innerText();
  L.check('bandeau ambre « Mode test » sur /', /Mode test/.test(t) && (await p.getByTestId('test-mode-banner-link').count()) === 1, t);
  await p.getByTestId('test-mode-banner-link').click();
  await p.waitForURL(/\/test$/);
  await p.getByTestId('test-mode-page').waitFor();
  L.check('/test : panneau (connexion rapide, mot de passe affiché)', /Demo-2026!/.test(await p.getByTestId('test-demo-password').innerText()));
  L.check('/test : étapes 1 Préparer, 2 Choisir un rôle, 3 Parcours', (await p.getByTestId('test-step-seed').count()) === 1
    && (await p.getByTestId('test-scenarios').count()) === 1 && (await p.locator('[data-testid^=test-scenario-go-]').count()) >= 5);
  await p.getByTestId('test-seed').click();
  await p.getByTestId('test-seed-done').waitFor({ timeout: 30000 });
  await L.sleep(500);
  const seeded = (await L.api('GET', '/companies', { params: { limit: 50 } }));
  L.check('seed : 8 annonces publiées (GET /companies)', Number(seeded.headers.get('x-total-count')) === 8, seeded.headers.get('x-total-count'));
  L.check('seed : annonces marquées is_test', (seeded.data || []).every((c) => c.is_test === true));
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=listing-card]');
  L.check('/ : 8 annonces de démonstration visibles', (await p.getByTestId('listing-card').count()) === 8, String(await p.getByTestId('listing-card').count()));
  L.check('/ : « 8 annonces en ligne »', /8 annonces en ligne/.test(await p.getByTestId('listings-total').innerText()));
  L.check('/ : badge « Annonce de test » sur les cartes', (await p.getByTestId('listing-card-test').count()) === 8);
  const badges = await p.getByTestId('listing-card-badge').allInnerTexts();
  L.check('/ : 5 annonces démo « RGE vérifié ADEME » (contrôles passés), libellés distincts', badges.filter((b) => /RGE vérifié ADEME/.test(b)).length === 5
    && !badges.some((b) => /Qualifications déclarées/.test(b)), badges.join(' | '));
  await p.context().close();

  // ---- Connexion rapide « Vendeur démo »
  p = await L.makePage(browser, { errors });
  await p.goto(L.FRONT + PANEL, { waitUntil: 'networkidle' });
  await p.getByTestId('test-login-vendeur').click();
  await p.waitForURL(/\/seller\/dashboard/, { timeout: 15000 });
  await p.getByTestId('app-header').waitFor();
  await p.waitForSelector('[data-testid^=status-]', { timeout: 15000 }).catch(() => {});
  t = await L.text(p);
  L.check('connexion rapide vendeur → espace vendeur (annonces de démonstration)', /Vincent|Espace vendeur/.test(t) && (await p.locator('[data-testid^=status-]').count()) > 0, t.slice(0, 200));
  const sellerDemo = { token: await p.evaluate(() => localStorage.getItem('token')), user: JSON.parse(await p.evaluate(() => localStorage.getItem('user'))) };
  await p.context().close();

  // ---- Nouveau vendeur : inscription, confirmation par le bandeau, annonce avec SIRET fictif
  p = await L.makePage(browser, { errors });
  await p.goto(L.FRONT + '/register?role=seller', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=register-form]');
  await p.getByTestId('register-first-name-input').fill('Hélène');
  await p.getByTestId('register-last-name-input').fill('Riou');
  await p.getByTestId('register-email-input').fill(EMAIL);
  await p.getByTestId('register-password-input').fill('Test1234!');
  await p.getByTestId('register-phone-input').fill('06 11 22 33 44');
  await p.getByTestId('register-source-select').selectOption('comptable_avocat').catch(() => {});
  await p.getByTestId('register-submit-btn').click();
  await p.getByTestId('register-done').waitFor({ timeout: 15000 });
  await p.getByTestId('register-continue').click();
  await p.waitForURL(/\/seller\/(create|dashboard)/);
  await p.getByTestId('email-verification-banner').waitFor({ timeout: 10000 });
  L.check('bandeau e-mail : bouton « Confirmer maintenant (mode test) »', (await p.getByTestId('test-confirm-email-btn').count()) === 1);
  await p.getByTestId('test-confirm-email-btn').click();
  await p.getByTestId('email-verification-banner').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  const sellerToken = await p.evaluate(() => localStorage.getItem('token'));
  let me = (await L.api('GET', '/auth/profile', { token: sellerToken })).data;
  L.check('e-mail confirmé (simulation) : email_verified, via test', me.email_verified === true && me.email_verified_via === 'test', JSON.stringify({ v: me.email_verified, via: me.email_verified_via }));
  L.check('bandeau e-mail disparu après confirmation', (await p.getByTestId('email-verification-banner').count()) === 0);

  await p.goto(L.FRONT + '/seller/create', { waitUntil: 'networkidle' });
  await p.getByTestId('create-listing-form').waitFor();
  await p.getByTestId('siret-input').fill(SIRET);
  await L.sleep(800);
  if (!(await p.getByTestId('company-name-input').inputValue())) await p.getByTestId('company-name-input').fill('RIOU THERMIQUE (essai)');
  L.check('SIRET fictif : aucune fiche open data préremplie', !/SECRET ENERGIE/.test(await p.getByTestId('company-name-input').inputValue()));
  if (!(await p.locator('[data-testid=trade-plomberie-chauffage] input').isChecked())) await p.getByTestId('trade-plomberie-chauffage').click();
  await p.getByTestId('region-select').selectOption('Bretagne');
  await L.sleep(200);
  await p.getByTestId('department-select').selectOption('56');
  await p.getByTestId('staff-count-input').fill('5');
  await p.getByTestId('legal-structure-select').selectOption('SARL').catch(() => {});
  await p.getByTestId('next-step').click();
  await p.waitForSelector('[data-testid=ca-n-input]', { timeout: 15000 }).catch(async (e) => {
    await L.shot(p, 'debug-step1.png');
    console.log(await p.$$eval('[role=alert], .text-red-700, [data-sonner-toast]', (els) => els.map((x) => x.innerText).join(' | ')));
    throw e;
  });
  await p.getByTestId('ca-n-input').fill('640000');
  await p.getByTestId('ca-n1-input').fill('600000');
  await p.getByTestId('ca-n2-input').fill('570000');
  await p.getByTestId('margin-input').fill('30');
  await p.getByTestId('debt-input').fill('30000');
  await p.getByTestId('pipeline-input').fill('90000');
  await p.getByTestId('charges-salaries-input').fill('220000');
  await p.getByTestId('charges-rent-input').fill('14000');
  await p.getByTestId('next-step').click();
  await p.waitForSelector('[data-testid=asking-price-input]', { timeout: 15000 });
  await p.getByTestId('asking-price-input').fill('280000');
  await p.getByTestId('sale-reason-select').selectOption('retraite');
  await p.getByTestId('sale-object-titres').click();
  await p.getByTestId('handover-select').selectOption('6').catch(() => {});
  await p.getByTestId('description-input').fill(DESCRIPTION);
  await p.getByTestId('next-step').click();
  await p.getByTestId('go-mandate').waitFor({ timeout: 15000 });
  const mine = (await L.api('GET', '/companies', { token: sellerToken })).data.find((c) => c.seller_id === me.id);
  const companyId = mine && mine.id;
  L.check('annonce : brouillon créé avec le SIRET fictif', !!companyId, JSON.stringify(mine).slice(0, 200));

  // Identité simulée depuis l'écran « Plus que deux étapes »
  await p.getByRole('button', { name: /Vérifier mon identité/ }).first().click();
  await p.getByTestId('kyc-simulate-btn').waitFor({ timeout: 10000 });
  L.check('identité : bouton « Simuler la vérification (mode test) » sous le bouton Stripe', /Simuler la vérification/.test(await p.getByTestId('kyc-simulate-btn').innerText()));
  await p.getByTestId('kyc-simulate-btn').click();
  // Confirmation « Identité vérifiée (simulation) » puis rechargement complet de la page (comme au retour de Stripe) :
  // le message peut disparaître avant d'être lu, on attend donc l'état côté serveur
  await waitVerified(sellerToken);
  await p.waitForLoadState('networkidle');
  await L.sleep(2500); // rechargement complet de la page, comme au retour de Stripe
  me = (await L.api('GET', '/auth/profile', { token: sellerToken })).data;
  L.check('identité simulée : identity_verified, kyc_provider test', me.identity_verified === true && me.kyc_provider === 'test', JSON.stringify({ v: me.identity_verified, p: me.kyc_provider }));
  let comp = (await L.api('GET', `/companies/${companyId}`, { token: sellerToken })).data;
  L.check('annonce soumise après l\'identité → mandat_en_attente', comp.status === 'mandat_en_attente', comp.status);

  // Mandat signé avec le code affiché
  await p.goto(L.FRONT + `/seller/mandat/${companyId}`, { waitUntil: 'networkidle' });
  await p.getByTestId('mandant-form').waitFor({ timeout: 15000 });
  await p.getByTestId('address-line1').fill('8 rue du Port');
  await p.getByTestId('address-postal-code').fill('56100');
  await p.getByTestId('address-city').fill('Lorient');
  await p.getByTestId('capacity-select').selectOption('dirigeant');
  await p.getByTestId('prepare-mandate').click();
  await p.getByTestId('mandate-summary').waitFor({ timeout: 15000 });
  await p.getByTestId('open-mandate-sign').click();
  // Capture : boîte de signature avec le code de test affiché (avant « Remplir »)
  const dlg = p.getByTestId('otp-signature-dialog');
  await dlg.waitFor();
  const signed = await (async () => {
    const toggle = p.getByTestId('otp-toggle-document');
    if (await toggle.count() && /Lire/.test(await toggle.innerText())) await toggle.click();
    const doc = p.getByTestId('otp-document');
    const docText = await doc.innerText();
    for (let i = 0; i < 5; i++) {
      await doc.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll', { bubbles: true })); });
      await L.sleep(150);
      if (!(await p.getByTestId('otp-scroll-hint').count())) break;
    }
    await p.getByTestId('otp-accept').click();
    await p.getByTestId('otp-request').click();
    await p.getByTestId('otp-test-code').waitFor({ timeout: 10000 });
    await p.getByTestId('otp-test-code').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(L.SHOTS_DIR, 'mandate-test-code.png') });
    const shown = ((await p.getByTestId('otp-test-code').innerText()).match(/\d{6}/) || [''])[0];
    await p.getByTestId('otp-test-fill').click();
    const filled = await p.getByTestId('otp-code').inputValue();
    await p.getByTestId('otp-sign').click();
    await dlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return { code: shown, filled, docText };
  })();
  L.check('mandat : texte avec « DOCUMENT DE TEST — SANS VALEUR JURIDIQUE »', /DOCUMENT DE TEST — SANS VALEUR JURIDIQUE/.test(signed.docText), signed.docText.slice(0, 200));
  L.check('mandat : code de test affiché puis rempli par « Remplir »', /^\d{6}$/.test(signed.code) && signed.filled === signed.code, JSON.stringify(signed));
  await p.getByTestId('mandate-signed').waitFor({ timeout: 20000 });
  const registry = (await p.getByTestId('mandate-registry').innerText()).trim();
  L.check('mandat signé : numéro de registre de test TEST-…', /^TEST-\d{4}$/.test(registry), registry);
  L.check('mandat signé : annonce « publiée immédiatement »', /publiée immédiatement/.test(await L.text(p)));
  comp = (await L.api('GET', `/companies/${companyId}`)).data;
  L.check('annonce publiée (publique, is_test)', comp && comp.status === 'published' && comp.is_test === true, JSON.stringify(comp).slice(0, 160));

  // Boîte mail de test du nouveau vendeur : l'e-mail de code apparaît
  await p.goto(L.FRONT + PANEL, { waitUntil: 'networkidle' });
  await p.getByTestId('test-inbox-list').waitFor({ timeout: 10000 });
  const subjects = await p.getByTestId('test-inbox-item').allInnerTexts();
  L.check('boîte mail de test : e-mail « code de signature » présent', subjects.some((s) => /code de signature/i.test(s)), subjects.slice(0, 6).join(' | '));
  L.check('boîte mail de test : seulement les e-mails du compte', !subjects.some((s) => /vendeur\.demo|repreneur\.demo/.test(s)));
  await p.getByTestId('test-inbox-item').filter({ hasText: /code de signature/i }).first().locator('button, a').first().click().catch(() => p.getByTestId('test-inbox-item').filter({ hasText: /code de signature/i }).first().click());
  await p.getByTestId('test-inbox-iframe').waitFor({ timeout: 10000 });
  L.check('boîte mail : aperçu dans un iframe sandbox', (await p.getByTestId('test-inbox-iframe').getAttribute('sandbox')) === '');
  await p.context().close();

  // ---- Repreneur démo : contact → demande de dossier
  const demoListing = (await L.api('GET', '/companies', { params: { limit: 50 } })).data.find((c) => c.id !== companyId);
  const cid = demoListing.id;
  // Les comptes démo sont créés avec une identité simulée : on la retire ici pour rejouer l'étape « identité » du dossier
  await L.setUser('repreneur.demo@test.local', 'identity_verified', false);
  await L.setUser('repreneur.demo@test.local', 'kyc_status', 'pending');
  p = await L.makePage(browser, { errors });
  await p.goto(L.FRONT + PANEL, { waitUntil: 'networkidle' });
  await p.getByTestId('test-login-repreneur').click();
  await p.waitForURL(/\/buyer\/dashboard/, { timeout: 15000 });
  L.check('connexion rapide repreneur → espace repreneur', true);
  const buyerToken = await p.evaluate(() => localStorage.getItem('token'));
  await p.goto(L.FRONT + `/company/${cid}`, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=company-header]');
  L.check('fiche : badge « Annonce de test »', (await p.getByTestId('test-listing-badge').count()) === 1);
  await p.getByTestId('contact-seller-btn').first().click();
  await p.getByTestId('contact-modal').waitFor();
  const pre = await p.getByTestId('contact-message').inputValue();
  await p.getByTestId('contact-message').fill((pre || 'Bonjour,') + ' Je souhaite échanger sur votre calendrier de cession.');
  await p.getByTestId('contact-send-btn').click();
  await p.waitForURL(/\/messages\?conversation=/, { timeout: 15000 });
  await p.waitForSelector('[data-testid=thread]', { timeout: 15000 });
  // Le fil se charge après l'ouverture de la conversation : attente du premier message avant de compter
  await p.waitForSelector('[data-testid=thread] [data-testid=message]', { timeout: 10000 }).catch(() => {});
  L.check('contact : conversation ouverte', (await p.locator('[data-testid=thread] [data-testid=message]').count()) >= 1);
  await p.goto(L.FRONT + `/dataroom/${cid}`, { waitUntil: 'networkidle' });
  await p.getByTestId('request-access-btn').waitFor({ timeout: 15000 });
  await p.locator('#request-message').fill('Projet de reprise individuelle, financement bancaire en cours.');
  await p.getByTestId('request-access-btn').click();
  await L.sleep(1000);
  let st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('dossier : demande en attente du cédant', st.access_status === 'pending', JSON.stringify(st).slice(0, 160));

  // Cédant démo : accepte la demande depuis « À traiter »
  const sp = await L.makePage(browser, { errors, user: sellerDemo });
  await sp.goto(L.FRONT + '/seller/dashboard', { waitUntil: 'networkidle' });
  await sp.waitForSelector('[data-testid^=accept-request-]', { timeout: 15000 });
  await sp.locator('[data-testid^=accept-request-]').first().click();
  await L.sleep(1200);
  st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('cédant démo : demande acceptée → étape identité', st.access_status === 'accepted' && st.next_step === 'identity', JSON.stringify(st).slice(0, 200));
  await sp.context().close();

  // Repreneur : identité simulée → NDA par code affiché → origine des fonds → data room
  await p.goto(L.FRONT + `/dataroom/${cid}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Vérifier mon identité/ }).first().click();
  await p.getByTestId('kyc-simulate-btn').click();
  await waitVerified(buyerToken);
  await L.sleep(2500);
  await p.waitForLoadState('networkidle');
  await p.getByTestId('nda-btn').waitFor({ timeout: 15000 });
  L.check('identité simulée : étape NDA proposée', true);
  await p.getByTestId('nda-btn').click();
  const nda = await otpSignWithTestCode(p);
  L.check('NDA : mention de test et code affiché rempli', /DOCUMENT DE TEST/.test(nda.docText) && /^\d{6}$/.test(nda.code) && nda.filled === nda.code, nda.docText.slice(0, 120));
  await p.getByTestId('revealed-name').waitFor({ timeout: 15000 });
  L.check('NDA signé : nom de l\'entreprise révélé', (await p.getByTestId('revealed-name').innerText()).length > 0);
  await p.getByTestId('funds-form').waitFor({ timeout: 10000 });
  await p.getByTestId('funds-source').selectOption('mixte');
  await p.getByTestId('funds-amount').fill('400000');
  await p.getByTestId('funds-partner').fill('Banque de démonstration');
  await p.getByTestId('funds-attest').check();
  await p.getByTestId('funds-submit').click();
  await p.getByTestId('open-offer-form').waitFor({ timeout: 15000 });
  st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('data room ouverte (identité, NDA, fonds)', st.access_granted === true && st.steps.identity && st.steps.nda && st.steps.funds, JSON.stringify(st).slice(0, 200));
  await p.context().close();

  // ---- Admin démo : « Mode test actif », puis purge
  p = await L.makePage(browser, { errors });
  await p.goto(L.FRONT + PANEL, { waitUntil: 'networkidle' });
  await p.getByTestId('test-login-admin').click();
  await p.waitForURL(/\/admin\/dashboard/, { timeout: 15000 });
  await p.waitForFunction(() => /Mode test actif/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  L.check('admin démo : « À faire » montre « Mode test actif »', /Mode test actif/.test(await L.text(p)));
  await L.shot(p, 'admin-todo-test-mode.png');
  await p.goto(L.FRONT + PANEL, { waitUntil: 'networkidle' });
  await p.getByTestId('test-purge-dry-run').click();
  await p.getByTestId('test-purge-plan').waitFor({ timeout: 15000 });
  t = await p.getByTestId('test-purge-plan').innerText();
  L.check('purge : simulation détaillée par collection', /annonce|Annonces/i.test(t) && /\d/.test(t), t.slice(0, 200));
  L.check('purge : simulation sans suppression', Number((await L.api('GET', '/companies', { params: { limit: 50 } })).headers.get('x-total-count')) === 9);
  await p.getByTestId('test-purge-confirm').click();
  await L.sleep(1500);
  const after = await L.api('GET', '/companies', { params: { limit: 50 } });
  L.check('purge : plus aucune annonce publique', Number(after.headers.get('x-total-count')) === 0 && (after.data || []).length === 0, after.headers.get('x-total-count'));
  L.check('purge : compte démo supprimé → déconnecté', !(await p.evaluate(() => localStorage.getItem('token'))));
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  await p.getByTestId('listings-empty').waitFor({ timeout: 10000 });
  t = await L.text(p);
  L.check('/ vide après la purge (« Aucune annonce… », sans « 0 »)', /Aucune annonce/.test(t) && L.zeroCounters(t).length === 0, t.slice(0, 200));
  L.check('compte admin réel conservé', (await L.api('POST', '/auth/login', { body: { email: 'admin@test.fr', password: 'AdminTest123!' } })).status === 200);
  await p.context().close();

  // ---- Relance SANS TEST_MODE : panneau désactivé, bandeau absent, routes /test/* → 404
  restartBackend({ NOSEED: '1', JOBS_ENABLED: 'false' });
  // Connexions HTTP gardées ouvertes vers l'ancien processus : nouvelle tentative après la relance
  const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 3) throw e; await L.sleep(500); } } };
  const cfg2 = await retry(() => L.api('GET', '/config'));
  L.check('sans TEST_MODE : GET /config → test_mode false', cfg2.data && cfg2.data.test_mode === false, JSON.stringify(cfg2.data));
  p = await L.makePage(browser, { errors });
  await p.goto(L.FRONT + PANEL, { waitUntil: 'networkidle' });
  await p.getByTestId('test-mode-disabled').waitFor({ timeout: 10000 });
  L.check('sans TEST_MODE : /test « Le mode test n\'est pas activé »', /Le mode test n'est pas activé/.test(await L.text(p)));
  L.check('sans TEST_MODE : bandeau absent', (await p.getByTestId('test-mode-banner').count()) === 0);
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  await L.sleep(500);
  L.check('sans TEST_MODE : bandeau absent sur /', (await p.getByTestId('test-mode-banner').count()) === 0);
  const la = await retry(() => L.api('POST', '/test/login-as', { body: { persona: 'vendeur' } }));
  L.check('sans TEST_MODE : POST /api/test/login-as → 404', la.status === 404, String(la.status));
  await p.context().close();

  L.check('aucune erreur JS / 5xx', errors.length === 0, errors.join(' ; '));
  const ok = L.summary();
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
