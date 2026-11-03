"""Print-ready, portrait A0 competition poster for Tujian.

The Image 2.5 artwork is decorative. All claims and Chinese text are set as
PDF vectors, while the product imagery is taken from the existing report.
"""

from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "output" / "pdf" / "assets"
HERO = ROOT / "output" / "poster" / "assets" / "memory-hero-image25.png"
OUT = ROOT / "output" / "poster" / "途見_A0直式比賽海報.pdf"
MM = 72 / 25.4
PW, PH = 841 * MM, 1189 * MM

pdfmetrics.registerFont(TTFont("JH", r"C:\Windows\Fonts\msjh.ttc", subfontIndex=0))
pdfmetrics.registerFont(TTFont("JHB", r"C:\Windows\Fonts\msjhbd.ttc", subfontIndex=0))

INK = colors.HexColor("#18323B")
TEAL = colors.HexColor("#0B666B")
TEAL_DARK = colors.HexColor("#0A333A")
GOLD = colors.HexColor("#B98D4F")
PALE = colors.HexColor("#F4FAF9")
MIST = colors.HexColor("#E4F1F1")
LINE = colors.HexColor("#C9DDDD")
MUTED = colors.HexColor("#587078")
WHITE = colors.white


def rect(c, x, top, w, h, fill=WHITE, stroke=None, radius=0):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    c.setLineWidth(1.7)
    y = PH - (top + h) * MM
    if radius:
        c.roundRect(x * MM, y, w * MM, h * MM, radius * MM, fill=1, stroke=int(stroke is not None))
    else:
        c.rect(x * MM, y, w * MM, h * MM, fill=1, stroke=int(stroke is not None))


def text(c, x, top, s, size=20, bold=False, color=INK):
    c.setFillColor(color)
    c.setFont("JHB" if bold else "JH", size)
    c.drawString(x * MM, PH - top * MM - size * 0.9, s)


def wrapped(c, x, top, value, max_w, size=19, leading=1.52, color=INK, bold=False):
    font = "JHB" if bold else "JH"
    c.setFillColor(color)
    c.setFont(font, size)
    lines = []
    for block in value.split("\n"):
        line = ""
        for ch in block:
            trial = line + ch
            if line and pdfmetrics.stringWidth(trial, font, size) > max_w * MM:
                lines.append(line)
                line = ch
            else:
                line = trial
        lines.append(line)
    baseline = PH - top * MM - size * 0.9
    for line in lines:
        c.drawString(x * MM, baseline, line)
        baseline -= size * leading
    return len(lines) * size * leading / MM


def image_cover(c, path, x, top, w, h, radius=0):
    im = ImageReader(str(path))
    iw, ih = im.getSize()
    target_w, target_h = w * MM, h * MM
    scale = max(target_w / iw, target_h / ih)
    draw_w, draw_h = iw * scale, ih * scale
    left = x * MM + (target_w - draw_w) / 2
    bottom = PH - (top + h) * MM + (target_h - draw_h) / 2
    c.saveState()
    if radius:
        p = c.beginPath()
        p.roundRect(x * MM, PH - (top + h) * MM, target_w, target_h, radius * MM)
        c.clipPath(p, stroke=0)
    else:
        p = c.beginPath()
        p.rect(x * MM, PH - (top + h) * MM, target_w, target_h)
        c.clipPath(p, stroke=0)
    c.drawImage(im, left, bottom, width=draw_w, height=draw_h, mask="auto")
    c.restoreState()


def card(c, x, y, w, h):
    rect(c, x, y, w, h, WHITE, LINE, 7)


def label(c, x, top, value):
    rect(c, x, top, 7, 10, GOLD, radius=2)
    text(c, x + 14, top - 1.5, value, 28, True, INK)


