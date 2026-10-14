# Frontend Dockerfile pour Dokploy
# Build version: 2026-03-03-v2
FROM node:20-alpine as build

WORKDIR /app

# Dépendances épinglées par package-lock.json (legacy-peer-deps : conflit date-fns 4 / react-day-picker 8, voir .npmrc)
COPY package.json package-lock.json .npmrc ./
RUN npm ci --legacy-peer-deps

# Copier le code source (inclut .env.production)
COPY . .

# URL du backend vue du navigateur : l'API est servie sous le même domaine (/api proxifié par nginx)
ARG REACT_APP_BACKEND_URL=
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

# Marque et domaine (lib/brand.js, pré-rendu, URLs canoniques, Open Graph, JSON-LD) : jamais en dur dans le code
ARG REACT_APP_BRAND_NAME=CessionBâtiment
ENV REACT_APP_BRAND_NAME=$REACT_APP_BRAND_NAME
ARG REACT_APP_SITE_URL=https://cessionbatiment.fr
ENV REACT_APP_SITE_URL=$REACT_APP_SITE_URL
ARG REACT_APP_CONTACT_EMAIL=
ENV REACT_APP_CONTACT_EMAIL=$REACT_APP_CONTACT_EMAIL
# Minimum de commission affiché (doit valoir COMMISSION_MIN_HT côté backend)
ARG REACT_APP_COMMISSION_MIN_HT=4000
ENV REACT_APP_COMMISSION_MIN_HT=$REACT_APP_COMMISSION_MIN_HT
# Site vitrine WordPress (facultatif) : lien « Site » du pied de page de l'application. Vide = pas de lien.
ARG REACT_APP_MARKETING_URL=
ENV REACT_APP_MARKETING_URL=$REACT_APP_MARKETING_URL

# Build de production (sans sourcemaps) + pré-rendu statique de la page des annonces, de l'estimateur et des pages
# légales (scripts/prerender.mjs)
RUN npm run build

# Stage de production avec nginx
FROM nginx:alpine

# Copier le build
COPY --from=build /app/build /usr/share/nginx/html

# Configuration nginx en gabarit : au démarrage, l'entrypoint officiel (20-envsubst-on-templates.sh) y substitue
# EMBED_ALLOWED_ORIGINS et SELLER_LANDING_URL puis écrit /etc/nginx/conf.d/default.conf. Le filtre (expression
# régulière sur le nom) limite la substitution à ces deux variables.
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER="EMBED_ALLOWED_ORIGINS|SELLER_LANDING_URL"
# Origines autorisées à afficher /embed/annonces dans une iframe (site WordPress), séparées par des espaces, ex.
# « https://www.cessionbatiment.fr https://cessionbatiment.fr ». Vide (défaut) = même origine seulement ('self').
# Variable d'exécution du conteneur : modifiable sans reconstruire l'image.
ENV EMBED_ALLOWED_ORIGINS=""
# Page « vendre mon entreprise » du site WordPress, cible des anciennes adresses /vendre-mon-entreprise-… (301).
# Vide (défaut) = /estimer, l'estimateur de l'application. Variable d'exécution du conteneur.
ENV SELLER_LANDING_URL=""

# Exposer le port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
