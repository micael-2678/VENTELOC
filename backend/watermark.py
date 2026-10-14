"""
Filigrane incrusté dans les documents de la data room (et non plus seulement affiché par-dessus).
Le fichier envoyé au navigateur porte l'email du lecteur et l'horodatage sur chaque page :
une copie qui fuiterait reste traçable.
"""
import io
import logging
from typing import Tuple


def _pdf_overlay(width: float, height: float, text: str) -> bytes:
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import Color
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.setFillColor(Color(0.45, 0.45, 0.45, alpha=0.22))
    c.setFont("Helvetica", 11)
    c.translate(width / 2, height / 2)
    c.rotate(35)
    step_x, step_y = 330, 70
    span = int(max(width, height) * 1.5)
    for y in range(-span, span, step_y):
        offset = (y // step_y) % 2 * (step_x // 2)
        for x in range(-span, span, step_x):
            c.drawString(x + offset, y, text)
    c.save()
    return buf.getvalue()


def watermark_pdf(data: bytes, text: str) -> bytes:
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    overlays = {}
    for page in reader.pages:
        w, h = float(page.mediabox.width), float(page.mediabox.height)
        key = (round(w), round(h))
        if key not in overlays:
            overlays[key] = PdfReader(io.BytesIO(_pdf_overlay(w, h, text))).pages[0]
        page.merge_page(overlays[key])
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def watermark_image(data: bytes, text: str) -> Tuple[bytes, str]:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    size = max(14, img.size[0] // 45)
    try:
        font = ImageFont.load_default(size=size)
    except TypeError:
        font = ImageFont.load_default()
    step_x, step_y = size * 28, size * 6
    for i, y in enumerate(range(-img.size[1], img.size[1] * 2, step_y)):
        for x in range(-img.size[0], img.size[0] * 2, step_x):
            draw.text((x + (i % 2) * step_x // 2, y), text, fill=(90, 90, 90, 70), font=font)
    layer = layer.rotate(30, center=(img.size[0] / 2, img.size[1] / 2))
    out = io.BytesIO()
    Image.alpha_composite(img, layer).convert("RGB").save(out, format="JPEG", quality=88)
    return out.getvalue(), "image/jpeg"


class WatermarkError(Exception):
    """Le document ne peut pas être filigrané (PDF protégé ou illisible, image corrompue, type non pris en charge)"""


def apply_watermark(data: bytes, content_type: str, text: str, strict: bool = False) -> Tuple[bytes, str]:
    """Renvoie (contenu filigrané, type). En cas d'échec : WatermarkError si `strict` (data room : un document n'est
    jamais servi sans filigrane), sinon le document original."""
    try:
        if content_type == "application/pdf" or data[:5] == b"%PDF-":
            return watermark_pdf(data, text), "application/pdf"
        if content_type and content_type.startswith("image/"):
            return watermark_image(data, text)
    except Exception as e:
        logging.warning(f"Filigrane impossible ({content_type}): {e}")
        if strict:
            raise WatermarkError(str(e)) from e
        return data, content_type
    if strict:
        raise WatermarkError(f"type non pris en charge : {content_type}")
    return data, content_type
