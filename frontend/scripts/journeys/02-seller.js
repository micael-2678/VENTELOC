// Parcours vendeur VenteLoc (docs/venteloc/SPEC.md §5.2) : estimateur par le rendement → inscription vendeur →
// confirmation d'e-mail (lien reçu) → annonce en 3 écrans (le bien, la location, la vente ; code postal → ville, DPE,
// copropriété, rendements en direct, aperçu sans adresse) → justificatif de propriété → identité (simulation /test/set-user)
// → mandat (qualité, rétractation 14 jours, honoraires TTC, signature par code) → publication automatique → tableau de
// bord (justificatif, rétractation) ; création d'annonce à 390 px sans débordement.
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./lib');

const EMAIL = `vendeur.ui.${Date.now().toString(36)}@test.fr`;
const ADDRESS = `${Math.floor(Math.random() * 90) + 10} rue des Parcours`;
const DESCRIPTION = 'Appartement de deux pièces au troisième étage avec ascenseur, traversant et lumineux, à cinq minutes du métro et '
  + 'des commerces. Loué depuis 2019 à un locataire stable, loyers payés à l\'échéance, révision annuelle selon l\'IRL. Copropriété '
  + 'bien tenue de vingt-quatre lots, ravalement réalisé en 2021, aucun travaux votés. Cave en sous-sol.';

