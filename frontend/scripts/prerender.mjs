#!/usr/bin/env node
// Pré-rendu statique des pages publiques, exécuté après `craco build` (voir package.json).
//
// L'application est une SPA : sans ce script, robots et aperçus de partage ne voient qu'un index.html vide.
// Pages pré-rendues (docs/venteloc/SPEC.md §5.1) : la page des annonces (/), la page vendeur (/vendre), l'estimateur
// (/estimer) et les pages légales.
// Pour chacune, build/<route>/index.html est écrit à partir de build/index.html avec :
//   - <title>, meta description, canonical, Open Graph, Twitter card, robots, JSON-LD ;
//   - dans <div id="root">, un HTML statique reprenant la coque de la page React (en-tête AppHeader, titre, pied de
//     page AppFooter) et ses textes, issus des mêmes fichiers (src/seo/content.json, src/lib/brand.js…).
// Au chargement, React (createRoot, sans hydratation) remplace ce contenu ; la liste des annonces se charge côté client.
//
// Données lues sur l'API au build (facultatif, PRERENDER_API_URL ou REACT_APP_BACKEND_URL) : informations légales
// (GET /public/legal-info).
//
// `node scripts/prerender.mjs --routes-only` écrit seulement scripts/seo-routes.json (liste des routes pré-rendues,
// copiée dans backend/seo_routes.json pour le sitemap) sans avoir besoin du dossier build.
//
// Node pur, aucune dépendance : les modules partagés de src/ sont écrits sans import et chargés
// ci-dessous dans un bac à sable (node:vm). Aucun navigateur n'est nécessaire (build Docker node:alpine).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const SRC = path.join(ROOT, 'src');
const ROUTES_ONLY = process.argv.includes('--routes-only');

// API interrogée au build : PRERENDER_API_URL (ex. URL publique du backend en CI) sinon REACT_APP_BACKEND_URL (vide en
// production : /api relatif, donc pas d'appel au build et pages indexables par défaut)
const BACKEND_URL = (process.env.PRERENDER_API_URL || process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const TODAY = new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------------
// Chargement des modules partagés (ESM sans import) dans un contexte isolé
const loadShared = (rel) => {
  const file = path.join(SRC, rel);
  let code = fs.readFileSync(file, 'utf8');
  if (/^\s*import\s/m.test(code)) throw new Error(`${rel} : les modules partagés avec le pré-rendu ne doivent rien importer`);
  const names = [];
  code = code.replace(/^export\s+(const|let|function)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  // lib/brand.js lit process.env.REACT_APP_* (remplacé par CRA au build) : on fournit `process` au bac à sable
  return vm.runInNewContext(`(function () {\n${code}\nreturn { ${names.join(', ')} };\n})()`, { process: { env: process.env } }, { filename: file });
};
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(SRC, rel), 'utf8'));

const { BRAND, LEGAL, splitBrandName } = loadShared('lib/brand.js');
const SITE_URL = BRAND.siteUrl;
const { parseInline, fillBrand, formatDateFr, formatDateShort } = loadShared('seo/inline.js');
const { fillOffer } = loadShared('lib/offer.js');
const schema = loadShared('seo/schema.js');
const legal = loadShared('seo/legal.js');
const { logoMarkSvg } = loadShared('seo/brand.js');
const content = readJson('seo/content.json');
const { PROPERTY_TYPES, REGIONS, slugify } = loadShared('lib/referentiels.js');
// Classes des boutons partagées avec AppHeader (utilitaires Tailwind seulement)
const buttons = loadShared('components/shared/buttonStyles.js');

const BRAND_TOKENS = { ...LEGAL, ...BRAND };
const fill = (text) => fillBrand(fillOffer(text), BRAND_TOKENS);

