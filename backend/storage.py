"""
Stockage des fichiers (data room, photos, pièces KYC).

- Si S3_BUCKET est défini : fichiers dans un bucket compatible S3 (AWS, Scaleway, OVH, MinIO…),
  la base ne garde qu'une référence (storage="s3", storage_key).
- Sinon : contenu en base64 dans MongoDB (comportement historique, limité par la taille max d'un document).
"""
import asyncio
import base64
import os
import uuid
from typing import Optional


def s3_enabled() -> bool:
    return bool(os.environ.get("S3_BUCKET"))


def max_upload_bytes() -> int:
    # MongoDB limite un document à 16 Mo (base64 = +33 %) : 10 Mo max sans S3
    return (25 if s3_enabled() else 10) * 1024 * 1024


def s3_extra_args() -> dict:
    """Chiffrement au repos (SSE AES256), désactivable par S3_SSE=false si le fournisseur ne le gère pas"""
    if os.environ.get("S3_SSE", "true").lower() != "false":
        return {"ServerSideEncryption": "AES256"}
    return {}


def _client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        region_name=os.environ.get("S3_REGION") or None,
    )


async def save_file(data: bytes, content_type: Optional[str], prefix: str) -> dict:
    """Enregistre un fichier et renvoie les champs à stocker dans le document MongoDB"""
    if not s3_enabled():
        return {"content": base64.b64encode(data).decode("utf-8")}
    key = f"{prefix.strip('/')}/{uuid.uuid4()}"
    params = {
        "Bucket": os.environ["S3_BUCKET"], "Key": key, "Body": data,
        "ContentType": content_type or "application/octet-stream",
    }
    params.update(s3_extra_args())
    await asyncio.to_thread(_client().put_object, **params)
    return {"storage": "s3", "storage_key": key}


async def load_file(doc: dict) -> bytes:
    """Contenu binaire d'un fichier, quel que soit son stockage"""
    if doc.get("storage") == "s3":
        obj = await asyncio.to_thread(_client().get_object, Bucket=os.environ["S3_BUCKET"], Key=doc["storage_key"])
        return await asyncio.to_thread(obj["Body"].read)
    return base64.b64decode(doc.get("content") or "")


async def delete_file(doc: dict) -> None:
    if doc.get("storage") == "s3" and doc.get("storage_key"):
        await asyncio.to_thread(_client().delete_object, Bucket=os.environ["S3_BUCKET"], Key=doc["storage_key"])
