"""產生 A0 參賽展板（ISEF 附屬賽 · TECA 類別）。

為什麼用 PyMuPDF 排版而不是 HTML：本機沙箱禁止啟動瀏覽器（具名管道限制），
PyMuPDF 可以在純 Python 內排版、輸出可直接送印的 A0 PDF，並且能自己 rasterize
成 PNG 供我們檢查版面。

排版規範（A0 直式 841×1189 mm，觀看距離 1~1.5 m）：
    主標題 96pt / 副標 34pt / 章節標題 46pt / 內文 26pt / 圖說 21pt / 大數字 56pt

用法：python tools/poster/build_poster.py
產出：tools/poster/out/澳門記憶_展板_A0.pdf（送印）、…_A0.png（預覽）
"""
from __future__ import annotations

from pathlib import Path

import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[2]
EVAL_OUT = ROOT / "tools" / "eval" / "out"
OUT = ROOT / "tools" / "poster" / "out"
FONTS = Path(r"C:\Windows\Fonts")

SITE = "https://linference.github.io/macaumemory/"
REPO = "https://github.com/Linference/macaumemory"

MM = 72 / 25.4
PW, PH = 841 * MM, 1189 * MM
MARGIN = 24 * MM
CW = PW - 2 * MARGIN

INK = (0.063, 0.141, 0.227)
INK_SOFT = (0.16, 0.24, 0.33)
GOLD = (0.784, 0.635, 0.290)
TEAL = (0.145, 0.463, 0.529)
RED = (0.753, 0.224, 0.169)
PAPER = (0.969, 0.961, 0.945)
PANEL = (1.0, 1.0, 1.0)
TINT = (0.929, 0.949, 0.953)
TINT_RED = (0.988, 0.929, 0.914)
TINT_GOLD = (0.996, 0.976, 0.925)
LINE = (0.847, 0.824, 0.776)
GREY = (0.38, 0.42, 0.46)

FONT_REG = FONTS / "msjh.ttc"
FONT_BOLD = FONTS / "msjhbd.ttc"

S_TITLE, S_TITLE_EN, S_SUB, S_TAG = 92, 38, 33, 25
S_SECTION, S_PANEL, S_BODY, S_SMALL, S_CAP = 46, 34, 26, 22, 21
S_FLOW_T, S_FLOW_D = 28, 20
S_STAT, S_STAT_L = 54, 21
S_TBL = 23
ROW_H = 17 * MM


