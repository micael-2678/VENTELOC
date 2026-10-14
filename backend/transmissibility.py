"""
Diagnostic de transmissibilité des qualifications (SPEC §4.6), gratuit.

Règles françaises de transfert des qualifications RGE (Qualibat, Qualit'EnR — QualiPAC, QualiPV, Qualibois,
Qualisol —, Qualifelec, Certibat, RGE Études), référent technique, assurance décennale, chantiers aidés en cours
et réforme 2026-2027, sous forme de constantes en français rendues par le front.

- build_diagnostic(property_or_qualifications, with_financials=False) : diagnostic à partir d'une liste de
  qualifications (ADEME) ou d'une annonce (`property`, avec ses réponses « ce qui rassure un repreneur »).
- GET /rge/property/{siret}/transmissibility : version courte publique (ADEME, sans données financières).
- GET /properties/{property_id}/transmissibility : version complète pour le cédant, l'admin et les repreneurs
  dont l'accès à la data room est accordé.

Sources : règlement général Qualibat (vente / changement de majorité, retour du certificat), Qualit'EnR
DG-APP-12 §2.6 (référent technique, 6 mois), Qualibat doc 005 v12 (QCM du nouveau référent), OPQTECC
(instruction partielle sous un mois), arrêté du 23 juin 2026 (audits, VAE au 1er mars 2027), loi 2025-594 et décret
2026-774 (entreprise RGE-facturante au 1er janvier 2027), Code des assurances L241-1 et L113-2.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request

import server
from events import SlidingWindowLimiter, check_rate_limit
from server import db, get_current_user, is_property_owner

logger = logging.getLogger("transmissibility")
router = APIRouter()
# Limite publique : 30 diagnostics par minute et par adresse IP (l'ADEME répond en quelques secondes)
public_limiter = SlidingWindowLimiter(30, 60)

EXPIRY_WARNING_DAYS = 180          # qualification « expire bientôt » à moins de 6 mois
REFERENT_DEADLINE_MONTHS = 6       # délai Qualit'EnR pour déclarer un nouveau référent technique
NDA_ACCESS_STATUSES = ("granted",)

# ----------------------------------------------------------------------------------------------
# Constantes : règles par organisme (textes affichés tels quels)

ORGANISMES: Dict[str, Dict[str, Any]] = {
    "qualibat": {
        "label": "Qualibat",
        "site": "https://www.qualibat.com",
        "qualifications": ["Qualibat RGE (isolation, menuiseries, chauffage, rénovation globale…)", "Qualibat"],
        "titres": [
            "La qualification est délivrée à la société (SIREN) : elle reste attachée à la société après une cession de parts ou d'actions.",
            "Informer Qualibat du changement de majorité et lui transmettre le certificat ; en cas de changement de dirigeant, "
            "fournir le CV et les justificatifs du nouveau responsable légal.",
            "Si le référent technique change, le nouveau référent justifie du QCM RGE transversal et du QCM spécifique "
            "au domaine (doc. Qualibat 005) ; l'instruction est partielle, sans nouvel audit complet.",
        ],
        "fonds": [
            "La qualification ne se transmet pas avec le fonds : l'entreprise cédante signale la cession à Qualibat et "
            "retourne son certificat.",
            "Le repreneur (nouveau SIREN) dépose sa propre demande : formation ou QCM du référent, dossier administratif, "
            "références de chantiers, audit sur chantier dans les 24 mois.",
            "Une location-gérance en attendant la vente du fonds est possible sur production du contrat.",
        ],
        "delai_fonds": "Quelques semaines si le dossier est complet, deux à six mois en pratique.",
        "referent": "Un référent technique par domaine, salarié ou dirigeant, titulaire du QCM RGE.",
    },
    "qualit-enr": {
        "label": "Qualit'EnR",
        "site": "https://www.qualit-enr.org",
        "qualifications": ["QualiPAC", "QualiPV", "Qualibois", "Qualisol", "Qualiforage", "Chauffage+"],
        "titres": [
            "La qualification (QualiPAC, QualiPV, Qualibois, Qualisol) est attachée au SIREN : elle suit la société lors "
            "d'une cession de titres, après notification à Qualit'EnR.",
            "Si le référent technique quitte l'entreprise, vous disposez de six mois pour déclarer un nouveau référent formé "
            "et validé (règlement d'usage DG-APP-12 §2.6).",
            "Un référent ne peut l'être que pour une seule entreprise ; Qualit'EnR peut transférer un référent d'une "
            "entreprise à une autre sur demande.",
        ],
        "fonds": [
            "Le repreneur, nouvelle personne morale, dépose une nouvelle demande de qualification : formation agréée du "
            "référent, dossier, puis audit de chantier.",
            "Pendant l'instruction, l'entreprise repreneuse ne peut pas signer de devis aidés (MaPrimeRénov', CEE).",
        ],
        "delai_fonds": "Trois à six mois (formation, dossier, audit).",
        "referent": "Un référent technique formé par un organisme agréé, dédié à une seule entreprise.",
    },
    "qualifelec": {
        "label": "Qualifelec",
        "site": "https://www.qualifelec.fr",
        "qualifications": ["Qualifelec RGE (électricité, PV, bornes de recharge)", "Qualifelec"],
        "titres": [
            "La qualification est délivrée à l'entreprise : elle est conservée en cession de titres, à condition de "
            "déclarer le changement de direction ou d'actionnariat à Qualifelec.",
            "Le responsable technique (indice RGE) doit rester en place ou être remplacé par une personne formée ; le "
            "remplacement est instruit sur dossier.",
        ],
        "fonds": [
            "Le repreneur dépose sa propre demande de qualification (compétences du responsable technique, moyens, "
            "références, audit).",
        ],
        "delai_fonds": "Deux à quatre mois selon le dossier.",
        "referent": "Un responsable technique formé (mention RGE) rattaché à l'entreprise.",
    },
    "certibat": {
        "label": "Certibat",
        "site": "https://www.certibat.fr",
        "qualifications": ["Certibat Offre globale rénovation énergétique", "Certibat"],
        "titres": [
            "La certification est attachée à la société : elle est maintenue en cession de titres, après information de "
            "Certibat (changement de majorité ou de dirigeant).",
            "Le référent de l'offre globale doit être maintenu ou remplacé par une personne formée.",
        ],
        "fonds": [
            "Certification non transmissible avec le fonds : nouvelle demande du repreneur, avec audit.",
        ],
        "delai_fonds": "Deux à six mois.",
        "referent": "Un référent de l'offre globale formé à la rénovation énergétique.",
    },
    "rge-etudes": {
        "label": "RGE Études (OPQIBI, OPQTECC, I.Cert, LNE)",
        "site": "https://www.opqibi.com",
        "qualifications": ["RGE Études (audit énergétique, maîtrise d'œuvre)", "OPQIBI", "OPQTECC", "I.Cert", "LNE"],
        "titres": [
            "La qualification est attachée à la structure : elle est conservée en cession de titres, après déclaration du "
            "changement de direction à l'organisme.",
            "Un changement de référent est traité par instruction partielle, décision sous un mois environ (OPQTECC).",
        ],
        "fonds": [
            "Le repreneur dépose une nouvelle demande (compétences des référents, références d'études, moyens).",
        ],
        "delai_fonds": "Un à trois mois.",
        "referent": "Un référent technique diplômé ou expérimenté, par domaine d'études.",
    },
    "autre": {
        "label": "Organisme de qualification",
        "site": "",
        "qualifications": [],
        "titres": [
            "Les qualifications RGE sont délivrées à la personne morale : en cession de titres, elles restent attachées à "
            "la société, l'organisme devant être informé du changement de majorité ou de dirigeant.",
            "Le référent technique doit rester dans l'entreprise ou être remplacé par une personne formée dans le délai "
            "fixé par l'organisme (six mois en général).",
        ],
        "fonds": [
            "En cession de fonds, le repreneur (nouveau SIREN) doit déposer sa propre demande de qualification ; les "
            "qualifications ne se transmettent pas avec le fonds.",
        ],
        "delai_fonds": "Deux à six mois selon l'organisme.",
        "referent": "Un référent technique formé, rattaché à l'entreprise.",
    },
}

# Mots-clés (sans accents, minuscules) → organisme
_ORGANISME_KEYWORDS = (
    ("qualit'enr", "qualit-enr"), ("qualit enr", "qualit-enr"), ("qualitenr", "qualit-enr"), ("qualipac", "qualit-enr"),
    ("qualipv", "qualit-enr"), ("qualibois", "qualit-enr"), ("qualisol", "qualit-enr"), ("qualiforage", "qualit-enr"),
    ("chauffage+", "qualit-enr"),
    ("certibat", "certibat"),
    ("qualifelec", "qualifelec"),
    ("opqibi", "rge-etudes"), ("opqtecc", "rge-etudes"), ("i.cert", "rge-etudes"), ("icert", "rge-etudes"),
    ("lne", "rge-etudes"), ("afnor", "rge-etudes"), ("certivea", "rge-etudes"), ("etudes", "rge-etudes"),
    ("qualibat", "qualibat"),
)

# Identifiants déclaratifs (taxonomy.OTHER_QUALIFICATIONS) → organisme
_DECLARED_ORGANISME = {"qualibat": "qualibat", "qualifelec": "qualifelec", "qualit-enr": "qualit-enr",
                       "certibat": "certibat"}

REFERENT = {
    "label": "Référent technique RGE",
    "text": "Chaque qualification RGE repose sur un référent technique nommément désigné (dirigeant ou salarié) qui a "
            "réussi le QCM ou la formation agréée. S'il part avec le cédant, l'organisme laisse en général six mois pour "
            "déclarer un nouveau référent formé ; passé ce délai, la qualification est suspendue puis retirée.",
    "deadline_months": REFERENT_DEADLINE_MONTHS,
    "steps": [
        "Identifier le référent de chaque qualification (nom, fonction, date du QCM ou de la formation).",
        "S'il reste : le mentionner dans l'acte de cession (clause de maintien, durée d'accompagnement).",
        "S'il part : former un salarié ou le repreneur avant la cession, ou prévoir une période de transition avec le "
        "cédant (accompagnement de trois à six mois) pour conserver la qualification.",
        "Déclarer le nouveau référent à l'organisme dès la cession (délai de six mois chez Qualit'EnR).",
    ],
}

DECENNALE = {
    "label": "Assurance décennale",
    "titres": "Le contrat est souscrit par la société : il continue après la cession des titres. Déclarez à l'assureur le "
              "changement de dirigeant et d'actionnariat (art. L113-2 du Code des assurances), vérifiez que les activités "
              "déclarées couvrent celles que le repreneur exercera et demandez le relevé de sinistralité.",
    "fonds": "La police ne se transmet pas avec le fonds : le repreneur souscrit sa propre décennale avant d'ouvrir le "
             "moindre chantier (art. L241-1 du Code des assurances, attestation à remettre aux clients). Les chantiers "
             "ouverts avant la cession restent couverts par la police du cédant, qui conserve sa responsabilité décennale "
             "dix ans après chaque réception.",
    "steps": [
        "Attestation d'assurance en cours de validité, avec la liste des activités couvertes.",
        "Relevé de sinistralité des cinq dernières années.",
        "Liste des chantiers en cours et des réceptions récentes (point de départ des garanties).",
    ],
}

AIDES = {
    "label": "Chantiers aidés en cours (MaPrimeRénov', CEE, éco-PTZ)",
    "text": "Les aides exigent que l'entreprise soit RGE à la date de l'attestation de fin de travaux. Un dossier dont "
            "l'entreprise perd le RGE avant la fin est rejeté. Terminez et facturez les chantiers aidés en cours avant une "
            "cession de fonds, ou prévoyez une transition pendant laquelle le cédant reste dans l'entreprise.",
}

REFORME = [
    {"label": "Entreprise RGE-facturante au 1er janvier 2027",
     "text": "Loi 2025-594 et décret 2026-774 : l'entreprise qui commercialise et facture des travaux aidés doit être "
             "elle-même RGE ; la sous-traitance est limitée à deux rangs. Une structure commerciale ne peut plus "
             "s'appuyer sur un sous-traitant RGE : c'est un argument pour une cession de titres qui conserve le label."},
    {"label": "Contrôles renforcés",
     "text": "Arrêté du 23 juin 2026 : audits aléatoires et contrôles inopinés, suspension jusqu'à 24 mois et retrait "
             "après deux contrôles non conformes. Un historique d'audits propre est une pièce du dossier de cession."},
    {"label": "Voie de l'expérience (VAE) à partir du 1er mars 2027",
     "text": "Un artisan expérimenté pourra se qualifier sur trois chantiers audités conformes. Le référent technique "
             "reste indispensable pour un repreneur sans expérience du métier ou pour une structure commerciale."},
]

TRANSFER = {
    "titres": {
        "label": "Cession de titres (parts ou actions)",
        "summary": "La société reste la même personne morale : les qualifications, l'assurance, les contrats et les "
                   "chantiers en cours suivent la société. Les organismes doivent être informés et le référent technique "
                   "conservé ou remplacé dans le délai.",
    },
    "fonds": {
        "label": "Cession du fonds de commerce",
        "summary": "Le repreneur exploite sous un nouveau SIREN : les qualifications ne se transmettent pas, il dépose "
                   "ses propres demandes (deux à six mois) et souscrit sa propre décennale ; les chantiers aidés doivent "
                   "être terminés par le cédant ou faire l'objet d'une transition.",
    },
    "recommendation": "Pour conserver les qualifications RGE, privilégiez la cession de titres avec maintien ou "
                      "remplacement du référent technique ; en cession de fonds, prévoyez une location-gérance ou une "
                      "période de transition pendant l'instruction des nouvelles qualifications.",
}

DISCLAIMER = ("Diagnostic établi à partir des règles publiées par les organismes de qualification et de la liste ADEME "
              "des entreprises RGE. Il ne remplace ni la consultation de l'organisme concerné ni les conseils juridiques "
              "des parties.")

LEVELS = {
    "elevee": "Transmissibilité élevée",
    "moyenne": "Transmissibilité moyenne : des points à sécuriser",
    "fragile": "Transmissibilité fragile",
    "non-applicable": "Pas de qualification RGE",
    "a-completer": "À compléter par le cédant",
}


# ----------------------------------------------------------------------------------------------
# Outils


def _norm(value: Any) -> str:
    s = unicodedata.normalize("NFD", str(value or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def organisme_for(*values: Any) -> str:
    """Clé de l'organisme d'après le nom de l'organisme ou de la qualification (ADEME) ; « autre » sinon."""
    for value in values:
        text = _norm(value)
        if not text:
            continue
        for keyword, key in _ORGANISME_KEYWORDS:
            if keyword in text:
                return key
    return "autre"