// URL du site WordPress (pied de page), même validation que AppFooter.marketingUrl
const MARKETING_URL = (() => {
  const s = String(process.env.REACT_APP_MARKETING_URL || '').trim();
  return /^https?:\/\/[^\s"<>]+$/i.test(s) ? s.replace(/\/+$/, '') : '';
})();

// ------------------------------------------------------------------------------------------------
// Utilitaires HTML
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const rich = (text) => parseInline(fill(text)).map((seg) => {
  if (seg.type === 'strong') return `<strong>${esc(seg.text)}</strong>`;
  if (seg.type === 'link') return `<a href="${esc(seg.href)}"${seg.href.startsWith('/') ? '' : ' rel="noopener"'}>${esc(seg.text)}</a>`;
  return esc(seg.text);
}).join('');

const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 bg-white hover:bg-brand-surface text-brand-navy font-semibold border border-brand-navy rounded-xl px-5 py-3 transition-colors';
const HOME_CRUMB = { name: 'Accueil', path: '/' };
const INFO_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 mt-0.5 shrink-0 text-brand-teal" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
const MENU_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6" aria-hidden="true"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>';
const SPINNER = '<div class="flex justify-center py-12" role="status" aria-label="Chargement"><div class="spinner"></div></div>';

// ------------------------------------------------------------------------------------------------
// Coque commune : en-tête et pied de page (mêmes balisages que AppHeader, état déconnecté, et AppFooter)
const logoHtml = () => {
  const { head, tail } = splitBrandName(BRAND.name);
  const tailHtml = tail ? `<span class="text-brand-teal">${esc(tail)}</span>` : '';
  return `<a href="/" class="inline-flex items-center gap-2 min-w-0" aria-label="${esc(BRAND.name)} – accueil">`
    + `<span class="inline-flex shrink-0" style="width:32px;height:32px">${logoMarkSvg(32)}</span>`
    + `<span class="font-display font-extrabold tracking-tight leading-none text-xl sm:text-2xl text-brand-navy">${esc(head)}${tailHtml}</span></a>`;
};

const NAV_LINK = 'inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap';
const headerHtml = (current) => {
  const h = content.header;
  const link = (to, label) => {
    const active = current === to;
    return `<a href="${esc(to)}" class="${NAV_LINK} ${active ? 'text-brand-navy bg-brand-surface' : 'text-gray-700 hover:text-brand-navy hover:bg-brand-surface'}"${active ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  };
  return `<header class="bg-white border-b border-brand-line"><a href="#contenu" class="sr-only">${esc(h.skip)}</a>`
    + `<div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 min-w-0">`
    + `<div class="flex items-center gap-6 min-w-0">${logoHtml()}<nav aria-label="Navigation principale" class="hidden md:flex items-center gap-1">${link('/', h.listings)}${link('/vendre', h.sell)}</nav></div>`
    + `<div class="flex items-center gap-1 sm:gap-2 shrink-0">`
    + `<a href="/login" class="hidden sm:inline-flex items-center px-3 py-2 rounded-lg text-sm font-medium text-brand-navy hover:bg-brand-surface">${esc(h.login)}</a>`
    + `<a href="/register" class="${buttons.BTN_PRIMARY} hidden md:inline-flex px-4 py-2 text-sm">${esc(h.register)}</a>`
    + `<span class="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl text-brand-navy" aria-hidden="true">${MENU_ICON}</span>`
    + `</div></div></header>`;
};

let RAW_LEGAL = null;

const footerHtml = () => {
  const f = content.footer;
  const linkClass = 'text-gray-600 hover:text-brand-navy hover:underline underline-offset-4';
  const items = [
    ...f.legal.map((l) => `<li><a href="${esc(l.to)}" class="${linkClass}">${esc(l.label)}</a></li>`),
    ...(BRAND.contactEmail ? [`<li><a href="mailto:${esc(BRAND.contactEmail)}" class="${linkClass}">${esc(f.contact)}</a></li>`] : []),
    ...(MARKETING_URL ? [`<li><a href="${esc(MARKETING_URL)}" class="${linkClass}">${esc(fill(f.site))}</a></li>`] : []),
  ];
  return `<footer class="bg-white border-t border-brand-line px-4 sm:px-6 py-6"><div class="max-w-7xl mx-auto min-w-0 space-y-3 text-sm">`
    + `<nav aria-label="Informations légales"><ul class="flex flex-wrap items-center gap-x-5 gap-y-2">${items.join('')}</ul></nav>`
    + `<p class="text-gray-500 break-words">© ${new Date().getFullYear()} ${esc(BRAND.name)} · ${esc(legal.footerShortLine(RAW_LEGAL))}</p>`
    + `</div></footer>`;
};

const layout = (current, main, bg = 'bg-white') =>
  `<div class="min-h-screen flex flex-col overflow-x-hidden ${bg}">${headerHtml(current)}<main id="contenu" class="flex-1 min-w-0">${main}</main>${footerHtml()}</div>`;

// ------------------------------------------------------------------------------------------------
// Briques éditoriales (mêmes structures que src/components/seo/Content.jsx)
const breadcrumbsHtml = (items, tone = 'dark') => `<nav aria-label="Fil d'Ariane" class="mb-4"><ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${tone === 'light' ? 'text-gray-300' : 'text-gray-500'}">`
  + items.map((it, i) => (i === items.length - 1
    ? `<li class="flex items-center gap-2 min-w-0"><span aria-current="page" class="${tone === 'light' ? 'text-white' : 'text-gray-800'}">${esc(it.name)}</span></li>`
    : `<li class="flex items-center gap-2 min-w-0"><a href="${esc(it.path)}" class="hover:underline">${esc(it.name)}</a><span aria-hidden="true">›</span></li>`)).join('')
  + `</ol></nav>`;

const tocHtml = (sections) => `<nav aria-label="Sommaire" class="rounded-2xl border border-brand-line bg-brand-surface p-5 mb-8"><p class="font-display font-bold text-brand-navy mb-2">Sommaire</p>`
  + `<ol class="list-decimal pl-5 space-y-1 text-sm text-gray-700 marker:text-brand-teal">`
  + sections.map((s) => `<li><a href="#${esc(s.id)}" class="hover:text-brand-teal hover:underline">${esc(fill(s.title))}</a></li>`).join('')
  + `</ol></nav>`;

// Marque et e-mail : l'API prime, sinon lib/brand.js
const brandedLegal = (raw) => ({ ...(raw || {}), marque: (raw && raw.marque) || BRAND.name, email: (raw && raw.email) || BRAND.contactEmail });

const legalBlockHtml = (kind, rawLegal) => {
  const info = legal.mergeLegal(brandedLegal(rawLegal));
  if (kind === 'controller') {
    return `<p>Le responsable du traitement est la société <strong>${esc(info.denomination)}</strong>${info.forme_juridique ? `, ${esc(info.forme_juridique)}` : ''}${info.adresse ? `, ${esc(info.adresse)}` : ''}, qui exploite la marque ${esc(info.marque)}.</p>`;
  }
  if (kind === 'contact' && info.email) {
    return `<p>Pour exercer vos droits ou pour toute question sur vos données, écrivez-nous à <a href="mailto:${esc(info.email)}">${esc(info.email)}</a>.</p>`;
  }
  if (kind === 'editor') {
    return `<ul>${legal.editorLines(brandedLegal(rawLegal)).map((l) => `<li><strong>${esc(l.label)}</strong> : ${l.href ? `<a href="${esc(l.href)}">${esc(l.value)}</a>` : esc(l.value)}</li>`).join('')}</ul>`;
  }
  return '';
};

const sectionsHtml = (sections, rawLegal) => sections.map((s) => `<section aria-labelledby="${esc(s.id)}"><h2 id="${esc(s.id)}">${esc(fill(s.title))}</h2>`
  + s.blocks.map((b) => {
    if (b.p) return `<p>${rich(b.p)}</p>`;
    if (b.h3) return `<h3>${esc(fill(b.h3))}</h3>`;
    if (b.ul) return `<ul>${b.ul.map((li) => `<li>${rich(li)}</li>`).join('')}</ul>`;
    if (b.ol) return `<ol>${b.ol.map((li) => `<li>${rich(li)}</li>`).join('')}</ol>`;
    if (b.note) return `<p class="not-prose flex gap-3 rounded-xl border border-brand-teal-line bg-brand-teal-soft p-4 text-[0.95rem] text-gray-700">${INFO_ICON}<span>${rich(b.note)}</span></p>`;
    if (b.legal) return legalBlockHtml(b.legal, rawLegal);
    return '';
  }).join('') + `</section>`).join('');

// ------------------------------------------------------------------------------------------------
// Espaces privés, module intégrable et panneau de test exclus de l'exploration ; sitemap servi par le backend
const ROBOTS_DISALLOW = ['/admin', '/seller', '/buyer', '/messages', '/profile', '/kyc', '/suivi', '/reset-password',
  '/dataroom', '/vente/', '/embed/', '/test'];
const robotsTxt = (site) => ['User-agent: *', 'Allow: /', ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`), '', `Sitemap: ${site}/api/sitemap.xml`, ''].join('\n');

// ------------------------------------------------------------------------------------------------
// Pages
const pages = [];
const addPage = (p) => pages.push({ type: 'website', robots: 'index, follow', jsonLd: [], ...p });

const buildPages = () => {
  // Page des annonces (/) : en-tête, titre et phrase d'accroche ; les annonces et les filtres se chargent côté client.
  // Sans JavaScript (robots qui n'exécutent pas les scripts) : liens vers la liste filtrée par type de bien et par région.
  {
    const L = content.listings;
    const browseList = (label, items) => `<h2 class="font-display text-lg font-bold text-brand-navy mt-4 mb-2">${esc(label)}</h2>`
      + `<ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">${items.map(([href, text]) => `<li><a href="${esc(href)}" class="text-brand-navy underline underline-offset-2">${esc(text)}</a></li>`).join('')}</ul>`;
    const browse = `<noscript><nav aria-label="Parcourir les annonces" class="max-w-7xl mx-auto px-4 sm:px-6 pb-8 min-w-0">`
      + browseList('Biens loués par type', PROPERTY_TYPES.map((t) => [`/?type=${t.id}`, t.label]))
      + browseList('Biens loués par région', REGIONS.map((r) => [`/?region=${slugify(r)}`, r]))
      + `</nav></noscript>`;
    const body = `<section class="bg-white border-b border-brand-line" aria-labelledby="titre-annonces"><div class="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10 min-w-0">`
      + `<h1 id="titre-annonces" class="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy tracking-tight">${esc(L.h1)}</h1>`
      + `<p class="mt-2 text-base sm:text-lg text-gray-600">${esc(L.intro)}</p></div></section>`
      + `<div class="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 min-w-0">${SPINNER}</div>${browse}`;
    addPage({
      path: '/',
      title: fill(L.title),
      description: fill(L.description),
      body: layout('/', body, 'bg-brand-surface'),
      jsonLd: [schema.organizationLd(SITE_URL, BRAND, LEGAL), schema.websiteLd(SITE_URL, BRAND)],
      changefreq: 'daily',
    });
  }

  // Page vendeur (/vendre) : titre, accroche, raisons, honoraires et FAQ (FAQPage JSON-LD) -----------------
  {
    const page = content.sell;
    const p = page.path;
    const crumbs = [HOME_CRUMB, { name: 'Vendre un bien loué', path: p }];
    const faqLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: fill(f.a) } })),
    };
    const card = (title, text) => `<li class="card p-5 min-w-0"><h3 class="font-display text-lg font-bold text-brand-navy">${esc(title)}</h3><p class="text-sm text-gray-700 mt-1 leading-relaxed">${esc(text)}</p></li>`;
    const body = `<section class="bg-white border-b border-brand-line px-4 sm:px-6 pt-8 pb-10"><div class="max-w-5xl mx-auto min-w-0">${breadcrumbsHtml(crumbs)}`
      + `<p class="eyebrow mb-2">Propriétaires bailleurs</p><h1 class="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy leading-tight tracking-tight">${esc(page.h1)}</h1>`
      + `<p class="text-lg text-gray-700 mt-3 leading-relaxed max-w-3xl">${esc(fill(page.intro))}</p>`
      + `<p class="mt-6 flex flex-col sm:flex-row gap-3"><a href="/estimer" class="${BTN_SECONDARY}">${esc(page.ctaEstimate)}</a><a href="/register?role=seller" class="${buttons.BTN_PRIMARY} px-5 py-3">${esc(page.ctaDeposit)}</a></p></div></section>`
      + `<div class="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-12 min-w-0">`
      + `<section><h2 class="section-title mb-5">${esc(page.whyTitle)}</h2><ul class="grid gap-4 sm:grid-cols-3">${page.why.map((w) => card(w.title, w.text)).join('')}</ul></section>`
      + `<section><h2 class="section-title mb-5">${esc(fill(page.doTitle))}</h2><ul class="grid gap-3 sm:grid-cols-2">${page.do.map((d) => `<li class="rounded-2xl border border-brand-line bg-white p-4 text-gray-800">${rich(d)}</li>`).join('')}</ul></section>`
      + `<section><h2 class="section-title mb-3">${esc(page.costTitle)}</h2><p class="text-gray-700 leading-relaxed">${esc(page.costIntro)}</p><p class="text-sm text-gray-600 mt-3">${esc(fill('{{commissionSentence}}'))}</p></section>`
      + `<section><h2 class="section-title mb-3">${esc(page.faqTitle)}</h2><ul class="rounded-2xl border border-brand-line bg-white px-4 sm:px-6">${page.faq.map((f) => `<li class="border-b border-brand-line py-4"><h3 class="font-semibold text-brand-navy">${esc(f.q)}</h3><p class="mt-2 text-gray-700 leading-relaxed">${rich(f.a)}</p></li>`).join('')}</ul></section>`
      + `</div>`;
    addPage({ path: p, title: fill(page.title), description: fill(page.description), body: layout(p, body, 'bg-brand-surface'), jsonLd: [schema.breadcrumbLd(SITE_URL, crumbs), faqLd], changefreq: 'monthly' });
  }

  // Estimation (page React du parcours vendeur : coquille statique titre + intro) ------------------------
  {
    const page = content.estimate;
    const p = '/estimer';
    const crumbs = [HOME_CRUMB, { name: 'Estimer mon bien', path: p }];
    const body = `<section class="px-4 sm:px-6 pt-8 pb-6 bg-white border-b border-brand-line"><div class="max-w-5xl mx-auto min-w-0">${breadcrumbsHtml(crumbs)}`
      + `<h1 class="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy leading-tight">${esc(page.h1)}</h1>`
      + `<p class="text-gray-700 mt-3 leading-relaxed max-w-3xl">${esc(fill(page.intro))}</p></div></section>${SPINNER}`;
    addPage({ path: p, title: fill(page.title), description: fill(page.description), body: layout(p, body, 'bg-brand-surface'), jsonLd: [schema.breadcrumbLd(SITE_URL, crumbs)], changefreq: 'monthly' });
  }

  // Pages légales (informations de l'exploitant lues sur l'API au build, valeurs connues sinon) -----
  const legalShell = (page, inner, updated) => {
    const crumbs = [HOME_CRUMB, { name: page.h1, path: page.path }];
    const version = updated ? `<p class="text-sm text-gray-600 mb-6">Version du <time datetime="${esc(updated)}">${esc(formatDateShort(updated))}</time> · dernière mise à jour le ${esc(formatDateFr(updated))}</p>` : '';
    return { crumbs, body: layout(page.path, `<div class="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 min-w-0">${breadcrumbsHtml(crumbs)}<h1 class="font-display text-3xl sm:text-4xl font-extrabold text-brand-navy mb-4">${esc(page.h1)}</h1>${version}${inner}</div>`) };
  };
  const rawLegal = brandedLegal(RAW_LEGAL);
  const mentions = content.legal.mentions;
  const ms = legalShell(mentions, `<div class="prose-cr">${sectionsHtml(legal.mentionsSections(rawLegal, mentions.sections), rawLegal)}</div>`);
  addPage({ path: mentions.path, title: fill(mentions.title), description: fill(mentions.description), body: ms.body, jsonLd: [schema.breadcrumbLd(SITE_URL, ms.crumbs)], changefreq: 'yearly' });

  const privacy = content.legal.privacy;
  const ps = legalShell(privacy, `<div class="prose-cr"><p>${esc(fill(privacy.intro))}</p>${tocHtml(privacy.sections)}${sectionsHtml(privacy.sections, rawLegal)}</div>`, privacy.updated);
  addPage({ path: privacy.path, title: fill(privacy.title), description: fill(privacy.description), body: ps.body, jsonLd: [schema.breadcrumbLd(SITE_URL, ps.crumbs)], changefreq: 'yearly', lastmod: privacy.updated });

  const cgu = content.legal.cgu;
  const cs = legalShell(cgu, `<div class="prose-cr"><p>${rich(cgu.intro)}</p>${tocHtml(cgu.sections)}${sectionsHtml(cgu.sections, rawLegal)}</div>`, cgu.updated);
  addPage({ path: cgu.path, title: fill(cgu.title), description: fill(cgu.description), body: cs.body, jsonLd: [schema.breadcrumbLd(SITE_URL, cs.crumbs)], changefreq: 'yearly', lastmod: cgu.updated });

  const report = content.legal.report;
  const rs = legalShell(report, `<p class="text-gray-700 leading-relaxed max-w-3xl mb-8">${esc(fill(report.intro))}</p><div class="card p-6 sm:p-8 min-w-0"><p class="text-sm text-gray-600">${esc(report.descriptionHelp)}</p><p class="mt-4"><a href="mailto:${esc(BRAND.contactEmail)}?subject=${encodeURIComponent(report.mailSubject)}" class="${BTN_SECONDARY} py-3">${esc(report.mailto)}</a></p></div><section class="card p-6 mt-6"><h2 class="font-display text-lg font-bold text-brand-navy mb-3">${esc(report.afterTitle)}</h2><ol class="space-y-3 text-sm text-gray-700 leading-relaxed">${report.after.map((t) => `<li>${rich(t)}</li>`).join('')}</ol></section>`);
  addPage({ path: report.path, title: fill(report.title), description: fill(report.description), body: rs.body, jsonLd: [schema.breadcrumbLd(SITE_URL, rs.crumbs)], changefreq: 'yearly' });
};

