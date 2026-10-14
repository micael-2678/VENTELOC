# VenteLoc

Place de marché d'intermédiation sécurisée pour les **biens immobiliers déjà loués** : le propriétaire bailleur dépose
lui-même son annonce (appartement, maison, immeuble de rapport, local commercial, bureaux, parking, lot en résidence
gérée), VenteLoc vérifie le vendeur et le bien, qualifie les investisseurs et encadre la vente jusqu'au notaire.
Opérée par AlterEgo SAS (carte professionnelle T, transactions sur immeubles). Rien n'est payé avant l'acte
authentique : honoraires à la charge du vendeur (3 % HT par défaut, minimum 3 000 € HT, paramétrables).

Spécification : **[docs/venteloc/SPEC.md](./docs/venteloc/SPEC.md)** · contrat d'API : **[docs/venteloc/API.md](./docs/venteloc/API.md)**
· déploiement : **[DOKPLOY_DEPLOYMENT.md](./DOKPLOY_DEPLOYMENT.md)**.

## Parcours

- **Vendeur** : estimation par le rendement (`/estimer`), annonce en 3 écrans (le bien, la location, la vente) avec
  rendements calculés en direct, justificatif de propriété, identité vérifiée, mandat de vente simple signé en ligne par
  code (non exclusif, résiliable, rétractation de 14 jours), publication automatique, demandes de dossier, offres d'achat,
  suivi jusqu'à l'acte.
- **Acquéreur** : recherche par type de bien, bail, zone, prix, rendement et surface ; alertes sans compte ; contact du
  vendeur avec un profil d'investisseur ; dossier du bien (bail, loyers, diagnostics, taxe foncière, copropriété) après
  identité vérifiée, engagement de confidentialité et de non-contournement et déclaration d'origine des fonds ; fiche de
  reprise du bail ; offre d'achat signée en ligne.
- **Sécurité** : adresse et identité du vendeur révélées seulement après l'engagement ; données du locataire jamais
  publiées ; dossier filigrané avec journal d'accès ; preuves de signature conservées 10 ans ; alerte de décence
  énergétique (calendrier DPE G 2025, F 2028, E 2034).
- **Administration** : écran « À faire » (justificatifs de propriété à contrôler, annonces à relire, ventes, factures),
  registre des mandats, factures d'honoraires et relances, statistiques maison, mode test complet.

## Stack technique

- **Frontend** : React 19, Tailwind CSS, Radix UI (nginx en production, pages publiques pré-rendues)
- **Backend** : FastAPI, Motor (MongoDB async)
- **Base de données** : MongoDB 7 (sauvegardes quotidiennes, copie S3 facultative)
- **Intégrations** : Stripe Identity (à l'usage), Brevo (e-mails, palier gratuit), recherche-entreprises.api.gouv.fr (SCI)

## Développement local

```bash
# Backend (Python 3.11)
cd backend
pip install -r requirements.txt
cp .env.example .env  # configurer les variables
uvicorn server:app --reload --port 8001

# Frontend
cd frontend
npm ci --legacy-peer-deps
npm start
```

Mode test (essai sans vraie vérification d'identité ni vrais contrats) : `TEST_MODE=true` côté backend, puis panneau
`/test` (comptes et annonces de démonstration, boîte mail de test). Voir `DOKPLOY_DEPLOYMENT.md` §9.

## Tests

```bash
cd backend && pip install -r requirements.txt -r requirements-dev.txt && pytest -q   # API complète, MongoDB en mémoire
cd frontend && CI=true npx craco test --watchAll=false && npm run lint
```

Les tests tournent aussi sur GitHub à chaque push (`.github/workflows/tests.yml`).

## Licence

Propriétaire - Tous droits réservés