def _parse_date(value: Any) -> Optional[datetime]:
    """Date ADEME (AAAA-MM-JJ, JJ/MM/AAAA ou ISO complet) → datetime UTC, None si illisible."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        dt = datetime.strptime(text[:10], "%d/%m/%Y") if "/" in text[:10] else datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = datetime.fromisoformat(text[:10])
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def qualification_status(date_fin: Any, now: Optional[datetime] = None) -> Dict[str, Any]:
    """{status: valide | expire_bientot | expiree | inconnue, days_left}."""
    now = now or datetime.now(timezone.utc)
    end = _parse_date(date_fin)
    if not end:
        return {"status": "inconnue", "days_left": None}
    days_left = (end.date() - now.date()).days
    if days_left < 0:
        return {"status": "expiree", "days_left": days_left}
    if days_left <= EXPIRY_WARNING_DAYS:
        return {"status": "expire_bientot", "days_left": days_left}
    return {"status": "valide", "days_left": days_left}


def normalize_qualification(entry: Any, source: str = "ademe") -> Dict[str, Any]:
    """Entrée ADEME (dict ou libellé) → {name, organisme, organisme_label, domaine, date_debut, date_fin, source}."""
    if isinstance(entry, dict):
        name = (entry.get("name") or entry.get("nom_qualification") or entry.get("qualification") or
                entry.get("label") or "").strip()
        organisme_raw = entry.get("organisme") or entry.get("organisme_label") or ""
        key = entry.get("organisme_key") or organisme_for(organisme_raw, name)
        if key not in ORGANISMES:
            key = organisme_for(key, organisme_raw, name)
        return {
            "name": name or ORGANISMES[key]["label"],
            "organisme": key,
            "organisme_label": (str(organisme_raw).strip() or ORGANISMES[key]["label"]),
            "domaine": (entry.get("domaine") or entry.get("meta_domaine") or "").strip(),
            "date_debut": entry.get("date_debut") or entry.get("lien_date_debut") or None,
            "date_fin": entry.get("date_fin") or entry.get("lien_date_fin") or None,
            "certificat": (entry.get("certificat") or entry.get("nom_certificat") or "").strip(),
            "source": entry.get("source") or source,
        }
    name = str(entry or "").strip()
    key = organisme_for(name)
    return {"name": name, "organisme": key, "organisme_label": ORGANISMES[key]["label"], "domaine": "",
            "date_debut": None, "date_fin": None, "certificat": "", "source": source}


# ----------------------------------------------------------------------------------------------
# Lecture ADEME (via la route existante de server.py, remplaçable dans les tests)


def normalize_ademe(raw: Any) -> Dict[str, Any]:
    """Résultat de server.get_property_qualifications → {available, found, property, qualifications, organismes,
    domaines, verified_at, message}. Les dates viennent de `details` quand la route les fournit."""
    raw = raw if isinstance(raw, dict) else {}
    if raw.get("error"):
        return {"available": False, "found": False, "company": {}, "qualifications": [], "organismes": [],
                "domaines": [], "verified_at": None,
                "message": "Vérification RGE différée : la base ADEME n'a pas répondu."}
    if not raw.get("found"):
        return {"available": True, "found": False, "company": {}, "qualifications": [], "organismes": [],
                "domaines": [], "verified_at": datetime.now(timezone.utc).isoformat(),
                "message": raw.get("message") or "Entreprise absente de la liste ADEME des entreprises RGE."}
    qualifications: List[Dict[str, Any]] = []
    seen = set()
    details = raw.get("details")
    if isinstance(details, list) and details:
        for d in details:
            q = normalize_qualification(d)
            key = (q["name"], q["organisme"], q["domaine"], q.get("date_fin"))
            if key not in seen:
                seen.add(key)
                qualifications.append(q)
    else:
        organismes = [o for o in (raw.get("organismes") or []) if o]
        single = organismes[0] if len(organismes) == 1 else ""
        for name in raw.get("qualifications") or []:
            if not name:
                continue
            key = organisme_for(name)
            if key == "autre" and single:
                key = organisme_for(single)
            q = normalize_qualification({"name": name, "organisme": single if key == organisme_for(single) else "",
                                         "organisme_key": key})
            if (q["name"], q["organisme"]) not in seen:
                seen.add((q["name"], q["organisme"]))
                qualifications.append(q)
    property = raw.get("company") or {}
    return {
        "available": True,
        "found": True,
        "company": {"siret": property.get("siret"), "nom_entreprise": property.get("nom_entreprise", ""),
                    "code_postal": property.get("code_postal"), "commune": property.get("commune")},
        "qualifications": qualifications,
        "organismes": sorted({q["organisme_label"] for q in qualifications} | set(raw.get("organismes") or [])),
        "domaines": sorted(set(raw.get("domaines") or []) | {q["domaine"] for q in qualifications if q["domaine"]}),
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "message": "",
    }


async def fetch_ademe_qualifications(siret: str) -> Dict[str, Any]:
    """Qualifications RGE d'un SIRET d'après la liste ADEME, via la route existante de server.py
    (GET /rge/property/{siret}/qualifications). Jamais bloquant : `available: False` en cas de panne."""
    try:
        raw = await server.get_property_qualifications(siret)
    except Exception as e:  # réseau, délai, réponse inattendue
        logger.warning("ADEME indisponible pour %s : %s", siret, e)
        return normalize_ademe({"found": False, "error": str(e)})
    return normalize_ademe(raw)


# ----------------------------------------------------------------------------------------------
# Diagnostic


def _qualifications_from_property(property: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Qualifications d'une annonce : ADEME si disponibles (`ademe_qualifications`), sinon déclaratives."""
    ademe = property.get("ademe_qualifications")
    if isinstance(ademe, list) and ademe:
        return [normalize_qualification(q, "ademe") for q in ademe]
    out: List[Dict[str, Any]] = []
    for label in property.get("rge_types") or []:
        q = normalize_qualification({"name": label, "organisme_key": "autre", "organisme": "",
                                     "date_fin": property.get("rge_validity")}, "declaration")
        q["organisme_label"] = "Organisme non précisé"
        out.append(q)
    for ident in property.get("other_qualifications") or []:
        key = _DECLARED_ORGANISME.get(str(ident).strip().lower())
        if key:
            out.append(normalize_qualification({"name": ORGANISMES[key]["label"], "organisme_key": key,
                                                "organisme": ORGANISMES[key]["label"]}, "declaration"))
    return out


