"""Stockage S3 optionnel et filigrane des images"""
import asyncio
import io

import pytest


def test_s3_storage_roundtrip(monkeypatch):
    moto = pytest.importorskip("moto")
    import boto3
    import storage
    monkeypatch.setenv("S3_BUCKET", "cessionrge-test")
    monkeypatch.setenv("S3_REGION", "eu-west-3")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    with moto.mock_aws():
        boto3.client("s3", region_name="eu-west-3").create_bucket(
            Bucket="cessionrge-test", CreateBucketConfiguration={"LocationConstraint": "eu-west-3"})
        ref = asyncio.run(storage.save_file(b"%PDF-1.4 test", "application/pdf", "dataroom/abc"))
        assert ref["storage"] == "s3" and "content" not in ref
        assert asyncio.run(storage.load_file(ref)) == b"%PDF-1.4 test"
        asyncio.run(storage.delete_file(ref))
        assert storage.max_upload_bytes() == 25 * 1024 * 1024


def test_mongo_storage_fallback(monkeypatch):
    import storage
    monkeypatch.delenv("S3_BUCKET", raising=False)
    ref = asyncio.run(storage.save_file(b"abc", "image/png", "photos/x"))
    assert "content" in ref and asyncio.run(storage.load_file(ref)) == b"abc"


def test_image_watermark():
    from PIL import Image
    from watermark import apply_watermark
    buf = io.BytesIO()
    Image.new("RGB", (800, 600), "white").save(buf, format="PNG")
    out, ctype = apply_watermark(buf.getvalue(), "image/png", "acheteur@test.fr | 01/01/2026")
    assert ctype == "image/jpeg"
    img = Image.open(io.BytesIO(out)).convert("L")
    assert img.getextrema()[0] < 250, "l'image doit porter un filigrane visible"