def step(c, y, number, heading, body):
    cx = 59
    c.setFillColor(TEAL)
    c.circle(cx * MM, (PH - (y + 16) * MM), 14 * MM, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont("JHB", 28)
    nwidth = pdfmetrics.stringWidth(str(number), "JHB", 28)
    c.drawString(cx * MM - nwidth / 2, PH - (y + 19) * MM - 11, str(number))
    text(c, 85, y + 1, heading, 25, True, TEAL_DARK)
    wrapped(c, 85, y + 21, body, 292, 18.3, 1.38)


def main():
    if not HERO.exists():
        raise FileNotFoundError(HERO)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(PW, PH), pageCompression=1)
    c.setTitle("途見——基於3DGS與GMVR的澳門文旅記憶系統｜A0直式比賽海報")
    c.setAuthor("林杰、李靖汐、馮梓雯｜澳門濠江中學")

    # Exhibition masthead and team identity, following the reference hierarchy.
    rect(c, 0, 0, 841, 1189, PALE)
    rect(c, 0, 0, 841, 11, TEAL_DARK)
    rect(c, 0, 11, 841, 3, GOLD)
    text(c, 33, 31, "2026年澳門青少年科學家大會", 58, True, TEAL_DARK)
    text(c, 34, 67, "城市記憶 × 文化科技 × 共創敘事", 22, False, TEAL)
    rect(c, 30, 96, 781, 62, MIST, radius=8)
    text(c, 47, 107, "澳門濠江中學", 32, True, TEAL_DARK)
    text(c, 48, 136, "指導老師：曾劍輝", 19, False, MUTED)
    text(c, 426, 108, "參賽者：林杰、李靖汐、馮梓雯", 24, True, INK)
    text(c, 428, 138, "作品類型：文旅記憶系統", 18, False, MUTED)

    # Image 2.5 conceptual artwork; title is set separately as exact vector type.
    image_cover(c, HERO, 30, 174, 781, 148, 8)
    c.saveState()
    c.setFillAlpha(0.78)
    rect(c, 30, 174, 520, 148, TEAL_DARK, radius=8)
    c.restoreState()
    text(c, 54, 191, "途見", 81, True, WHITE)
    text(c, 57, 243, "基於 3DGS 與 GMVR 的澳門文旅記憶系統", 31, True, WHITE)
    text(c, 58, 283, "每一棟建築，都值得被記住。", 23, False, colors.HexColor("#EEDDBB"))

    # Plain-language first explanation.
    card(c, 30, 339, 781, 113)
    label(c, 49, 354, "這是甚麼？")
    wrapped(
        c, 51, 389,
        "途見把澳門的地點、真實照片、三維實景與居民故事連在一起。旅客可拍照確認眼前建築、觀看大三巴的3DGS實景、聆聽介紹；有特色的普通建築也能建立記憶檔案。網站、小程序與AR眼鏡導覽載體共用地點編號，讓一次到訪延續為可補充的城市記錄。",
        740, 22, 1.50,
    )

    # Main two-column competition-poster body.
    card(c, 30, 470, 376, 291)
    label(c, 49, 485, "到現場，途見怎樣用？")
    step(c, 531, 1, "出發前，選地點", "在小程序查詢建築資料，挑選景點並安排行程。")
    step(c, 589, 2, "抵達後，拍照確認", "結合影像、定位與多張照片提出候選，由使用者確認。")
    step(c, 647, 3, "看實景，聽故事", "瀏覽3DGS、真實照片與講解；AR眼鏡可作現場載體。")
    step(c, 705, 4, "留下你的記憶", "經同意提交照片、文字或原聲，連結人物與事件線索。")

    card(c, 427, 470, 384, 291)
    label(c, 446, 485, "核心場景：大三巴")
    image_cover(c, ASSETS / "stpaul-2010.jpg", 448, 530, 165, 156, 5)
    image_cover(c, ASSETS / "stpaul-gaussian-web.png", 624, 530, 166, 156, 5)
    text(c, 449, 698, "實拍照片", 19, True, TEAL_DARK)
    text(c, 625, 698, "網站 3DGS 實景畫面", 19, True, TEAL_DARK)
    wrapped(c, 449, 730, "照片保存建築細節；高斯模型讓使用者從不同視角重新觀看同一地點。", 342, 18.2, 1.40, MUTED)

    card(c, 30, 779, 376, 235)
    label(c, 49, 794, "普通建築，也有記憶")
    image_cover(c, ASSETS / "tonglau-real.jpg", 51, 839, 334, 123, 5)
    wrapped(c, 51, 975, "不只記錄著名地標。街區建築也可經定位、查重與人工確認，取得長久使用的地點編號。", 334, 18.2, 1.35)

    card(c, 427, 779, 384, 235)
    label(c, 446, 794, "真實照片與記憶拼圖")
    image_cover(c, ASSETS / "real-photo-album.png", 448, 841, 166, 117, 5)
    image_cover(c, ASSETS / "memory-puzzle.jpg", 625, 841, 166, 117, 5)
    text(c, 449, 969, "照片時間軸", 18, True, TEAL_DARK)
    text(c, 626, 969, "可編輯的記憶拼圖", 18, True, TEAL_DARK)
    wrapped(c, 449, 991, "把有來源的歷史線索與個人故事放回同一地點。", 340, 17.5, 1.3)

    card(c, 30, 1032, 781, 112)
    label(c, 49, 1046, "技術與驗證｜讓成果可查核")
    rect(c, 294, 1090, 0.6, 43, LINE)
    rect(c, 549, 1090, 0.6, 43, LINE)
    text(c, 50, 1087, "3DGS 空間記錄", 23, True, TEAL)
    wrapped(c, 51, 1115, "FFmpeg → COLMAP → Brush\n網站瀏覽實景模型", 222, 17.5, 1.35)
    text(c, 309, 1087, "GMVR 建築確認", 23, True, TEAL)
    wrapped(c, 310, 1115, "YOLO ＋ DINOv2 ＋ 定位\n多照片一致性、人工覆核", 226, 17.5, 1.35)
    text(c, 565, 1087, "38 棟建築 · 335 張照片", 23, True, TEAL)
    wrapped(c, 566, 1115, "參考庫留一法 Top-1 88.96%\n此數值並非遊客實拍準確率", 226, 17.5, 1.35)

    text(c, 32, 1163, "圖像說明：實拍照片及網站截圖取自作品資料；標題主視覺由 Image 2.5 生成，僅作概念呈現。", 15.5, False, MUTED)
    c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    main()
