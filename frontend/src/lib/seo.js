import { useEffect } from 'react';
import { OFFER } from '@/lib/offer';
import { BRAND } from '@/lib/brand';

// Domaine public (URLs canoniques, Open Graph, JSON-LD) et nom de marque : lib/brand.js (REACT_APP_SITE_URL, REACT_APP_BRAND_NAME)
export const SITE_URL = BRAND.siteUrl;
export const SITE_NAME = BRAND.name;
export const DEFAULT_TITLE = `${BRAND.name} – ${BRAND.tagline}`;
export const DEFAULT_DESCRIPTION = `${OFFER.metaPlatform} : ${OFFER.metaMatching}`;
export const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`;
export const NOINDEX = 'noindex, nofollow';

// Espaces privés, module intégrable (/embed, iframe du site WordPress) et panneau du mode test (/test) :
// jamais indexés, même si la page oublie de le préciser
const PRIVATE_PREFIXES = ['/buyer', '/seller', '/admin', '/messages', '/profile', '/kyc', '/suivi', '/reset-password', '/login', '/register', '/president',
  '/dataroom', '/vente', '/confirmer-email', '/mot-de-passe-oublie', '/embed', '/test'];
export const isPrivatePath = (path) => PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

const upsert = (selector, create, attrs) => {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

const setMetaName = (name, content) =>
  upsert(`meta[name="${name}"]`, () => {
    const el = document.createElement('meta');
    el.setAttribute('name', name);
    return el;
  }, { content });

const setMetaProperty = (property, content) =>
  upsert(`meta[property="${property}"]`, () => {
    const el = document.createElement('meta');
    el.setAttribute('property', property);
    return el;
  }, { content });

const setCanonical = (href) =>
  upsert('link[rel="canonical"]', () => {
    const el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    return el;
  }, { href });

// Remplace les données structurées de la page (y compris celles écrites par le pré-rendu)
const setJsonLd = (data) => {
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());
  const list = (Array.isArray(data) ? data : [data]).filter(Boolean);
  list.forEach((obj) => {
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.setAttribute('data-seo', 'page');
    el.textContent = JSON.stringify(obj);
    document.head.appendChild(el);
  });
};

/**
 * Métadonnées de la page courante : <title>, description, canonical, Open Graph, Twitter, robots, JSON-LD.
 *
 * useSeo(title, description, {
 *   robots,     // ex. NOINDEX ; par défaut « index, follow » (sauf espaces privés)
 *   path,       // chemin canonique (par défaut : chemin courant, sans paramètres)
 *   type,       // og:type (website | article)
 *   image,      // URL absolue de l'image de partage
 *   jsonLd,     // objet ou tableau d'objets schema.org
 *   skip,       // true : n'écrit rien (la page délègue à <NotFound />, dont l'effet s'exécute avant celui du parent)
 * })
 */
export const useSeo = (title, description, options = {}) => {
  const { robots, path, type = 'website', image = DEFAULT_IMAGE, jsonLd, skip = false } = options;
  const jsonKey = jsonLd ? JSON.stringify(jsonLd) : '';

  useEffect(() => {
    if (skip) return;
    const t = title || DEFAULT_TITLE;
    const d = description || DEFAULT_DESCRIPTION;
    const currentPath = path || window.location.pathname;
    const url = `${SITE_URL}${currentPath === '/' ? '/' : currentPath.replace(/\/+$/, '')}`;
    const robotsValue = robots || (isPrivatePath(window.location.pathname) ? NOINDEX : 'index, follow');

    document.title = t;
    setMetaName('description', d);
    setMetaName('robots', robotsValue);
    setCanonical(url);
    setMetaProperty('og:title', t);
    setMetaProperty('og:description', d);
    setMetaProperty('og:url', url);
    setMetaProperty('og:type', type);
    setMetaProperty('og:image', image);
    setMetaProperty('og:locale', 'fr_FR');
    setMetaProperty('og:site_name', SITE_NAME);
    setMetaName('twitter:card', 'summary_large_image');
    setMetaName('twitter:title', t);
    setMetaName('twitter:description', d);
    setMetaName('twitter:image', image);
    setJsonLd(jsonKey ? JSON.parse(jsonKey) : null);
  }, [skip, title, description, robots, path, type, image, jsonKey]);
};

// Raccourci pour les pages privées (dashboards, messagerie, connexion…)
export const usePrivateSeo = (title) => useSeo(title ? `${title} – ${SITE_NAME}` : DEFAULT_TITLE, undefined, { robots: NOINDEX });
