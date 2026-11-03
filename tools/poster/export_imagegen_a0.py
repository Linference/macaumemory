"""Place the unaltered Image 2.5 poster on an exact portrait A0 PDF page."""

from pathlib import Path

from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "output" / "poster" / "途見_2026科學家大會_詳細版_Image2.5.png"
DEST = ROOT / "output" / "poster" / "途見_2026澳門青少年科學家大會_A0詳細版.pdf"
MM = 72 / 25.4
PAGE_W, PAGE_H = 841 * MM, 1189 * MM


def main() -> None:
    with Image.open(SRC) as image:
        iw, ih = image.size
    # Retain the generated art's aspect ratio without stretching text.
    scale = min(PAGE_W / iw, PAGE_H / ih)
    width, height = iw * scale, ih * scale
    pdf = canvas.Canvas(str(DEST), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    pdf.setTitle("途見｜2026年澳門青少年科學家大會｜A0直式海報")
    pdf.setAuthor("林杰、李靖汐、馮梓雯")
    pdf.setFillColorRGB(1, 1, 1)
    pdf.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    pdf.drawImage(ImageReader(str(SRC)), (PAGE_W - width) / 2, (PAGE_H - height) / 2,
                  width=width, height=height)
    pdf.showPage()
    pdf.save()
    print(f"{DEST} | source={iw}x{ih}px | page=841x1189mm")


if __name__ == "__main__":
    main()
