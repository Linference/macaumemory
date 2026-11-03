"""Image 2.5 poster with exact vector body copy for A0 print.

The generated composition supplies the graphic design. Small AI-rendered body
copy is covered and replaced with independently checked Traditional Chinese.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "output" / "poster" / "途見_2026科學家大會_詳細版_Image2.5.png"
OUT = ROOT / "output" / "poster" / "途見_2026澳門青少年科學家大會_A0高清文字版.pdf"
W_PX, H_PX = 1055, 1491
MM = 72 / 25.4
PW, PH = 841 * MM, 1189 * MM
SX, SY = PW / W_PX, PH / H_PX

pdfmetrics.registerFont(TTFont("JH", r"C:\Windows\Fonts\msjh.ttc", subfontIndex=0))
pdfmetrics.registerFont(TTFont("JHB", r"C:\Windows\Fonts\msjhbd.ttc", subfontIndex=0))

INK = colors.HexColor("#102F4B")
BLUE = colors.HexColor("#075BA4")
WHITE = colors.white
PALE = colors.HexColor("#F3FBFF")
RULE = colors.HexColor("#C3E2F2")


def px_rect(pdf, x, y, w, h, fill=WHITE):
    pdf.setFillColor(fill)
    pdf.rect(x * SX, PH - (y + h) * SY, w * SX, h * SY, fill=1, stroke=0)


def txt(pdf, x, y, s, pts=24, bold=False, color=INK):
    pdf.setFont("JHB" if bold else "JH", pts)
    pdf.setFillColor(color)
    pdf.drawString(x * SX, PH - y * SY - pts * 0.80, s)


def prose(pdf, x, y, width, height, copy, pts=25, leading=1.26, color=INK, bold=False):
    font = "JHB" if bold else "JH"
    max_w = width * SX
    lines = []
    for para in copy.split("\n"):
        line = ""
        for ch in para:
            candidate = line + ch
            if line and pdfmetrics.stringWidth(candidate, font, pts) > max_w:
                lines.append(line)
                line = ch
            else:
                line = candidate
        lines.append(line)
    used = len(lines) * pts * leading
    available = height * SY
    if used > available + pts * 0.2:
        raise ValueError(f"Text exceeds box by {(used-available)/SY:.1f} px: {copy[:28]}")
    pdf.setFillColor(color)
    pdf.setFont(font, pts)
    baseline = PH - y * SY - pts * 0.85
    for line in lines:
        pdf.drawString(x * SX, baseline, line)
        baseline -= pts * leading


def table(pdf):
    rows = [
        ("三維地圖", "顯示景點、道路及記憶點，提供步行路線入口。"),
        ("多照片確認", "融合影像、定位品質與多視角一致性，由人覆核。"),
        ("普通建築建檔", "人工確認位置並查重，取得永久地點編號。"),
        ("真實照片時間軸", "按拍攝時間查看同一建築的不同年代面貌。"),
        ("記憶拼圖", "把故事、歷史線索與筆記組成可編輯敘事。"),
        ("研學任務", "支援遊前預習、現場探究與遊後報告。"),
        ("小澳語音導覽", "選定地點後聆聽建築介紹並繼續提問。"),
        ("AR眼鏡", "作為現場觀看地點提示與聆聽講解的載體。"),
    ]
    px_rect(pdf, 20, 878, 550, 207)
    row_h = 25.2
    for i, (name, detail) in enumerate(rows):
        yy = 883 + i * row_h
        px_rect(pdf, 24, yy, 541, row_h - 1.4, PALE if i % 2 == 0 else WHITE)
        txt(pdf, 74, yy + 2.5, name, 23, True, BLUE)
        txt(pdf, 228, yy + 2.5, detail, 21.5, False, INK)
        pdf.setStrokeColor(RULE)
        pdf.setLineWidth(0.8)
        pdf.line(23 * SX, PH - (yy + row_h) * SY, 565 * SX, PH - (yy + row_h) * SY)


def main():
    if not SRC.exists():
        raise FileNotFoundError(SRC)
    pdf = canvas.Canvas(str(OUT), pagesize=(PW, PH), pageCompression=1)
    pdf.setTitle("途見｜2026年澳門青少年科學家大會｜A0海報")
    pdf.setAuthor("林杰、李靖汐、馮梓雯")
    pdf.drawImage(ImageReader(str(SRC)), 0, 0, width=PW, height=PH)

    # 01: explain the cultural and technical scope without inflated claims.
    px_rect(pdf, 24, 390, 328, 175)
    prose(pdf, 30, 397, 314, 166,
          "「途見」以澳門地點為索引，連結網站、微信小程序、MacauSplat重建工具及Rokid AR眼鏡導覽載體。系統收錄著名景點，也讓騎樓、唐樓和街市等有特色的普通建築建立地點編號。旅客可查看真實照片、三維實景、來源資料和原聲故事；居民則可把個人經歷補充到具體地點，使城市記憶持續累積。",
          pts=26.5, leading=1.26)

    # 02: four user steps. Retain the AI's diagram and replace small text.
    steps = [
        (32, "在小程序查詢建築、周邊景點與文化路線。"),
        (170, "拍照取得候選，結合位置與多張照片確認；再看實景、照片，聽小澳介紹。"),
        (307, "經同意提交照片、文字或原聲。公開故事經審核，保留來源。"),
        (445, "把故事、人物和事件線索整理成記憶拼圖，回看探究成果。"),
    ]
    for x, copy in steps:
        px_rect(pdf, x, 660, 109, 111)
        prose(pdf, x + 4, 666, 101, 101, copy, pts=21.5, leading=1.22)

    # 03: real descriptions replace the icon-only grid.
    table(pdf)

    # 04: technical process and the reviewable annotation step.
    px_rect(pdf, 602, 390, 421, 96)
    prose(pdf, 609, 397, 407, 88,
          "MacauSplat以FFmpeg整理環繞拍攝素材，由COLMAP估計相機位姿及稀疏點雲，再由Brush訓練三維高斯潑濺模型。網站可即時瀏覽。團隊還利用重建位姿及三維包圍盒，把建築位置投影回拍攝影格，產生可人工覆核的標註資料。",
          pts=23.2, leading=1.22)
    px_rect(pdf, 601, 563, 421, 72)
    prose(pdf, 609, 570, 407, 64,
          "GMVR先以YOLO偵測建築區域，再以DINOv2檢索具體建築；定位品質與多張照片的一致性共同產生候選，由使用者確認身份及座標。",
          pts=24, leading=1.25)

    # 05: measured result, with its actual evaluation scope.
    px_rect(pdf, 590, 746, 433, 79)
    prose(pdf, 598, 753, 417, 72,
          "現有辨識參考庫涵蓋38棟建築、335張照片。參考庫留一法測試：Top-1為88.96%，Top-3為94.93%。這些數值只代表庫內檢索表現，不能當作獨立遊客照片的準確率；獨立實拍仍需另行檢驗。",
          pts=24.5, leading=1.22)

    # 06: website evidence heading, and 07: purpose and public value.
    px_rect(pdf, 38, 1138, 523, 31)
    prose(pdf, 40, 1143, 510, 25,
          "網站示範大三巴3DGS瀏覽、真實照片時間軸與可編輯記憶拼圖。",
          pts=23.5, leading=1.2)
    px_rect(pdf, 272, 1431, 764, 52)
    prose(pdf, 282, 1435, 748, 43,
          "讓旅客從熱門地標走入普通街區，讓居民、旅客與學生共同補充照片、聲音和故事。建築的空間面貌與人的日常記憶相互連結，形成可追溯、可更新、可持續累積的澳門文化記錄。",
          pts=24, leading=1.24)

    pdf.showPage()
    pdf.save()
    print(OUT)


if __name__ == "__main__":
    main()
