// Outils communs des parcours Playwright (NODE_PATH=/opt/node22/lib/node_modules node scripts/journeys/<script>.js).
// Prérequis : backend de test sur API (mongomock, e-mails écrits dans EMAILS_FILE, route /test/set-user) et front
// statique sur FRONT (build fait avec REACT_APP_BACKEND_URL pointant sur le backend de test).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SCRATCH = process.env.SCRATCHPAD || '/tmp/claude-0/-home-user-Cession-rge/ce38f6ec-42e9-581c-a8b8-72299bf0cff5/scratchpad';
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
// Compteur à zéro visible (« 0 vues », « 0 annonce », « 0 repreneur »…) : interdit par SPEC §5.1
const zeroCounters = (t) => (t.match(/\b0\s+(vues?|annonces?|repreneurs?|contacts?|favoris|offres?|messages?|résultats?|entreprises?)\b/gi) || []);

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

// Annonce publiée par l'API pour un cédant (identité vérifiée, e-mail confirmé) : brouillon complet, mandat v2 signé
// par code, publication automatique. `overrides` complète ou remplace les champs de l'annonce.
const DEFAULT_LISTING = {
  rge_types: [], rge_validity: '', ca_n: 500000, ca_n1: 450000, ca_n2: 400000, margin: 25, ebitda: 70000, creation_date: '2011-03-01',
  staff_count: 6, legal_structure: 'SARL', pipeline: 80000, fixed_charges: { salaries: 200000, rent: 15000 }, debt: 20000,
  asking_price: 260000, sale_type: 'Cession totale', region: 'Bretagne', department: '29', trades: ['electricite'], sale_object: 'titres',
  sale_reason: 'retraite', handover_months: 3, has_maintenance_contracts: true, technical_referent_stays: true, key_staff_stays: true,
  decennale_ok: true, auto_accept_dataroom: false,
  description: 'Entreprise d\'électricité générale implantée depuis quinze ans, clientèle de particuliers et de syndics de copropriété, '
    + 'équipe de six personnes dont deux chefs d\'équipe autonomes, carnet de commandes signé sur quatre mois, véhicules et outillage '
    + 'récents, dépôt en location avec bail transférable. Le dirigeant accompagne le repreneur pendant trois mois.',
};
const publishListing = async (sellerUser, siret, overrides = {}) => {
  const token = sellerUser.token;
  const body = { ...DEFAULT_LISTING, siret, company_name: overrides.company_name || `SOCIETE ${siret.slice(-5)}`, ...overrides };
  const created = await api('POST', '/companies', { token, body });
  if (created.status !== 200) throw new Error(`POST /companies ${created.status} ${JSON.stringify(created.data)}`);
  const id = created.data.id;
  await api('PUT', `/companies/${id}`, { token, body: { mandant_address: { line1: '4 rue du Port', postal_code: '29200', city: 'Brest' }, mandant_capacity: 'dirigeant', sale_object: body.sale_object } });
  const gen = await api('POST', '/seller/mandat/generate', { token, params: { company_id: id } });
  if (!gen.data || !gen.data.contract_id) throw new Error(`generate ${gen.status} ${JSON.stringify(gen.data)}`);
  const since = emailCount();
  await api('POST', '/signatures/request-code', { token, body: { contract_id: gen.data.contract_id } });
  const code = await waitEmailCode(sellerUser.user.email, /code de signature/i, since);
  const signed = await api('POST', `/seller/mandat/${gen.data.contract_id}/sign`, { token, body: { otp_code: code } });
  if (signed.status !== 200) throw new Error(`sign ${signed.status} ${JSON.stringify(signed.data)}`);
  return { id, listing_status: signed.data.listing_status, registry_number: signed.data.registry_number };
};
const uniqueSiret = (prefix = '777') => (prefix + String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 90) + 10)).slice(0, 14);

module.exports = {
  publishListing, uniqueSiret,
  FRONT, API, EMAILS_FILE, SEED_FILE, SHOTS_DIR, check, summary, sleep, seed, api, setUser, login,
  readEmails, emailCount, findEmail, waitEmail, waitEmailCode, codeIn, linkIn,
  launch, makePage, text, shot, noOverflow, toasts, zeroCounters, otpSign,
};
