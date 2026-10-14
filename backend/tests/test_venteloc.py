"""Règles propres à VenteLoc (docs/venteloc/SPEC.md, API.md) : justificatif de propriété et contrôle admin, champs
calculés (titre, rendements, décence énergétique), photos de l'annonce, fiche de reprise du bail (bail.py), catégories
du dossier du bien, bloc `commission` de /config."""
import base64
import uuid

import bail
import business_model
import server
from conftest import last_email, listing


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


def _seller_with_listing(api, client, **extra):
    seller = api.register(uid("vendeur"), "seller", first="Paul", last="Dupont")
    api.verify_kyc(seller)
    c = client.post("/api/properties", headers=api.h(seller), json=listing(**extra)).json()
    return seller, c


# ---------- Justificatif de propriété (SPEC §5.2.3) et contrôle admin ----------

def test_justificatif_depot_controle_admin_et_refus(api, client, emails):
    seller, c = _seller_with_listing(api, client)
    pid = c["id"]
    url = f"/api/properties/{pid}/ownership-proof"
    # Sans justificatif : bloquant, statut « missing »
    assert "ownership_proof" in [b["code"] for b in c["blocking"]]
    assert client.get(url, headers=api.h(seller)).json()["ownership"]["status"] == "missing"
    assert client.get(f"{url}/file", headers=api.h(seller)).status_code == 404
    # Validation du dépôt : type de pièce et format
    r = client.post(url, headers=api.h(seller), data={"doc_type": "facture-edf"}, files={"file": ("t.pdf", api.PDF, "application/pdf")})
    assert r.status_code == 400 and r.json()["detail"]["field"] == "doc_type"
    r = client.post(url, headers=api.h(seller), data={"doc_type": "titre-propriete"}, files={"file": ("t.exe", b"MZ\x90\x00", "application/x-msdownload")})
    assert r.status_code == 400
    other = api.register(uid("autre"), "seller")
    r = client.post(url, headers=api.h(other), data={"doc_type": "titre-propriete"}, files={"file": ("t.pdf", api.PDF, "application/pdf")})
    assert r.status_code in (403, 404)
    # Dépôt : « pending », e-mail de réception, publication possible (drapeau ownership_pending)
    emails.clear()
    r = client.post(url, headers=api.h(seller), data={"doc_type": "taxe-fonciere"}, files={"file": ("avis.pdf", api.PDF, "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["ownership"]["status"] == "pending" and r.json()["ownership"]["doc_type"] == "taxe-fonciere"
    assert last_email(seller["email"], "Justificatif de propriété reçu")
    meta = client.get(url, headers=api.h(seller)).json()["ownership"]
    assert meta["status"] == "pending" and meta["filename"] == "avis.pdf" and meta["uploaded_at"] and meta["note"] is None
    m = api.mandate(seller, pid)
    assert api.sign_mandate(seller, m["contract_id"]).json()["listing_status"] == "published"
    doc = client.get(f"/api/properties/{pid}", headers=api.h(seller)).json()
    assert "ownership_pending" in doc["moderation"]["flags"]
    # Le fichier : vendeur et admin seulement, jamais un acquéreur ni le public
    buyer = api.register(uid("acq"), "buyer")
    f = client.get(f"{url}/file", headers=api.h(seller))
    assert f.status_code == 200 and f.content == api.PDF and f.headers["content-type"] == "application/pdf"
    assert client.get(f"{url}/file", headers=api.h(api.admin())).status_code == 200
    assert client.get(f"{url}/file", headers=api.h(buyer)).status_code in (403, 404)
    assert client.get(url, headers=api.h(buyer)).status_code in (403, 404)
    assert client.get(f"{url}/file").status_code in (401, 403)
    public = client.get(f"/api/properties/{pid}").json()
    assert public["ownership"] == {"status": "pending"} and public["property_checks"]["ownership_verified"] is False
    # « À faire » admin, compteurs
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    row = next(r for s in todo["sections"] if s["key"] == "ownership_proofs" for r in s["rows"] if r["ref"]["property_id"] == pid)
    assert row["ref"]["doc_type"] == "taxe-fonciere" and row["ref"]["owner_type"] == "personne-physique"
    assert row["ref"]["file_url"] == f"{url}/file"
    assert client.get("/api/admin/stats", headers=api.h(api.admin())).json()["ownership_pending"] >= 1
    admin_row = next(p for p in client.get("/api/admin/properties", headers=api.h(api.admin())).json()["properties"] if p["id"] == pid)
    assert admin_row["ownership"]["status"] == "pending" and admin_row["ownership"]["doc_type"] == "taxe-fonciere"
    # Contrôle : réservé à l'admin, motif obligatoire pour un refus
    review = f"/api/admin/properties/{pid}/ownership"
    assert client.put(review, headers=api.h(seller), json={"status": "verified"}).status_code == 403
    r = client.put(review, headers=api.h(api.admin()), json={"status": "rejected"})
    assert r.status_code == 400 and r.json()["detail"]["field"] == "note"
    assert client.put(review, headers=api.h(api.admin()), json={"status": "en-attente"}).status_code == 422
    # Refus motivé d'une annonce en ligne : brouillon bloqué, retirée du site, e-mail avec le motif
    emails.clear()
    r = client.put(review, headers=api.h(api.admin()), json={"status": "rejected", "note": "Avis de taxe foncière illisible"})
    assert r.status_code == 200 and r.json()["ownership"]["status"] == "rejected"
    stored = db_call(client, server.db.properties.find_one, {"id": pid})
    assert stored["status"] == "draft" and [b["code"] for b in stored["blocking"]] == ["ownership_proof"]
    assert client.get(f"/api/properties/{pid}").status_code == 404
    mail = last_email(seller["email"], "Votre justificatif de propriété n'a pas pu être validé")
    assert mail and "illisible" in mail["html"]
    assert client.get(url, headers=api.h(seller)).json()["ownership"]["note"] == "Avis de taxe foncière illisible"
    # Nouveau dépôt : de nouveau « pending », annonce re-soumise et remise en ligne
    r = client.post(url, headers=api.h(seller), data={"doc_type": "titre-propriete"}, files={"file": ("acte.pdf", api.PDF, "application/pdf")})
    assert r.status_code == 200 and r.json()["ownership"]["status"] == "pending" and r.json()["listing_status"] == "published"
    # Validation : badge « Propriétaire vérifié », e-mail
    emails.clear()
    r = client.put(review, headers=api.h(api.admin()), json={"status": "verified"})
    assert r.status_code == 200 and r.json()["ownership"]["status"] == "verified"
    assert last_email(seller["email"], "Propriétaire vérifié")
    public = client.get(f"/api/properties/{pid}").json()
    assert public["ownership"] == {"status": "verified"} and public["property_checks"]["ownership_verified"] is True
    todo = client.get("/api/admin/todo", headers=api.h(api.admin())).json()
    assert not [r for s in todo["sections"] if s["key"] == "ownership_proofs" for r in s["rows"] if r["ref"]["property_id"] == pid]


# ---------- Champs calculés (SPEC §3.4) ----------

def test_titre_rendements_et_decence_calcules_par_le_serveur(api, client):
    seller, c = _seller_with_listing(api, client, title="Mon bel appartement 12 rue des Lilas", gross_yield=99, dpe_class="F")
    # Loyer 800 €/mois, prix 200 000 €, taxe foncière 900 €, charges non récupérables 400 €
    assert c["title"] == "Appartement T2 loué · 42 m² · Lyon (69)"
    assert c["gross_yield"] == 4.8 and c["net_yield"] == 4.15
    assert c["department"] == "69" and c["region"] == "Auvergne-Rhône-Alpes"
    assert c["dpe_rental"] == {"status": "echeance", "date": "2028-01-01"}
    r = client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"rent_monthly": 1000, "property_tax": 1200, "surface": 55.5})
    body = r.json()
    assert body["gross_yield"] == 6.0 and body["net_yield"] == round((12000 - 1200 - 400) / 200000 * 100, 2)
    assert body["title"] == "Appartement T2 loué · 55,5 m² · Lyon (69)"
    r = client.put(f"/api/properties/{c['id']}", headers=api.h(seller), json={"property_type": "immeuble", "units_count": 6})
    assert r.json()["title"] == "Immeuble de rapport loué · 6 lots · 55,5 m² · Lyon (69)"
    # Prix absent : rendements non calculés
    _, draft = _seller_with_listing(api, client, asking_price=None)
    assert draft["gross_yield"] is None and draft["net_yield"] is None and "price" in [b["code"] for b in draft["blocking"]]


def test_acquereur_ne_cree_pas_d_annonce(api, client):
    buyer = api.register(uid("acq-annonce"), "buyer")
    r = client.post("/api/properties", headers=api.h(buyer), json=listing())
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_allowed"


# ---------- Photos de l'annonce ----------

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


def test_photos_publiques_et_privees_dans_l_annonce(api, client):
    seller, c = _seller_with_listing(api, client)
    api.publish(seller, c["id"])
    ids = {}
    for visibility in ("public", "private"):
        r = client.post(f"/api/properties/{c['id']}/photos", headers=api.h(seller), data={"visibility": visibility},
                        files={"file": (f"{visibility}.png", PNG, "image/png")})
        assert r.status_code == 200, r.text
        ids[visibility] = r.json()["id"]
    public = client.get(f"/api/properties/{c['id']}").json()
    assert public["photos"] == [{"id": ids["public"], "visibility": "public", "url": f"/api/properties/{c['id']}/photos/{ids['public']}"}]
    listed = next(x for x in client.get("/api/properties", params={"limit": 100}).json() if x["id"] == c["id"])
    assert [p["id"] for p in listed["photos"]] == [ids["public"]]
    own = client.get(f"/api/properties/{c['id']}", headers=api.h(seller)).json()
    assert {p["id"] for p in own["photos"]} == set(ids.values())
    content = client.get(public["photos"][0]["url"]).json()
    assert base64.b64decode(content["content"]) == PNG and content["content_type"] == "image/png"
    assert client.get(f"/api/properties/{c['id']}/photos/{ids['private']}").status_code in (401, 403)
    # Photos privées visibles après l'engagement de confidentialité
    buyer = api.register(uid("acq-photo"), "buyer")
    assert [p["id"] for p in client.get(f"/api/properties/{c['id']}", headers=api.h(buyer)).json()["photos"]] == [ids["public"]]
    api.grant_dataroom(seller, buyer, c["id"])
    assert {p["id"] for p in client.get(f"/api/properties/{c['id']}", headers=api.h(buyer)).json()["photos"]} == set(ids.values())


# ---------- Fiche de reprise du bail (bail.py, SPEC §6.2) ----------

def _keys(sheet):
    return [p["key"] for p in sheet["points"]]


def test_regles_de_reprise_du_bail():
    habitation = bail.lease_transfer_sheet("habitation-vide", "appartement", "bien")
    assert _keys(habitation) == ["bail_continue", "depot_garantie", "prorata", "revision", "conge", "decence_energetique"]
    assert habitation["regime"] == "habitation" and habitation["disclaimer"] and len(habitation["summary"]) == 6
    assert "article 1743" in habitation["points"][0]["text"] and "deux ans après l'achat" in habitation["points"][4]["text"]
    commercial = bail.lease_transfer_sheet("commercial", "local-commercial", "bien")
    assert _keys(commercial) == ["bail_continue", "depot_garantie", "prorata", "revision", "bail_369", "preference"]
    assert "L145-46-1" in commercial["points"][5]["text"]
    # Vente des parts : la société reste bailleresse, pas de transfert de dépôt ni de droit de préférence
    parts = bail.lease_transfer_sheet("commercial", "local-commercial", "parts")
    assert _keys(parts) == ["vente_parts", "revision", "bail_369"] and parts["points"][0]["level"] == "attention"
    indifferent = bail.lease_transfer_sheet("habitation-meublee", "appartement", "indifferent")
    assert "vente_parts" in _keys(indifferent) and "bail_continue" in _keys(indifferent)
    assert "location_parking" in _keys(bail.lease_transfer_sheet("parking", "parking"))
    assert "bail_professionnel" in _keys(bail.lease_transfer_sheet("professionnel", "bureaux"))
    residence = bail.lease_transfer_sheet("residence-geree", "residence-geree", "bien",
                                          {"operator_lease_end": "2031-09-30", "deposit": 0})
    assert "exploitant" in _keys(residence) and "30/09/2031" in next(p for p in residence["points"] if p["key"] == "exploitant")["text"]
    assert "bail_369" not in _keys(residence)
    # Données du bien : dépôt de garantie, indexation, échéance, DPE
    sheet = bail.lease_transfer_sheet("habitation-vide", "appartement", "bien",
                                      {"deposit": 800, "indexation": "irl", "lease_end": "2027-12-31", "dpe_class": "G"}, today="2026-10-14")
    texts = {p["key"]: p["text"] for p in sheet["points"]}
    assert "800" in texts["depot_garantie"] and "IRL" in texts["revision"] and "31/12/2027" in texts["conge"]
    assert sheet["dpe"]["status"] == "interdit" and sheet["dpe"]["date"] == "2025-01-01" and "classé G" in sheet["dpe"]["text"]
    assert next(p for p in sheet["points"] if p["key"] == "decence_energetique")["level"] == "attention"
    f = bail.lease_transfer_sheet("habitation-vide", "maison", "bien", {"dpe_class": "F"}, today="2026-10-14")
    assert f["dpe"] == {"status": "echeance", "date": "2028-01-01", "text": f["dpe"]["text"]} and "1ᵉʳ janvier 2028" in f["dpe"]["text"]
    for bad in ("bail-emphyteotique", ""):
        try:
            bail.lease_transfer_sheet(bad)
            raise AssertionError("type de bail inconnu accepté")
        except ValueError:
            pass
    # Vocabulaire : aucune notion de cession d'entreprise
    for sheet in (habitation, commercial, parts, residence):
        text = " ".join(p["text"] for p in sheet["points"]).lower()
        assert "cédant" not in text and "repreneur" not in text and "fonds de commerce" not in text


def test_routes_de_reprise_du_bail(api, client):
    r = client.get("/api/lease-transfer/rules", params={"lease_type": "habitation-meublee", "property_type": "appartement"})
    assert r.status_code == 200 and r.json()["lease_label"].startswith("Bail d'habitation meublé") and "dpe" not in r.json()
    assert client.get("/api/lease-transfer/rules", params={"lease_type": "commercial", "sale_object": "titres"}).status_code == 400
    assert client.get("/api/lease-transfer/rules").status_code == 422
    seller, c = _seller_with_listing(api, client, dpe_class="F", deposit=800)
    api.publish(seller, c["id"])
    url = f"/api/properties/{c['id']}/lease-transfer"
    assert client.get(url).status_code in (401, 403)
    buyer = api.register(uid("acq-bail"), "buyer")
    r = client.get(url, headers=api.h(buyer))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_allowed"
    sheet = client.get(url, headers=api.h(seller)).json()
    assert sheet["property_id"] == c["id"] and sheet["property_title"] == c["title"] and sheet["dpe"]["date"] == "2028-01-01"
    assert "800" in next(p for p in sheet["points"] if p["key"] == "depot_garantie")["text"]
    api.grant_dataroom(seller, buyer, c["id"])
    assert client.get(url, headers=api.h(buyer)).status_code == 200
    assert client.get("/api/properties/inconnue/lease-transfer", headers=api.h(seller)).status_code == 404


# ---------- Dossier du bien : catégories (SPEC §6.3) ----------

def _real_pdf():
    import io
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_categories_du_dossier_du_bien(api, client):
    categories = client.get("/api/dataroom/categories").json()
    assert [c["id"] for c in categories][:3] == ["bail", "etats-des-lieux", "loyers"]
    assert all(set(c) == {"id", "label", "hint"} and c["label"] and c["hint"] for c in categories)
    assert "societe" in [c["id"] for c in categories] and "bilans" not in [c["id"] for c in categories]
    seller, c = _seller_with_listing(api, client)
    api.publish(seller, c["id"])
    r = client.post(f"/api/dataroom/{c['id']}/documents", headers=api.h(seller), data={"category": "bilans"},
                    files={"file": ("x.pdf", api.PDF, "application/pdf")})
    assert r.status_code == 400 and r.json()["detail"]["field"] == "category"
    r = client.post(f"/api/dataroom/{c['id']}/documents", headers=api.h(seller), data={"category": "loyers"},
                    files={"file": ("quittances.pdf", _real_pdf(), "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["category"] == "loyers" and r.json()["category_label"] == "Loyers et quittances"
    assert "locataire" in r.json()["warning"]
    docs = client.get(f"/api/dataroom/{c['id']}/documents", headers=api.h(seller)).json()
    docs = docs.get("documents", docs) if isinstance(docs, dict) else docs
    assert any(d["category"] == "loyers" and d.get("category_label") == "Loyers et quittances" for d in docs)


# ---------- Honoraires : bloc `commission` de /config (SPEC §7.1) ----------

def test_bloc_commission_de_la_configuration(api, client, monkeypatch):
    config = client.get("/api/config").json()
    assert config["commission"] == {"rate_percent_ht": 3.0, "rate_percent_ttc": 3.6, "minimum_ht": 3000.0, "minimum_ttc": 3600.0,
                                    "vat_rate": 0.2}
    assert config["commission_payer"] == "vendeur" and config["commission_terms_version"] == "v1"
    assert business_model.commission_scale_text().startswith("3,6 % TTC du prix de vente (3 % HT)")
    calc = business_model.calculate_commission(200000)
    assert calc["final_commission_ht"] == 6000 and calc["final_commission_ttc"] == 7200 and calc["applied_minimum"] is False
    small = business_model.calculate_commission(50000)
    assert small["final_commission_ht"] == 3000 and small["applied_minimum"] is True and small["payer"] == "vendeur"
    # Taux et minimum réglables par l'environnement
    monkeypatch.setenv("COMMISSION_RATE_PERCENT", "4")
    monkeypatch.setenv("COMMISSION_MIN_HT", "5000")
    config = client.get("/api/config").json()["commission"]
    assert config["rate_percent_ht"] == 4.0 and config["rate_percent_ttc"] == 4.8 and config["minimum_ttc"] == 6000.0
    assert business_model.calculate_commission(200000)["final_commission_ht"] == 8000
    # Annonce publique : honoraires à la charge du vendeur, rien pour l'acquéreur
    monkeypatch.delenv("COMMISSION_RATE_PERCENT")
    monkeypatch.delenv("COMMISSION_MIN_HT")
    seller, c = _seller_with_listing(api, client)
    api.publish(seller, c["id"])
    info = client.get(f"/api/properties/{c['id']}").json()["commission_info"]
    assert {"payer", "rate_percent_ttc", "rate_percent_ht", "estimate_ht", "estimate_ttc", "minimum_ht", "minimum_ttc", "terms_version"} <= set(info)
    assert info["payer"] == "vendeur" and info["estimate_ht"] == 6000 and info["estimate_ttc"] == 7200 and info["terms_version"] == "v1"