def _organismes_block(qualifications: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[str]] = {}
    for q in qualifications:
        grouped.setdefault(q["organisme"], [])
        if q["name"] not in grouped[q["organisme"]]:
            grouped[q["organisme"]].append(q["name"])
    keys = [k for k in ORGANISMES if k in grouped] or (["autre"] if qualifications else [])
    return [{"key": k, "label": ORGANISMES[k]["label"], "site": ORGANISMES[k]["site"],
             "qualifications": grouped.get(k, []), "titres": list(ORGANISMES[k]["titres"]),
             "fonds": list(ORGANISMES[k]["fonds"]), "delai_fonds": ORGANISMES[k]["delai_fonds"],
             "referent": ORGANISMES[k]["referent"]} for k in keys]


def _transfer_block(organismes: List[Dict[str, Any]], sale_object: Optional[str]) -> Dict[str, Any]:
    titres_steps = ["Notifier chaque organisme du changement de majorité ou de dirigeant et transmettre le certificat."]
    fonds_steps = ["Signaler la cession à chaque organisme ; le cédant retourne ses certificats."]
    for o in organismes:
        titres_steps.extend(s for s in o["titres"] if s not in titres_steps)
        fonds_steps.extend(s for s in o["fonds"] if s not in fonds_steps)
    if not any("référent technique" in s for s in titres_steps):
        # Étape générique seulement si aucun organisme ne l'a déjà formulée (pas de doublon dans la carte)
        titres_steps.append("Conserver ou remplacer le référent technique dans le délai de l'organisme (six mois en général).")
    fonds_steps.append("Le repreneur dépose ses propres demandes avant la cession ou pendant une transition "
                       "(location-gérance, accompagnement du cédant).")
    chosen = {"titres": "titres", "fonds": "fonds", "indifferent": "indifferent"}.get(str(sale_object or "").lower())
    return {
        "titres": {**TRANSFER["titres"], "steps": titres_steps},
        "fonds": {**TRANSFER["fonds"], "steps": fonds_steps},
        "recommended": "titres",
        "recommendation": TRANSFER["recommendation"],
        "chosen": chosen,
    }


