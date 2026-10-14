"""Étape de vente, facture et relances (closing.py, SPEC §4.5) : création à l'acceptation d'une offre, rédacteur, relances
J+30/60/90 avec réponses par lien signé, déclaration → confirmation → facture (numérotation continue, débiteur = cédant,
adresse du mandat, barème via calculate_commission), confirmation automatique à 7 jours, échéances titres/fonds, relances
de facture idempotentes, mise en demeure et « À faire », marquage payé / annulé, PDF."""
import io
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pypdf import PdfReader

import business_model
import closing
import server
from conftest import last_email

ADMIN = "admin@test.fr"
NOW = datetime.now(timezone.utc)


def db_call(client, fn, *args, **kwargs):
    return client.portal.call(lambda: fn(*args, **kwargs))


def uid(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.fr"


def iso(days):
    return (NOW + timedelta(days=days)).isoformat()


def day(days):
    return (NOW + timedelta(days=days)).date().isoformat()


def _company(client, seller, name="SECRET ENERGIE SAS", **extra):
    doc = {"id": str(uuid.uuid4()), "seller_id": seller["id"], "siret": "73282932000074", "company_name": name,
           "legal_structure": "SAS", "status": "published", "rge_types": ["Pompes à chaleur air/eau"], "region": "Bretagne",
           "sale_object": "titres", "asking_price": 500000, "created_at": iso(-100), **extra}
    db_call(client, server.db.companies.insert_one, doc)
    return doc


def _mandat(client, company, address="12 rue de la Mer, 29200 Brest", **extra):
    registry = db_call(client, server.next_sequence, "mandate_registry")
    doc = {"id": str(uuid.uuid4()), "type": "mandat", "contract_number": f"MANDAT-TEST-{registry}", "company_id": company["id"],
           "seller_id": company["seller_id"], "status": "signed", "signed_at": iso(-90), "created_at": iso(-91),
           "registry_number": registry, "terms_version": "v2", "sale_object": company.get("sale_object", "titres"), **extra}
    if address is not None:
        doc["mandant_address"] = address
    db_call(client, server.db.generated_contracts.insert_one, doc)
    db_call(client, server.db.companies.update_one, {"id": company["id"]}, {"$set": {"mandate_id": doc["id"], "mandat_signed": True}})
    return doc


def _offer(client, company, buyer, amount=500000, status="accepted", **extra):
    doc = {"id": str(uuid.uuid4()), "company_id": company["id"], "buyer_id": buyer["id"], "buyer_email": buyer["email"],
           "seller_id": company["seller_id"], "amount": amount, "status": status, "created_at": iso(-10),
           "responded_at": iso(-1) if status == "accepted" else None, **extra}
    db_call(client, server.db.offers.insert_one, doc)
    return doc


def _setup(api, client, prefix, amount=500000, sale_object="titres", address="12 rue de la Mer, 29200 Brest", **company_extra):
    """Cédant + repreneur + annonce publiée + mandat signé + offre acceptée → closing (sans e-mail de checklist)"""
    seller = api.register(uid(f"{prefix}-ced"), "seller", first="Paul", last="Dupont")
    buyer = api.register(uid(f"{prefix}-rep"), "buyer", first="Marie", last="Martin")
    company = _company(client, seller, sale_object=sale_object, **company_extra)
    mandat = _mandat(client, company, address=address)
    offer = _offer(client, company, buyer, amount=amount)
    clo = db_call(client, closing.create_closing_for_offer, offer, company, False)
    return {"seller": seller, "buyer": buyer, "company": company, "mandat": mandat, "offer": offer, "closing": clo}


def pdf_text(content: bytes) -> str:
    """Texte d'un PDF (espaces insécables normalisées pour comparer les montants)"""
    assert content.startswith(b"%PDF")
    return "".join(page.extract_text() for page in PdfReader(io.BytesIO(content)).pages).replace("\xa0", " ")


def eur(amount) -> str:
    return closing.fmt_eur_cents(amount).replace("\xa0", " ")


def _invoice(client, invoice_id):
    return db_call(client, server.db.invoices.find_one, {"id": invoice_id}, {"_id": 0})


def _closing(client, closing_id):
    return db_call(client, server.db.closings.find_one, {"id": closing_id}, {"_id": 0})


def _declare(client, api, ctx, who, price=None, sale_object=None, signed_days_ago=2):
    r = client.post(f"/api/closing/{ctx['closing']['id']}/declare", headers=api.h(ctx[who]),
                    json={"signed_on": day(-signed_days_ago), "final_price": price or ctx["offer"]["amount"],
                          "sale_object": sale_object or ctx["company"]["sale_object"]})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Branchement ----------

def test_module_branche_et_gabarits():
    assert "closing" in server.LOADED_MODULES
    assert any(name == "closing" for name, _ in server.DAILY_JOBS)
    for tpl in ("closing_checklist", "closing_followup", "closing_declared_to_confirm", "invoice_issued", "invoice_reminder",
                "payment_order_redacteur", "invoice_paid", "closing_disputed_admin"):
        assert tpl in business_model.EMAIL_TEMPLATES
    # Les statuts « vente déclarée » de la veille BODACC couvrent ceux du module
    import veille
    assert closing.STATUS_DECLARED in veille.SALE_DECLARED_STATUSES and closing.STATUS_CONFIRMED in veille.SALE_DECLARED_STATUSES
    # Aucun texte « à compléter » dans les gabarits du module
    for tpl in ("closing_checklist", "invoice_issued", "invoice_reminder", "payment_order_redacteur"):
        assert "à compléter" not in business_model.EMAIL_TEMPLATES[tpl]["html"].lower()
    assert closing.LATE_PENALTY_TEXT and "40 €" in closing.LATE_PENALTY_TEXT and "L441-10" in closing.LATE_PENALTY_TEXT


# ---------- Création et rédacteur ----------

def test_creation_closing_checklist_et_redacteur(api, client, emails):
    seller = api.register(uid("crea-ced"), "seller", first="Paul", last="Dupont")
    buyer = api.register(uid("crea-rep"), "buyer", first="Marie", last="Martin")
    stranger = api.register(uid("crea-autre"), "buyer")
    company = _company(client, seller)
    _mandat(client, company)
    offer = _offer(client, company, buyer, amount=450000)
    emails.clear()

    # Création à l'acceptation (fonction appelée par server.py) : idempotente, checklist aux deux parties
    clo = db_call(client, closing.create_closing_for_offer, offer, company)
    assert clo["status"] == "in_progress" and clo["offer_id"] == offer["id"] and clo["sale_object"] == "titres"
    assert clo["seller_id"] == seller["id"] and clo["buyer_id"] == buyer["id"] and clo["tokens"]["seller"] != clo["tokens"]["buyer"]
    assert db_call(client, closing.create_closing_for_offer, offer, company)["id"] == clo["id"]
    assert db_call(client, server.db.closings.count_documents, {"offer_id": offer["id"]}) == 1
    assert db_call(client, server.db.offers.find_one, {"id": offer["id"]})["closing_id"] == clo["id"]
    for u in (seller, buyer):
        e = last_email(u["email"], "Offre acceptée")
        assert e and "450 000 €" in e["html"] and "Rédacteur de l'acte" in e["html"] and "Financement" in e["html"]
    assert len([e for e in emails if e["subject"].startswith("Offre acceptée")]) == 2

    # Route pour une offre déjà acceptée : idempotente, réservée aux parties, offre acceptée uniquement
    r = client.post(f"/api/closing/from-offer/{offer['id']}", headers=api.h(buyer))
    assert r.status_code == 200 and r.json()["id"] == clo["id"] and "tokens" not in r.json() and r.json()["role"] == "buyer"
    # Honoraires (facturés au cédant) : jamais dans la vue du repreneur
    assert r.json()["commission_preview"] is None and r.json()["invoice"] is None
    seller_view = client.post(f"/api/closing/from-offer/{offer['id']}", headers=api.h(seller)).json()
    assert seller_view["commission_preview"]["final_commission_ht"] == business_model.calculate_commission(450000)["final_commission_ht"]
    assert client.post(f"/api/closing/from-offer/{offer['id']}", headers=api.h(stranger)).status_code == 403
    pending = _offer(client, company, buyer, amount=1, status="pending")
    assert client.post(f"/api/closing/from-offer/{pending['id']}", headers=api.h(buyer)).status_code == 400
    assert client.post("/api/closing/from-offer/inconnue", headers=api.h(buyer)).status_code == 404

    # Consultation
    r = client.get("/api/closing/my", headers=api.h(seller))
    assert r.status_code == 200 and [c["id"] for c in r.json()["closings"]] == [clo["id"]]
    assert client.get(f"/api/closing/{clo['id']}", headers=api.h(stranger)).status_code == 403
    assert client.get(f"/api/closing/{clo['id']}", headers=api.h(api.admin())).json()["role"] == "admin"

    # Rédacteur renseigné par le repreneur → le cédant est prévenu ; validation
    r = client.put(f"/api/closing/{clo['id']}/redacteur", headers=api.h(buyer),
                   json={"type": "notaire", "name": "Maître Le Gall", "email": "Etude@LeGall.notaires.fr", "phone": "02 98 00 00 00"})
    assert r.status_code == 200 and r.json()["redacteur"]["email"] == "etude@legall.notaires.fr" and r.json()["redacteur"]["set_by"] == "buyer"
    e = last_email(seller["email"], "Rédacteur de l'acte renseigné")
    assert e and "Maître Le Gall" in e["html"] and "Le repreneur" in e["html"]
    assert client.put(f"/api/closing/{clo['id']}/redacteur", headers=api.h(seller), json={"type": "huissier", "name": "X Y"}).status_code == 400
    assert client.put(f"/api/closing/{clo['id']}/redacteur", headers=api.h(seller), json={"type": "avocat", "name": "X Y", "email": "pas-un-mail"}).status_code == 400
    assert client.put(f"/api/closing/{clo['id']}/redacteur", headers=api.h(stranger), json={"type": "avocat", "name": "X Y"}).status_code == 403


# ---------- Relances J+30/60/90 et réponses en un clic ----------

def test_relances_et_reponses_en_un_clic(api, client, emails):
    ctx = _setup(api, client, "relance")
    clo, seller, buyer = ctx["closing"], ctx["seller"], ctx["buyer"]
    # La base est partagée entre les tests : on vérifie l'état de ce closing, pas le compteur global du job

    def sent():
        return [f["day"] for f in _closing(client, clo["id"])["followups_sent"]]

    db_call(client, closing.daily_job, NOW + timedelta(days=10))
    assert sent() == [] and last_email(seller["email"], "Où en est la vente") is None
    db_call(client, closing.daily_job, NOW + timedelta(days=31))
    assert sent() == [30]
    before = len(emails)
    db_call(client, closing.daily_job, NOW + timedelta(days=31))
    assert sent() == [30] and len(emails) == before, "idempotent (claim_once)"
    for u in (seller, buyer):
        e = last_email(u["email"], "Où en est la vente")
        assert e and "30 jours" in e["html"] and "SECRET ENERGIE SAS" in e["html"]
    seller_mail = last_email(seller["email"], "Où en est la vente")
    links = re.findall(r'href="(https://cessionrge.test/api/closing/[^"]+)"', seller_mail["html"])
    assert len(links) == 3 and all(f"/status/{clo['tokens']['seller']}" in link for link in links)

    # « Toujours en cours » : le lien (GET) n'affiche qu'une page de confirmation, sans effet ; le bouton (POST) enregistre
    path = links[0].replace("https://cessionrge.test", "").replace("&amp;", "&")
    r = client.get(path)
    assert r.status_code == 200 and r.json()["confirm_required"] is True and r.json()["status"] == "in_progress"
    r = client.get(path, headers={"Accept": "text/html"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html") and "Toujours en cours" in r.text
    assert '<form method="post" action="/api/closing/' in r.text
    assert not _closing(client, clo["id"]).get("progress"), "un GET (scanner de liens) n'enregistre rien"
    r = client.post(path)
    assert r.status_code == 200 and r.json()["answer"] == "en_cours" and r.json()["status"] == "in_progress"
    r = client.post(path, headers={"Accept": "text/html"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html") and "Toujours en cours" in r.text
    assert client.post(f"/api/closing/{clo['id']}/status/mauvais-jeton?answer=en_cours").status_code == 404
    assert client.get(f"/api/closing/{clo['id']}/status/mauvais-jeton?answer=en_cours").status_code == 404
    assert client.post(f"/api/closing/{clo['id']}/status/{clo['tokens']['seller']}?answer=autre").status_code == 400
    assert [p["answer"] for p in _closing(client, clo["id"])["progress"]] == ["en_cours", "en_cours"]

    # J+60 puis J+90 : une relance par passage, dans l'ordre
    db_call(client, closing.daily_job, NOW + timedelta(days=61))
    assert sent() == [30, 60]
    db_call(client, closing.daily_job, NOW + timedelta(days=95))
    assert sent() == [30, 60, 90]
    before = len(emails)
    db_call(client, closing.daily_job, NOW + timedelta(days=200))
    assert sent() == [30, 60, 90] and not [e for e in emails[before:] if e["to"] in (seller["email"], buyer["email"])]

    # « Acte signé » : enregistré, invitation à déclarer ; « abandonné » : statut abandonné, plus de relance
    r = client.post(f"/api/closing/{clo['id']}/status/{clo['tokens']['buyer']}?answer=signe", headers={"Accept": "text/html"})
    assert r.status_code == 200 and "déclarez la vente" in r.text
    assert _closing(client, clo["id"])["signature_reported"]["by"] == "buyer"
    abandon = f"/api/closing/{clo['id']}/status/{clo['tokens']['seller']}?answer=abandonne"
    assert client.get(abandon).status_code == 200 and _closing(client, clo["id"])["status"] == "in_progress"
    r = client.post(abandon)
    assert r.status_code == 200 and r.json()["status"] == "abandoned"
    assert _closing(client, clo["id"])["status"] == "abandoned"
    # Réversible par la partie qui a déclaré l'abandon (pas par l'autre)
    client.post(f"/api/closing/{clo['id']}/status/{clo['tokens']['buyer']}?answer=en_cours")
    assert _closing(client, clo["id"])["status"] == "abandoned"
    r = client.post(f"/api/closing/{clo['id']}/status/{clo['tokens']['seller']}?answer=en_cours")
    assert r.json()["status"] == "in_progress" and _closing(client, clo["id"])["status"] == "in_progress"


# ---------- Déclaration → confirmation → facture ----------

def test_declaration_confirmation_facture_pdf_paiement(api, client, emails):
    ctx = _setup(api, client, "vente", amount=500000)
    clo, seller, buyer, company = ctx["closing"], ctx["seller"], ctx["buyer"], ctx["company"]
    client.put(f"/api/closing/{clo['id']}/redacteur", headers=api.h(seller),
               json={"type": "avocat", "name": "Maître Durand", "email": "durand@avocats.test"})
    db_call(client, server.db.incidents.insert_one, {"id": "inc-1", "company_id": company["id"], "status": "open", "siren": "732829320", "event": {"id": "inc-1"}})
    emails.clear()

    # Validation
    cid = clo["id"]
    assert client.post(f"/api/closing/{cid}/declare", headers=api.h(buyer),
                       json={"signed_on": day(5), "final_price": 480000, "sale_object": "titres"}).status_code == 400
    assert client.post(f"/api/closing/{cid}/declare", headers=api.h(buyer),
                       json={"signed_on": day(-1), "final_price": 480000, "sale_object": "indifferent"}).status_code == 400
    assert client.post(f"/api/closing/{cid}/declare", headers=api.h(buyer),
                       json={"signed_on": "hier", "final_price": 480000, "sale_object": "titres"}).status_code == 400
    assert client.post(f"/api/closing/{cid}/declare", headers=api.h(buyer),
                       json={"signed_on": day(-1), "final_price": 0, "sale_object": "titres"}).status_code == 422

    # Déclaration par le repreneur : l'autre partie et l'admin sont prévenus, incident BODACC clos
    data = _declare(client, api, ctx, "buyer", price=480000)
    assert data["status"] == "declared" and data["declaration"]["declared_by"] == "buyer" and data["declaration"]["final_price"] == 480000
    deadline = server._parse_dt(data["declaration"]["confirm_deadline"])
    assert abs((deadline - datetime.now(timezone.utc)).days - closing.CONFIRMATION_DAYS) <= 1
    e = last_email(seller["email"], "Vente déclarée")
    assert e and "480 000 €" in e["html"] and "Le repreneur" in e["html"] and deadline.strftime("%d/%m/%Y") in e["html"]
    a = last_email(ADMIN, "Vente déclarée")
    expected = business_model.calculate_commission(480000)
    assert a and company["id"] in a["html"] and closing.fmt_eur_cents(expected["final_commission_ht"]) in a["html"]
    assert db_call(client, server.db.incidents.find_one, {"id": "inc-1"})["status"] == "closed"
    assert last_email(buyer["email"], "Vente déclarée") is None

    # Le déclarant ne peut pas confirmer ; un tiers non plus ; le cédant confirme
    assert client.post(f"/api/closing/{cid}/confirm", headers=api.h(buyer)).status_code == 403
    stranger = api.register(uid("vente-tiers"), "seller")
    assert client.post(f"/api/closing/{cid}/confirm", headers=api.h(stranger)).status_code == 403
    r = client.post(f"/api/closing/{cid}/confirm", headers=api.h(seller))
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["status"] == "confirmed" and view["confirmed_by"] == "seller" and view["invoice"]["number"].startswith("FAC-")
    assert client.post(f"/api/closing/{cid}/confirm", headers=api.h(seller)).status_code == 400

    # Facture : numéro, barème via calculate_commission, débiteur = cédant avec l'adresse du mandat, échéance titres +30 j
    inv = _invoice(client, view["invoice"]["id"])
    assert re.fullmatch(r"FAC-\d{4}-\d{5}", inv["number"]) and inv["status"] == "issued"
    assert inv["total_ht"] == expected["final_commission_ht"] and inv["vat"] == expected["vat"] and inv["total_ttc"] == expected["final_commission_ttc"]
    assert inv["final_price"] == 480000 and inv["sale_object"] == "titres" and inv["mandate_number"] == str(ctx["mandat"]["registry_number"])
    assert inv["debtor"] == {"user_id": seller["id"], "name": "Paul Dupont", "email": seller["email"], "address": "12 rue de la Mer, 29200 Brest",
                             "address_source": "mandat", "company_name": "SECRET ENERGIE SAS", "siren": "732829320", "legal_structure": "SAS"}
    issued = datetime.fromisoformat(inv["issued_on"]).date()
    # Échéance du mandat (art. 6.3) : 30 jours après l'acte (signé il y a 2 jours), pas après la facture
    signed = datetime.fromisoformat(inv["signed_on"]).date()
    assert signed < issued
    assert datetime.fromisoformat(inv["due_on"]).date() == signed + timedelta(days=30) and inv["due_days"] == 30
    assert "30 jours" in inv["payment_terms"] and "40 €" in inv["late_penalties"]
    assert inv["lines"][0]["designation"].startswith("Honoraires d'intermédiation — mandat n°") and "cession de titres" in inv["lines"][0]["designation"]
    assert sum(line["amount_ht"] for line in inv["lines"]) == pytest.approx(inv["total_ht"], abs=0.01)
    assert inv["issuer"]["vat_number"] == closing.vat_number() and inv["issuer"]["carte_t"]
    c = _closing(client, cid)
    assert c["invoice_id"] == inv["id"] and c["invoice_number"] == inv["number"]
    assert db_call(client, server.db.companies.find_one, {"id": company["id"]})["status"] == "sold"

    # E-mails : facture au cédant (lien PDF), ordre de paiement au rédacteur, confirmation au repreneur
    e = last_email(seller["email"], f"Votre facture n° {inv['number']}")
    assert e and closing.fmt_eur_cents(inv["total_ttc"]) in e["html"] and f"/api/invoices/{inv['id']}/pdf?token=" in e["html"]
    assert "Maître Durand" in e["html"]
    po = last_email("durand@avocats.test", "Ordre de paiement des honoraires")
    assert po and inv["number"] in po["html"] and f"/api/closing/{cid}/payment-order.pdf?token=" in po["html"]
    assert last_email(buyer["email"], "Vente confirmée")
    assert _closing(client, cid)["payment_order_sent_to"] == "durand@avocats.test"

    # PDF facture : cédant, admin, lien signé ; ni repreneur ni anonyme
    r = client.get(f"/api/invoices/{inv['id']}/pdf", headers=api.h(seller))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF") and len(r.content) > 1500
    assert client.get(f"/api/invoices/{inv['id']}/pdf", headers=api.h(api.admin())).status_code == 200
    assert client.get(f"/api/invoices/{inv['id']}/pdf", headers=api.h(buyer)).status_code == 403
    assert client.get(f"/api/invoices/{inv['id']}/pdf").status_code == 401
    assert client.get(f"/api/invoices/{inv['id']}/pdf", params={"token": "faux"}).status_code == 401
    token = re.search(r"pdf\?token=([^\"&]+)", e["html"]).group(1)
    assert client.get(f"/api/invoices/{inv['id']}/pdf", params={"token": token}).status_code == 200
    text = pdf_text(r.content)
    for needle in (inv["number"], "Honoraires", "Paul Dupont", "12 rue de la Mer", "732 829 320", "Total TTC", "40 €",
                   "Date d'échéance", closing.vat_number(), "ne recevoir ni détenir"):
        assert needle in text, needle
    assert "à compléter" not in text.lower()

    # Vue du repreneur : ni facture (débiteur : e-mail, adresse, SIREN du cédant), ni honoraires
    buyer_view = client.get(f"/api/closing/{cid}", headers=api.h(buyer)).json()
    assert buyer_view["invoice"] is None and buyer_view["commission_preview"] is None and "invoice_id" not in buyer_view
    assert seller["email"] not in str(buyer_view) and "12 rue de la Mer" not in str(buyer_view)
    assert "12 rue de la Mer" not in str(client.get("/api/closing/my", headers=api.h(buyer)).json())

    # Ordre de paiement : cédant, admin, lien du rédacteur ; jamais le repreneur
    po_token = re.search(r"payment-order\.pdf\?token=([^\"&]+)", po["html"]).group(1)
    assert client.get(f"/api/closing/{cid}/payment-order.pdf", headers=api.h(buyer)).status_code == 403
    for headers, params in ((api.h(seller), {}), (api.h(api.admin()), {}), ({}, {"token": po_token})):
        r = client.get(f"/api/closing/{cid}/payment-order.pdf", headers=headers, params=params)
        assert r.status_code == 200 and r.content.startswith(b"%PDF"), r.status_code
    text = pdf_text(r.content)
    assert "ORDRE DE PAIEMENT" in text and inv["number"] in text and "Maître Durand" in text and "irrévocable" in text
    assert client.get(f"/api/closing/{cid}/payment-order.pdf").status_code == 401
    assert client.get(f"/api/closing/{cid}/payment-order.pdf", headers=api.h(stranger)).status_code == 403

    # Consultation
    assert client.get("/api/invoices/my", headers=api.h(seller)).json()["invoices"][0]["number"] == inv["number"]
    assert client.get(f"/api/invoices/{inv['id']}", headers=api.h(buyer)).status_code == 403
    assert "access_token" not in client.get(f"/api/invoices/{inv['id']}", headers=api.h(seller)).json()

    # Admin : liste, marquage payé (e-mail au cédant), plus d'annulation possible
    r = client.get("/api/admin/invoices", headers=api.h(api.admin()))
    assert r.status_code == 200 and any(i["id"] == inv["id"] and i["overdue"] is False for i in r.json()["invoices"])
    assert client.get("/api/admin/invoices", headers=api.h(seller)).status_code == 403
    assert client.put(f"/api/admin/invoices/{inv['id']}/paid", headers=api.h(api.admin()),
                      json={"paid_on": day(3), "amount": inv["total_ttc"]}).status_code == 400
    r = client.put(f"/api/admin/invoices/{inv['id']}/paid", headers=api.h(api.admin()), json={"paid_on": day(0), "amount": inv["total_ttc"]})
    assert r.status_code == 200 and r.json()["status"] == "paid" and r.json()["balance_due"] == 0
    assert last_email(seller["email"], f"Paiement reçu : facture n° {inv['number']}")
    assert _closing(client, cid)["paid_at"]
    assert client.put(f"/api/admin/invoices/{inv['id']}/cancel", headers=api.h(api.admin()), json={"reason": "erreur"}).status_code == 400
    paid = client.get("/api/admin/invoices", params={"status": "paid"}, headers=api.h(api.admin())).json()
    assert any(i["id"] == inv["id"] for i in paid["invoices"]) and paid["totals"]["paid_ht"] >= inv["total_ht"]
    # Facture acquittée : mention dans le PDF ; mise en demeure impossible
    r = client.get(f"/api/invoices/{inv['id']}/pdf", headers=api.h(seller))
    assert "acquittée" in pdf_text(r.content)
    assert client.get(f"/api/admin/invoices/{inv['id']}/mise-en-demeure.pdf", headers=api.h(api.admin())).status_code == 400
    # Rien à relancer pour une facture payée
    db_call(client, closing.daily_job, NOW + timedelta(days=400))
    assert _invoice(client, inv["id"])["reminder_count"] == 0


def test_confirmation_automatique_apres_7_jours(api, client, emails):
    ctx = _setup(api, client, "auto", amount=300000)
    cid = ctx["closing"]["id"]
    _declare(client, api, ctx, "seller", price=300000)
    db_call(client, closing.daily_job, NOW + timedelta(days=6))
    assert _closing(client, cid)["status"] == "declared" and _closing(client, cid)["invoice_id"] is None
    assert db_call(client, closing.daily_job, NOW + timedelta(days=8)) >= 1
    c = _closing(client, cid)
    assert c["status"] == "confirmed" and c["confirmed_by"] == "auto" and c["invoice_id"]
    inv = _invoice(client, c["invoice_id"])
    assert inv["total_ht"] == business_model.calculate_commission(300000)["final_commission_ht"]
    assert inv["issued_on"] == day(8), "la facture est datée du jour de la confirmation"
    assert last_email(ctx["seller"]["email"], f"Votre facture n° {inv['number']}")
    assert last_email(ctx["buyer"]["email"], "Vente confirmée")
    # Rejouer le job : aucune seconde facture
    db_call(client, closing.daily_job, NOW + timedelta(days=9))
    assert db_call(client, server.db.invoices.count_documents, {"closing_id": cid}) == 1
    assert _closing(client, cid)["invoice_id"] == c["invoice_id"]
    # Une vente confirmée ne se redéclare pas
    assert client.post(f"/api/closing/{cid}/declare", headers=api.h(ctx["buyer"]),
                       json={"signed_on": day(-1), "final_price": 1, "sale_object": "titres"}).status_code == 400


# ---------- Échéances et relances de facture ----------

def test_relances_facture_titres_mise_en_demeure_et_a_faire(api, client, emails):
    ctx = _setup(api, client, "rel-titres", amount=200000)
    cid, seller = ctx["closing"]["id"], ctx["seller"]
    _declare(client, api, ctx, "buyer", price=200000)
    client.post(f"/api/closing/{cid}/confirm", headers=api.h(seller))
    inv = _invoice(client, _closing(client, cid)["invoice_id"])
    assert inv["due_days"] == 30
    emails.clear()

    def reminders():
        return [r["step"] for r in _invoice(client, inv["id"])["reminders"]]

    db_call(client, closing.daily_job, NOW + timedelta(days=10))
    assert reminders() == []
    db_call(client, closing.daily_job, NOW + timedelta(days=16))
    assert reminders() == [1]
    before = len(emails)
    db_call(client, closing.daily_job, NOW + timedelta(days=16))
    assert reminders() == [1] and not [x for x in emails[before:] if x["to"] == seller["email"]], "idempotent"
    e = last_email(seller["email"], "Rappel d'échéance")
    assert e and inv["number"] in e["html"] and "arrive à échéance" in e["html"] and f"/api/invoices/{inv['id']}/pdf?token=" in e["html"]
    db_call(client, closing.daily_job, NOW + timedelta(days=31))
    assert reminders() == [1, 2]
    e = last_email(seller["email"], "Facture en retard")
    assert e and "Deuxième rappel" in e["html"] and "échue depuis" in e["html"]
    assert _invoice(client, inv["id"])["formal_notice_at"] is None
    # J+46 : troisième relance puis, l'échéance étant passée, mise en demeure + ligne « À faire »
    db_call(client, closing.daily_job, NOW + timedelta(days=46))
    assert reminders() == [1, 2, 3]
    e = last_email(seller["email"], "Facture en retard")
    assert "Dernier rappel" in e["html"] and "mise en demeure" in e["html"]
    inv2 = _invoice(client, inv["id"])
    assert inv2["formal_notice_at"] and inv2["reminder_count"] == 3
    todos = client.get("/api/admin/todos", headers=api.h(api.admin())).json()["todos"]
    todo = next(t for t in todos if t["type"] == "invoice_overdue" and t["ref"]["invoice_id"] == inv["id"])
    assert todo["status"] == "open" and inv["number"] in todo["title"] and todo["action"].endswith("/mise-en-demeure.pdf")
    assert db_call(client, server.db.todos.count_documents, {"type": "invoice_overdue", "key": inv["id"]}) == 1
    # Plus rien ensuite (pas de quatrième relance, pas de doublon de mise en demeure)
    db_call(client, closing.daily_job, NOW + timedelta(days=120))
    assert reminders() == [1, 2, 3]
    assert db_call(client, server.db.todos.count_documents, {"type": "invoice_overdue", "key": inv["id"]}) == 1
    assert len([x for x in emails if x["to"] == seller["email"] and "facture" in x["subject"].lower()]) == 3

    # Modèle de mise en demeure (admin seulement), avec les dates des rappels
    r = client.get(f"/api/admin/invoices/{inv['id']}/mise-en-demeure.pdf", headers=api.h(api.admin()))
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    text = pdf_text(r.content)
    assert "MISE EN DEMEURE" in text and inv["number"] in text and "huit jours" in text and "Paul Dupont" in text
    assert closing.fmt_date_fr(inv2["reminders"][0]["sent_at"]) in text
    assert client.get(f"/api/admin/invoices/{inv['id']}/mise-en-demeure.pdf", headers=api.h(seller)).status_code == 403
    # Vue admin : facture en retard, lien du modèle
    assert client.get("/api/admin/invoices", params={"status": "overdue"}, headers=api.h(api.admin())).status_code == 200
    row = next(i for i in client.get("/api/admin/invoices", headers=api.h(api.admin())).json()["invoices"] if i["id"] == inv["id"])
    assert row["formal_notice_url"].endswith("/mise-en-demeure.pdf")
    # Marquer payée clôt la ligne « À faire »
    r = client.put(f"/api/admin/invoices/{inv['id']}/paid", headers=api.h(api.admin()), json={"paid_on": day(0), "amount": inv["total_ttc"]})
    assert r.status_code == 200
    assert db_call(client, server.db.todos.find_one, {"type": "invoice_overdue", "key": inv["id"]})["status"] == "done"


def test_echeance_fonds_180_jours_et_relances(api, client, emails):
    ctx = _setup(api, client, "rel-fonds", amount=150000, sale_object="fonds")
    cid, seller = ctx["closing"]["id"], ctx["seller"]
    _declare(client, api, ctx, "seller", price=150000, sale_object="fonds")
    client.post(f"/api/closing/{cid}/confirm", headers=api.h(ctx["buyer"]))
    inv = _invoice(client, _closing(client, cid)["invoice_id"])
    signed = datetime.fromisoformat(inv["signed_on"]).date()
    assert datetime.fromisoformat(inv["due_on"]).date() == signed + timedelta(days=180) and inv["due_days"] == 180
    assert "séquestre" in inv["payment_terms"] and "cession de fonds de commerce" in inv["lines"][0]["designation"]
    emails.clear()

    def count():
        return _invoice(client, inv["id"])["reminder_count"]

    db_call(client, closing.daily_job, NOW + timedelta(days=60))
    assert count() == 0
    db_call(client, closing.daily_job, NOW + timedelta(days=91))
    assert count() == 1 and "arrive à échéance" in last_email(seller["email"], "Rappel d'échéance")["html"]
    db_call(client, closing.daily_job, NOW + timedelta(days=121))
    assert count() == 2
    db_call(client, closing.daily_job, NOW + timedelta(days=151))
    assert count() == 3 and "Dernier rappel" in last_email(seller["email"], "Rappel d'échéance")["html"]
    assert _invoice(client, inv["id"])["formal_notice_at"] is None, "pas de mise en demeure avant l'échéance"
    db_call(client, closing.daily_job, NOW + timedelta(days=170))
    assert _invoice(client, inv["id"])["formal_notice_at"] is None
    db_call(client, closing.daily_job, NOW + timedelta(days=181))
    assert _invoice(client, inv["id"])["formal_notice_at"] and count() == 3
    assert db_call(client, server.db.todos.count_documents, {"type": "invoice_overdue", "key": inv["id"], "status": "open"}) == 1
    # PDF de l'ordre de paiement : prélèvement sur le séquestre
    r = client.get(f"/api/closing/{cid}/payment-order.pdf", headers=api.h(seller))
    assert "séquestre" in pdf_text(r.content)


# ---------- Numérotation, minimum, adresse de repli ----------

def test_numerotation_continue_et_minimum(api, client, emails):
    a = _setup(api, client, "num-a", amount=40000)
    b = _setup(api, client, "num-b", amount=1500000, address=None)
    db_call(client, server.db.users.update_one, {"id": b["seller"]["id"]}, {"$set": {"address": "5 place du Marché, 35000 Rennes"}})
    for ctx in (a, b):
        _declare(client, api, ctx, "buyer")
        assert client.post(f"/api/closing/{ctx['closing']['id']}/confirm", headers=api.h(ctx["seller"])).status_code == 200
    inv_a = _invoice(client, _closing(client, a["closing"]["id"])["invoice_id"])
    inv_b = _invoice(client, _closing(client, b["closing"]["id"])["invoice_id"])
    assert inv_b["sequence"] == inv_a["sequence"] + 1
    year = str(datetime.now(timezone.utc).year)
    assert inv_a["number"] == f"FAC-{year}-{inv_a['sequence']:05d}" and inv_b["number"] == f"FAC-{year}-{inv_b['sequence']:05d}"
    # Minimum contractuel : montant = calculate_commission, ligne d'ajustement présente
    exp_a = business_model.calculate_commission(40000)
    assert exp_a["applied_minimum"] and inv_a["total_ht"] == exp_a["final_commission_ht"]
    assert any("minimum" in line["label"] for line in inv_a["lines"])
    assert sum(line["amount_ht"] for line in inv_a["lines"]) == pytest.approx(inv_a["total_ht"], abs=0.01)
    # Au-delà d'un million : deux parts, montant = calculate_commission ; adresse de repli = profil
    exp_b = business_model.calculate_commission(1500000)
    assert inv_b["total_ht"] == exp_b["final_commission_ht"] and len([line for line in inv_b["lines"] if line.get("rate")]) == 2
    assert inv_b["debtor"]["address"] == "5 place du Marché, 35000 Rennes" and inv_b["debtor"]["address_source"] == "profil"
    # PDF des deux factures non vides, avec numéro et « Honoraires »
    for inv, ctx in ((inv_a, a), (inv_b, b)):
        r = client.get(f"/api/invoices/{inv['id']}/pdf", headers=api.h(ctx["seller"]))
        text = pdf_text(r.content)
        assert inv["number"] in text and "Honoraires" in text and eur(inv["total_ttc"]) in text
    # Sans aucune adresse : facture émise quand même + ligne « À faire »
    c = _setup(api, client, "num-c", amount=100000, address=None)
    _declare(client, api, c, "seller")
    client.post(f"/api/closing/{c['closing']['id']}/confirm", headers=api.h(c["buyer"]))
    inv_c = _invoice(client, _closing(client, c["closing"]["id"])["invoice_id"])
    assert inv_c["debtor"]["address"] == "" and inv_c["sequence"] == inv_b["sequence"] + 1
    assert db_call(client, server.db.todos.count_documents, {"type": "invoice_debtor_address", "key": inv_c["id"], "status": "open"}) == 1
    # Annulation (avec motif) : statut, ligne « À faire » close, plus dans la liste des émises
    r = client.put(f"/api/admin/invoices/{inv_c['id']}/cancel", headers=api.h(api.admin()), json={"reason": "Déclaration erronée"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["cancelled_reason"] == "Déclaration erronée"
    assert db_call(client, server.db.todos.find_one, {"type": "invoice_debtor_address", "key": inv_c["id"]})["status"] == "done"
    assert all(i["id"] != inv_c["id"] for i in client.get("/api/admin/invoices", params={"status": "issued"}, headers=api.h(api.admin())).json()["invoices"])
    assert client.put(f"/api/admin/invoices/{inv_c['id']}/paid", headers=api.h(api.admin()), json={"paid_on": day(0), "amount": 10}).status_code == 400


# ---------- Contestation ----------

def test_contestation_et_arbitrage_admin(api, client, emails):
    ctx = _setup(api, client, "conflit", amount=250000)
    cid, seller, buyer = ctx["closing"]["id"], ctx["seller"], ctx["buyer"]
    _declare(client, api, ctx, "buyer", price=250000)
    assert client.post(f"/api/closing/{cid}/dispute", headers=api.h(buyer), json={"reason": "Je me suis trompé"}).status_code == 403
    assert client.post(f"/api/closing/{cid}/dispute", headers=api.h(seller), json={"reason": "non"}).status_code == 422
    r = client.post(f"/api/closing/{cid}/dispute", headers=api.h(seller), json={"reason": "Le prix réel est de 230 000 €, acte non encore signé"})
    assert r.status_code == 200 and r.json()["status"] == "disputed" and r.json()["dispute"]["by"] == "seller"
    assert "230" in last_email(buyer["email"], "Déclaration de vente contestée")["html"]
    assert "230" in last_email(ADMIN, "Contestation d'une vente déclarée")["html"]
    todo = db_call(client, server.db.todos.find_one, {"type": "closing_disputed", "key": cid}, {"_id": 0})
    assert todo and todo["status"] == "open" and todo["action"].endswith(f"/admin/closings/{cid}/resolve")
    assert client.post(f"/api/closing/{cid}/confirm", headers=api.h(seller)).status_code == 400
    # La contestation n'est pas confirmée automatiquement
    db_call(client, closing.daily_job, NOW + timedelta(days=30))
    assert _closing(client, cid)["status"] == "disputed"
    # Admin : liste, annulation de la déclaration → retour « en cours », ligne close
    rows = client.get("/api/admin/closings", params={"status": "disputed"}, headers=api.h(api.admin())).json()["closings"]
    assert any(c["id"] == cid and "tokens" not in c for c in rows)
    r = client.put(f"/api/admin/closings/{cid}/resolve", headers=api.h(api.admin()), json={"action": "cancel", "note": "Acte non signé"})
    assert r.status_code == 200 and r.json()["status"] == "in_progress" and r.json()["declaration"] is None
    assert db_call(client, server.db.todos.find_one, {"type": "closing_disputed", "key": cid})["status"] == "done"
    assert client.put(f"/api/admin/closings/{cid}/resolve", headers=api.h(api.admin()), json={"action": "cancel"}).status_code == 400
    # Nouvelle déclaration corrigée, nouvelle contestation, l'admin confirme → facture au bon prix
    _declare(client, api, ctx, "buyer", price=230000)
    client.post(f"/api/closing/{cid}/dispute", headers=api.h(seller), json={"reason": "Toujours pas signé selon moi"})
    r = client.put(f"/api/admin/closings/{cid}/resolve", headers=api.h(api.admin()), json={"action": "confirm", "note": "Acte reçu du notaire"})
    assert r.status_code == 200 and r.json()["status"] == "confirmed" and r.json()["confirmed_by"] == "admin"
    inv = _invoice(client, r.json()["invoice"]["id"])
    assert inv["final_price"] == 230000 and inv["total_ht"] == business_model.calculate_commission(230000)["final_commission_ht"]
    assert len(_closing(client, cid)["declarations"]) == 2
    assert client.put(f"/api/admin/closings/{cid}/resolve", headers=api.h(seller), json={"action": "confirm"}).status_code == 403
    assert client.put(f"/api/admin/todos/{todo['id']}/done", headers=api.h(api.admin())).status_code == 404
    # Ligne « À faire » : marquage manuel
    extra = db_call(client, closing.add_todo, "test_type", "cle", "Ligne de test")
    assert client.put(f"/api/admin/todos/{extra['id']}/done", headers=api.h(api.admin())).json()["status"] == "done"


# ---------- Revue sécurité : déclaration unilatérale et rédacteur indiqué par le repreneur ----------

def test_declaration_du_repreneur_jamais_confirmee_automatiquement(api, client, emails):
    ctx = _setup(api, client, "unilat", amount=300000)
    cid = ctx["closing"]["id"]
    _declare(client, api, ctx, "buyer", price=2000000)
    e = last_email(ctx["seller"]["email"], "Vente déclarée par le repreneur")
    assert e and "Rien n'est facturé" in e["html"]
    db_call(client, closing.daily_job, NOW + timedelta(days=8))
    c = _closing(client, cid)
    assert c["status"] == "declared" and not c.get("invoice_id")
    assert db_call(client, server.db.invoices.count_documents, {"closing_id": cid}) == 0
    assert db_call(client, server.db.companies.find_one, {"id": ctx["company"]["id"]})["status"] == "published"
    todo = db_call(client, server.db.todos.find_one, {"type": closing.TODO_DECLARATION_UNCONFIRMED, "key": cid, "status": "open"})
    assert todo, "arbitrage admin à l'échéance"
    # Le cédant confirme explicitement : facture, ligne « À faire » close
    assert client.post(f"/api/closing/{cid}/confirm", headers=api.h(ctx["seller"])).status_code == 200
    assert db_call(client, server.db.todos.find_one, {"id": todo["id"]})["status"] != "open"


def test_repreneur_ne_declare_pas_une_vente_abandonnee(api, client):
    ctx = _setup(api, client, "aband")
    cid = ctx["closing"]["id"]
    db_call(client, server.db.closings.update_one, {"id": cid}, {"$set": {"status": "abandoned"}})
    r = client.post(f"/api/closing/{cid}/declare", headers=api.h(ctx["buyer"]),
                    json={"signed_on": day(-1), "final_price": 300000, "sale_object": "titres"})
    assert r.status_code == 400
    _declare(client, api, ctx, "seller", price=300000)


def test_ordre_de_paiement_pas_envoye_au_redacteur_du_repreneur(api, client, emails):
    ctx = _setup(api, client, "redac", amount=300000)
    cid = ctx["closing"]["id"]
    r = client.put(f"/api/closing/{cid}/redacteur", headers=api.h(ctx["buyer"]),
                   json={"type": "avocat", "name": "Maître Faux", "email": "complice@exemple.test"})
    assert r.status_code == 200
    _declare(client, api, ctx, "seller", price=300000)
    assert client.post(f"/api/closing/{cid}/confirm", headers=api.h(ctx["buyer"])).status_code == 200
    assert last_email("complice@exemple.test", "Ordre de paiement") is None
    assert not _closing(client, cid).get("payment_order_sent_at")
    assert db_call(client, server.db.todos.find_one, {"type": closing.TODO_PAYMENT_ORDER, "key": cid, "status": "open"})
    inv_mail = last_email(ctx["seller"]["email"], "Votre facture")
    assert inv_mail and "indiqué par le repreneur" in inv_mail["html"]
    # Le repreneur ne peut plus modifier le rédacteur ; le cédant le confirme : l'ordre de paiement part
    assert client.put(f"/api/closing/{cid}/redacteur", headers=api.h(ctx["buyer"]),
                      json={"type": "avocat", "name": "Maître Faux", "email": "complice@exemple.test"}).status_code == 400
    r = client.put(f"/api/closing/{cid}/redacteur", headers=api.h(ctx["seller"]),
                   json={"type": "avocat", "name": "Maître Durand", "email": "durand@avocats.test"})
    assert r.status_code == 200, r.text
    assert last_email("durand@avocats.test", "Ordre de paiement")
    assert _closing(client, cid)["payment_order_sent_to"] == "durand@avocats.test"
    assert not db_call(client, server.db.todos.find_one, {"type": closing.TODO_PAYMENT_ORDER, "key": cid, "status": "open"})
    # Ordre envoyé : le rédacteur n'est plus modifiable
    assert client.put(f"/api/closing/{cid}/redacteur", headers=api.h(ctx["seller"]),
                      json={"type": "avocat", "name": "Autre", "email": "autre@avocats.test"}).status_code == 400
