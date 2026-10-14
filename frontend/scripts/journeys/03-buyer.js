// Parcours repreneur : inscription avec profil → confirmation d'e-mail → recherche → fiche → contact (sans identité) →
// messagerie par conversation → demande de dossier → acceptation par le cédant (carte repreneur) → identité → NDA par code →
// origine des fonds → data room → offre indicative signée → acceptation du cédant par code → étape de vente → déclaration →
// confirmation → facture visible côté cédant et en admin.
const L = require('./lib');

const EMAIL = `repreneur.ui.${Date.now().toString(36)}@test.fr`;
const isoPlus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

(async () => {
  const browser = await L.launch();
  const errors = [];
  const s = L.seed();
  const cid = s.company_id;
  const sellerUser = s.seller;
  const p = await L.makePage(browser, { errors });

  // ---- Inscription repreneur avec profil (un seul écran)
  await p.goto(L.FRONT + '/register?role=buyer', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=buyer-profile-fields]');
  L.check('inscription : profil repreneur présélectionné', await p.getByTestId('register-role-buyer').isChecked());
  await p.getByTestId('register-first-name-input').fill('Claire');
  await p.getByTestId('register-last-name-input').fill('Martin');
  await p.getByTestId('register-email-input').fill(EMAIL);
  await p.getByTestId('register-password-input').fill('Test1234!');
  await p.getByTestId('register-phone-input').fill('06 98 76 54 32');
  const choose = async (testId) => p.locator(`[data-testid="${testId}"] + label`).click();
  await choose('buyer-project-type-reprise-individuelle');
  await p.getByRole('textbox', { name: /Budget maximum/ }).fill('600000');
  await p.getByRole('textbox', { name: 'Apport' }).fill('200000');
  await choose('buyer-financing-mixte');
  await choose('buyer-zones-Île-de-France');
  await choose('buyer-trades-pac-clim-cvc');
  await choose('buyer-horizon-6-12');
  await L.sleep(200);
  const scoreTxt = await p.getByTestId('profile-score').innerText();
  L.check('inscription : score de profil calculé en direct (≥ 80 %)', /8\d|9\d|100/.test(scoreTxt), scoreTxt);
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
  L.check('espace repreneur : vide sans compteur à zéro, sans crédit', L.zeroCounters(t).length === 0 && !/crédit/i.test(t), L.zeroCounters(t).join(', '));

  // ---- Page des annonces → fiche → contact
  await p.goto(L.FRONT + '/', { waitUntil: 'networkidle' });
  await p.locator(`a[href="/company/${cid}"]`).first().click();
  await p.waitForSelector('[data-testid=company-header]');
  await p.getByTestId('contact-seller-btn').first().click();
  await p.getByTestId('contact-modal').waitFor();
  const prefilled = await p.getByTestId('contact-message').inputValue();
  L.check('contact : message prérempli depuis le profil', prefilled.length >= 20, prefilled.slice(0, 120));
  await p.getByTestId('contact-message').fill(prefilled + ' Je souhaite échanger sur votre activité et votre calendrier de cession.');
  await p.getByTestId('contact-send-btn').click();
  await p.waitForURL(/\/messages\?conversation=/, { timeout: 15000 });
  L.check('contact : redirection vers la conversation', true);
  await p.waitForSelector('[data-testid=thread]', { timeout: 15000 });
  await L.sleep(500);
  L.check('messagerie : premier message visible', (await p.locator('[data-testid=thread] [data-testid=message]').count()) >= 1);
  L.check('messagerie : e-mail « premier contact » au cédant avec carte', !!L.findEmail(sellerUser.user.email, /contact|projet/i, since));
  await p.getByTestId('message-input').fill('Pouvez-vous me préciser la part de contrats d\'entretien dans le chiffre d\'affaires ?');
  await p.getByTestId('send-message').click();
  await L.sleep(800);
  L.check('messagerie : second message envoyé', (await p.locator('[data-testid=thread] [data-testid=message]').count()) >= 2);
  t = await L.text(p);
  L.check('messagerie : identité masquée avant NDA', !/SECRET ENERGIE/.test(t));
  await L.shot(p, 'messages-buyer-desktop.png');

  // ---- Demande de dossier
  await p.goto(L.FRONT + `/dataroom/${cid}`, { waitUntil: 'networkidle' });
  await p.getByTestId('request-access-btn').waitFor({ timeout: 15000 });
  await p.locator('#request-message').fill('Projet de reprise individuelle, financement bancaire en cours d\'accord.');
  await p.getByTestId('request-access-btn').click();
  await L.sleep(1000);
  t = await L.text(p);
  L.check('dossier : demande enregistrée (en attente du cédant)', /Votre demande est enregistrée/.test(t) && /J\+2 et J\+5/.test(t), t.slice(0, 300));
  let st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('dossier : statut pending côté API', st.access_status === 'pending', JSON.stringify(st).slice(0, 200));

  // ---- Cédant : « À traiter » avec carte repreneur → Accepter
  const sp = await L.makePage(browser, { errors, user: sellerUser });
  await sp.goto(L.FRONT + '/seller/dashboard', { waitUntil: 'networkidle' });
  await sp.waitForSelector('[data-testid=todo-block]', { timeout: 15000 });
  const card = sp.locator('[data-testid=todo-block] [data-testid=buyer-card]').first();
  L.check('cédant : carte repreneur dans « À traiter » (pseudonyme, projet, budget)', (await card.count()) === 1 && /Repreneur n°|Acquéreur/.test(await card.innerText()) && /600\s?000/.test(await card.innerText()), (await card.innerText().catch(() => '')).slice(0, 200));
  L.check('cédant : carte sans nom ni coordonnées', !/Claire|Martin|@test\.fr/.test(await card.innerText()));
  await sp.locator('[data-testid^=accept-request-]').first().click();
  await L.sleep(1200);
  st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('cédant : demande acceptée (statut accepted, étape suivante identité)', st.access_status === 'accepted' && st.next_step === 'identity', JSON.stringify(st).slice(0, 200));
  L.check('repreneur : e-mail « dossier accepté »', !!L.findEmail(EMAIL, /accept|dossier/i, since));

  // ---- Identité (simulation Stripe) → NDA par code
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
  L.check('NDA : texte v2 (24 mois, identité, sans commission acquéreur ni LOI)', /24 mois/.test(ndaText) && /Claire/.test(ndaText) && !/\bLOI\b|Lettre d'intention/.test(ndaText) && !/commission/i.test(ndaText), ndaText.slice(0, 200));
  await L.otpSign(p, EMAIL);
  await p.getByTestId('revealed-name').waitFor({ timeout: 15000 });
  L.check('NDA : nom de l\'entreprise révélé', /SECRET ENERGIE/.test(await p.getByTestId('revealed-name').innerText()));
  const mandateStatus = (await L.api('GET', `/seller/mandat/status/${cid}`, { token: sellerUser.token })).data;
  L.check('NDA : repreneur présenté sur la liste nominative du cédant', (mandateStatus.presented_buyers || []).some((b) => b.buyer_id === buyerId && /Martin/i.test(b.name || '')), JSON.stringify(mandateStatus.presented_buyers));

  // ---- Origine des fonds → accès
  await p.getByTestId('funds-form').waitFor({ timeout: 10000 });
  await p.getByTestId('funds-source').selectOption('mixte');
  await p.getByTestId('funds-amount').fill('500000');
  await p.getByTestId('funds-partner').fill('Crédit Mutuel de Bretagne');
  await p.getByTestId('funds-attest').check();
  await p.getByTestId('funds-submit').click();
  await p.getByTestId('open-offer-form').waitFor({ timeout: 15000 });
  st = (await L.api('GET', `/dataroom/${cid}/access-status`, { token: buyerToken })).data;
  L.check('fonds : accès accordé (granted, 3 étapes faites)', st.access_granted === true && st.access_status === 'granted' && st.steps.identity && st.steps.nda && st.steps.funds, JSON.stringify(st).slice(0, 200));
  t = await L.text(p);
  L.check('data room : documents (état vide utile), diagnostic, offre', (await p.getByTestId('dataroom-empty').count()) + (await p.getByTestId('dataroom-documents').count()) >= 1 && (await p.getByTestId('transmissibility').count()) === 1);
  L.check('data room : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  await L.shot(p, 'dataroom-desktop.png');

  // ---- Offre indicative signée par code
  await p.getByTestId('open-offer-form').click();
  await p.getByTestId('offer-form').waitFor();
  await p.getByTestId('offer-amount').fill('420000');
  await p.getByTestId('offer-sale-object').selectOption('titres');
  await p.getByTestId('offer-equity').fill('150000');
  await p.getByTestId('offer-loan').fill('270000');
  await p.getByTestId('offer-target-date').fill(isoPlus(90));
  await p.getByTestId('offer-validity').fill('30');
  await p.getByTestId('offer-message').fill('Offre indicative sous réserve de l\'audit comptable.');
  await p.getByTestId('offer-submit').click();
  await p.getByTestId('otp-signature-dialog').waitFor({ timeout: 15000 });
  const offerText = await p.getByTestId('otp-document').innerText();
  L.check('offre : texte du contrat (montant, objet, validité)', /420\s?000/.test(offerText) && /30 jours/.test(offerText), offerText.slice(0, 200));
  await L.otpSign(p, EMAIL);
  await L.sleep(1000);
  const myOffers = (await L.api('GET', '/offers/my', { token: buyerToken })).data.offers;
  const offer = myOffers.find((o) => o.company_id === cid);
  L.check('offre : signée → statut pending, e-mail au cédant', offer && offer.status === 'pending' && !!L.findEmail(sellerUser.user.email, /offre/i, since), JSON.stringify(offer).slice(0, 200));
  L.check('offre : suivi affiché côté repreneur', (await p.getByTestId(`offer-${offer.id}`).count()) === 1);

  // ---- Cédant : acceptation par code → étape de vente
  await sp.goto(L.FRONT + `/seller/dashboard?annonce=${cid}&onglet=offers`, { waitUntil: 'networkidle' });
  await sp.getByTestId(`accept-offer-${offer.id}`).waitFor({ timeout: 15000 });
  t = await sp.locator(`[data-testid=offer-${offer.id}]`).innerText();
  L.check('cédant : offre listée avec nom du repreneur (NDA signé)', /420\s?000/.test(t) && /Martin/i.test(t), t.slice(0, 200));
  await sp.getByTestId(`accept-offer-${offer.id}`).click();
  await L.otpSign(sp, sellerUser.user.email);
  await L.sleep(1000);
  const closings = (await L.api('GET', '/closing/my', { token: sellerUser.token })).data;
  const closing = (Array.isArray(closings) ? closings : closings.closings || []).find((c) => c.offer_id === offer.id);
  L.check('cédant : offre acceptée → étape de vente créée', !!closing && closing.status === 'in_progress', JSON.stringify(closing).slice(0, 200));
  L.check('repreneur : e-mail « offre acceptée »', !!L.findEmail(EMAIL, /accept/i, since));

  // ---- Étape de vente : rédacteur + déclaration (cédant), confirmation (repreneur)
  await sp.goto(L.FRONT + `/vente/${closing.id}`, { waitUntil: 'networkidle' });
  await sp.getByTestId('closing-panel').waitFor({ timeout: 15000 });
  await sp.getByTestId('redacteur-type').selectOption('notaire');
  await sp.getByTestId('redacteur-name').fill('Maître Le Gall');
  await sp.getByTestId('redacteur-email').fill('etude@notaires-test.fr');
  await sp.getByTestId('redacteur-phone').fill('02 98 00 00 00');
  await sp.getByTestId('redacteur-submit').click();
  await L.sleep(800);
  L.check('vente : rédacteur enregistré', /Le Gall/.test(await L.text(sp)));
  await sp.getByTestId('declare-date').fill(isoPlus(-1));
  await sp.getByTestId('declare-price').fill('420000');
  await sp.getByTestId('declare-object').selectOption('titres');
  await L.sleep(200);
  L.check('vente : commission prévisualisée HT (25 200 €)', /25\s?200/.test(await sp.getByTestId('declare-commission').innerText()), await sp.getByTestId('declare-commission').innerText());
  await sp.getByTestId('declare-submit').click();
  await L.sleep(1000);
  L.check('vente : déclarée par le cédant', /déclarée|Déclarée/.test(await sp.getByTestId('closing-status').innerText()), await sp.getByTestId('closing-status').innerText());
  await p.goto(L.FRONT + `/vente/${closing.id}`, { waitUntil: 'networkidle' });
  await p.getByTestId('confirm-banner').waitFor({ timeout: 15000 });
  await p.getByTestId('confirm-btn').click();
  await p.getByTestId('confirm-dialog-confirm').click();
  await L.sleep(1200);
  L.check('vente : confirmée par le repreneur', /confirmée|Confirmée|Vendue/.test(await p.getByTestId('closing-status').innerText()), await p.getByTestId('closing-status').innerText());
  t = await L.text(p);
  L.check('vente : rien n\'est demandé au repreneur', /rien ne vous est demandé|aucune commission|à la charge du cédant/i.test(t), t.slice(0, 300));
  await sp.reload({ waitUntil: 'networkidle' });
  await sp.getByTestId('invoice-card').waitFor({ timeout: 15000 });
  t = await sp.getByTestId('invoice-card').innerText();
  L.check('vente : facture côté cédant (numéro, HT, TTC)', /FAC|F-?\d/.test(t) && /25\s?200/.test(t) && /30\s?240/.test(t), t.slice(0, 200));
  const dl = sp.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await sp.getByTestId('invoice-pdf-btn').click();
  L.check('vente : PDF de facture téléchargé', !!(await dl));
  const pub = (await L.api('GET', `/companies/${cid}`, { token: sellerUser.token })).data;
  L.check('annonce : statut « vendue » après confirmation', pub.status === 'sold', pub.status);
  await L.shot(sp, 'closing-seller-desktop.png');

  // ---- Admin : facture visible
  const ap = await L.makePage(browser, { errors, user: s.admin });
  await ap.goto(L.FRONT + '/admin/dashboard?tab=invoices', { waitUntil: 'networkidle' });
  await L.sleep(1200);
  t = await L.text(ap);
  L.check('admin : facture listée (Factures)', /FAC|Facture/.test(t) && /25\s?200|30\s?240/.test(t), t.slice(0, 300));
  await ap.context().close();

  // ---- Espace repreneur : pipeline
  await p.goto(L.FRONT + '/buyer/dashboard', { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-testid=pipeline-list]', { timeout: 15000 });
  t = await L.text(p);
  L.check('espace repreneur : dossier dans « Mes dossiers » avec lien vente', (await p.getByTestId(`pipeline-${cid}`).count()) === 1 && (await p.getByTestId(`pipeline-${cid}`).getAttribute('href')) === `/vente/${closing.id}`);
  L.check('espace repreneur : aucun compteur à zéro', L.zeroCounters(t).length === 0, L.zeroCounters(t).join(', '));
  await L.shot(p, 'buyer-dashboard-desktop.png');

  // ---- Mobile 390 : data room et messagerie
  const m = await L.makePage(browser, { errors, viewport: { width: 390, height: 844 }, user: { token: buyerToken, user: me } });
  await m.goto(L.FRONT + `/dataroom/${cid}`, { waitUntil: 'networkidle' });
  await m.getByTestId('checklist').waitFor({ timeout: 15000 });
  let o = await L.noOverflow(m, 390);
  L.check('mobile data room : aucun débordement horizontal', o.ok, `scrollWidth=${o.width}`);
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
