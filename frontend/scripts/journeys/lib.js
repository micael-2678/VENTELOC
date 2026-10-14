// Outils communs des parcours Playwright VenteLoc (NODE_PATH=/opt/node22/lib/node_modules node scripts/journeys/<script>.js).
// Prérequis : backend de test sur API (mongomock, e-mails écrits dans EMAILS_FILE, route /test/set-user) et front
// statique sur FRONT (build fait avec REACT_APP_BACKEND_URL pointant sur le backend de test).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const SCRATCH = process.env.SCRATCHPAD || path.join(os.tmpdir(), 'venteloc-journeys');
const FRONT = process.env.FRONT || 'http://127.0.0.1:3000';
const API = process.env.API || 'http://127.0.0.1:8001/api';
const TEST_API = API.replace(/\/api$/, '') + '/test';
const EMAILS_FILE = process.env.EMAILS_FILE || path.join(SCRATCH, 'emails.jsonl');
const SEED_FILE = process.env.SEED_FILE || path.join(SCRATCH, 'seed.json');
const SHOTS_DIR = process.env.SHOTS_DIR || path.join(SCRATCH, 'shots-v2');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

fs.mkdirSync(SHOTS_DIR, { recursive: true });

const results = [];
const check = (name, cond, info = '') => {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : '  -> ' + String(info).slice(0, 400)));
  return !!cond;
};
const summary = () => {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} OK`);
  return ok === results.length;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = () => JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));

// ---- API directe (Node 22 : fetch natif)
const api = async (method, p, { token, body, params, headers } = {}) => {
  const url = new URL(API + p);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data, headers: res.headers };
};
const setUser = async (email, field, value) => {
  const url = new URL(TEST_API + '/set-user');
  url.searchParams.set('email', email); url.searchParams.set('field', field); url.searchParams.set('value', String(value));
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`set-user ${res.status}`);
};
const login = async (email, password = 'Test1234!') => {
  const r = await api('POST', '/auth/login', { body: { email, password } });
  if (r.data && r.data.otp_required) {
    const code = await waitEmailCode(email, /code de connexion/i, 0);
    return (await api('POST', '/auth/login/verify', { body: { email, code } })).data;
  }
  return r.data;
};

// ---- E-mails écrits par le backend de test
const readEmails = () => {
  try {
    return fs.readFileSync(EMAILS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { return []; }
};
const emailCount = () => readEmails().length;
const findEmail = (to, subjectRe, since = 0) => {
  const list = readEmails();
  for (let i = list.length - 1; i >= since; i--) {
    const e = list[i];
    if (e.to === to && subjectRe.test(e.subject || '')) return e;
  }
  return null;
};
const waitEmail = async (to, subjectRe, since = 0, timeoutMs = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const e = findEmail(to, subjectRe, since);
    if (e) return e;
    await sleep(250);
  }
  throw new Error(`e-mail non reçu : ${to} ${subjectRe}`);
};
const codeIn = (html) => {
  const m = /letter-spacing:6px">(\d{6})</.exec(html) || /(\d{6})/.exec(html.replace(/<[^>]+>/g, ' '));
  return m ? m[1] : null;
};
const waitEmailCode = async (to, subjectRe, since = 0) => codeIn((await waitEmail(to, subjectRe, since)).html);
const linkIn = (html, pathRe) => {
  const m = new RegExp(`href="([^"]*${pathRe.source}[^"]*)"`).exec(html);
  return m ? m[1].replace(/&amp;/g, '&') : null;
};

// ---- Navigateur
const launch = () => chromium.launch({ executablePath: CHROME });
const makePage = async (browser, { user, viewport = { width: 1400, height: 900 }, errors } = {}) => {
  const ctx = await browser.newContext({ viewport, locale: 'fr-FR', acceptDownloads: true });
  if (user) {
    await ctx.addInitScript((u) => {
      localStorage.setItem('token', u.token);
      localStorage.setItem('user', JSON.stringify(u.user));
    }, user);
  }
  const page = await ctx.newPage();
  if (errors) {
    page.on('pageerror', (e) => errors.push(`JS: ${e.message}`));
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  }
  return page;
};
const text = (page) => page.innerText('body');
// Capture pleine page prise depuis le haut : après un défilement, la barre collante apparaîtrait au milieu de l'image
// Les toasts (position fixe) sont masqués pendant la capture : en pleine page, ils apparaîtraient au milieu du contenu
const shot = async (page, name) => {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  return page.screenshot({ path: path.join(SHOTS_DIR, name), fullPage: true, style: '[data-sonner-toaster] { display: none !important; }' });
};
const noOverflow = async (page, width) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  return { ok: w <= width, width: w };
};
const toasts = (page) => page.$$eval('[data-sonner-toast]', (els) => els.map((e) => e.innerText).join(' | ')).catch(() => '');
// Compteur à zéro visible (« 0 vues », « 0 bien », « 0 acquéreur »…) : interdit (SPEC §5.1)
const zeroCounters = (t) => (t.match(/\b0\s+(vues?|annonces?|biens?|acquéreurs?|contacts?|favoris|offres?|messages?|résultats?)\b/gi) || []);

// Signature par code dans OtpSignatureDialog : lecture du texte intégral (défilement), case, envoi, saisie, signature.
const otpSign = async (page, email) => {
  const dlg = page.getByTestId('otp-signature-dialog');
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  const toggle = page.getByTestId('otp-toggle-document');
  if (await toggle.count()) {
    const label = await toggle.innerText();
    if (/Lire/.test(label)) await toggle.click();
  }
  const doc = page.getByTestId('otp-document');
  if (await doc.count()) {
    for (let i = 0; i < 5; i++) {
      await doc.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll', { bubbles: true })); });
      await sleep(150);
      if (!(await page.getByTestId('otp-scroll-hint').count())) break;
    }
  }
  const accept = page.getByTestId('otp-accept');
  await accept.waitFor({ state: 'visible' });
  if (await accept.isDisabled()) throw new Error('case d\'acceptation toujours désactivée (texte non lu)');
  await accept.click();
  const since = emailCount();
  await page.getByTestId('otp-request').click();
  const code = await waitEmailCode(email, /code de signature/i, since);
  await page.getByTestId('otp-code').fill(code);
  await page.getByTestId('otp-sign').click();
  await dlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  const err = await page.getByTestId('otp-error').innerText().catch(() => '');
  if (err) throw new Error('signature refusée : ' + err);
};

// Bien loué publié par l'API pour un vendeur (docs/venteloc/SPEC.md §5.2 et §5.4) : brouillon complet, justificatif de
// propriété déposé (multipart), e-mail et identité marqués vérifiés par /test/set-user (mode test), mandat signé par
// code, publication automatique. `overrides` complète ou remplace les champs du bien ; `docType` : type du justificatif.
const DEFAULT_PROPERTY = {
  property_type: 'appartement', owner_type: 'personne-physique', address: '8 rue des Essais', postal_code: '35000', city: 'Rennes',
  surface: 38, rooms: 2, floor: 2, elevator: false, construction_year: 1975, is_copro: true, copro_lots: 24, copro_charges_annual: 960, copro_procedure: false,
  dpe_class: 'D', ges_class: 'D', energy_cost_min: 700, energy_cost_max: 980,
  lease_type: 'habitation-vide', rent_monthly: 590, charges_monthly: 60, lease_start: '2022-09-01', deposit: 590, indexation: 'irl',
  tenant_payment_status: 'a-jour', has_gli: false, has_guarantor: true, property_tax: 720, non_recoverable_charges: 480, management: 'direct',
  asking_price: 128000, sale_object: 'bien', sale_reason: 'arbitrage', auto_accept_dataroom: false,
  description: 'Appartement de deux pièces au deuxième étage d\'une copropriété bien tenue, proche des commerces et du métro. '
    + 'Locataire en place depuis septembre 2022, loyers payés à l\'échéance, caution solidaire. Séjour lumineux, chambre sur cour, '
    + 'cuisine séparée, salle d\'eau refaite en 2021. Charges de copropriété maîtrisées, aucuns travaux votés.',
};
const uploadOwnershipProof = async (token, id, docType = 'titre-propriete') => {
  const form = new FormData();
  form.append('doc_type', docType);
  form.append('file', new Blob(['%PDF-1.4\n% justificatif de test\n'], { type: 'application/pdf' }), 'justificatif.pdf');
  const res = await fetch(`${API}/properties/${id}/ownership-proof`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`ownership-proof ${res.status}`);
  return res.json().catch(() => ({}));
};
const publishProperty = async (sellerUser, overrides = {}, docType = 'titre-propriete') => {
  const token = sellerUser.token;
  const email = sellerUser.user.email;
  const body = { ...DEFAULT_PROPERTY, ...overrides };
  // Mode test : e-mail confirmé et identité vérifiée (simulation de Stripe Identity)
  await setUser(email, 'email_verified', true).catch(() => {});
  await setUser(email, 'identity_verified', true).catch(() => {});
  const created = await api('POST', '/properties', { token, body });
  if (created.status !== 200) throw new Error(`POST /properties ${created.status} ${JSON.stringify(created.data)}`);
  const id = created.data.id;
  await uploadOwnershipProof(token, id, docType);
  const company = ['sci', 'societe'].includes(body.owner_type);
  await api('PUT', `/properties/${id}`, { token, body: { mandant_address: { line1: '4 rue du Port', postal_code: '35000', city: 'Rennes' }, mandant_capacity: company ? 'gerant' : 'proprietaire', sale_object: body.sale_object } });
  const gen = await api('POST', '/seller/mandat/generate', { token, params: { property_id: id } });
  if (!gen.data || !gen.data.contract_id) throw new Error(`generate ${gen.status} ${JSON.stringify(gen.data)}`);
  const since = emailCount();
  await api('POST', '/signatures/request-code', { token, body: { contract_id: gen.data.contract_id } });
  const code = await waitEmailCode(email, /code de signature/i, since);
  const signed = await api('POST', `/seller/mandat/${gen.data.contract_id}/sign`, { token, body: { otp_code: code } });
  if (signed.status !== 200) throw new Error(`sign ${signed.status} ${JSON.stringify(signed.data)}`);
  return { id, address: body.address, listing_status: signed.data.listing_status, registry_number: signed.data.registry_number };
};
// Ancien nom conservé pour les scripts qui l'appellent encore
const publishListing = publishProperty;
// SIRET unique (bien détenu par une SCI)
const uniqueSiret = (prefix = '777') => (prefix + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 90) + 10)).slice(0, 14);

module.exports = {
  DEFAULT_PROPERTY, publishProperty, publishListing, uploadOwnershipProof, uniqueSiret,
  FRONT, API, EMAILS_FILE, SEED_FILE, SHOTS_DIR, check, summary, sleep, seed, api, setUser, login,
  readEmails, emailCount, findEmail, waitEmail, waitEmailCode, codeIn, linkIn,
  launch, makePage, text, shot, noOverflow, toasts, zeroCounters, otpSign,
};
