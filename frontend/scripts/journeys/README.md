# Parcours navigateur (Playwright)

Prérequis : backend de test (mongomock, e-mails écrits dans un fichier JSONL, route `POST /test/set-user`), front statique
construit avec `REACT_APP_BACKEND_URL` pointant sur ce backend, Chromium Playwright.

```
REACT_APP_BACKEND_URL=http://127.0.0.1:8001 npm run build      # front
python spa.py build                                            # serveur statique (port 3000)
NODE_PATH=/opt/node22/lib/node_modules node scripts/journeys/01-public.js
NODE_PATH=/opt/node22/lib/node_modules node scripts/journeys/02-seller.js
NODE_PATH=/opt/node22/lib/node_modules node scripts/journeys/03-buyer.js
NODE_PATH=/opt/node22/lib/node_modules node scripts/journeys/04-admin.js
# Mode test : backend relancé avec TEST_MODE=true, sans jeu de données (le script relance lui-même le backend sans
# TEST_MODE à la fin, via RESTART_CMD)
TEST_MODE=true TEST_PANEL_KEY=cle-essai JOBS_ENABLED=false NOSEED=1 restart.sh
TEST_PANEL_KEY=cle-essai NODE_PATH=/opt/node22/lib/node_modules node scripts/journeys/05-test-mode.js
```

Variables (facultatives) : `FRONT`, `API`, `EMAILS_FILE`, `SEED_FILE` (jeu de données écrit par `seed.py` : admin, cédants,
repreneurs, annonces publiées), `SHOTS_DIR` (captures), `CHROME_PATH`, `RESTART_CMD` (05 : script de relance du backend),
`TEST_PANEL_KEY` (05 : même clé que le backend ; sans elle, le panneau est ouvert et les contrôles « visiteur sans clé »
sont sautés).

| Script | Couverture |
|---|---|
| `01-public.js` | Page des annonces sur `/` (H1, prix lisibles, filtres dans l'URL sans entrée d'historique, titre de la recherche ciblée, état vide sans « 0 », alerte, encart cédant), fiche anonyme, anciennes URL redirigées, module `/embed/annonces`, mentions, 404, mobile 390 px (liste, panneau de filtres, fiche) |
| `02-seller.js` | Estimateur → inscription cédant → confirmation d'e-mail par le lien reçu → annonce en 3 écrans → identité → mandat v2 (adresse, qualité, objet, code) → publication immédiate → tableau de bord ; mobile 390 px |
| `03-buyer.js` | Inscription repreneur avec profil → contact → messagerie → demande de dossier → acceptation cédant (carte) → identité → NDA par code → origine des fonds → data room → offre signée → acceptation par code → étape de vente → déclaration → confirmation → facture (cédant, admin) ; mobile 390 px |
| `04-admin.js` | Connexion avec code, « À faire » (relecture 48 h, Valider), retrait motivé, factures (PDF, payée), KPI du lundi, coûts, tâches, utilisateurs ; mobile 390 px |
| `05-test-mode.js` | Mode test (`TEST_MODE=true`) : visiteur sans clé (bandeau sans lien, panneau réservé, connexion rapide 403), bandeau, `/test` en étapes, données de démonstration (8 annonces sur `/`), connexion rapide, inscription → confirmation par le bandeau → annonce avec SIRET fictif → identité simulée → mandat signé avec le code affiché (« Remplir ») → publication, registre `TEST-…` ; repreneur démo : contact → dossier → acceptation → identité simulée → NDA → fonds → data room ; boîte mail de test ; admin démo « Mode test actif » ; purge ; puis backend sans `TEST_MODE` : `/test` désactivé, plus de bandeau, `/api/test/*` → 404 |

Chaque script renvoie un code de sortie non nul si un contrôle échoue.
