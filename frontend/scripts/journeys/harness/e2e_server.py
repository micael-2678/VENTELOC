"""
Backend de test pour les parcours Playwright (scripts/journeys) : l'API réelle (backend/server.py) avec
- MongoDB en mémoire (mongomock-motor, comme les tests pytest) ;
- e-mails Brevo interceptés et écrits dans EMAILS_FILE (une ligne JSON par e-mail : to, subject, html) ;
- route de test POST /test/set-user?email=&field=&value= (forcer un champ d'un compte : identité vérifiée…),
  seulement dans ce banc d'essai.
Lancement (venv du backend) :
  EMAILS_FILE=/tmp/emails.jsonl python frontend/scripts/journeys/harness/e2e_server.py   # port 8001
Variables : PORT (8001), EMAILS_FILE, SEED_FILE (si défini, seed.py y écrit le jeu de données au démarrage),
            NOSEED=1 (pas de jeu de données), et toutes celles du backend (TEST_MODE, TEST_PANEL_KEY…).
"""
import json
import os
import sys
from types import SimpleNamespace

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "backend"))
sys.path.insert(0, BACKEND)
sys.path.insert(0, HERE)

os.environ.setdefault("MONGO_URL", "mongodb://mock")
os.environ.setdefault("DB_NAME", "venteloc_e2e")
os.environ.setdefault("JWT_SECRET", "e2e-" + "x" * 40)
os.environ.setdefault("SITE_URL", "http://127.0.0.1:3000")
os.environ.setdefault("CORS_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000")
os.environ.setdefault("ADMIN_EMAIL", "admin@venteloc.test")
os.environ.setdefault("ADMIN_PASSWORD", "AdminTest123!")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("JOBS_ENABLED", "false")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("EMAIL_DAILY_SOFT_LIMIT", "0")

import motor.motor_asyncio  # noqa: E402
import mongomock_motor  # noqa: E402
motor.motor_asyncio.AsyncIOMotorClient = mongomock_motor.AsyncMongoMockClient

import business_model  # noqa: E402

EMAILS_FILE = os.environ.get("EMAILS_FILE", os.path.join(HERE, "emails.jsonl"))


def _fake_send(to_email, to_name, subject, html_content, unsubscribe_url=""):
    with open(EMAILS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps({"to": to_email, "subject": subject,
                            "html": business_model.wrap_email_html(html_content, unsubscribe_url)}, ensure_ascii=False) + "\n")
    return SimpleNamespace(message_id="e2e")


business_model._send_brevo_email_sync = _fake_send
if not os.environ.get("BREVO_API_KEY"):
    os.environ["BREVO_API_KEY"] = "e2e-fake"

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402


@server.app.post("/test/set-user")
async def set_user(email: str, field: str, value: str):
    parsed = {"true": True, "false": False}.get(value.lower(), value)
    res = await server.db.users.update_one({"email": email.lower()}, {"$set": {field: parsed}})
    if not res.matched_count:
        raise HTTPException(404, "compte introuvable")
    return {"ok": True}


@server.app.on_event("startup")
async def _seed():
    if os.environ.get("NOSEED") == "1" or not os.environ.get("SEED_FILE"):
        return
    import seed  # noqa: E402  (harness/seed.py)
    data = await seed.run(server)
    with open(os.environ["SEED_FILE"], "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(server.app, host="127.0.0.1", port=int(os.environ.get("PORT", "8001")), log_level="warning")
