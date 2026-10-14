# HANDOFF — agent « closing-facturation »

Chantier : SPEC §4.5 en entier (`backend/closing.py`, `backend/tests/test_closing.py`).
Vérification : `cd backend && python -m pytest -q` → **195 passés** (186 existants + 9 nouveaux) ; `flake8 --max-line-length=140 --extend-ignore=E501 closing.py tests/test_closing.py` propre. Aucune dépendance ajoutée (reportlab et pypdf déjà présents), aucun outil payant : factures, relances et mise en demeure sont « maison ».

## 1. Livré

| Fichier | Contenu |
|---|---|
| `backend/closing.py` | Module chargé par la boucle `importlib` de `server.py` (`router`, `daily_job`). Collections : `db.closings`, `db.invoices`, `db.todos`. Gabarits d'e-mail ajoutés par `EMAIL_TEMPLATES.setdefault` (aucune entrée existante modifiée). |
| `backend/tests/test_closing.py` | 9 tests (données créées directement en base : annonce publiée, mandat signé avec `mandant_address` et `registry_number`, offre acceptée) : branchement et gabarits ; création + checklist + `from-offer` + rédacteur ; relances J+30/60/90 et réponses par lien (JSON / HTML, jeton invalide, abandon) ; déclaration → confirmation → facture (numéro, barème via `calculate_commission`, débiteur et adresse du mandat, échéance titres +30 j, e-mails cédant / rédacteur / repreneur, PDF facture et ordre de paiement avec contrôle d'accès, marquage payé) ; confirmation automatique à 7 jours (date simulée) ; relances titres J+15/30/45 idempotentes + mise en demeure + « À faire » ; échéance fonds +180 j et relances J+90/120/150 ; numérotation continue, minimum contractuel, part > 1 M€, adresse de repli (profil) ou absente, annulation ; contestation et arbitrage admin. Les attendus de montant sont calculés en appelant `business_model.calculate_commission` (aucun montant en dur). |

### Modèle `closing` (`db.closings`)

```
{id, company_id, company_label, buyer_id, seller_id, offer_id, offer_amount, sale_object: titres|fonds|null,
 expected_date, redacteur: {type: notaire|avocat|expert-comptable|autre, name, email, phone, set_by, set_at} | null,
 status: in_progress | declared | confirmed | disputed | abandoned,
 accepted_at, created_at, updated_at, progress: [{at, by: seller|buyer, answer: en_cours|signe|abandonne}],
 followups_sent: [{day, at}], signature_reported: {by, at}?, abandoned_at?, abandoned_by?,
 declaration: {signed_on, final_price, sale_object, declared_by, declared_by_user_id, declared_at, confirm_deadline} | null,
 declarations: [historique complet], confirmed_at, confirmed_by: seller|buyer|admin|auto, confirmation_note,
 dispute: {reason, by, by_user_id, at} | null, resolution?: {action, note, by, at, cancelled_declaration},
 invoice_id, invoice_number, paid_at?, payment_order_sent_at?, payment_order_sent_to?,
 tokens: {seller, buyer} (liens signés, jamais renvoyés par l'API), payment_order_token (idem)}
```

`veille.SALE_DECLARED_STATUSES` contient déjà `declared` et `confirmed` : rien à changer. À la déclaration, les incidents BODACC ouverts de la société sont clos (`note: "Vente déclarée"`) et `company.sale_declared_at` est posé ; à la confirmation, `company.status = "sold"` (+ `sold_at`, `sold_via_platform`, `closing_id`) et `offer.closing_status = "confirmed"`.

### Modèle `invoice` (`db.invoices`)

```
{id, number: "FAC-AAAA-NNNNN", sequence (compteur continu next_sequence("invoice")), status: issued | paid | cancelled (draft : anciennes migrées),
 terms_version: "v2", closing_id, offer_id, company_id, company_label, buyer_id, mandate_id, mandate_number (n° de registre),
 issued_on (AAAA-MM-JJ), issued_at, sale_object, signed_on, final_price,
 debtor: {user_id (cédant), name, email, address (mandant_address du mandat, sinon profil), address_source: mandat|profil|"", company_name, siren, legal_structure},
 lines: [{designation (1re ligne), label, base, rate, amount_ht}], commission: calculate_commission(final_price),
 total_ht, vat_rate, vat, total_ttc, due_on, due_days: 30|180, payment_terms, late_penalties, bank: {iban, bic, bank},
 issuer: {denomination, siren, vat_number, address, carte_t}, redacteur, reminders: [{step, sent_at, overdue}], reminder_count,
 formal_notice_at, paid_on, paid_amount, balance_due, cancelled_at, cancelled_reason, access_token (jamais renvoyé), created_at, updated_at}
```

Compatible avec `GET /admin/stats` (`status`, `total_ht`) et `GET /auth/export` (`debtor.user_id`).

### Lignes « À faire » (`db.todos`)

```
{id, type: invoice_overdue | closing_disputed | invoice_debtor_address, key (id de la facture ou du closing : un seul « open » par (type, key)),
 title (phrase FR prête à afficher), ref: {...ids et montants}, action (URL relative de l'action : PDF de mise en demeure, résolution…),
 status: open | done, created_at, done_at, done_by?, note?}
```

Helpers réutilisables : `closing.add_todo(type, key, title, ref=None, action="")` (idempotent) et `closing.close_todos(type, key, note="")`.

### Routes (toutes sous `/api`)

Parties (cédant / repreneur du closing, ou admin) :
- `POST /closing/from-offer/{offer_id}` (offre acceptée, idempotent) · `GET /closing/my` · `GET /closing/{id}` (vue : `role`, `status_label`, `invoice`, `seller_name`, `buyer_name`, `commission_preview`)
- `PUT /closing/{id}/redacteur {type, name, email?, phone?}` → e-mail à l'autre partie
- `POST /closing/{id}/declare {signed_on: AAAA-MM-JJ, final_price, sale_object: titres|fonds}` → e-mail « Vente déclarée : merci de confirmer sous 7 jours » à l'autre partie + e-mail admin immédiat
- `POST /closing/{id}/confirm` (l'autre partie ou l'admin) → facture · `POST /closing/{id}/dispute {reason}` → « À faire » + e-mails
- `GET /closing/{id}/status/{token}?answer=en_cours|signe|abandonne` (sans connexion ; JSON, ou page HTML si `Accept: text/html`)
- `GET /closing/{id}/payment-order.pdf` (parties, admin, ou `?token=` du lien envoyé au rédacteur) → PDF binaire
- `GET /invoices/my` · `GET /invoices/{id}` (débiteur ou admin) · `GET /invoices/{id}/pdf` (Bearer : cédant débiteur ou admin ; ou `?token=` du lien de l'e-mail) → **PDF binaire** (`application/pdf`, `Content-Disposition: inline`), pas le JSON base64 des anciennes routes.

Admin (`require_admin`) :
- `GET /admin/invoices?status=issued|paid|cancelled|draft|overdue` → `{invoices: [... + overdue, pdf_url, formal_notice_url?], totals: {issued_ht, paid_ht, overdue_ttc}}`
- `PUT /admin/invoices/{id}/paid {paid_on, amount}` (e-mail « Paiement reçu » au cédant, « À faire » close) · `PUT /admin/invoices/{id}/cancel {reason}` (impossible si payée)
- `GET /admin/invoices/{id}/mise-en-demeure.pdf` (facture émise et impayée)
- `GET /admin/closings?status=` · `PUT /admin/closings/{id}/resolve {action: confirm|cancel, note?}` (contestation : l'admin confirme → facture, ou annule la déclaration → retour « en cours »)
- `GET /admin/todos?status=open|done|all` · `PUT /admin/todos/{id}/done`

### Tâche quotidienne `closing.daily_job(now)` (enregistrée dans `DAILY_JOBS`, idempotente via `claim_once`)
1. Relances J+30/60/90 des closings `in_progress` (clés `closing_followup:<id>:<jour>`, une relance par passage, pas de rafale de rattrapage) aux deux parties avec leurs liens signés.
2. Confirmation automatique des closings `declared` dont `declaration.confirm_deadline` est passée (`closing_autoconfirm:<id>`, `confirmed_by: "auto"`).
3. Relances de facture : titres J+15/J+30/J+45, fonds J+90/J+120/J+150 **à compter de la date de facture** (`invoice_reminder:<id>:<n>`, une par passage, dans l'ordre) ; objet « Rappel d'échéance » avant l'échéance, « Facture en retard de paiement » après. Après la 3ᵉ relance **et** une fois l'échéance passée : `formal_notice_at`, ligne « À faire » `invoice_overdue` avec `action` = URL du modèle de mise en demeure (`invoice_formal_notice:<id>`).

Échéance de la facture : date de facture + 30 j (titres) ou + 180 j (fonds, « payable par le séquestre à la libération du prix ») ; la facture est datée du jour de la confirmation.

## 2. À appliquer dans `server.py` (intégrateur)

### a) `respond_to_offer` (`PUT /offers/{id}/respond`) : créer le closing à l'acceptation

Dans la branche `if new_status == "accepted":`, après l'e-mail `offer_accepted` au repreneur :

```python
        closing_module = LOADED_MODULES.get("closing")
        if closing_module:
            offer_doc = await db.offers.find_one({"id": offer_id}, {"_id": 0}) or offer
            await closing_module.create_closing_for_offer(offer_doc, company)
```

(`LOADED_MODULES` est rempli à l'import, avant toute requête ; `offer_doc` doit contenir `responded_at` et, pour l'offre v2, `sale_object` / `target_date` qui alimentent `closing.sale_object` et `expected_date`.) La fonction est idempotente (une seule étape de vente par offre) et envoie la checklist aux deux parties ; `notify=False` pour un appel silencieux.

### b) Anciennes routes

`POST /closing/declare`, `GET /closing/commission-calculator`, `GET /admin/invoices` et `GET /invoices/{id}/pdf` ne sont **plus** dans `server.py` (déjà retirées par le chantier fondations, vérifié par `test_fondations.py`) : rien à supprimer, les chemins sont libres pour `closing.py`.

### c) Index au démarrage (`startup`)

```python
    await db.closings.create_index("offer_id", unique=True)
    await db.closings.create_index([("status", 1), ("updated_at", -1)])
    await db.closings.create_index("seller_id")
    await db.closings.create_index("buyer_id")
    await db.invoices.create_index("number", unique=True)
    await db.invoices.create_index("closing_id")
    await db.invoices.create_index([("status", 1), ("due_on", 1)])
    await db.invoices.create_index("debtor.user_id")
    await db.todos.create_index([("type", 1), ("key", 1), ("status", 1)])
```

### d) `GET /admin/todo` (onglet « À faire », chantier admin)

Lire `db.todos` (`status: "open"`) et afficher `title`, `created_at`, `ref`, `action` ; actions : « Marquer payée » → `PUT /admin/invoices/{ref.invoice_id}/paid`, « Mise en demeure » → `action` (PDF), « Trancher » → `PUT /admin/closings/{ref.closing_id}/resolve`, « Clore » → `PUT /admin/todos/{id}/done`. Ventes déclarées en attente : `GET /admin/closings?status=declared` ; contestées : `?status=disputed` ; offres acceptées > 60 j sans vente : `GET /admin/closings?status=in_progress` filtré sur `accepted_at`.

### e) Variables d'environnement (`.env.example`, `docker-compose.yml`, `DOKPLOY_DEPLOYMENT.md`)

`INVOICE_IBAN`, `INVOICE_BIC`, `INVOICE_BANK` (déjà transmises par docker-compose ; sans IBAN, la facture indique « coordonnées bancaires communiquées sur simple demande à LEGAL_EMAIL ») ; `LEGAL_TVA` (facultatif : n° de TVA intracommunautaire, sinon calculé depuis `LEGAL_SIREN` : `FR21952180230`) ; `LEGAL_RC_PRO` (déjà prévu : assureur + n° de police, sinon « RC professionnelle souscrite conformément à la loi Hoguet »).

### f) Migration (`refonte_2026_10.py`)

Les anciennes factures `a_valider` passées en `draft` apparaissent dans `GET /admin/invoices?status=draft` ; leur PDF n'est pas régénéré (`GET /invoices/{id}/pdf` → 400 « ancien format ») car elles n'ont ni `lines` ni `debtor` au nouveau schéma. Le compteur `invoice` (`db.counters._id == "invoice"`) démarre à 1 : si des factures FAC-… existent déjà en production, initialiser `db.counters` `{_id: "invoice", value: <dernier numéro>}` pour garder la numérotation continue.

## 3. Front (agent front) — écrans à brancher

- **Espace vendeur / repreneur, « Étape de vente »** (`GET /closing/my`) : statut lisible (`status_label`), checklist, formulaire rédacteur (`PUT …/redacteur`), bouton « Déclarer la vente » (date, prix, objet titres/fonds → `POST …/declare`), bandeau « Vente déclarée par l'autre partie : Confirmer / Contester (motif) » quand `status == "declared"` et `declaration.declared_by != role`, carte facture (`invoice.number`, HT/TVA/TTC, `due_on`, lien `GET /api/invoices/{id}/pdf` avec le jeton Bearer → ouvrir le blob), lien « Ordre de paiement » (`GET /api/closing/{id}/payment-order.pdf`). Le bouton « Vendue via la plateforme » du dashboard vendeur = ouvrir le formulaire de déclaration du closing de l'offre acceptée.
- Les liens des e-mails (facture, ordre de paiement, réponses J+30/60/90) fonctionnent **sans page front** (jeton dans l'URL, page HTML minimale servie par l'API pour les réponses en un clic).
- **Admin** : onglet Factures (`GET /admin/invoices`, filtres, « Marquer payée » avec date + montant, « Annuler » avec motif, PDF, mise en demeure quand `formal_notice_url`), onglet Ventes (`GET /admin/closings`, résolution des contestations), « À faire » (voir 2.d).

## 4. Décisions à connaître

- **Relances et échéance comptées depuis la date de facture** (jour de la confirmation), pas depuis l'acte : la mise en demeure n'est proposée qu'une fois l'échéance passée (titres : au 3ᵉ rappel J+45 ; fonds : à J+180, après les rappels J+90/120/150 qui sont des rappels d'échéance).
- Déclaration possible par le cédant, le repreneur ou l'admin ; **le déclarant ne peut ni confirmer ni contester** ; l'admin peut tout faire. Une déclaration contestée n'est jamais confirmée automatiquement.
- Réponse « abandonné » au lien J+30/60/90 : closing `abandoned` (plus de relance), l'annonce reste publiée. Réponse « signé » : enregistrée (`signature_reported`), la page invite à déclarer la vente.
- Lien signé des PDF (`?token=`) : jeton aléatoire de 32 octets par facture / par closing, nécessaire pour qu'un lien d'e-mail ouvre un PDF sans session (le rédacteur n'a pas de compte). Le jeton n'est jamais renvoyé par les routes JSON.
- Facture annulée : statut `cancelled` + motif (pas de génération d'avoir numéroté ; à faire au besoin dans la comptabilité). Facture payée : `paid_amount`, `balance_due` si règlement partiel, mention « acquittée » dans le PDF.
- Adresse du débiteur absente du mandat **et** du profil : la facture est émise quand même (numérotation continue) et une ligne « À faire » `invoice_debtor_address` est créée.