// ------------------------------------------------------------------------------------------------
// Données lues sur l'API au build (facultatif)
const fetchApi = async (p) => {
  if (!BACKEND_URL || ROUTES_ONLY) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${BACKEND_URL}/api${p}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null;
  }
};

// ------------------------------------------------------------------------------------------------
// Écriture des fichiers
const HEAD_TAGS_TO_REPLACE = [
  /<title>[\s\S]*?<\/title>/gi,
  /<meta\s+name="(?:description|robots|twitter:[^"]+)"[^>]*>/gi,
  /<meta\s+property="og:[^"]+"[^>]*>/gi,
  /<link\s+rel="canonical"[^>]*>/gi,
  /<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi,
];

const jsonLdTag = (obj) => `<script type="application/ld+json" data-seo="page">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const renderHtml = (template, page) => {
  const url = `${SITE_URL}${page.path === '/' ? '/' : page.path}`;
  const image = `${SITE_URL}/og-image.png`;
  let html = template;
  HEAD_TAGS_TO_REPLACE.forEach((re) => { html = html.replace(re, ''); });
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}"/>`,
    `<meta name="robots" content="${esc(page.robots)}"/>`,
    `<link rel="canonical" href="${esc(url)}"/>`,
    `<meta property="og:site_name" content="${esc(BRAND.name)}"/>`,
    `<meta property="og:locale" content="fr_FR"/>`,
    `<meta property="og:type" content="${esc(page.type)}"/>`,
    `<meta property="og:title" content="${esc(page.title)}"/>`,
    `<meta property="og:description" content="${esc(page.description)}"/>`,
    `<meta property="og:url" content="${esc(url)}"/>`,
    `<meta property="og:image" content="${esc(image)}"/>`,
    `<meta property="og:image:width" content="1200"/>`,
    `<meta property="og:image:height" content="630"/>`,
    `<meta property="og:image:alt" content="${esc(BRAND.name)} – ${esc(BRAND.tagline)}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${esc(page.title)}"/>`,
    `<meta name="twitter:description" content="${esc(page.description)}"/>`,
    `<meta name="twitter:image" content="${esc(image)}"/>`,
    ...page.jsonLd.map(jsonLdTag),
  ].join('');
  html = html.replace('</head>', `${head}</head>`);
  if (!html.includes('<div id="root"></div>')) throw new Error('build/index.html : <div id="root"></div> introuvable');
  return html.replace('<div id="root"></div>', `<div id="root" data-prerendered="true">${page.body}</div>`);
};

