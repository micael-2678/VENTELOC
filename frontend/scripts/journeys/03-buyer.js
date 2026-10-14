// Parcours acquéreur VenteLoc : inscription avec profil d'investisseur → confirmation d'e-mail → liste des biens → fiche
// → contact (sans identité) → messagerie par conversation → demande de dossier → acceptation par le vendeur (carte
// acquéreur) → identité → engagement de confidentialité et de non-contournement par code → origine des fonds → dossier du
// bien (adresse révélée, documents, fiche de reprise du bail) → offre d'achat signée → acceptation du vendeur par code →
// étape de vente (notaire, avant-contrat, acte authentique) → confirmation → facture visible côté vendeur et en admin.
// Jeu de données (SEED_FILE) : `property_id` (bien publié), `seller`, `admin`, et `property_address` (adresse
// confidentielle du bien, révélée seulement après l'engagement ; repli : « rue »).
const L = require('./lib');

const EMAIL = `acquereur.ui.${Date.now().toString(36)}@test.fr`;
const isoPlus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

(async () => {
  const browser = await L.launch();
  const errors = [];
  const s = L.seed();
  const cid = s.property_id;
  const sellerUser = s.seller;
  const SECRET = new RegExp(String(s.property_address || 'rue ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const p = await L.makePage(browser, { errors });

  // ---- Inscription acquéreur avec profil d'investisseur (un seul écran)
  await p.goto(L.FRONT + '/register?role=buyer', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=buyer-profile-fields]');
  L.check('inscription : profil acquéreur présélectionné', await p.getByTestId('register-role-buyer').isChecked());
  await p.getByTestId('register-first-name-input').fill('Claire');
  await p.getByTestId('register-last-name-input').fill('Martin');
  await p.getByTestId('register-email-input').fill(EMAIL);
  await p.getByTestId('register-password-input').fill('Test1234!');
  await p.getByTestId('register-phone-input').fill('06 98 76 54 32');
  const choose = async (testId) => p.locator(`[data-testid="${testId}"] + label`).click();
  await choose('buyer-project-type-particulier');
  await p.getByRole('textbox', { name: /Budget maximum/ }).fill('300000');
  await p.getByRole('textbox', { name: 'Apport' }).fill('60000');
  await choose('buyer-financing-mixte');
  await choose('buyer-zones-Auvergne-Rhône-Alpes');
  await choose('buyer-property-types-appartement');
  await p.getByTestId('buyer-min-yield').fill('5');
  await choose('buyer-horizon-6-12');
  await L.sleep(200);
  const scoreTxt = await p.getByTestId('profile-score').innerText();
  L.check('inscription : score de profil calculé en direct (100 %)', /100/.test(scoreTxt), scoreTxt);
  const since = L.emailCount();
  await p.getByTestId('register-submit-btn').click();
  await p.getByTestId('register-done').waitFor({ timeout: 15000 });
  const mail = await L.waitEmail(EMAIL, /Confirmez votre adresse/i, since);
  const token = (L.linkIn(mail.html, /\/confirmer-email\//) || '').split('/confirmer-email/')[1].split(/[?#]/)[0];
  L.check('inscription : e-mail de confirmation reçu', !!token);
  await p.goto(L.FRONT + '/confirmer-email/' + token, { waitUntil: 'networkidle' });
  await p.getByTestId('confirm-email-continue').waitFor({ timeout: 10000 });
  const buyerToken = await p.evaluate(() => localStorage.getItem('token'));
  const me = (await L.api('GET', '/auth/profile', { token: buyerToken })).data;
  L.check('inscription : score serveur ≥ 40 et e-mail confirmé', me.email_verified === true && me.profile_score >= 40, JSON.stringify({ v: me.email_verified, score: me.profile_score }));
  const buyerId = me.id;
  await p.getByTestId('confirm-email-continue').click();
  await p.waitForURL(/\/buyer\/dashboard/);
  let t = await L.text(p);
  L.check('espace acquéreur : vide sans compteur à zéro, sans crédit', L.zeroCounters(t).length === 0 && !/crédit/i.test(t) && /Espace acquéreur/.test(t), L.zeroCounters(t).join(', '));

  // ---- Page des annonces → fiche → contact
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  await p.locator(`a[href="/annonce/${cid}"]`).first().click();
  await p.waitForSelector('[data-testid=property-header]');
  await p.getByTestId('contact-seller-btn').first().click();
  await p.getByTestId('contact-modal').waitFor();
  const prefilled = await p.getByTestId('contact-message').inputValue();
  L.check('contact : message prérempli depuis le profil', prefilled.length >= 20, prefilled.slice(0, 120));
  await p.getByTestId('contact-message').fill(prefilled + ' Je souhaite échanger sur le bail en cours et votre calendrier de vente.');
  await p.getByTestId('contact-send-btn').click();
  await p.waitForURL(/\/messages\?conversation=/, { timeout: 15000 });
  L.check('contact : redirection vers la conversation', true);
  await p.waitForSelector('[data-testid=thread]', { timeout: 15000 });
  await L.sleep(500);
  L.check('messagerie : premier message visible', (await p.locator('[data-testid=thread] [data-testid=message]').count()) >= 1);
  L.check('messagerie : e-mail « premier contact » au vendeur avec carte', !!L.findEmail(sellerUser.user.email, /contact|projet/i, since));
  await p.getByTestId('message-input').fill('Pouvez-vous me préciser la date de la dernière révision du loyer ?');
  await p.getByTestId('send-message').click();
  await L.sleep(800);
  L.check('messagerie : second message envoyé', (await p.locator('[data-testid=thread] [data-testid=message]').count()) >= 2);
  t = await L.text(p);
  L.check('messagerie : adresse masquée avant l\'engagement', !SECRET.test(t) || !s.property_address);
  await L.shot(p, 'messages-buyer-desktop.png');

  // ---- Demande de dossier
  await p.goto(L.FRONT + `/dataroom/${cid}`, { waitUntil: 'networkidle' });
  await p.getByTestId('request-access-btn').waitFor({ timeout: 15000 });
  await p.locator('#request-message').fill('Investisseur particulier, financement bancaire en cours d\'accord.');
  await p.getByTestId('request-access-btn').click();
  await L.sleep(1000);
  t = await L.text(p);
  L.check('dossier : demande enregistrée (en attente du vendeur)', /Votre demande est enregistrée/.test(t) && /J\+2 et J\+5/.test(t), t.slice(0, 300));
  let st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('dossier : statut pending côté API', st.access_status === 'pending', JSON.stringify(st).slice(0, 200));

  // ---- Vendeur : « À traiter » avec carte acquéreur → Accepter
  const sp = await L.makePage(browser, { errors, user: sellerUser });
  await sp.goto(L.FRONT + '/seller/dashboard', { waitUntil: 'networkidle' });
  await sp.waitForSelector('[data-testid=todo-block]', { timeout: 15000 });
  const card = sp.locator('[data-testid=todo-block] [data-testid=buyer-card]').first();
  L.check('vendeur : carte acquéreur dans « À traiter » (pseudonyme, projet, budget)', (await card.count()) === 1 && /Acquéreur n°/.test(await card.innerText()) && /300\s?000/.test(await card.innerText()), (await card.innerText().catch(() => '')).slice(0, 200));
  L.check('vendeur : carte sans nom ni coordonnées', !/Claire|Martin|@test\.fr/.test(await card.innerText()));
  await sp.locator('[data-testid^=accept-request-]').first().click();
  await L.sleep(1200);
  st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('vendeur : demande acceptée (statut accepted, étape suivante identité)', st.access_status === 'accepted' && st.next_step === 'identity', JSON.stringify(st).slice(0, 200));
  L.check('acquéreur : e-mail « dossier accepté »', !!L.findEmail(EMAIL, /accept|dossier/i, since));

  // ---- Identité (simulation Stripe) → engagement de confidentialité par code
  await p.goto(L.FRONT + `/dataroom/${cid}`, { waitUntil: 'networkidle' });
  await L.sleep(500);
  t = await L.text(p);
  L.check('dossier : étape identité proposée après acceptation', /Identité vérifiée/.test(t) && (await p.locator('[data-testid=checklist]').innerText()).includes('Vérifier'), t.slice(0, 200));
  const kyc = await L.api('PUT', `/admin/kyc/${buyerId}/validate`, { token: s.admin.token, params: { status: 'verified' } });
  L.check('identité : validée (simulation Stripe)', kyc.status === 200);
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByTestId('nda-btn').waitFor({ timeout: 15000 });
  await p.getByTestId('nda-btn').click();
  await p.getByTestId('otp-signature-dialog').waitFor({ timeout: 15000 });
  const ndaText = await p.getByTestId('otp-document').innerText();
  L.check('engagement : texte v1 (24 mois, non-contournement, locataire, identité)', /24 mois/.test(ndaText) && /contourn/i.test(ndaText) && /locataire/i.test(ndaText) && /Claire/.test(ndaText) && !/commission/i.test(ndaText), ndaText.slice(0, 200));
  L.check('engagement : intitulé du dialogue', /Engagement de confidentialité et de non-contournement/.test(await p.getByTestId('otp-signature-dialog').innerText()));
  await L.otpSign(p, EMAIL);
  const mandateStatus = (await L.api('GET', `/seller/mandat/status/${cid}`, { token: sellerUser.token })).data;
  L.check('engagement : acquéreur présenté sur la liste nominative du vendeur', (mandateStatus.presented_buyers || []).some((b) => b.buyer_id === buyerId && /Martin/i.test(b.name || '')), JSON.stringify(mandateStatus.presented_buyers));

  // ---- Origine des fonds → accès
  await p.getByTestId('funds-form').waitFor({ timeout: 10000 });
  await p.getByTestId('funds-source').selectOption('mixte');
  await p.getByTestId('funds-amount').fill('500000');
  await p.getByTestId('funds-partner').fill('Banque Populaire Auvergne Rhône Alpes');
  await p.getByTestId('funds-attest').check();
  await p.getByTestId('funds-submit').click();
  await p.getByTestId('open-offer-form').waitFor({ timeout: 15000 });
  st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('fonds : accès accordé (granted, 3 étapes faites)', st.access_granted === true && st.access_status === 'granted' && st.steps.identity && st.steps.nda && st.steps.funds, JSON.stringify(st).slice(0, 200));
  t = await L.text(p);
  L.check('dossier : adresse exacte révélée après l\'engagement', (await p.getByTestId('revealed-address').count()) === 1 && (!s.property_address || SECRET.test(await p.getByTestId('revealed-address').innerText())));
  L.check('dossier : documents (état vide utile), fiche de reprise du bail, offre', (await p.getByTestId('dataroom-empty').count()) + (await p.getByTestId('dataroom-documents').count()) >= 1 && (await p.getByTestId('lease-transfer').count()) === 1);
  L.check('dossier : fiche de reprise du bail (le bail continue, avertissement notaire)', /bail/i.test(await p.getByTestId('lease-transfer').innerText()) && /notaire/i.test(await p.getByTestId('lease-transfer').innerText()));
  L.check('dossier : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  await L.shot(p, 'dataroom-desktop.png');

  // ---- Offre d'achat signée par code (condition suspensive de prêt, validité 5 à 30 jours)
  await p.getByTestId('open-offer-form').click();
  await p.getByTestId('offer-form').waitFor();
  L.check('offre : notes juridiques (pas de vente, prêt, rétractation 10 jours)', /n'emporte pas vente/.test(await p.getByTestId('offer-legal-notes').innerText()) && /L271-1/.test(await p.getByTestId('offer-legal-notes').innerText()));
  await p.getByTestId('offer-amount').fill('140000');
  await p.getByTestId('offer-equity').fill('40000');
  await p.getByTestId('offer-loan').fill('110000');
  await p.getByTestId('offer-loan-required').check();
  await p.getByTestId('offer-loan-rate').fill('3.9');
  await p.getByTestId('offer-loan-years').fill('20');
  await p.getByTestId('offer-target-date').fill(isoPlus(30));
  await p.getByTestId('offer-validity').fill('10');
  await p.getByTestId('offer-message').fill('Offre sous condition suspensive d\'obtention du prêt.');
  await p.getByTestId('offer-submit').click();
  await p.getByTestId('otp-signature-dialog').waitFor({ timeout: 15000 });
  const offerText = await p.getByTestId('otp-document').innerText();
  L.check('offre : texte du contrat (montant, prêt, validité)', /140\s?000/.test(offerText) && /10 jours/.test(offerText) && /prêt/i.test(offerText), offerText.slice(0, 200));
  await L.otpSign(p, EMAIL);
  await L.sleep(1000);
  const myOffers = (await L.api('GET', '/offers/my', { token: buyerToken })).data.offers;
  const offer = myOffers.find((o) => o.property_id === cid);
  L.check('offre : signée → statut pending, condition de prêt enregistrée, e-mail au vendeur', offer && offer.status === 'pending' && offer.loan_condition && offer.loan_condition.required === true && !!L.findEmail(sellerUser.user.email, /offre/i, since), JSON.stringify(offer).slice(0, 200));
  L.check('offre : suivi affiché côté acquéreur', (await p.getByTestId(`offer-${offer.id}`).count()) === 1);

  // ---- Vendeur : acceptation par code → étape de vente
  await sp.goto(L.FRONT + `/seller/dashboard?annonce=${cid}&onglet=offers`, { waitUntil: 'networkidle' });
  await sp.getByTestId(`accept-offer-${offer.id}`).waitFor({ timeout: 15000 });
  t = await sp.locator(`[data-testid=offer-${offer.id}]`).innerText();
  L.check('vendeur : offre listée avec nom de l\'acquéreur (engagement signé)', /140\s?000/.test(t) && /Martin/i.test(t), t.slice(0, 200));
  await sp.getByTestId(`accept-offer-${offer.id}`).click();
  await L.otpSign(sp, sellerUser.user.email);
  await L.sleep(1000);
  const closings = (await L.api('GET', '/closing/my', { token: sellerUser.token })).data;
  const closing = (Array.isArray(closings) ? closings : closings.closings || []).find((c) => c.offer_id === offer.id);
  L.check('vendeur : offre acceptée → étape de vente créée', !!closing && closing.status === 'in_progress', JSON.stringify(closing).slice(0, 200));
  L.check('acquéreur : e-mail « offre acceptée »', !!L.findEmail(EMAIL, /accept/i, since));

  // ---- Étape de vente : notaire + avant-contrat + acte authentique (vendeur), confirmation (acquéreur)
  await sp.goto(L.FRONT + `/vente/${closing.id}`, { waitUntil: 'networkidle' });
  await sp.getByTestId('closing-panel').waitFor({ timeout: 15000 });
  await sp.getByTestId('redacteur-type').selectOption('notaire');
  await sp.getByTestId('redacteur-name').fill('Maître Le Gall');
  await sp.getByTestId('redacteur-email').fill('etude@notaires-test.fr');
  await sp.getByTestId('redacteur-phone').fill('04 78 00 00 00');
  await sp.getByTestId('redacteur-submit').click();
  await L.sleep(800);
  L.check('vente : notaire enregistré', /Le Gall/.test(await L.text(sp)) && /Notaire en charge de la vente/.test(await L.text(sp)));
  await sp.getByTestId('avant-contrat-date').fill(isoPlus(-20));
  await sp.getByTestId('avant-contrat-submit').click();
  await sp.getByTestId('avant-contrat-on').waitFor({ timeout: 10000 });
  const ac = (await L.api('GET', `/closing/${closing.id}`, { token: sellerUser.token })).data;
  L.check('vente : date de l\'avant-contrat enregistrée (PUT /closing/{id}/avant-contrat)', ac.avant_contrat_on === isoPlus(-20), JSON.stringify(ac).slice(0, 200));
  await sp.getByTestId('declare-date').fill(isoPlus(-1));
  await sp.getByTestId('declare-price').fill('140000');
  await sp.getByTestId('declare-object').selectOption('bien');
  await L.sleep(200);
  L.check('vente : honoraires prévisualisés (3 % HT de 140 000 €, soit 5 040 € TTC)', /5\s?040/.test(await sp.getByTestId('declare-commission').innerText()) && /notaire/.test(await sp.getByTestId('declare-commission').innerText()), await sp.getByTestId('declare-commission').innerText());
  await sp.getByTestId('declare-submit').click();
  await L.sleep(1000);
  L.check('vente : acte authentique déclaré par le vendeur', /déclaré|Déclaré/.test(await sp.getByTestId('closing-status').innerText()), await sp.getByTestId('closing-status').innerText());
  await p.goto(L.FRONT + `/vente/${closing.id}`, { waitUntil: 'networkidle' });
  await p.getByTestId('confirm-banner').waitFor({ timeout: 15000 });
  await p.getByTestId('confirm-btn').click();
  await p.getByTestId('confirm-dialog-confirm').click();
  await L.sleep(1200);
  L.check('vente : confirmée par l\'acquéreur', /confirmée|Confirmée|Vendue/.test(await p.getByTestId('closing-status').innerText()), await p.getByTestId('closing-status').innerText());
  t = await L.text(p);
  L.check('vente : rien n\'est demandé à l\'acquéreur', /rien ne vous est demandé|à la charge du vendeur/i.test(t), t.slice(0, 300));
  await sp.reload({ waitUntil: 'networkidle' });
  await sp.getByTestId('invoice-card').waitFor({ timeout: 15000 });
  t = await sp.getByTestId('invoice-card').innerText();
  L.check('vente : facture côté vendeur (numéro, 4 200 € HT, 5 040 € TTC, notaire)', /FAC|F-?\d/.test(t) && /4\s?200/.test(t) && /5\s?040/.test(t) && /notaire/.test(t), t.slice(0, 200));
  L.check('vente : ordre de paiement adressé au notaire', /Ordre de paiement pour le notaire/.test(await sp.getByTestId('payment-order-btn').innerText()));
  const dl = sp.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await sp.getByTestId('invoice-pdf-btn').click();
  L.check('vente : PDF de facture téléchargé', !!(await dl));
  const pub = (await L.api('GET', `/properties/${cid}`, { token: sellerUser.token })).data;
  L.check('annonce : statut « vendue » après confirmation', pub.status === 'sold', pub.status);
  await L.shot(sp, 'closing-seller-desktop.png');

  // ---- Admin : facture visible
  const ap = await L.makePage(browser, { errors, user: s.admin });
  await ap.goto(L.FRONT + '/admin/dashboard?tab=invoices', { waitUntil: 'networkidle' });
  await L.sleep(1200);
  t = await L.text(ap);
  L.check('admin : facture listée (Factures)', /FAC|Facture/.test(t) && /4\s?200|5\s?040/.test(t), t.slice(0, 300));
  await ap.context().close();

  // ---- Espace acquéreur : pipeline
  await p.goto(L.FRONT + '/buyer/dashboard', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=pipeline-list]', { timeout: 15000 });
  t = await L.text(p);
  L.check('espace acquéreur : dossier dans « Mes dossiers » avec lien vente', (await p.getByTestId(`pipeline-${cid}`).count()) === 1 && (await p.getByTestId(`pipeline-${cid}`).getAttribute('href')) === `/vente/${closing.id}`);
  L.check('espace acquéreur : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  await L.shot(p, 'buyer-dashboard-desktop.png');

  // ---- Mobile 390 : dossier du bien et messagerie
  const m = await L.makePage(browser, { errors, viewport: { width: 390, height: 844 }, user: { token: buyerToken, user: me } });
  await m.goto(L.FRONT + `/dataroom/${cid}`, { waitUntil: 'networkidle' });
  await m.getByTestId('checklist').waitFor({ timeout: 15000 });
  let o = await L.noOverflow(m, 390);
  L.check('mobile dossier du bien : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await L.shot(m, 'dataroom-mobile.png');
  await m.goto(L.FRONT + '/messages', { waitUntil: 'networkidle' });
  await L.sleep(800);
  o = await L.noOverflow(m, 390);
  L.check('mobile messagerie : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
  await m.context().close();
  await sp.context().close();
  await p.context().close();

  L.check('aucune erreur JS / 5xx', errors.length === 0, errors.join(' ; '));
  const ok = L.summary();
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
