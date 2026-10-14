"""Revue « argent » de la vague 3 : mandat (dénonciation puis nouveau mandat, clause de suite, remise en ligne, numéro de
registre), offres (preuve de la contre-proposition, validité à compter de la signature), factures (acompte, avoir et
réémission, échéance comptée depuis l'acte), contestation d'une déclaration de vente."""
import base64
from datetime import datetime, timedelta, timezone

import business_model
import closing
import server
from conftest import last_email
from test_closing import _closing, _declare, _invoice, _setup, day, pdf_text
from test_contrats_v2 import OFFER, db_call, iso, presented_buyer, published, run_jobs, signed_mandate

NOW = datetime.now(timezone.utc)


def _mandate(client, contract_id):
    return db_call(client, server.db.generated_contracts.find_one, {"id": contract_id}, {"_id": 0})


def _company(client, company_id):
    return db_call(client, server.db.companies.find_one, {"id": company_id}, {"_id": 0})


# ---------- Mandat : dénonciation puis nouveau mandat pendant le préavis (contrats-argent-01) ----------

def test_nouveau_mandat_pendant_le_preavis_garde_l_annonce_en_ligne(api, client, emails):
    seller, c, m, signed = signed_mandate(api, client)
    assert client.post(f"/api/seller/mandat/{m['contract_id']}/denounce", headers=api.h(seller)).status_code == 200
    # Le cédant change d'avis pendant le préavis : nouveau mandat signé
    m2 = api.mandate(seller, c["id"])
    assert m2["already_signed"] is False and m2["contract_id"] != m["contract_id"]
    r2 = api.sign_mandate(seller, m2["contract_id"])
    assert r2.status_code == 200, r2.text
    company = _company(client, c["id"])
    assert company["status"] == "published" and company["mandate_id"] == m2["contract_id"] and company["mandat_signed"] is True
    assert _mandate(client, m["contract_id"])["superseded_by"] == m2["contract_id"]
    # Date d'effet de la première dénonciation atteinte : l'annonce reste en ligne, aucun e-mail « fin de mandat »
    db_call(client, server.db.generated_contracts.update_one, {"id": m["contract_id"]}, {"$set": {"effective_at": iso(-1)}})
    emails.clear()
    assert run_jobs(api, client)["daily:mandate_denounce_effective"] == 0
    company = _company(client, c["id"])
    assert company["status"] == "published" and company["mandat_signed"] is True
    assert not last_email(seller["email"], "Fin de votre mandat")
    assert client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()["mandat_signed"] is True
    # Garde-fou : même appelée directement, la fin d'un mandat qui ne couvre plus l'annonce ne la dépublie pas
    db_call(client, server.end_mandate, _mandate(client, m["contract_id"]), "test", "withdrawn", NOW)
    assert _company(client, c["id"])["status"] == "published" and not last_email(seller["email"], "Fin de votre mandat")


# ---------- Clause de suite recalculée à la dénonciation et à la caducité (contrats-argent-02) ----------

def test_clause_de_suite_comptee_depuis_la_fin_effective(api, client, emails):
    seller, c, m, signed = signed_mandate(api, client)
    presented_buyer(api, client, seller, c["id"])
    r = client.post(f"/api/seller/mandat/{m['contract_id']}/denounce", headers=api.h(seller))
    assert r.status_code == 200, r.text
    effective = datetime.fromisoformat(r.json()["effective_at"])
    expected_tail = server.add_months(effective, server.MANDATE_TAIL_MONTHS)
    assert datetime.fromisoformat(r.json()["tail_ends_at"]) == expected_tail
    assert expected_tail < datetime.fromisoformat(signed["tail_ends_at"]), "la clause de suite ne court plus depuis l'échéance initiale"
    status = client.get(f"/api/seller/mandat/status/{c['id']}", headers=api.h(seller)).json()
    assert datetime.fromisoformat(status["mandat"]["tail_ends_at"]) == expected_tail
    assert datetime.fromisoformat(_company(client, c["id"])["mandate_tail_ends_at"]) == expected_tail
    # E-mail de fin de mandat à la date d'effet : clause de suite = effet + 18 mois
    db_call(client, server.db.generated_contracts.update_one, {"id": m["contract_id"]}, {"$set": {"effective_at": iso(-1)}})
    emails.clear()
    run_jobs(api, client)
    mail = last_email(seller["email"], "Fin de votre mandat")
    assert mail and server.fmt_date_fr(expected_tail) in mail["html"]
    assert server.fmt_date_fr(signed["tail_ends_at"]) not in mail["html"]