def _level(qualifications: List[Dict[str, Any]], statuses: List[Dict[str, Any]], property: Optional[Dict[str, Any]],
           with_financials: bool) -> Dict[str, Any]:
    reasons: List[str] = []
    if not qualifications:
        return {"value": "non-applicable", "label": LEVELS["non-applicable"], "reasons": [
            "Aucune qualification RGE : la cession ne dépend pas d'un organisme de qualification ; l'assurance décennale "
            "et le référent technique restent à vérifier."]}
    score = 2  # 2 = élevée, 1 = moyenne, 0 = fragile
    expired = [q["name"] for q, s in zip(qualifications, statuses) if s["status"] == "expiree"]
    soon = [q["name"] for q, s in zip(qualifications, statuses) if s["status"] == "expire_bientot"]
    if expired:
        score = 0
        reasons.append("Qualification expirée : " + ", ".join(expired) + ".")
    elif soon:
        score = min(score, 1)
        reasons.append("Qualification à renouveler dans les six mois : " + ", ".join(soon) + ".")
    if not property or not with_financials:
        if score == 2:
            reasons.append("Qualifications en cours de validité d'après la liste ADEME.")
        reasons.append("Référent technique, assurance décennale et chantiers aidés : informations non renseignées par le cédant.")
        return {"value": "a-completer" if score == 2 else ("moyenne" if score == 1 else "fragile"),
                "label": LEVELS["a-completer" if score == 2 else ("moyenne" if score == 1 else "fragile")],
                "reasons": reasons}
    referent = property.get("technical_referent_stays")
    if referent is False:
        score = min(score, 1)
        reasons.append("Le référent technique ne reste pas : un remplaçant formé doit être déclaré sous six mois.")
    elif referent is None:
        score = min(score, 1)
        reasons.append("Référent technique : situation non renseignée.")
    else:
        reasons.append("Le référent technique reste dans l'entreprise.")
    if property.get("decennale_ok") is False:
        score = 0
        reasons.append("Assurance décennale non à jour.")
    elif property.get("decennale_ok") is None:
        reasons.append("Assurance décennale : à vérifier (attestation et relevé de sinistralité).")
    sale_object = str(property.get("sale_object") or "").lower()
    if sale_object == "fonds":
        score = min(score, 1)
        reasons.append("Cession de fonds envisagée : les qualifications ne se transmettent pas, nouvelle demande du repreneur.")
    elif sale_object == "titres":
        reasons.append("Cession de titres envisagée : les qualifications suivent la société.")
    handover = property.get("handover_months")
    if isinstance(handover, (int, float)) and handover >= 3:
        reasons.append(f"Accompagnement prévu : {int(handover)} mois, utile pour la transition du référent.")
    value = {2: "elevee", 1: "moyenne", 0: "fragile"}[score]
    return {"value": value, "label": LEVELS[value], "reasons": reasons}