class Poster:
    def __init__(self):
        self.doc = fitz.open()
        self.page = self.doc.new_page(width=PW, height=PH)
        self.page.insert_font(fontname="zh", fontfile=str(FONT_REG))
        self.page.insert_font(fontname="zhb", fontfile=str(FONT_BOLD))
        self.f_reg = fitz.Font(fontfile=str(FONT_REG))
        self.f_bold = fitz.Font(fontfile=str(FONT_BOLD))
        self.page.draw_rect(fitz.Rect(0, 0, PW, PH), color=None, fill=PAPER)
        self.css = ("@font-face{font-family:zh;src:url('msjh.ttc');}"
                    "@font-face{font-family:zhb;src:url('msjhbd.ttc');}"
                    "*{font-family:zh;}")
        self.arch = fitz.Archive(str(FONTS))

    # ---------------------------------------------------------- 文字
    def text(self, x, y, s, size=S_BODY, bold=False, color=INK):
        self.page.insert_text((x, y), s, fontname="zhb" if bold else "zh", fontsize=size, color=color)
        return x + self.width(s, size, bold)

    def width(self, s, size=S_BODY, bold=False):
        return (self.f_bold if bold else self.f_reg).text_length(s, fontsize=size)

    def wrap(self, s, size, box_w, bold=False):
        f = self.f_bold if bold else self.f_reg
        lines, cur = [], ""
        for ch in s:
            if ch == "\n":
                lines.append(cur); cur = ""; continue
            if f.text_length(cur + ch, fontsize=size) > box_w and cur:
                lines.append(cur); cur = ch
            else:
                cur += ch
        if cur:
            lines.append(cur)
        return lines

    def para(self, x, y, s, size=S_BODY, box_w=None, color=INK, bold=False, leading=1.5):
        """y 為『首行基線』；回傳下一段可用的 y（已含行距）。"""
        box_w = box_w or CW
        lines = self.wrap(s, size, box_w, bold)
        lh = size * leading
        for i, ln in enumerate(lines):
            self.text(x, y + i * lh, ln, size=size, bold=bold, color=color)
        return y + (len(lines) - 1) * lh + lh

    def html(self, rect, html, size=S_BODY, leading=1.5):
        self.page.insert_htmlbox(rect, f"<div style='font-size:{size}pt;line-height:{leading}'>{html}</div>",
                                 css=self.css, archive=self.arch)

    # ---------------------------------------------------------- 圖形
    def rect(self, r, fill=PANEL, stroke=LINE, width=1.2):
        self.page.draw_rect(fitz.Rect(r), color=stroke, fill=fill, width=width)

    def badge(self, x, y, s, size=22, bg=GOLD, fg=(1, 1, 1), pad=9):
        w = self.width(s, size, True) + 2 * pad
        h = size * 1.85
        self.page.draw_rect(fitz.Rect(x, y, x + w, y + h), color=None, fill=bg)
        self.text(x + pad, y + h - size * 0.62, s, size=size, bold=True, color=fg)
        return w

    def section(self, y, num, title, color=INK):
        h = 16 * MM
        self.page.draw_rect(fitz.Rect(MARGIN, y + 1 * MM, MARGIN + 4.5 * MM, y + h - 1 * MM), color=None, fill=color)
        self.text(MARGIN + 8 * MM, y + h - 5.5 * MM, f"{num}　{title}", size=S_SECTION, bold=True, color=color)
        return y + h + 3 * MM

    def figure(self, path, rect, caption=None):
        path = Path(path)
        if not path.exists():
            self.rect(rect, fill=(0.94, 0.94, 0.92))
            self.text(rect.x0 + 8, rect.y0 + 24, f"（缺少圖檔 {path.name}）", size=S_SMALL, color=GREY)
            return rect.y1
        if path.suffix.lower() == ".svg":
            # 向量圖：SVG → PDF → show_pdf_page，放大不失真（送印用）
            svg = fitz.open(str(path))
            pdf = fitz.open("pdf", svg.convert_to_pdf())
            self.page.show_pdf_page(fitz.Rect(rect), pdf, 0)
            pdf.close()
            svg.close()
        else:
            self.page.insert_image(fitz.Rect(rect), filename=str(path), keep_proportion=True)
        if caption:
            return self.para(rect.x0, rect.y1 + 8 * MM, caption, size=S_CAP, box_w=rect.width, color=GREY)
        return rect.y1

    def table(self, x, y, headers, rows, col_w, size=S_TBL, row_h=ROW_H, highlight=()):
        total = sum(col_w)
        self.page.draw_rect(fitz.Rect(x, y, x + total, y + row_h), color=None, fill=INK)
        cx = x
        for h, w in zip(headers, col_w):
            self.text(cx + 4 * MM, y + row_h - 5.4 * MM, h, size=size, bold=True, color=(1, 1, 1))
            cx += w
        yy = y + row_h
        for i, row in enumerate(rows):
            fill = (0.976, 0.965, 0.945) if i % 2 else (1, 1, 1)
            if i in highlight:
                fill = TINT_GOLD
            self.page.draw_rect(fitz.Rect(x, yy, x + total, yy + row_h), color=None, fill=fill)
            cx = x
            for j, (cell, w) in enumerate(zip(row, col_w)):
                self.text(cx + 4 * MM, yy + row_h - 5.4 * MM, str(cell), size=size, bold=(j == 0), color=INK)
                cx += w
            self.page.draw_line(fitz.Point(x, yy + row_h), fitz.Point(x + total, yy + row_h), color=LINE, width=0.7)
            yy += row_h
        return yy

    def save(self):
        OUT.mkdir(parents=True, exist_ok=True)
        try:
            self.doc.subset_fonts()
        except Exception as e:
            print("subset_fonts 略過：", e)
        pdf = OUT / "澳門記憶_展板_A0.pdf"
        self.doc.save(str(pdf), deflate=True, garbage=4)
        d = fitz.open(str(pdf))
        png = OUT / "澳門記憶_展板_A0.png"
        d[0].get_pixmap(dpi=96).save(str(png))
        d.close()
        print(f"[poster] {pdf}  ({pdf.stat().st_size / 1e6:.2f} MB)")
        print(f"[poster] {png}")
        return pdf, png