def test_clause_de_suite_du_mandat_caduc(api, client):
    seller, c, m, signed = signed_mandate(api, client)
    r = client.put(f"/api/companies/{c['id']}/status", params={"status": "removed", "reason": "coordonnees"}, headers=api.h(api.admin()))
    assert r.status_code == 200
    mandat = _mandate(client, m["contract_id"])
    tail = datetime.fromisoformat(mandat["tail_ends_at"])
    void_at = datetime.fromisoformat(mandat["void_at"])
    assert mandat["status"] == "void" and tail == server.add_months(void_at, server.MANDATE_TAIL_MONTHS)
    assert _company(client, c["id"])["mandate_tail_ends_at"] == mandat["tail_ends_at"]


# ---------- Nouveau mandat après une dénonciation effective : remise en ligne (contrats-argent-06) ----------

def test_nouveau_mandat_apres_denonciation_effective_republie(api, client, emails):
    seller, c, m, signed = signed_mandate(api, client)
    client.post(f"/api/seller/mandat/{m['contract_id']}/denounce", headers=api.h(seller))
    db_call(client, server.db.generated_contracts.update_one, {"id": m["contract_id"]}, {"$set": {"effective_at": iso(-1)}})
    assert run_jobs(api, client)["daily:mandate_denounce_effective"] == 1
    company = _company(client, c["id"])
    assert company["status"] == "withdrawn" and company["withdrawn_reason"] == "mandate_ended"
    m2 = api.mandate(seller, c["id"])
    r = api.sign_mandate(seller, m2["contract_id"])
    assert r.status_code == 200 and r.json()["listing_status"] == "published"
    assert _company(client, c["id"])["status"] == "published"
    assert client.get(f"/api/companies/{c['id']}").status_code == 200


def test_retrait_volontaire_pas_republie_par_un_nouveau_mandat(api, client):
    seller, c, m, signed = signed_mandate(api, client)
    assert client.put(f"/api/companies/{c['id']}/status", params={"status": "withdrawn"}, headers=api.h(seller)).status_code == 200
    db_call(client, server.db.generated_contracts.update_one, {"id": m["contract_id"]}, {"$set": {"ends_at": iso(-1)}})
    run_jobs(api, client)
    assert _company(client, c["id"])["withdrawn_reason"] == "cedant"
    m2 = api.mandate(seller, c["id"])
    assert api.sign_mandate(seller, m2["contract_id"]).json()["listing_status"] == "withdrawn"


# ---------- Numéro de registre dans le texte signé (contrats-argent-10, juridique-05) ----------

def test_numero_de_registre_sans_doublon(api, client):
    seller, c, m, signed = signed_mandate(api, client)
    n = signed["registry_number"]
    content = _mandate(client, m["contract_id"])["content"]
    assert f"sous le numéro {n}." in content and f"registre n° {n} —" in content
    assert f"Numéro d'inscription au registre des mandats : {n}" in content
    assert "n° n°" not in content and "numéro n°" not in content


# ---------- Offre : preuve de la contre-proposition (contrats-argent-08) ----------

def test_contre_proposition_avec_dossier_de_preuve_du_cedant(api, client, emails):
    seller, c = published(api, client)
    buyer = presented_buyer(api, client, seller, c["id"])
    created = client.post("/api/offers", headers=api.h(buyer), json={"company_id": c["id"], **OFFER}).json()
    offer, contract_id = created["offer"], created["contract_id"]
    api.sign_contract(buyer, contract_id)
    r = client.put(f"/api/offers/{offer['id']}/respond", headers={**api.h(seller), "User-Agent": "NavigateurCedant/1.0"},
                   json={"action": "counter", "counter_amount": 520000})
    assert r.status_code == 200, r.text
    record = db_call(client, server.db.documents.find_one, {"contract_id": contract_id, "doc_type": "offer_counter_proposal"}, {"_id": 0})
    assert record and record["signer_id"] == seller["id"] and record["signer_role"] == "seller"
    assert record["evidence"]["user_agent"] == "NavigateurCedant/1.0" and record["evidence"]["method"] == "authenticated_session"
    assert record["evidence"]["document_sha256"] == server.hashlib.sha256(record["addendum"].encode()).hexdigest()
    assert db_call(client, server.db.offers.find_one, {"id": offer["id"]})["counter"]["record_id"] == record["id"]
    code = api.request_code(buyer, contract_id)
    assert client.put(f"/api/offers/{offer['id']}/accept-counter", headers=api.h(buyer), json={"otp_code": code}).status_code == 200
    contract = _mandate(client, contract_id)
    assert contract["status"] == "fully_signed" and contract["countersignature_record_id"] == record["id"]
    text = pdf_text(base64.b64decode(client.get(f"/api/offers/{offer['id']}/pdf", headers=api.h(seller)).json()["content"]))
    assert "contre-proposition du cédant" in text and "Paul Dupont" in text