const main = async () => {
  const indexFile = path.join(BUILD, 'index.html');
  const shellFile = path.join(BUILD, 'app-shell.html');
  if (!ROUTES_ONLY && !fs.existsSync(indexFile)) throw new Error('build/index.html introuvable : lancer `craco build` avant le pré-rendu');

  RAW_LEGAL = await fetchApi('/public/legal-info');
  buildPages();

  const seen = new Set();
  pages.forEach((page) => {
    if (seen.has(page.path)) throw new Error(`Route pré-rendue en double : ${page.path}`);
    seen.add(page.path);
  });

  // Liste des routes statiques, reprise par le backend pour /api/sitemap.xml (copie : backend/seo_routes.json)
  const routes = pages.map((p) => ({
    path: p.path,
    changefreq: p.changefreq || 'monthly',
    ...(p.lastmod ? { lastmod: p.lastmod } : {}),
  }));
  // Sans clé `site` : le domaine vient de REACT_APP_SITE_URL (brand.js) au build et de SITE_URL côté backend
  const manifest = { generated: TODAY, routes };
  fs.writeFileSync(path.join(ROOT, 'scripts', 'seo-routes.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  if (ROUTES_ONLY) {
    console.log(`Routes pré-rendues : ${pages.length} (scripts/seo-routes.json)`);
    return;
  }

  // Gabarit vierge conservé pour le repli SPA (routes privées, annonces…) : voir nginx.conf
  if (!fs.existsSync(shellFile)) fs.copyFileSync(indexFile, shellFile);
  const template = fs.readFileSync(shellFile, 'utf8');
  pages.forEach((page) => {
    const out = page.path === '/' ? indexFile : path.join(BUILD, page.path.replace(/^\//, ''), 'index.html');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderHtml(template, page));
  });
  fs.writeFileSync(path.join(BUILD, 'seo-routes.json'), `${JSON.stringify(manifest)}\n`);
  // robots.txt généré avec le domaine du build (REACT_APP_SITE_URL) : aucun domaine écrit en dur dans public/
  fs.writeFileSync(path.join(BUILD, 'robots.txt'), robotsTxt(SITE_URL));

  console.log(`Pré-rendu : ${pages.length} pages écrites (${SITE_URL})${RAW_LEGAL ? '' : ' – informations légales par défaut (API injoignable)'}`);
};

main().catch((err) => {
  console.error(`Pré-rendu en échec : ${err.message}`);
  process.exit(1);
});
