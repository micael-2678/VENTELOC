// Parcours cédant : estimateur → inscription vendeur → confirmation d'e-mail (lien reçu) → annonce en 3 écrans →
// identité (PUT /admin/kyc) → mandat v2 (adresse, qualité, objet, signature par code) → publication immédiate →
// tableau de bord ; création d'annonce à 390 px sans débordement.
const L = require('./lib');

const EMAIL = `vendeur.ui.${Date.now().toString(36)}@test.fr`;
const SIRET = ('555' + String(Date.now()).slice(-9) + '19').slice(0, 14); // unique par exécution (doublon de SIREN bloquant)
const DESCRIPTION = 'Entreprise de plomberie et de chauffage installée depuis vingt ans sur le bassin brestois, spécialisée dans '
  + 'la rénovation énergétique de maisons individuelles : pompes à chaleur, chaudières à condensation, salles de bains. Équipe stable '
  + 'de cinq personnes dont un référent technique, clientèle de particuliers fidèles, contrats d\'entretien récurrents.';

(async () => {
  const browser = await L.launch();
  const errors = [];
  const s = L.seed();
  const p = await L.makePage(browser, { errors });

  // ---- Estimateur
  await p.goto(L.FRONT + '/estimer', { waitUntil: 'networkidle' });
  L.check('estimateur : H1', /Estimer|Combien vaut/i.test(await p.locator('h1').first().innerText()));
  await p.getByTestId('estimate-siret-input').fill(SIRET);
  await p.waitForFunction(() => { const b = document.querySelector('[data-testid=estimate-siret-continue]'); return b && !b.disabled; }, null, { timeout: 10000 });
  const prefill = await L.text(p);
  L.check('estimateur : fiche open data préchargée', /SECRET ENERGIE/.test(prefill), prefill.slice(0, 300));
  await p.getByTestId('estimate-siret-continue').click();
  await p.getByTestId('estimate-step-figures').waitFor();
  await p.getByTestId('estimate-ca-input').fill('600000');
  await p.getByTestId('estimate-ebe-input').fill('90000');
  const staffVal = await p.getByTestId('estimate-staff-input').inputValue();
  L.check('estimateur : effectif prérempli depuis l\'open data', staffVal !== '', staffVal);
  await p.getByTestId('estimate-submit').click();
  await p.getByTestId('estimate-result').waitFor({ timeout: 10000 });
  let t = await L.text(p);
  L.check('estimateur : fourchette affichée', /€/.test(await p.getByTestId('estimate-result').innerText()) && /Fourchette indicative/i.test(t));
  await p.getByTestId('estimate-deposit-btn').click();
  await p.waitForURL(/\/register\?role=seller/);
  L.check('estimateur → inscription vendeur', true);

  // ---- Inscription vendeur
  await p.waitForSelector('[data-testid=register-form]');
  L.check('inscription : profil cédant présélectionné', await p.getByTestId('register-role-seller').isChecked());
  await p.getByTestId('register-first-name-input').fill('Paul');
  await p.getByTestId('register-last-name-input').fill('Dupont');
  await p.getByTestId('register-email-input').fill(EMAIL);
  await p.getByTestId('register-password-input').fill('Test1234!');
  await p.getByTestId('register-phone-input').fill('06 12 34 56 78');
  await p.getByTestId('register-source-select').selectOption('comptable_avocat');
  const siretField = await p.getByTestId('register-siret-input').inputValue();
  L.check('inscription : SIRET repris de l\'estimateur', siretField.replace(/\s/g, '') === SIRET, siretField);
  const since = L.emailCount();
  await p.getByTestId('register-submit-btn').click();
  await p.getByTestId('register-done').waitFor({ timeout: 15000 });
  t = await L.text(p);
  L.check('inscription : écran « Vérifiez votre boîte mail »', /Vérifiez votre boîte mail/.test(t));
  const mail = await L.waitEmail(EMAIL, /Confirmez votre adresse/i, since);
  const link = L.linkIn(mail.html, /\/confirmer-email\//);
  L.check('inscription : e-mail de confirmation avec lien', !!link, mail.subject);
  await p.getByTestId('register-continue').click();
  await p.waitForURL(/\/seller\/create/);
  L.check('inscription : « Déposer mon annonce anonyme » → /seller/create', true);

  // ---- Confirmation d'e-mail par le lien reçu
  const token = link.split('/confirmer-email/')[1].split(/[?#]/)[0];
  await p.goto(L.FRONT + '/confirmer-email/' + token, { waitUntil: 'networkidle' });
  await p.getByTestId('confirm-email-continue').waitFor({ timeout: 10000 });
  L.check('confirmation : adresse confirmée', /Adresse confirmée/.test(await L.text(p)));
  const u = await L.api('GET', '/test/user'.replace('/test/user', '/auth/profile'), { token: await p.evaluate(() => localStorage.getItem('token')) });
  L.check('confirmation : email_verified côté serveur', u.data && u.data.email_verified === true, JSON.stringify(u.data).slice(0, 200));
  const sellerToken = await p.evaluate(() => localStorage.getItem('token'));
  const sellerId = u.data.id;

  // ---- Annonce en 3 écrans
  await p.goto(L.FRONT + '/seller/create', { waitUntil: 'networkidle' });
  await p.getByTestId('create-listing-form').waitFor();
  await L.sleep(800); // préremplissage open data (estimate en session)
  t = await L.text(p);
  L.check('annonce écran 1 : SIRET et dénomination préremplis', (await p.getByTestId('siret-input').inputValue()).replace(/\s/g, '') === SIRET && /SECRET ENERGIE/.test(await p.getByTestId('property-name-input').inputValue()));
  // Métiers : s'assurer que « PAC, climatisation » est coché (principal) et pas plus de 4
  const tradeInput = (id) => p.locator(`[data-testid=trade-${id}] input`);
  if (!(await tradeInput('plomberie-chauffage').isChecked())) await p.getByTestId('trade-plomberie-chauffage').click();
  if (!(await tradeInput('pac-clim-cvc').isChecked())) await p.getByTestId('trade-pac-clim-cvc').click();
  L.check('annonce écran 1 : compteur de métiers', /[1-4] \/ 4/.test(await p.getByTestId('trade-count').innerText()));
  if (!(await p.getByTestId('region-select').inputValue())) await p.getByTestId('region-select').selectOption('Bretagne');
  await L.sleep(200);
  if (!(await p.getByTestId('department-select').inputValue())) await p.getByTestId('department-select').selectOption('29');
  if (!(await p.getByTestId('staff-count-input').inputValue())) await p.getByTestId('staff-count-input').fill('5');
  await p.getByTestId('legal-structure-select').selectOption('SAS').catch(() => {});
  await p.getByTestId('next-step').click();
  await p.waitForSelector('[data-testid=ca-n-input]', { timeout: 15000 });
  L.check('annonce écran 1 → écran 2 (brouillon POST /properties)', true);
  const propertyId = (await L.api('GET', '/properties', { token: sellerToken })).data.find((c) => c.seller_id === sellerId)?.id;
  L.check('annonce : brouillon créé côté serveur (statut draft, non soumis)', !!propertyId, JSON.stringify((await L.api('GET', '/properties', { token: sellerToken })).data).slice(0, 200));
  L.check('annonce écran 2 : CA prérempli depuis l\'estimateur', (await p.getByTestId('ca-n-input').inputValue()) === '600000', await p.getByTestId('ca-n-input').inputValue());
  await p.getByTestId('ca-n1-input').fill('560000');
  await p.getByTestId('ca-n2-input').fill('520000');
  await p.getByTestId('margin-input').fill('32');
  await p.getByTestId('debt-input').fill('40000');
  await p.getByTestId('pipeline-input').fill('120000');
  await p.getByTestId('charges-salaries-input').fill('210000');
  await p.getByTestId('charges-rent-input').fill('18000');
  await p.getByTestId('next-step').click();
  await p.waitForSelector('[data-testid=asking-price-input]', { timeout: 15000 });
  L.check('annonce écran 2 → écran 3', true);
  await p.getByTestId('asking-price-input').fill('300000');
  await p.getByTestId('sale-reason-select').selectOption('retraite');
  await p.getByTestId('sale-object-titres').click();
  await p.getByTestId('handover-select').selectOption('6').catch(() => {});
  await p.getByTestId('reassure-has_maintenance_contracts').click();
  await p.getByTestId('description-input').fill(DESCRIPTION + ' Contact : 06 00 00 00 00');
  await L.sleep(200);
  L.check('annonce écran 3 : coordonnées détectées dans la description', /Coordonnées détectées/.test(await p.getByTestId('description-contacts').innerText()));
  await p.getByTestId('description-input').fill(DESCRIPTION);
  L.check('annonce écran 3 : aperçu anonyme (carte) sans dénomination', (await p.locator('[data-testid=listing-anonymous-preview] [data-testid=listing-card]').count()) === 1 && !/SECRET ENERGIE/.test(await p.getByTestId('listing-anonymous-preview').innerText()));
  L.check('annonce écran 3 : alerte prix hors fourchette ou prix dans la fourchette', (await p.getByTestId('price-alert').count()) + (await p.getByTestId('price-ok').count()) >= 1);
  await p.getByTestId('next-step').click();
  await p.getByTestId('go-mandate').waitFor({ timeout: 15000 });
  t = await L.text(p);
  L.check('annonce : écran « Plus que deux étapes » (identité → mandat → publication)', /Plus que deux étapes/.test(t) && /Vérifiez votre identité/.test(t));
  let comp = (await L.api('GET', `/properties/${propertyId}`, { token: sellerToken })).data;
  L.check('annonce : brouillon complet en attente d\'identité (draft)', comp.status === 'draft' && comp.asking_price === 300000 && comp.sale_object === 'titres', `${comp.status} ${comp.asking_price} ${comp.sale_object}`);
  L.check('annonce : aucun e-mail « mandat à signer » avant l\'identité', !L.findEmail(EMAIL, /mandat/i, since));

  // ---- Identité vérifiée (simulation du retour Stripe : PUT /admin/kyc)
  const kyc = await L.api('PUT', `/admin/kyc/${sellerId}/validate`, { token: s.admin.token, params: { status: 'verified' } });
  L.check('identité : validée par l\'admin (simulation Stripe)', kyc.status === 200, JSON.stringify(kyc.data));
  await L.sleep(500);
  comp = (await L.api('GET', `/properties/${propertyId}`, { token: sellerToken })).data;
  L.check('annonce : soumise à la vérification → mandat_en_attente', comp.status === 'mandat_en_attente', comp.status);
  L.check('annonce : e-mail « mandat à signer » reçu', !!L.findEmail(EMAIL, /mandat/i, since));

  // ---- Mandat v2
  await p.getByTestId('go-mandate').click();
  await p.waitForURL(new RegExp(`/seller/mandat/${propertyId}`));
  await p.getByTestId('mandant-form').waitFor({ timeout: 15000 });
  L.check('mandat : objet repris de l\'annonce (titres)', await p.locator('[data-testid=mandate-object-titres] input').isChecked());
  await p.getByTestId('address-line1').fill('12 rue des Artisans');
  await p.getByTestId('address-postal-code').fill('29200');
  await p.getByTestId('address-city').fill('Brest');
  await p.getByTestId('capacity-select').selectOption('dirigeant');
  await p.getByTestId('prepare-mandate').click();
  await p.getByTestId('mandate-summary').waitFor({ timeout: 15000 });
  t = await L.text(p);
  L.check('mandat : résumé en 5 points', (await p.locator('[data-testid=mandate-summary] li').count()) === 5, String(await p.locator('[data-testid=mandate-summary] li').count()));
  L.check('mandat : version datée, 6 % HT, sans exclusivité, résiliable 15 jours', /Version du \d{2}\/\d{2}\/\d{4}/.test(t) && /6 % HT/.test(t) && /15 jours/.test(t));
  await p.getByTestId('toggle-mandate-text').click();
  t = await L.text(p);
  L.check('mandat : texte « MANDAT DE VENTE SIMPLE (NON EXCLUSIF) » avec adresse et registre « attribué »', /MANDAT DE VENTE SIMPLE/.test(t) && /12 rue des Artisans/.test(t) && /attribué/.test(t) && !/\{[A-Z_]+\}/.test(t));
  await L.shot(p, 'mandate-desktop.png');
  await p.getByTestId('open-mandate-sign').click();
  await L.otpSign(p, EMAIL);
  await p.getByTestId('mandate-signed').waitFor({ timeout: 20000 });
  t = await L.text(p);
  const registry = await p.getByTestId('mandate-registry').innerText();
  L.check('mandat : signé, numéro de registre', /\d/.test(registry), registry);
  L.check('mandat : « publiée immédiatement »', /publiée immédiatement/.test(t), t.slice(0, 300));
  L.check('mandat : dates (mandat en cours jusqu\'au, clause de suite)', /Mandat en cours jusqu'au/i.test(t) && /Clause de suite jusqu'au/i.test(t));
  const dl = p.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await p.getByTestId('mandate-pdf').click();
  L.check('mandat : PDF téléchargé', !!(await dl));
  L.check('mandat : e-mail avec lien PDF', !!L.findEmail(EMAIL, /mandat/i, since) && /pdf/i.test((L.readEmails().reverse().find((e) => e.to === EMAIL && /sign/i.test(e.subject)) || {}).html || ''));
  comp = (await L.api('GET', `/properties/${propertyId}`)).data;
  L.check('annonce : publiée (GET public 200, statut published)', comp && comp.status === 'published' && !comp.company_name, JSON.stringify(comp).slice(0, 150));
  await L.shot(p, 'mandate-signed-desktop.png');

  // ---- Tableau de bord vendeur
  await p.goto(L.FRONT + '/seller/dashboard', { waitUntil: 'networkidle' });
  await p.waitForSelector(`[data-testid=listing-${propertyId}]`, { timeout: 15000 });
  t = await L.text(p);
  L.check('dashboard : annonce « En ligne »', /En ligne/.test(await p.getByTestId(`status-${propertyId}`).first().innerText()), await p.getByTestId(`status-${propertyId}`).first().innerText());
  L.check('dashboard : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  L.check('dashboard : pas de 48 h / LOI / débiteur', !/48 h|\bLOI\b|commission_payer|débiteur/i.test(t));
  await p.getByTestId(`open-${propertyId}`).click().catch(() => {});
  await L.sleep(500);
  await p.getByRole('tab', { name: /Mandat/ }).click();
  await L.sleep(500);
  t = await p.getByTestId('mandate-panel').innerText();
  L.check('dashboard : onglet mandat (résilier / prolonger, registre)', (await p.getByTestId('denounce-mandate').count()) === 1 && (await p.getByTestId('renew-mandate').count()) === 1 && /registre|Registre/.test(t), t.slice(0, 200));
  await L.shot(p, 'seller-dashboard-desktop.png');
  await p.context().close();

  // ---- Mobile 390 : création d'annonce et tableau de bord
  const sellerUser = { token: sellerToken, user: { ...u.data } };
  const m = await L.makePage(browser, { errors, viewport: { width: 390, height: 844 }, user: sellerUser });
  await m.goto(L.FRONT + '/seller/create', { waitUntil: 'networkidle' });
  await m.getByTestId('create-listing-form').waitFor();
  let o = await L.noOverflow(m, 390);
  L.check('mobile création d\'annonce : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await L.shot(m, 'create-listing-mobile.png');
  await m.goto(L.FRONT + '/seller/dashboard', { waitUntil: 'networkidle' });
  await m.waitForSelector(`[data-testid=listing-${propertyId}]`, { timeout: 15000 });
  o = await L.noOverflow(m, 390);
  L.check('mobile dashboard vendeur : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await L.shot(m, 'seller-dashboard-mobile.png');
  await m.goto(L.FRONT + `/seller/mandat/${propertyId}`, { waitUntil: 'networkidle' });
  await m.getByTestId('mandate-signed').waitFor({ timeout: 15000 });
  o = await L.noOverflow(m, 390);
  L.check('mobile page mandat : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await L.shot(m, 'mandate-mobile.png');
  await m.context().close();

  L.check('aucune erreur JS / 5xx', errors.length === 0, errors.join(' ; '));
  const ok = L.summary();
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