# ---------- Offre : validité à compter de la signature (contrats-argent-09) ----------

def test_validite_de_l_offre_comptee_depuis_la_signature(api, client):
    seller, c = published(api, client)
    buyer = presented_buyer(api, client, seller, c["id"])
    created = client.post("/api/offers", headers=api.h(buyer), json={"company_id": c["id"], **OFFER}).json()
    offer, contract_id = created["offer"], created["contract_id"]
    # Offre déposée il y a 5 jours (échéance initiale : dépôt + 30 j), signée aujourd'hui
    old_expiry = datetime.fromisoformat(offer["expires_at"])
    shifted = old_expiry - timedelta(days=5)
    contract = _mandate(client, contract_id)
    content = contract["content"].replace(f"soit jusqu'au {server.fmt_date_fr(old_expiry)}", f"soit jusqu'au {server.fmt_date_fr(shifted)}")
    db_call(client, server.db.generated_contracts.update_one, {"id": contract_id}, {"$set": {"content": content}})
    db_call(client, server.db.offers.update_one, {"id": offer["id"]}, {"$set": {"expires_at": shifted.isoformat()}})
    assert api.sign_contract(buyer, contract_id).json()["status"] == "pending"
    signed_offer = db_call(client, server.db.offers.find_one, {"id": offer["id"]}, {"_id": 0})
    expires = datetime.fromisoformat(signed_offer["expires_at"])
    signed_at = datetime.fromisoformat(signed_offer["signed_at"])
    assert expires == signed_at + timedelta(days=OFFER["validity_days"])
    signed_text = _mandate(client, contract_id)["content"]
    assert f"soit jusqu'au {server.fmt_date_fr(expires)}" in signed_text
    assert f"soit jusqu'au {server.fmt_date_fr(shifted)}" not in signed_text


# ---------- Facture : acompte (contrats-argent-03) ----------

def test_paiement_partiel_ne_solde_pas_la_facture(api, client, emails):
    ctx = _setup(api, client, "acompte", amount=600000)
    cid, seller = ctx["closing"]["id"], ctx["seller"]
    _declare(client, api, ctx, "seller", price=600000)
    client.post(f"/api/closing/{cid}/confirm", headers=api.h(ctx["buyer"]))
    inv = _invoice(client, _closing(client, cid)["invoice_id"])
    admin = api.h(api.admin())
    r = client.put(f"/api/admin/invoices/{inv['id']}/paid", headers=admin, json={"paid_on": day(0), "amount": 100})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "issued" and body["paid_amount"] == 100 and body["balance_due"] == round(inv["total_ttc"] - 100, 2)
    assert last_email(seller["email"], f"Acompte reçu : facture n° {inv['number']}")
    assert not last_email(seller["email"], "Paiement reçu")
    text = pdf_text(client.get(f"/api/invoices/{inv['id']}/pdf", headers=api.h(seller)).content)
    assert "acquittée" not in text and "Reste dû" in text
    # Montant supérieur au solde refusé
    assert client.put(f"/api/admin/invoices/{inv['id']}/paid", headers=admin,
                      json={"paid_on": day(0), "amount": inv["total_ttc"]}).status_code == 400
    # Les relances et la mise en demeure continuent sur le solde
    for days in (16, 31, 46):
        db_call(client, closing.daily_job, NOW + timedelta(days=days))
    after = _invoice(client, inv["id"])
    assert after["reminder_count"] == 3 and after["formal_notice_at"]
    assert closing.fmt_eur_cents(after["balance_due"]) in last_email(seller["email"], "Facture en retard")["html"]
    r = client.get(f"/api/admin/invoices/{inv['id']}/mise-en-demeure.pdf", headers=admin)
    assert r.status_code == 200 and closing.fmt_eur_cents(after["balance_due"]).replace("\xa0", " ") in pdf_text(r.content)
    # Suivi des impayés : le retard porte sur le solde, pas sur le total
    db_call(client, server.db.invoices.update_one, {"id": inv["id"]}, {"$set": {"due_on": day(-1)}})
    overdue = client.get("/api/admin/invoices", params={"status": "overdue"}, headers=admin).json()
    row = next(i for i in overdue["invoices"] if i["id"] == inv["id"])
    assert row["overdue"] and overdue["totals"]["overdue_ttc"] >= after["balance_due"]
    assert overdue["totals"]["overdue_ttc"] == round(sum(closing.invoice_balance(i) for i in overdue["invoices"]), 2)
    # Solde : facture payée, acquittée, plus de second marquage
    r = client.put(f"/api/admin/invoices/{inv['id']}/paid", headers=admin, json={"paid_on": day(0), "amount": after["balance_due"]})
    assert r.status_code == 200 and r.json()["status"] == "paid" and r.json()["paid_amount"] == inv["total_ttc"]
    assert len(r.json()["payments"]) == 2
    assert client.put(f"/api/admin/invoices/{inv['id']}/paid", headers=admin, json={"paid_on": day(0), "amount": 1}).status_code == 400
    assert "acquittée" in pdf_text(client.get(f"/api/invoices/{inv['id']}/pdf", headers=api.h(seller)).content)