(async () => {
  const browser = await L.launch();
  const errors = [];
  const p = await L.makePage(browser, { errors });

  // ---- Estimateur
  await p.goto(L.FRONT + '/estimer', { waitUntil: 'networkidle' });
  L.check('estimateur : H1', /Estimer mon bien loué/.test(await p.locator('h1').first().innerText()));
  await p.getByTestId('estimate-type-select').selectOption('appartement');
  L.check('estimateur : bail proposé selon le type', (await p.getByTestId('estimate-lease-select').inputValue()) === 'habitation-vide');
  await p.getByTestId('estimate-department-select').selectOption('69');
  await p.getByTestId('estimate-surface-input').fill('42');
  await p.getByTestId('estimate-rent-input').fill('780');
  await p.getByTestId('estimate-tax-input').fill('900');
  await p.getByTestId('estimate-price-input').fill('180000');
  await p.getByTestId('estimate-submit').click();
  await p.getByTestId('estimate-result').waitFor({ timeout: 10000 });
  let t = await L.text(p);
  L.check('estimateur : fourchette, rendements, avertissement', /€/.test(await p.getByTestId('estimate-range').innerText()) && /%/.test(await p.getByTestId('estimate-yields').innerText()) && /Fourchette indicative/i.test(t));
  await p.getByTestId('estimate-deposit-btn').click();
  await p.waitForURL(/\/register\?role=seller/);
  L.check('estimateur → inscription vendeur', true);

  // ---- Inscription vendeur (plus de SIRET à l'inscription : il est demandé dans l'annonce si le bien appartient à une société)
  await p.waitForSelector('[data-testid=register-form]');
  L.check('inscription : profil vendeur présélectionné', await p.getByTestId('register-role-seller').isChecked());
  await p.getByTestId('register-first-name-input').fill('Paul');
  await p.getByTestId('register-last-name-input').fill('Dupont');
  await p.getByTestId('register-email-input').fill(EMAIL);
  await p.getByTestId('register-password-input').fill('Test1234!');
  await p.getByTestId('register-phone-input').fill('06 12 34 56 78');
  const since = L.emailCount();
  await p.getByTestId('register-submit-btn').click();
  await p.getByTestId('register-done').waitFor({ timeout: 15000 });
  L.check('inscription : écran « Vérifiez votre boîte mail »', /Vérifiez votre boîte mail/.test(await L.text(p)));
  const mail = await L.waitEmail(EMAIL, /Confirmez votre adresse/i, since);
  const link = L.linkIn(mail.html, /\/confirmer-email\//);
  L.check('inscription : e-mail de confirmation avec lien', !!link, mail.subject);

  // ---- Confirmation d'e-mail par le lien reçu
  const token = link.split('/confirmer-email/')[1].split(/[?#]/)[0];
  await p.goto(L.FRONT + '/confirmer-email/' + token, { waitUntil: 'networkidle' });
  await p.getByTestId('confirm-email-continue').waitFor({ timeout: 10000 });
  L.check('confirmation : adresse confirmée', /Adresse confirmée/.test(await L.text(p)));
  const sellerToken = await p.evaluate(() => localStorage.getItem('token'));
  const u = await L.api('GET', '/auth/profile', { token: sellerToken });
  L.check('confirmation : email_verified côté serveur', u.data && u.data.email_verified === true, JSON.stringify(u.data).slice(0, 200));

  // ---- Annonce, écran 1 : le bien
  await p.goto(L.FRONT + '/seller/create', { waitUntil: 'networkidle' });
  await p.getByTestId('create-listing-form').waitFor();
  await p.getByTestId('next-step').click();
  L.check('écran 1 : champs obligatoires signalés', /Indiquez à qui appartient le bien/.test(await L.text(p)));
  L.check('écran 1 : type de bien prérempli depuis l\'estimateur', await p.locator('[data-testid=property-type-appartement] input').isChecked());
  await p.getByTestId('owner-type-personne-physique').click();
  await p.getByTestId('address-input').fill(ADDRESS);
  await p.getByTestId('postal-code-input').fill('69007');
  await p.waitForFunction(() => { const el = document.querySelector('[data-testid=city-input], [data-testid=city-select]'); return el && el.value; }, null, { timeout: 5000 })
    .catch(() => p.getByTestId('city-input').fill('Lyon'));
  L.check('écran 1 : ville remplie depuis le code postal (ou saisie)', /Lyon/.test(await p.locator('[data-testid=city-input], [data-testid=city-select]').first().inputValue()));
  L.check('écran 1 : adresse confidentielle expliquée', /révélée seulement après l'engagement de confidentialité/.test(await L.text(p)));
  if (!(await p.getByTestId('surface-input').inputValue())) await p.getByTestId('surface-input').fill('42');
  await p.getByTestId('rooms-input').fill('2');
  await p.getByTestId('floor-input').fill('3');
  await p.getByTestId('elevator-oui').click();
  await p.getByTestId('copro-oui').click();
  await p.getByTestId('copro-lots-input').fill('24');
  await p.getByTestId('copro-charges-input').fill('960');
  await p.getByTestId('copro-procedure-non').click();
  await p.getByTestId('dpe-D').click();
  await p.getByTestId('energy-min-input').fill('900');
  await p.getByTestId('energy-max-input').fill('1300');
  await p.getByTestId('next-step').click();
  await p.getByTestId('tenant-warning').waitFor({ timeout: 15000 });
  L.check('écran 1 → écran 2 (brouillon POST /properties)', true);
  const mine = (await L.api('GET', '/properties/seller/mine', { token: sellerToken })).data || [];
  const propertyId = (mine.find((x) => x.address === ADDRESS) || mine[0] || {}).id;
  L.check('annonce : brouillon créé côté serveur', !!propertyId, JSON.stringify(mine).slice(0, 200));

  // ---- Écran 2 : la location
  L.check('écran 2 : rappel « aucun nom ni coordonnée du locataire »', /Ne saisissez aucun nom ni coordonnée du locataire/.test(await p.getByTestId('tenant-warning').innerText()));
  L.check('écran 2 : loyer prérempli depuis l\'estimateur', (await p.getByTestId('rent-input').inputValue()) === '780', await p.getByTestId('rent-input').inputValue());
  await p.getByTestId('lease-start-input').fill('2019-03-01');
  await p.getByTestId('deposit-input').fill('780');
  await p.getByTestId('indexation-select').selectOption('irl');
  await p.getByTestId('tenant-payment-a-jour').click();
  await p.getByTestId('gli-non').click();
  await p.getByTestId('non-recoverable-input').fill('450');
  L.check('écran 2 : rendement en direct', /%/.test(await p.getByTestId('live-gross').innerText()), await p.getByTestId('live-gross').innerText());
  await p.getByTestId('next-step').click();
  await p.getByTestId('asking-price-input').waitFor({ timeout: 15000 });

  // ---- Écran 3 : la vente
  await p.getByTestId('asking-price-input').fill('30000');
  L.check('écran 3 : alerte si le rendement brut dépasse 15 %', (await p.getByTestId('yield-alert').count()) === 1);
  await p.getByTestId('asking-price-input').fill('180000');
  L.check('écran 3 : honoraires TTC d\'abord et montant perçu', /€ TTC/.test(await p.getByTestId('price-fees').innerText()) && /percevez/.test(await p.getByTestId('price-fees').innerText()));
  L.check('écran 3 : vente des parts non proposée (nom propre)', (await p.getByTestId('sale-object-parts').count()) === 0 && await p.locator('[data-testid=sale-object-bien] input').isChecked());
  await p.getByTestId('sale-reason-select').selectOption('arbitrage');
  await p.getByTestId('description-input').fill(DESCRIPTION + ' Contact : 06 00 00 00 00');
  await L.sleep(200);
  L.check('écran 3 : coordonnées détectées dans la description', /Coordonnées détectées/.test(await p.getByTestId('description-contacts').innerText()));
  await p.getByTestId('description-input').fill(DESCRIPTION);
  const preview = await p.getByTestId('listing-preview').innerText();
  L.check('écran 3 : aperçu de la carte sans adresse', (await p.locator('[data-testid=listing-preview] [data-testid=listing-card]').count()) === 1 && !preview.includes(ADDRESS));
  // Photo publique (facultative)
  const png = path.join(os.tmpdir(), 'venteloc-photo.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await p.getByTestId('photo-upload-public').setInputFiles(png).catch(() => {});
  await L.sleep(800);
  await p.getByTestId('next-step').click();
  await p.getByTestId('publish-checklist').waitFor({ timeout: 15000 });
  t = await L.text(p);
  L.check('annonce : étapes avant publication (justificatif → identité → mandat)', /Déposez votre justificatif de propriété/.test(t) && /Vérifiez votre identité/.test(t) && /14 jours pour vous rétracter/.test(t));
  let comp = (await L.api('GET', `/properties/${propertyId}`, { token: sellerToken })).data;
  L.check('annonce : brouillon complet (prix, loyer, rendement calculé par le serveur)', comp.status === 'draft' && comp.asking_price === 180000 && comp.rent_monthly === 780 && comp.gross_yield > 0, `${comp.status} ${comp.asking_price} ${comp.gross_yield}`);

  // ---- Justificatif de propriété (dépôt par l'interface)
  const pdf = path.join(os.tmpdir(), 'venteloc-justificatif.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n% justificatif de test\n');
  await p.getByTestId('ownership-doc-taxe-fonciere').check();
  await p.getByTestId('ownership-file').setInputFiles(pdf);
  await p.getByTestId('ownership-submit').click();
  await p.getByTestId('ownership-pending').waitFor({ timeout: 10000 });
  comp = (await L.api('GET', `/properties/${propertyId}`, { token: sellerToken })).data;
  L.check('justificatif : déposé, en cours de contrôle', comp.ownership && comp.ownership.status === 'pending', JSON.stringify(comp.ownership));

  // ---- Identité vérifiée (simulation de Stripe Identity en mode test)
  await L.setUser(EMAIL, 'identity_verified', true);
  L.check('identité : vérifiée (simulation)', true);

  // ---- Mandat
  await p.goto(L.FRONT + `/seller/mandat/${propertyId}`, { waitUntil: 'networkidle' });
  await p.getByTestId('mandant-form').waitFor({ timeout: 15000 });
  t = await L.text(p);
  L.check('mandat : 14 jours de rétractation, 12 mois, rien avant l\'acte', /14 jours pour vous rétracter/.test(t) && /12 mois, sans exclusivité/.test(t) && /Rien avant l'acte/.test(t));
  L.check('mandat : vente du bien reprise de l\'annonce', await p.locator('[data-testid=mandate-object-bien] input').isChecked());
  await p.getByTestId('address-line1').fill('3 avenue Foch');
  await p.getByTestId('address-postal-code').fill('75016');
  await p.getByTestId('address-city').fill('Paris');
  await p.getByTestId('capacity-select').selectOption('proprietaire');
  await p.getByTestId('prepare-mandate').click();
  await p.getByTestId('mandate-summary').waitFor({ timeout: 15000 });
  t = await L.text(p);
  L.check('mandat : résumé en 5 points', (await p.locator('[data-testid=mandate-summary] li').count()) === 5, String(await p.locator('[data-testid=mandate-summary] li').count()));
  L.check('mandat : honoraires TTC d\'abord, à la charge du vendeur', /€ TTC \([\d\s\u202f\u00a0]+€ HT\)/.test(await p.getByTestId('mandate-fees').innerText()));
  await p.getByTestId('toggle-mandate-text').click();
  t = await L.text(p);
  L.check('mandat : texte complet sans variable vide, adresse du bien', /MANDAT/.test(t) && t.includes(ADDRESS) && !/\{[A-Z_]+\}/.test(t));
  await L.shot(p, 'mandate-desktop.png');
  await p.getByTestId('open-mandate-sign').click();
  await L.otpSign(p, EMAIL);
  await p.getByTestId('mandate-signed').waitFor({ timeout: 20000 });
  t = await L.text(p);
  const registry = await p.getByTestId('mandate-registry').innerText();
  L.check('mandat : signé, numéro de registre', /\d/.test(registry), registry);
  L.check('mandat : « publiée immédiatement »', /publiée immédiatement/.test(t), t.slice(0, 300));
  L.check('mandat : délai de rétractation indiqué', /rétracter sans motif jusqu'au/.test(await p.getByTestId('mandate-withdrawal-info').innerText()));
  comp = (await L.api('GET', `/properties/${propertyId}`)).data;
  L.check('annonce : publiée, adresse jamais renvoyée au public', comp && comp.status === 'published' && !comp.address, JSON.stringify(comp).slice(0, 150));

  // ---- Fiche publique
  await p.goto(L.FRONT + `/annonce/${propertyId}`, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=property-header]');
  t = await L.text(p);
  L.check('fiche : copropriété (24 lots), DPE D, rendement', /24 lots/.test(t) && (await p.getByTestId('dpe-scale').count()) === 1 && /%/.test(await p.getByTestId('gross-yield').innerText()));

  // ---- Tableau de bord vendeur
  await p.goto(L.FRONT + '/seller/dashboard', { waitUntil: 'networkidle' });
  await p.waitForSelector(`[data-testid=listing-${propertyId}]`, { timeout: 15000 });
  t = await L.text(p);
  L.check('dashboard : annonce « En ligne »', /En ligne/.test(await p.getByTestId(`status-${propertyId}`).first().innerText()), await p.getByTestId(`status-${propertyId}`).first().innerText());
  L.check('dashboard : justificatif en cours de contrôle', /Justificatif en cours de contrôle/.test(await p.getByTestId(`ownership-badge-${propertyId}`).innerText()));
  L.check('dashboard : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  L.check('dashboard : vocabulaire VenteLoc', !/48 h|repreneur|cédant|\bLOI\b/i.test(t));
  await p.getByTestId(`open-${propertyId}`).click().catch(() => {});
  await L.sleep(500);
  await p.getByRole('tab', { name: /Mandat/ }).click();
  await L.sleep(500);
  const panel = await p.getByTestId('mandate-panel').innerText();
  L.check('dashboard : onglet mandat (se rétracter / prolonger, registre)', (await p.getByTestId('denounce-mandate').innerText()).trim() === 'Me rétracter' && (await p.getByTestId('renew-mandate').count()) === 1 && /Registre/.test(panel), panel.slice(0, 200));
  await p.getByRole('tab', { name: /Dossier du bien/ }).click();
  await L.sleep(500);
  L.check('dashboard : dossier du bien avec avertissement « données du locataire »', /Masquez le nom, les coordonnées et les pièces d'identité du locataire/.test(await p.getByTestId('tenant-data-warning').innerText()));
  await L.shot(p, 'seller-dashboard-desktop.png');
  await p.context().close();

  // ---- Mobile 390 : création d'annonce et tableau de bord
  const sellerUser = { token: sellerToken, user: { ...u.data, identity_verified: true } };
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
