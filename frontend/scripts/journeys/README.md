# Parcours navigateur (Playwright)

Cinq scripts rejouent les parcours complets de VenteLoc dans Chromium, contre l'API réelle (`backend/server.py`) lancée
avec une base MongoDB en mémoire et des e-mails écrits dans un fichier. Chaque script renvoie un code de sortie non nul
si un contrôle échoue.

## Banc d'essai (`harness/`)

| Fichier | Rôle |
|---|---|
| `harness/e2e_server.py` | API réelle sur le port 8001 : mongomock, e-mails Brevo écrits dans `EMAILS_FILE` (JSONL), route `POST /test/set-user` (forcer un champ d'un compte : e-mail confirmé, identité vérifiée) |
| `harness/seed.js` | Jeu de données par l'API : admin connecté (code reçu par e-mail), deux vendeurs, deux biens publiés (justificatif, identité, mandat signé) → `SEED_FILE` |
| `harness/spa.py` | Serveur statique du build (repli sur `index.html`), port 3000 |

## Lancer

```bash
W=/tmp/venteloc-journeys; mkdir -p $W
export SCRATCHPAD=$W EMAILS_FILE=$W/emails.jsonl SEED_FILE=$W/seed.json SHOTS_DIR=$W/shots
export NODE_PATH=/opt/node22/lib/node_modules     # emplacement de playwright

# 1. Front construit pour le backend de test
cd frontend && REACT_APP_BACKEND_URL=http://127.0.0.1:8001 REACT_APP_SITE_URL=http://127.0.0.1:3000 npx craco build
python3 scripts/journeys/harness/spa.py build 3000 &

# 2. Backend de test (venv du backend, Python 3.11) puis jeu de données
python scripts/journeys/harness/e2e_server.py &
node scripts/journeys/harness/seed.js

# 3. Parcours
node scripts/journeys/01-public.js
node scripts/journeys/02-seller.js
node scripts/journeys/03-buyer.js
node scripts/journeys/04-admin.js

# 4. Mode test : backend relancé avec TEST_MODE=true ; RESTART_CMD est un script qui relance le backend (le parcours
#    le rappelle à la fin sans TEST_MODE pour vérifier que tout se referme)
TEST_MODE=true TEST_PANEL_KEY=cle-essai <relance du backend>
RESTART_CMD=<script de relance> TEST_PANEL_KEY=cle-essai node scripts/journeys/05-test-mode.js
```

Variables facultatives : `FRONT` (défaut `http://127.0.0.1:3000`), `API` (défaut `http://127.0.0.1:8001/api`),
`CHROME_PATH`, `ADMIN_EMAIL` / `ADMIN_PASSWORD` (défaut `admin@exemple.fr` / `AdminTest123!`, mêmes valeurs que
`e2e_server.py`).

## Couverture

| Script | Contrôles |
|---|---|
| `01-public.js` | Page des annonces `/` (titre, « Comment ça marche », cartes : prix, rendement brut, honoraires, jamais l'adresse), filtres dans l'URL (type, rendement, tri par rendement), état vide et alerte, fiche `/annonce/:id` (chiffres clés, DPE, copropriété, visites, honoraires TTC puis HT), `/vendre` (calculateur, FAQ), estimateur, anciennes URL CessionRGE en 404, module `/embed/annonces`, mentions et CGU, mobile 390 px |
| `02-seller.js` | Estimateur → inscription vendeur → confirmation d'e-mail → annonce en 3 écrans (le bien, la location, la vente ; rendements en direct, alertes) → justificatif de propriété → identité → mandat (adresse, qualité, code e-mail) → publication automatique → espace vendeur ; mobile |
| `03-buyer.js` | Inscription acquéreur avec profil → contact → messagerie → demande de dossier → acceptation par le vendeur → identité → engagement de confidentialité et de non-contournement par code → origine des fonds → adresse révélée, dossier du bien, fiche de reprise du bail → offre d'achat signée → acceptation → étape de vente (notaire, avant-contrat, acte) → facture ; mobile |
| `04-admin.js` | Connexion avec code, « À faire » (justificatifs : aperçu, valider, refuser avec motif ; annonces à relire), retrait motivé, factures, KPI, coûts, utilisateurs ; mobile |
| `05-test-mode.js` | Mode test : visiteur sans clé, bandeau, panneau `/test`, 8 biens de démonstration, connexion rapide vendeur / acquéreur / admin, inscription → identité simulée → mandat avec code affiché, boîte mail de test, purge, puis backend sans `TEST_MODE` (`/api/test/*` → 404) |