def _checklist(property: Dict[str, Any], qualifications: List[Dict[str, Any]], statuses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def tri(value: Any, ok_text: str, ko_text: str, unknown_text: str) -> Dict[str, Any]:
        if value is True:
            return {"status": "ok", "detail": ok_text}
        if value is False:
            return {"status": "attention", "detail": ko_text}
        return {"status": "inconnu", "detail": unknown_text}

    items = []
    if qualifications:
        if any(s["status"] in ("expiree", "expire_bientot") for s in statuses):
            worst = "attention"
        elif all(s["status"] == "inconnue" for s in statuses):
            worst = "inconnu"
        else:
            worst = "ok"
        verified = any(q.get("source") == "ademe" for q in qualifications)
        if worst == "ok" and not verified:
            # Dates déclarées par le cédant, non retrouvées sur la liste ADEME : pas de coche verte
            items.append({"key": "qualifications", "label": "Qualifications déclarées en cours de validité", "status": "inconnu",
                          "detail": "Aucune date déclarée n'expire dans les six mois ; qualifications non retrouvées sur la liste ADEME, "
                                    "à vérifier auprès de l'organisme."})
        else:
            items.append({"key": "qualifications", "label": "Qualifications RGE en cours de validité", "status": worst,
                          "detail": {"ok": "Aucune qualification datée n'expire dans les six mois.",
                                     "attention": "Au moins une qualification est expirée ou arrive à échéance dans les six mois.",
                                     "inconnu": "Dates de validité non disponibles (qualifications déclarées, non vérifiées)."}[worst]})
    items.append({"key": "referent", "label": "Référent technique conservé",
                  **tri(property.get("technical_referent_stays"),
                        "Le référent technique reste après la cession.",
                        "Le référent part : prévoir un remplaçant formé (délai de six mois).",
                        "À renseigner par le cédant.")})
    items.append({"key": "decennale", "label": "Assurance décennale à jour",
                  **tri(property.get("decennale_ok"), "Attestation à jour déclarée.",
                        "Décennale non à jour : à régulariser avant la cession.", "À vérifier avec l'attestation.")})
    items.append({"key": "sale_object", "label": "Forme de cession",
                  **{"titres": {"status": "ok", "detail": "Cession de titres : les qualifications suivent la société."},
                     "fonds": {"status": "attention", "detail": "Cession de fonds : nouvelles demandes du repreneur."},
                     "indifferent": {"status": "ok", "detail": "Au choix des parties : la cession de titres conserve les qualifications."}
                     }.get(str(property.get("sale_object") or "").lower(),
                           {"status": "inconnu", "detail": "Forme de cession non renseignée."})})
    items.append({"key": "key_staff", "label": "Équipe clé conservée",
                  **tri(property.get("key_staff_stays"), "Les salariés clés restent.",
                        "Des salariés clés pourraient partir : à sécuriser.", "À renseigner par le cédant.")})
    items.append({"key": "handover", "label": "Accompagnement du cédant",
                  **({"status": "ok", "detail": f"{int(property['handover_months'])} mois d'accompagnement prévus."}
                     if isinstance(property.get("handover_months"), (int, float)) and property["handover_months"] >= 3
                     else {"status": "attention", "detail": "Accompagnement court ou non prévu : la transition du référent est à organiser."}
                     if isinstance(property.get("handover_months"), (int, float))
                     else {"status": "inconnu", "detail": "Durée d'accompagnement non renseignée."})})
    return items


def build_diagnostic(property_or_qualifications: Union[Dict[str, Any], List[Any], None],
                     with_financials: bool = False, now: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Diagnostic de transmissibilité.
    - liste : qualifications ADEME (dicts normalisés ou libellés) → version courte (sans données financières) ;
    - dict : annonce (`property`), éventuellement enrichie de `ademe_qualifications` → avec `with_financials`,
      ajoute la checklist, le niveau détaillé et les réponses « ce qui rassure un repreneur ».
    """
    now = now or datetime.now(timezone.utc)
    property: Optional[Dict[str, Any]] = None
    if isinstance(property_or_qualifications, dict):
        property = property_or_qualifications
        qualifications = _qualifications_from_property(property)
    else:
        qualifications = [normalize_qualification(q) for q in (property_or_qualifications or []) if q]
    statuses = [qualification_status(q.get("date_fin"), now) for q in qualifications]
    for q, s in zip(qualifications, statuses):
        q.update(s)
    organismes = _organismes_block(qualifications)
    sale_object = property.get("sale_object") if property else None
    referent_stays = property.get("technical_referent_stays") if (property and with_financials) else None
    decennale_ok = property.get("decennale_ok") if (property and with_financials) else None
    source = ("ademe" if any(q["source"] == "ademe" for q in qualifications)
              else "declaration" if qualifications else "aucune")
    diagnostic: Dict[str, Any] = {
        "generated_at": now.isoformat(),
        "scope": "complet" if (property and with_financials) else "public",
        "is_rge": bool(qualifications),
        "source": source,
        "verified_at": (property or {}).get("qualifications_verified_at") if property else None,
        "qualifications": qualifications,
        "organismes": organismes,
        "transfer": _transfer_block(organismes, sale_object),
        "referent": {**REFERENT, "stays": referent_stays},
        "decennale": {**DECENNALE, "ok": decennale_ok},
        "aides": dict(AIDES),
        "reforme": [dict(r) for r in REFORME],
        "level": _level(qualifications, statuses, property, with_financials),
        "disclaimer": DISCLAIMER,
    }
    if property and with_financials:
        diagnostic["checklist"] = _checklist(property, qualifications, statuses)
        diagnostic["financials"] = {
            "sale_object": sale_object,
            "handover_months": property.get("handover_months"),
            "has_maintenance_contracts": property.get("has_maintenance_contracts"),
            "technical_referent_stays": referent_stays,
            "key_staff_stays": property.get("key_staff_stays"),
            "decennale_ok": decennale_ok,
            "staff_count": property.get("staff_count"),
            "ca_n": property.get("ca_n"),
            "ebitda": property.get("ebitda"),
            "asking_price": property.get("asking_price"),
            "rge_validity": property.get("rge_validity"),
        }
    return diagnostic


# ----------------------------------------------------------------------------------------------
# Routes


def _clean_siret(siret: str) -> str:
    digits = re.sub(r"\D", "", siret or "")
    if len(digits) != 14:
        raise HTTPException(status_code=400, detail="SIRET invalide : 14 chiffres attendus")
    return digits


@router.get("/rge/property/{siret}/transmissibility")
async def public_transmissibility(siret: str, request: Request):
    """Version courte publique : qualifications ADEME du SIRET + règles de transfert, sans données financières."""
    check_rate_limit(request, public_limiter, "transmissibility")
    siret = _clean_siret(siret)
    ademe = await fetch_ademe_qualifications(siret)
    diagnostic = build_diagnostic(ademe["qualifications"], with_financials=False)
    diagnostic["verified_at"] = ademe.get("verified_at")
    return {
        "siret": siret,
        "siren": siret[:9],
        "available": ademe["available"],
        "found": ademe["found"],
        "message": ademe.get("message") or "",
        "company": ademe.get("company") or {},
        "organismes_ademe": ademe.get("organismes") or [],
        "domaines": ademe.get("domaines") or [],
        "diagnostic": diagnostic,
    }


async def has_dataroom_access(property: Dict[str, Any], user: Dict[str, Any]) -> bool:
    """Vendeur de l'annonce, admin, ou repreneur dont l'accès à la data room est accordé."""
    if not user:
        return False
    if user.get("role") == "admin" or is_property_owner(property, user):
        return True
    access = await db.dataroom_access.find_one({"property_id": property["id"], "buyer_id": user["id"]},
                                               {"_id": 0, "status": 1})
    return bool(access and access.get("status") in NDA_ACCESS_STATUSES)


@router.get("/properties/{property_id}/transmissibility")
async def property_transmissibility(property_id: str, current_user: dict = Depends(get_current_user)):
    """Version complète : qualifications (ADEME si le SIRET est connu, sinon déclarées), référent, décennale, checklist."""
    property = await db.properties.find_one({"id": property_id}, {"_id": 0})
    if not property:
        raise HTTPException(status_code=404, detail="Annonce introuvable")
    if not await has_dataroom_access(property, current_user):
        raise HTTPException(status_code=403, detail="Diagnostic réservé au cédant et aux repreneurs ayant accès à la data room")
    siret = re.sub(r"\D", "", property.get("siret") or "")
    ademe: Dict[str, Any] = {"available": False, "found": False, "qualifications": [], "message": ""}
    if len(siret) == 14 and (property.get("rge_types") or property.get("is_rge")):
        ademe = await fetch_ademe_qualifications(siret)
        if ademe["found"]:
            property["ademe_qualifications"] = ademe["qualifications"]
            property["qualifications_verified_at"] = ademe.get("verified_at")
    diagnostic = build_diagnostic(property, with_financials=True)
    return {
        "property_id": property_id,
        "ademe": {"available": ademe.get("available", False), "found": ademe.get("found", False),
                  "message": ademe.get("message") or ""},
        "diagnostic": diagnostic,
    }
