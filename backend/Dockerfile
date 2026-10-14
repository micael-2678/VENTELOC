# Backend (FastAPI + uvicorn) : service `backend` de docker-compose.yml
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dépendances d'exécution seulement (outils de test et de qualité : requirements-dev.txt, jamais dans l'image)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code (lecture seule pour le processus : rien n'est écrit dans /app, les fichiers vont dans MongoDB ou S3)
COPY . .

# Utilisateur sans privilèges : uvicorn ne tourne pas en root dans le conteneur. Le volume des sauvegardes est monté
# en lecture seule sur /backups (archives lisibles par tous, écrites par le service backup).
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER app

EXPOSE 8001

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
