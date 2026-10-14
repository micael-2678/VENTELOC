# CessionRGE

Plateforme de cession d'entreprises RGE (Reconnu Garant de l'Environnement).

## 🚀 Déploiement

Voir **[DOKPLOY_DEPLOYMENT.md](./DOKPLOY_DEPLOYMENT.md)** pour le guide complet de déploiement.

## 📦 Stack Technique

- **Frontend** : React 19, Tailwind CSS, Radix UI
- **Backend** : FastAPI, Motor (MongoDB async)
- **Base de données** : MongoDB 7
- **Intégrations** : Stripe (paiements/KYC), Brevo (emails), API RGE

## 🔧 Développement Local

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env  # Configurer les variables
uvicorn server:app --reload --port 8001

# Frontend
cd frontend
yarn install
yarn start
```

## 📋 Fonctionnalités

- ✅ Phase de lancement gratuite (`FREE_MODE`) : mise en relation sans crédits ni commission
- ✅ Annonces anonymes vérifiées RGE (API ADEME), identité révélée après signature du NDA
- ✅ Publication automatique si identité (Stripe Identity) et qualité de dirigeant (registre) vérifiées, sinon validation admin
- ✅ Brouillons d'annonce soumis automatiquement dès la vérification d'identité
- ✅ Messagerie, NDA / LOI en ligne, data room avec filigrane incrusté et journal d'accès
- ✅ Emails automatiques à chaque étape + relances (vendeur sans réponse, vendeur sans annonce, suivi à 30 jours)
- ✅ Tableau de bord « Suivi du test » (entonnoir, sources d'acquisition, taux de réponse)
- ✅ Pages SEO par activité et par région, sitemap (`/api/sitemap.xml`), mesure d'audience Plausible optionnelle
- ✅ Stockage des fichiers S3 optionnel (sinon MongoDB)

## 🧪 Tests

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
pytest            # API complète avec MongoDB en mémoire, emails interceptés
```

Les tests tournent aussi automatiquement sur GitHub à chaque push (`.github/workflows/tests.yml`).

## 📄 Licence

Propriétaire - Tous droits réservés
