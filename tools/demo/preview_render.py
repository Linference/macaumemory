"""產生示範頁的「版面預覽圖」（沙箱內沒有瀏覽器可截圖，這裡用同一份資料畫一張等效預覽）。

注意：這是**版面示意圖**，不是瀏覽器截圖；目的是讓你在不開瀏覽器的情況下先看效果。
真正的互動頁面是 tools/demo/index.html（雙擊即可，file:// 可跑）。

用法：python tools/demo/preview_render.py
產出：tools/demo/out/demo-preview.png
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "demo" / "out"
FONTS = Path(r"C:\Windows\Fonts")
W, H = 1680, 950

INK = (11, 22, 34)
INK2 = (22, 50, 77)
GOLD = (200, 162, 74)
TEAL = (42, 127, 143)
RED = (192, 57, 43)
GREY = (147, 166, 184)
WHITE = (238, 242, 246)
PANEL_LINE = (29, 58, 85)
PAPER = (251, 250, 247)

BBOX = dict(lon0=113.525, lon1=113.600, lat0=22.103, lat1=22.222)
MAPW = 100.0
MAPH = 100.0 * ((BBOX["lat1"] - BBOX["lat0"]) / ((BBOX["lon1"] - BBOX["lon0"]) * 0.9262))
RESORTS = [("澳門銀河", 113.5543, 22.1466), ("澳門倫敦人", 113.5571, 22.1460), ("澳門巴黎人", 113.5607, 22.1437)]


def F(size, bold=False):
    return ImageFont.truetype(str(FONTS / ("msjhbd.ttc" if bold else "msjh.ttc")), size, index=0)


def proj(lon, lat):
    return ((lon - BBOX["lon0"]) / (BBOX["lon1"] - BBOX["lon0"]) * MAPW,
            (BBOX["lat1"] - lat) / (BBOX["lat1"] - BBOX["lat0"]) * MAPH)


def panel(d, box, title):
    d.rounded_rectangle(box, 10, fill=INK2, outline=PANEL_LINE, width=1)
    d.text((box[0] + 14, box[1] + 12), title, font=F(17, True), fill=GOLD)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    archive = json.loads((ROOT / "public" / "data" / "photo-archive.json").read_text(encoding="utf-8"))
    boundary = json.loads((ROOT / "public" / "data" / "macau-boundary.geojson").read_text(encoding="utf-8"))
    places = {p["id"]: p for p in archive["places"]}
    big = places["MM-0001"]          # 拍照 ①（併入）
    newp = places["MM-0004"]         # 拍照 ②（新建）

    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)

    # ---------------- header ----------------
    d.rectangle((0, 0, W, 66), fill=(15, 32, 51))
    d.rectangle((0, 66, W, 70), fill=GOLD)
    d.text((24, 18), "建築記憶點", font=F(30, True), fill=WHITE)
    d.text((178, 28), "Building Face-ID · 90 秒現場演示", font=F(15), fill=(159, 176, 192))
    bw = 250
    d.rounded_rectangle((W - bw - 396, 20, W - 396, 48), 4, fill=TEAL)
    d.text((W - bw - 386, 27), "示範重播 · 產線實際輸出", font=F(13, True), fill=WHITE)
    d.rounded_rectangle((W - 386, 20, W - 24, 48), 4, fill=(122, 92, 18))
    d.text((W - 376, 27), "測試素材為 3D 模型截圖（非實拍）", font=F(13, True), fill=(255, 245, 220))

    # ---------------- ① 流程 ----------------
    b1 = (20, 84, 330, 880)
    panel(d, b1, "① 歸戶流程")
    steps = [("① EXIF 讀取", "GPS 與拍攝時間", "done"),
             ("② YOLO 物件偵測", "隱私模糊（Haar 不可用 → yolo-person）", "done"),
             ("③ CLIP 視覺嵌入", "512 維影像向量", "done"),
             ("④ 地理先驗", "90 m 內既有記憶點作為候選", "done"),
             ("⑤ 相似度驗證", "餘弦相似度比對", "done"),
             ("⑥ 建檔／歸戶", "永久編號 + DeepSeek 解讀", "active")]
    y = 124
    for i, (t, s, st) in enumerate(steps):
        box = (b1[0] + 14, y, b1[2] - 14, y + 56)
        fill = (18, 55, 77) if st == "active" else (14, 36, 56)
        d.rounded_rectangle(box, 8, fill=fill, outline=TEAL if st == "active" else PANEL_LINE, width=2 if st == "active" else 1)
        dot = (47, 158, 107) if st == "done" else TEAL
        d.ellipse((box[0] + 12, y + 18, box[0] + 32, y + 38), fill=dot)
        d.text((box[0] + 17, y + 21), "✓" if st == "done" else str(i + 1), font=F(13, True), fill=WHITE)
        d.text((box[0] + 44, y + 12), t, font=F(15, True), fill=WHITE if st == "active" else (200, 214, 226))
        d.text((box[0] + 44, y + 33), s, font=F(12), fill=(125, 146, 165))
        y += 64
    d.rounded_rectangle((b1[0] + 14, 800, b1[2] - 14, 848), 8, fill=(14, 36, 56), outline=PANEL_LINE)
    d.text((b1[0] + 26, 812), "答辯細節（D）", font=F(14, True), fill=(180, 200, 218))
    d.text((b1[0] + 26, 830), "AUC 0.950 · 誤判率 12.2%", font=F(12), fill=GREY)

    # ---------------- ② 手機 ----------------
    b2 = (350, 84, 812, 880)
    panel(d, b2, "② 手機（拍照現場）")
    ph = big["photos"][1]
    shot = Image.open(ROOT / "public" / ph["file"])
    sw = b2[2] - b2[0] - 28
    sh = int(sw * 0.62)
    shot = shot.resize((sw, sh))
    img.paste(shot, (b2[0] + 14, 122))
    yy = 122 + sh + 10
    d.text((b2[0] + 14, yy), f'EXIF  GPS {big["coords"][1]:.6f}, {big["coords"][0]:.6f}', font=F(13), fill=(92, 102, 112))
    d.text((b2[0] + 14, yy + 20), f'時間 {big["firstSeen"].replace("T", " ")[:19]}  檔案 {ph["file"].split("/")[-1]}', font=F(13), fill=(92, 102, 112))
    yy += 48
    rows = [
        ("①", "YOLO 物件偵測（實測）：refrigerator×1", PAPER, (217, 211, 199)),
        ("②", "CLIP ViT-B/32 → 512 維影像向量", PAPER, (217, 211, 199)),
        ("③", "地理先驗：90 m 內候選 1 個（MM-0001 大三巴牌坊）", PAPER, (217, 211, 199)),
        ("④", "相似度比對：0.903", PAPER, (217, 211, 199)),
        ("⑤", "併入既有記憶點 MM-0001 大三巴牌坊（0.903 ≥ 0.86 → 同一棟）", (234, 246, 239), (159, 211, 180)),
        ("⑥", "隱私處理：yolo-person，模糊 0 處（測試圖為 3D 渲染，無人）", PAPER, (217, 211, 199)),
    ]
    for ico, txt, bg, br in rows:
        h = 34 if len(txt) < 40 else 52
        d.rounded_rectangle((b2[0] + 14, yy, b2[2] - 14, yy + h), 8, fill=bg, outline=br)
        d.text((b2[0] + 26, yy + 9), ico, font=F(15), fill=(30, 40, 50))
        d.text((b2[0] + 54, yy + 9), txt[:34], font=F(13, True), fill=(15, 32, 51))
        if len(txt) >= 40:
            d.text((b2[0] + 54, yy + 28), txt[34:70], font=F(13), fill=(70, 80, 90))
        yy += h + 8
    d.rounded_rectangle((b2[0] + 14, yy, b2[2] - 14, yy + 96), 8, fill=PAPER, outline=(217, 211, 199))
    d.text((b2[0] + 26, yy + 9), "⑥", font=F(15), fill=(30, 40, 50))
    d.text((b2[0] + 54, yy + 9), f'這棟建築的時間軸（共 {len(big["photos"])} 張）', font=F(13, True), fill=(15, 32, 51))
    tx = b2[0] + 54
    for p in big["photos"]:
        im = Image.open(ROOT / "public" / p["file"])
        th = 60
        tw = int(im.width / im.height * th)
        tw = min(tw, 130)
        im = im.resize((tw, th))
        img.paste(im, (tx, yy + 30))
        tx += tw + 8

    # ---------------- ③ 地圖 ----------------
    b3 = (832, 84, W - 20, 880)
    panel(d, b3, "③ 記憶點地圖（澳門）")
    mx0, my0, mx1, my1 = b3[0] + 20, b3[1] + 50, b3[2] - 20, b3[3] - 20
    scale = min((mx1 - mx0) / MAPW, (my1 - my0) / MAPH)
    ox = mx0 + ((mx1 - mx0) - MAPW * scale) / 2
    oy = my0 + ((my1 - my0) - MAPH * scale) / 2

    def mp(lon, lat):
        x, y = proj(lon, lat)
        return (ox + x * scale, oy + y * scale)

    for f in boundary.get("features", []):
        g = f.get("geometry") or {}
        polys = [g["coordinates"]] if g.get("type") == "Polygon" else (g.get("coordinates") if g.get("type") == "MultiPolygon" else [])
        for poly in polys:
            for ring in poly:
                if len(ring) < 4:
                    continue
                pts = [mp(c[0], c[1]) for c in ring]
                d.polygon(pts, outline=(60, 88, 118))
    # 度假村群 + 90m 圈
    for name, lon, lat in RESORTS:
        x, y = mp(lon, lat)
        r = 90 / (111320 * 0.9262) / (BBOX["lon1"] - BBOX["lon0"]) * MAPW * scale
        d.ellipse((x - r, y - r, x + r, y + r), outline=GOLD)
        d.rectangle((x - 6, y - 5, x + 6, y + 5), fill=(49, 70, 92), outline=(93, 119, 147))
        d.text((x + 9, y - 8), name, font=F(11), fill=(143, 163, 184))
    # 記憶點
    for pid, p in places.items():
        x, y = mp(p["coords"][0], p["coords"][1])
        d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=RED, outline=WHITE, width=2)
        d.text((x + 12, y - 9), f'{pid} {p["zh"]}', font=F(13, True), fill=(233, 238, 244))
    x, y = mp(big["coords"][0], big["coords"][1])
    r = 90 / (111320 * 0.9262) / (BBOX["lon1"] - BBOX["lon0"]) * MAPW * scale
    d.ellipse((x - r, y - r, x + r, y + r), outline=GOLD, width=2)
    # 旁白
    nb = (b3[0] + 300, b3[1] + 62, b3[2] - 30, b3[1] + 152)
    d.rounded_rectangle(nb, 8, fill=(200, 162, 74))
    d.text((nb[0] + 14, nb[1] + 12), "「同一個角度換一張，相似度 0.903，", font=F(15, True), fill=(32, 22, 10))
    d.text((nb[0] + 14, nb[1] + 34), "超過 0.86 的門檻 → 自動併入", font=F(15, True), fill=(32, 22, 10))
    d.text((nb[0] + 14, nb[1] + 56), "同一個編號 MM-0001。」", font=F(15, True), fill=(32, 22, 10))
    # 圖例
    lb = (b3[0] + 20, b3[3] - 74, b3[0] + 560, b3[3] - 20)
    d.rounded_rectangle(lb, 8, fill=(13, 26, 40), outline=PANEL_LINE)
    d.text((lb[0] + 12, lb[1] + 10), "● 記憶點（一棟一號）   ◌ 90 m 地理先驗範圍", font=F(12), fill=(169, 188, 205))
    d.text((lb[0] + 12, lb[1] + 32), "▬ 路氹城相似度假村群（誤判來源）", font=F(12), fill=(169, 188, 205))

    p = OUT / "demo-preview.png"
    img.save(p)
    print(f"[preview] {p.relative_to(ROOT)}  ({p.stat().st_size / 1024:.0f} KB)  ← 版面示意圖（非瀏覽器截圖）")


if __name__ == "__main__":
    main()