def make_qr(url: str, path: Path):
    """用 reportlab 產生向量 QR，存成單頁 PDF 供 show_pdf_page 使用（避開 pycairo 依賴）。"""
    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode import qr
    from reportlab.graphics.shapes import Drawing

    w = qr.QrCodeWidget(url, barLevel="M")
    b = w.getBounds()
    size = 400
    d = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
    d.add(w)
    renderPDF.drawToFile(d, str(path), showBoundary=0)
    return path


def make_strip(dst: Path, aspect: float, size=(705, 300), prefer=(), limit=8) -> list[Path]:
    """把 preview/ 的系統截圖置中裁成統一比例，做成作品圖帶。
    prefer 指定最具展示效果的檔名（依序），不足再由檔名排序補齊。"""
    from PIL import Image

    src_dir = ROOT / "preview"
    all_shots = {s.name: s for s in sorted(src_dir.glob("*.jpg")) + sorted(src_dir.glob("*.png"))}
    picked = [all_shots[n] for n in prefer if n in all_shots]
    picked += [s for n, s in all_shots.items() if n not in set(prefer)]
    shots = picked[:limit]

    dst.mkdir(parents=True, exist_ok=True)
    for f in dst.glob("*.jpg"):
        f.unlink()
    out = []
    for i, s in enumerate(shots):
        try:
            im = Image.open(s).convert("RGB")
        except Exception:
            continue
        w, h = im.size
        target = aspect
        if w / h > target:          # 太寬 → 裁左右
            nw = int(h * target)
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:                        # 太高 → 裁上下（保留上方，建築通常在畫面中上）
            nh = int(w / target)
            top = max(0, int((h - nh) * 0.35))
            im = im.crop((0, top, w, top + nh))
        im = im.resize(size, Image.LANCZOS)
        p = dst / f"{i:02d}.jpg"
        im.save(p, quality=88)
        out.append(p)
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    p = Poster()
    page = p.page

    # ---------------------------------------------------------- 標題帶 + 作品圖帶
    HEAD = 196 * MM
    page.draw_rect(fitz.Rect(0, 0, PW, HEAD), color=None, fill=INK)
    page.draw_rect(fitz.Rect(0, HEAD, PW, HEAD + 3 * MM), color=None, fill=GOLD)

    p.text(MARGIN, 46 * MM, "建築記憶點", size=S_TITLE, bold=True, color=(1, 1, 1))
    x = MARGIN + p.width("建築記憶點", S_TITLE, True) + 12 * MM
    p.text(x, 46 * MM, "Building Face-ID", size=S_TITLE_EN, bold=True, color=GOLD)
    p.text(MARGIN, 72 * MM, "以零樣本視覺重辨識，為澳門歷史建築建立永久數位身分", size=S_SUB, bold=True, color=(0.93, 0.94, 0.96))
    p.text(MARGIN, 92 * MM, "Zero-Shot Visual Re-identification for Macau's Architectural Heritage", size=S_TAG, color=(0.70, 0.77, 0.85))
    p.text(MARGIN, 112 * MM, "拍照 → 自動辨識「是不是同一棟」 → 歸入永久編號 MM-#### → 在 3D 地圖上成為記憶點",
           size=S_TAG + 2, bold=True, color=(0.88, 0.90, 0.93))

    bx = MARGIN
    bx += p.badge(bx, 122 * MM, "澳門創新學界 · ISEF 選拔賽", 19, bg=GOLD) + 5 * MM
    p.badge(bx, 122 * MM, "類別：Technology Enhances the Arts (TECA)", 19, bg=TEAL)

    qr_doc = fitz.open(str(make_qr(SITE, OUT / "_qr.pdf")))
    qr_rect = fitz.Rect(PW - MARGIN - 58 * MM, 26 * MM, PW - MARGIN, 84 * MM)
    page.draw_rect(qr_rect + (-4 * MM, -4 * MM, 4 * MM, 4 * MM), color=None, fill=(1, 1, 1))
    page.show_pdf_page(qr_rect, qr_doc, 0)
    qr_doc.close()
    p.text(PW - MARGIN - 58 * MM, 96 * MM, "掃描開啟線上 3D 澳門地圖", size=S_CAP, color=(0.88, 0.91, 0.94))
    p.text(PW - MARGIN - 58 * MM, 106 * MM, "61 景點 · 8 個 3D 文物模型 · AI 導覽", size=19, color=(0.70, 0.77, 0.85))

    # 作品畫面圖帶
    strip_h = 44 * MM
    strip_y = HEAD - strip_h - 6 * MM
    p.text(MARGIN, strip_y - 5 * MM, "實際作品畫面 Actual system — 3D 澳門地圖 · 景點與文物模型 · 照片記憶點",
           size=20, bold=True, color=GOLD)
    shots = make_strip(
        OUT / "_strip", aspect=2.35, size=(1230, 523), limit=8,
        prefer=[
            "01-全景-3D澳門.jpg",              # 3D 立體澳門全景
            "02-大三巴-三維建築.jpg",          # OSM 建築三維化
            "07-唐三彩雙峰駱駝俑-三維模型.jpg",  # 文物 GLB 模型
            "41-記憶點圖層.jpg",               # 記憶點圖層
            "42-記憶點彈窗.jpg",               # 點開記憶點 → 解讀
            "43-記憶點卡片與照片時間軸.jpg",    # 同一棟的時間軸
            "44-景點記憶點相簿.jpg",           # 景點相簿
            "32-AI導覽助理.jpg",               # AI 導覽
        ])
    if shots:
        gap = 4 * MM
        iw = (CW - gap * (len(shots) - 1)) / len(shots)
        for i, s in enumerate(shots):
            x0 = MARGIN + i * (iw + gap)
            page.draw_rect(fitz.Rect(x0 - 0.5 * MM, strip_y - 0.5 * MM, x0 + iw + 0.5 * MM, strip_y + strip_h + 0.5 * MM),
                           color=None, fill=(1, 1, 1))
            page.insert_image(fitz.Rect(x0, strip_y, x0 + iw, strip_y + strip_h), filename=str(s))

    y = HEAD + 14 * MM

    # ---------------------------------------------------------- 研究問題 + 創新點（175mm）
    gap = 8 * MM
    lw = CW * 0.55
    rw = CW - lw - gap
    bh = 182 * MM

    p.rect(fitz.Rect(MARGIN, y, MARGIN + lw, y + bh), fill=PANEL)
    page.draw_rect(fitz.Rect(MARGIN, y, MARGIN + lw, y + 3 * MM), color=None, fill=RED)
    p.text(MARGIN + 8 * MM, y + 20 * MM, "研究問題 Research Question", size=S_PANEL, bold=True, color=RED)
    yy = p.para(MARGIN + 8 * MM, y + 36 * MM,
                "在不為每棟建築標註訓練資料的前提下，能否結合 CLIP 零樣本視覺嵌入與地理先驗，"
                "為城市建築建立穩定、可重複識別的永久編號？",
                size=S_BODY + 2, box_w=lw - 16 * MM, color=INK, bold=True, leading=1.55)
    yy = p.para(MARGIN + 8 * MM, yy + 7 * MM,
                "假設：同一棟建築在不同角度、距離與光線下的 CLIP 影像嵌入餘弦相似度，顯著高於不同建築之間；"
                "再疊加 90 公尺地理先驗後，誤判可被進一步消除。",
                size=S_BODY, box_w=lw - 16 * MM, color=GREY, leading=1.45)
    p.para(MARGIN + 8 * MM, yy + 7 * MM,
           "核心主張：把流浪貓臉辨識（Visual Place Recognition）的問題搬到文化遺產建檔上，並用實驗量出它的能力邊界。",
           size=S_BODY, box_w=lw - 16 * MM, color=TEAL, bold=True, leading=1.45)

    rx = MARGIN + lw + gap
    p.rect(fitz.Rect(rx, y, rx + rw, y + bh), fill=PANEL)
    page.draw_rect(fitz.Rect(rx, y, rx + rw, y + 3 * MM), color=None, fill=TEAL)
    p.text(rx + 8 * MM, y + 20 * MM, "三個創新點 Innovation", size=S_PANEL, bold=True, color=TEAL)
    items = [
        ("1", "跨域遷移", "首次把視覺重辨識（VPR）用於城市文化遺產建檔，並做成公眾可用的平台。"),
        ("2", "方法融合", "地理先驗（OSM 建築／景點）＋ 視覺相似度雙重驗證，0.86／0.80 兩段式決策。"),
        ("3", "零成本可及", "全開放資料與免費工具鏈，手機拍照到地圖成點 < 30 秒，人人可建檔。"),
    ]
    iy = y + 34 * MM
    for num, t, d in items:
        page.draw_circle(fitz.Point(rx + 12 * MM, iy - 2.5 * MM), 5.6 * MM, color=None, fill=TEAL)
        p.text(rx + 9.6 * MM, iy, num, size=22, bold=True, color=(1, 1, 1))
        p.text(rx + 22 * MM, iy, t, size=S_BODY + 2, bold=True, color=INK)
        iy = p.para(rx + 22 * MM, iy + 13 * MM, d, size=S_BODY, box_w=rw - 30 * MM, color=GREY, leading=1.45) + 6 * MM

    y += bh + 12 * MM

    # ---------------------------------------------------------- 方法流程（135mm）
    y = p.section(y, "①", "方法：從一張照片到一個永久記憶點")
    flow_h = 95 * MM
    steps = [
        ("拍照", "手機原圖\nEXIF 取 GPS 與時間"),
        ("前處理", "EXIF 轉正、縮圖\nYOLO 物件偵測＋隱私模糊"),
        ("視覺嵌入", "CLIP ViT-B/32\n512 維影像向量"),
        ("地理先驗", "90 m 內既有記憶點\n作為候選（關鍵一步）"),
        ("相似度驗證", "餘弦相似度\n≥0.86 併入 / 0.80 待複核"),
        ("建檔", "永久編號 MM-####\nDeepSeek 撰寫建築解讀"),
    ]
    arrow = 6 * MM
    bw = (CW - 5 * arrow) / 6
    for i, (t, d) in enumerate(steps):
        x0 = MARGIN + i * (bw + arrow)
        hot = i in (3, 4)
        p.rect(fitz.Rect(x0, y, x0 + bw, y + flow_h), fill=TINT if hot else PANEL,
               stroke=TEAL if hot else LINE, width=2.2 if hot else 1.2)
        p.text(x0 + 6 * MM, y + 20 * MM, t, size=S_FLOW_T, bold=True, color=TEAL if hot else INK)
        p.para(x0 + 6 * MM, y + 34 * MM, d, size=S_FLOW_D, box_w=bw - 12 * MM, color=GREY, leading=1.55)
        if i < 5:
            ax = x0 + bw + 1.2 * MM
            cy = y + flow_h / 2
            page.draw_line(fitz.Point(ax, cy), fitz.Point(ax + 3.6 * MM, cy), color=GOLD, width=3)
            page.draw_line(fitz.Point(ax + 3.6 * MM, cy), fitz.Point(ax + 1.6 * MM, cy - 1.8 * MM), color=GOLD, width=3)
            page.draw_line(fitz.Point(ax + 3.6 * MM, cy), fitz.Point(ax + 1.6 * MM, cy + 1.8 * MM), color=GOLD, width=3)
    y += flow_h + 8 * MM
    p.para(MARGIN, y, "關鍵設計：地理先驗負責「不可能是我」，視覺比對只負責「同一棟的不同角度」——兩者互補，"
                      "這是本專案最重要的方法論主張，並由下方實驗數據支持。",
           size=S_BODY, box_w=CW, color=RED, bold=True, leading=1.5)
    y += 15 * MM

    # ---------------------------------------------------------- 結果（一）
    y = p.section(y, "②", "結果（一）：能不能認出同一棟？（受控渲染 vs 真實照片）")
    fig_h = 124 * MM
    fw = (CW - 10 * MM) / 2
    p.figure(EVAL_OUT / "fig-roc.svg", fitz.Rect(MARGIN, y, MARGIN + fw, y + fig_h))
    p.figure(EVAL_OUT / "fig-hist-E1r_實拍真實照片.svg",
             fitz.Rect(MARGIN + fw + 10 * MM, y, MARGIN + 2 * fw + 10 * MM, y + fig_h))
    y += fig_h + 9 * MM
    p.para(MARGIN, y, "左：ROC 曲線——受控渲染 0.950、文物 0.998、跨條件 0.850、"
                      "真實照片 0.796（101 張 Commons 實拍、20 棟建築、205 組正樣本／4845 組負樣本）。"
                      "右：真實照片的相似度分布——同棟 0.716、不同棟 0.578，兩者重疊區明顯比渲染圖大，"
                      "所以渲染圖調出來的 0.86 直接套到實拍會失效。",
           size=S_CAP, box_w=CW, color=GREY, leading=1.5)
    y += 14 * MM

    stats = [("0.950 → 0.796", "AUC：受控渲染 → 真實照片", TEAL, TINT),
             ("0.901 / 0.716", "同棟平均相似度：渲染 / 實拍", TEAL, TINT),
             ("61.0% / 8.8%", "實拍在閾值 0.70 的認出率 / 誤判率", TEAL, TINT),
             ("53.5%", "CLIP 零樣本分類準確率（實拍 12 類）", RED, TINT_RED)]
    sw = (CW - 3 * 7 * MM) / 4
    sh = 38 * MM
    for i, (v, lab, col, bg) in enumerate(stats):
        x0 = MARGIN + i * (sw + 7 * MM)
        page.draw_rect(fitz.Rect(x0, y, x0 + sw, y + sh), color=None, fill=bg)
        p.text(x0 + 7 * MM, y + 22 * MM, v, size=S_STAT, bold=True, color=col)
        p.para(x0 + 7 * MM, y + 32 * MM, lab, size=S_STAT_L, box_w=sw - 14 * MM, color=INK_SOFT, leading=1.35)
    y += sh + 12 * MM

    # ---------------------------------------------------------- 結果（二）（165mm）
    y = p.section(y, "③", "結果（二）：閾值必須用真實照片重新校準")
    tbl_w = CW * 0.56
    p.text(MARGIN, y + 8 * MM, "同一組閾值，在渲染圖與真實照片上的表現完全不同", size=S_BODY, bold=True, color=INK)
    ty = p.table(MARGIN, y + 14 * MM,
                 ["閾值", "渲染：認出", "渲染：誤判", "實拍：認出", "實拍：誤判"],
                 [("0.70", "100.0%", "75.8%", "61.0%", "8.8%"),
                  ("0.80", "99.1%", "27.9%", "28.8%", "0.9%"),
                  ("0.86", "86.1%", "12.2%", "14.1%", "0.0%"),
                  ("0.90", "54.2%", "3.1%", "5.4%", "0.0%")],
                 [tbl_w * 0.2] * 5, highlight={2})
    p.para(MARGIN, y + 14 * MM + 5 * ROW_H + 10 * MM,
           "結論：目前產品用的 0.86 是在渲染圖上調出來的，套到真實照片只認得出 14.1% 的同一棟建築；"
           "真實照片應改用 0.70–0.80，並由地理先驗（90 m）負責精確率。",
           size=S_CAP, box_w=tbl_w, color=RED, bold=True, leading=1.5)

    x2 = MARGIN + tbl_w + 10 * MM
    w2 = CW - tbl_w - 10 * MM
    p.text(x2, y + 8 * MM, "誤判來源分析：全部集中在路氹城度假村群", size=S_BODY, bold=True, color=INK)
    ty2 = p.table(x2, y + 14 * MM,
                  ["建築配對", "平均相似度", ">0.86 比例"],
                  [("澳門倫敦人 vs 澳門銀河", "0.874", "72.2%"),
                   ("澳門巴黎人 vs 澳門銀河", "0.840", "31.2%"),
                   ("澳門倫敦人 vs 澳門巴黎人", "0.826", "18.8%"),
                   ("其餘 7 組配對", "0.70~0.75", "0.0%")],
                  [w2 * 0.52, w2 * 0.24, w2 * 0.24], highlight={0})
    p.para(x2, ty2 + 12 * MM,
           "而這三棟兩兩相距 ≥ 296 公尺 → 90 公尺 GPS 先驗可直接排除全部誤判候選。",
           size=S_BODY, box_w=w2, color=RED, bold=True, leading=1.45)
    y = max(ty + 12 * MM + 26 * MM, ty2 + 12 * MM + 24 * MM) + 10 * MM

    # ---------------------------------------------------------- 資料來源（150mm）
    y = p.section(y, "④", "資料來源與研究誠信 Data provenance")
    prov_h = 108 * MM
    p.rect(fitz.Rect(MARGIN, y, MARGIN + CW, y + prov_h), fill=TINT_GOLD, stroke=GOLD)
    page.draw_rect(fitz.Rect(MARGIN, y, MARGIN + 3 * MM, y + prov_h), color=None, fill=GOLD)
    p.para(MARGIN + 10 * MM, y + 18 * MM, "本展板所有數字都標明來源，且可用一條指令完整重跑：",
           size=S_SMALL + 2, box_w=CW - 20 * MM, color=INK, bold=True)
    prov = [
        "真實照片（real-cc）：Wikimedia Commons 101 張、20 棟澳門建築、涵蓋 12 類；"
        "授權為 CC BY／CC BY-SA／CC0／公有領域（作者與出處見 ATTRIBUTION.csv）。",
        "受控實驗（render-*）：7 個 GLB 模型 × 20 視角 = 140 張渲染圖；用來量出辨識上界，並與實拍對照域偏移。",
        "地圖截圖（demo-map）／舊版裁切（demo-crop）：前者做跨呈現比較；後者是同圖裁切的資料洩漏對照，已排除。",
        "隱私處理實測：yolo11n-face 偵測人臉 ＋ yolo11n person 兩級模糊；實拍中模糊人臉 28 處、人物 205 處。",
        "範圍界定：辨識與分類指標（①–③）只使用 CLIP 影像嵌入；YOLO 只用於偵測與隱私模糊。",
        "學生手機實拍（real-phone）：建立中，將以同一套腳本再產出一次真實世界的 ROC 與閾值。",
    ]
    py = y + 29 * MM
    for s in prov:
        page.draw_circle(fitz.Point(MARGIN + 13 * MM, py - 3 * MM), 1.9 * MM, color=None, fill=GOLD)
        py = p.para(MARGIN + 19 * MM, py, s, size=S_CAP, box_w=CW - 28 * MM, color=INK_SOFT, leading=1.4) + 2 * MM
    y += prov_h + 10 * MM

    # ---------------------------------------------------------- 限制與下一步
    y = p.section(y, "⑤", "限制與下一步")
    lim_h = 62 * MM
    p.rect(fitz.Rect(MARGIN, y, MARGIN + CW, y + lim_h), fill=PANEL)
    yy = p.para(MARGIN + 10 * MM, y + 19 * MM,
                "限制：實拍 AUC 0.813 明顯低於渲染 0.950；同棟相似度 5% 分位僅 0.448；CLIP 零樣本分類在實拍為 53.5%，"
                "仍不足以單獨決定建築類型，因此分類由地理先驗主導。",
                size=S_SMALL + 2, box_w=CW - 20 * MM, color=GREY, leading=1.45)
    p.para(MARGIN + 10 * MM, yy + 7 * MM,
           "下一步：① 依實拍重新校準閾值（0.70~0.80）＋人工複核　② 影像編碼器換 DINOv2　"
           "③ 記憶點時間軸與複核 UI　④ 學生手機實拍驗證　⑤ 開放公眾拍照上傳。",
           size=S_SMALL + 2, box_w=CW - 20 * MM, color=TEAL, bold=True, leading=1.45)
    y += lim_h + 6 * MM

    # ---------------------------------------------------------- 頁腳
    FOOT = 26 * MM
    page.draw_rect(fitz.Rect(0, PH - FOOT, PW, PH), color=None, fill=INK)
    p.text(MARGIN, PH - FOOT + 10 * MM,
           f"可重現：python tools/eval/render_views.py → build_dataset.py → evaluate.py　|　"
           f"程式與資料：{REPO}　|　線上展示：{SITE}",
           size=S_CAP, color=(0.85, 0.88, 0.92))
    p.text(MARGIN, PH - FOOT + 18.5 * MM,
           "澳門記憶 macaumemory · 澳門創新學界（ISEF 附屬賽）· TECA 類別",
           size=19, color=(0.64, 0.70, 0.78))

    p.save()
    print(f"[layout] 內容底部 y = {y / MM:.0f} mm；頁腳起點 = {(PH - FOOT) / MM:.0f} mm；"
          f"{'OK' if y < PH - FOOT - 3 * MM else '⚠ 溢出，需壓縮 ' + str(round((y - (PH - FOOT - 3 * MM)) / MM)) + ' mm'}")


if __name__ == "__main__":
    main()