# ---------- Contestation : pas de redéclaration par la partie contestée (contrats-argent-04) ----------

def test_redeclaration_apres_contestation(api, client, emails):
    ctx = _setup(api, client, "redecl", amount=300000)
    cid, seller, buyer = ctx["closing"]["id"], ctx["seller"], ctx["buyer"]
    _declare(client, api, ctx, "seller", price=200000)
    assert client.post(f"/api/closing/{cid}/dispute", headers=api.h(buyer), json={"reason": "Le prix signé est de 300 000 €"}).status_code == 200
    # Le déclarant contesté ne peut pas effacer la contestation
    r = client.post(f"/api/closing/{cid}/declare", headers=api.h(seller),
                    json={"signed_on": day(-2), "final_price": 200000, "sale_object": "titres"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "disputed"
    c = _closing(client, cid)
    assert c["status"] == "disputed" and c["dispute"]["by"] == "buyer"
    assert db_call(client, server.db.todos.count_documents, {"type": "closing_disputed", "key": cid, "status": "open"}) == 1
    db_call(client, closing.daily_job, NOW + timedelta(days=8))
    assert _closing(client, cid)["status"] == "disputed" and not _closing(client, cid).get("invoice_id")
    # La partie qui a contesté peut déclarer sa version : historique conservé, ligne « À faire » toujours ouverte
    _declare(client, api, ctx, "buyer", price=300000)
    c = _closing(client, cid)
    assert c["status"] == "declared" and c["disputes"][0]["by"] == "buyer"
    assert db_call(client, server.db.todos.count_documents, {"type": "closing_disputed", "key": cid, "status": "open"}) == 1
    # L'admin peut toujours trancher
    r = client.put(f"/api/admin/closings/{cid}/resolve", headers=api.h(api.admin()), json={"action": "confirm"})
    assert r.status_code == 200 and _invoice(client, r.json()["invoice"]["id"])["final_price"] == 300000


# ---------- Facture annulée : avoir puis facture corrigée (contrats-argent-05) ----------

def test_annulation_avoir_et_reemission(api, client, emails):
    ctx = _setup(api, client, "avoir", amount=400000)
    cid, seller = ctx["closing"]["id"], ctx["seller"]
    admin = api.h(api.admin())
    _declare(client, api, ctx, "seller", price=400000)
    client.post(f"/api/closing/{cid}/confirm", headers=api.h(ctx["buyer"]))
    inv = _invoice(client, _closing(client, cid)["invoice_id"])
    r = client.put(f"/api/admin/invoices/{inv['id']}/cancel", headers=admin, json={"reason": "Prix erroné"})
    assert r.status_code == 200, r.text
    credit = r.json()["credit_note"]
    assert credit["number"].startswith("AV-") and credit["total_ttc"] == -inv["total_ttc"]
    assert client.put(f"/api/admin/invoices/{inv['id']}/cancel", headers=admin, json={"reason": "bis"}).status_code == 400
    mail = last_email(seller["email"], f"Facture n° {inv['number']} annulée")
    assert mail and credit["number"] in mail["html"] and "/avoir.pdf?token=" in mail["html"]
    pdf = client.get(f"/api/invoices/{inv['id']}/avoir.pdf", headers=api.h(seller))
    assert pdf.status_code == 200 and f"AVOIR n° {credit['number']}" in pdf_text(pdf.content) and inv["number"] in pdf_text(pdf.content)
    assert client.get(f"/api/invoices/{inv['id']}/avoir.pdf", headers=api.h(ctx["buyer"])).status_code == 403
    c = _closing(client, cid)
    assert not c.get("invoice_id") and c["invoice_history"][0]["invoice_id"] == inv["id"] and c["status"] == "confirmed"
    # issue_invoice ne renvoie plus la facture annulée
    assert db_call(client, closing.issue_invoice, {**c, "invoice_id": inv["id"]})["id"] != inv["id"]
    reissued = _invoice(client, _closing(client, cid)["invoice_id"])
    assert reissued["sequence"] > inv["sequence"]
    # Correction de la déclaration par l'admin : refusée tant qu'une facture est active, puis nouvelle facture au bon prix
    payload = {"signed_on": day(-3), "final_price": 350000, "sale_object": "titres", "note": "Prix de l'acte"}
    assert client.put(f"/api/admin/closings/{cid}/declaration", headers=admin, json=payload).status_code == 400
    client.put(f"/api/admin/invoices/{reissued['id']}/cancel", headers=admin, json={"reason": "Prix erroné"})
    assert client.put(f"/api/admin/closings/{cid}/declaration", headers=api.h(seller), json=payload).status_code == 403
    r = client.put(f"/api/admin/closings/{cid}/declaration", headers=admin, json=payload)
    assert r.status_code == 200, r.text
    fixed = _invoice(client, r.json()["invoice"]["id"])
    assert fixed["sequence"] > reissued["sequence"] and fixed["final_price"] == 350000 and fixed["status"] == "issued"
    assert fixed["total_ht"] == business_model.calculate_commission(350000)["final_commission_ht"]
    assert len(_closing(client, cid)["invoice_history"]) == 2


# ---------- Échéance de la facture depuis l'acte (contrats-argent-07) ----------

def test_echeance_comptee_depuis_l_acte(api, client, emails):
    recent = _setup(api, client, "ech-recent", amount=300000)
    _declare(client, api, recent, "seller", signed_days_ago=2)
    client.post(f"/api/closing/{recent['closing']['id']}/confirm", headers=api.h(recent["buyer"]))
    inv = _invoice(client, _closing(client, recent["closing"]["id"])["invoice_id"])
    assert inv["due_on"] == (datetime.fromisoformat(inv["signed_on"]).date() + timedelta(days=30)).isoformat()
    assert "signature de l'acte" in inv["payment_terms"]
    late = _setup(api, client, "ech-tardif", amount=300000)
    _declare(client, api, late, "seller", signed_days_ago=60)
    client.post(f"/api/closing/{late['closing']['id']}/confirm", headers=api.h(late["buyer"]))
    inv = _invoice(client, _closing(client, late["closing"]["id"])["invoice_id"])
    issued = datetime.fromisoformat(inv["issued_on"]).date()
    assert inv["due_on"] == (issued + timedelta(days=closing.INVOICE_MIN_DELAY_DAYS)).isoformat(), "délai minimal après la facture"
    # Relances rapprochées de l'échéance : 15 j (échéance), 30 j, 45 j puis mise en demeure
    db_call(client, closing.daily_job, NOW + timedelta(days=16))
    assert _invoice(client, inv["id"])["reminder_count"] == 1
    db_call(client, closing.daily_job, NOW + timedelta(days=31))
    db_call(client, closing.daily_job, NOW + timedelta(days=46))
    assert _invoice(client, inv["id"])["reminder_count"] == 3 and _invoice(client, inv["id"])["formal_notice_at"]
    fonds = _setup(api, client, "ech-fonds", amount=300000, sale_object="fonds")
    _declare(client, api, fonds, "seller", sale_object="fonds", signed_days_ago=10)
    client.post(f"/api/closing/{fonds['closing']['id']}/confirm", headers=api.h(fonds["buyer"]))
    inv = _invoice(client, _closing(client, fonds["closing"]["id"])["invoice_id"])
    assert inv["due_on"] == (datetime.fromisoformat(inv["signed_on"]).date() + timedelta(days=180)).isoformat()
