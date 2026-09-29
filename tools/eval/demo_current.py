"""產生「現在效果」的可視化演示圖。

① demo-geo-verify.jpg：幾何驗證在看什麼——同棟會有大量幾何一致的對應線，不同棟則沒有。
② demo-detection.jpg：新版 YOLO11s 在**沒見過**的實拍照片上的偵測結果（框 + 類別 + 信心）。

用法：python tools/eval/demo_current.py
"""
from __future__ import annotations

import csv
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "eval" / "out"
FIGS = ROOT / "docs" / "figs"
WEIGHTS = ROOT / ".cache" / "models" / "yolo" / "macau-buildings-best.pt"
CC_FALLBACK = ROOT / "photos-src" / "cc"
FONT = r"C:\Windows\Fonts\msjh.ttc"
FONT_B = r"C:\Windows\Fonts\msjhbd.ttc"
ZH = {"portuguese": "葡式殖民", "temple": "中式廟宇", "church": "天主教教堂", "tong_lau": "騎樓唐樓",
      "residential_tower": "高層住宅", "casino_hotel": "酒店娛樂", "civic": "公共建築",
      "industrial": "工業倉庫", "village": "村落民居", "monument": "牌坊紀念物", "market": "街市"}
INK = (16, 36, 58)


def imread(path) -> np.ndarray:
    return cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)


def match_pair(pa, pb, max_kp=2048):
    """回傳 (顯示用圖, 內點數, 匹配數)；內點綠線、外點紅線。"""
    sift = cv2.SIFT_create(nfeatures=max_kp)
    ia, ib = imread(pa), imread(pb)
    ga = cv2.cvtColor(ia, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(ib, cv2.COLOR_BGR2GRAY)
    ka, da = sift.detectAndCompute(ga, None)
    kb, db = sift.detectAndCompute(gb, None)
    if da is None or db is None:
        return None, 0, 0
    raw = cv2.BFMatcher(cv2.NORM_L2).knnMatch(da, db, k=2)
    good = [m for m, n in (p for p in raw if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < 4:
        return None, 0, len(good)
    src = np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kb[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, 3.0, maxIters=5000, confidence=0.999)
    mask = mask.ravel().astype(int) if mask is not None else np.zeros(len(good), int)
    vis = cv2.drawMatches(ia, ka, ib, kb, good, None,
                          matchColor=(60, 60, 60), singlePointColor=(120, 120, 120),
                          matchesMask=mask.tolist(), flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
    # 外點另外畫紅線
    out_mask = (1 - mask).astype(bool)
    if out_mask.any():
        vis = cv2.drawMatches(ia, ka, ib, kb, [g for g, k in zip(good, out_mask) if k], vis,
                              matchColor=(70, 70, 220), singlePointColor=(120, 120, 120),
                              matchesMask=None, flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
    return vis, int(mask.sum()), len(good)


def make_geo_demo():
    rep = OUT / "geo-verify-sift.csv"
    if not rep.exists():
        print("  跳過幾何驗證演示（缺 CSV）")
        return
    rows = list(csv.DictReader(rep.open(encoding="utf-8-sig")))
    # 同棟要挑「真實多視角」而非近重複圖：內點 100~900 的中段最能說明問題
    # （內點 2048 表示兩張幾乎完全相同，那樣的示範沒有說服力）
    allsame = sorted([r for r in rows if r["same_building"] == "True"], key=lambda r: -int(r["inliers"]))
    # CSV 內同時有 A→B 與 B→A，先去重（同一對只留一次），否則會挑到同一組兩次
    seen_pair, dedup = set(), []
    for r in allsame:
        key = frozenset([r["query"], r["cand"]])
        if key in seen_pair:
            continue
        seen_pair.add(key)
        dedup.append(r)
    mid = [r for r in dedup if 100 <= int(r["inliers"]) <= 900]
    same = mid or dedup
    diff = sorted([r for r in rows if r["same_building"] == "False"], key=lambda r: -int(r["inliers"]))
    pick = [(f"同一棟建築（不同角度）", same[0], True)]
    if diff:
        pick.append(("不同建築（外觀相近，應被拒絕）", diff[0], False))
    if len(same) > 1:
        pick.append(("同一棟建築（另一組）", same[1], True))

    panels = []
    for label, r, is_same in pick:
        vis, inl, n = match_pair(ROOT / r["query"], ROOT / r["cand"])
        if vis is None:
            continue
        # 縮到統一寬度
        W = 1180
        s = W / vis.shape[1]
        vis = cv2.resize(vis, (W, int(vis.shape[0] * s)))
        panels.append((label, vis, inl, n, float(r["global_sim"]), is_same))
    if not panels:
        print("  無法產生幾何驗證演示")
        return

    pad, cap = 12, 46
    H = sum(p[1].shape[0] + cap + pad for p in panels) + 74
    sheet = Image.new("RGB", (1180 + pad * 2, H), (247, 245, 240))
    d = ImageDraw.Draw(sheet)
    fb = ImageFont.truetype(FONT_B, 19)
    f = ImageFont.truetype(FONT, 15)
    d.rectangle((0, 0, sheet.width, 58), fill=INK)
    d.text((pad, 14), "幾何驗證在看什麼：同棟會有一致對應線，不同棟沒有", font=fb, fill=(240, 244, 248))
    y = 66
    for label, vis, inl, n, gsim, is_same in panels:
        sheet.paste(Image.fromarray(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB)), (pad, y))
        mark = "✓ 通過" if inl >= 15 else "✗ 拒絕"
        col = (22, 130, 90) if inl >= 15 else (180, 60, 50)
        d.text((pad, y + vis.shape[0] + 4),
               f"{label}　全域餘弦 {gsim:.3f}　SIFT 匹配 {n}　幾何內點 {inl}（綠線）→ {mark}",
               font=f, fill=col)
        y += vis.shape[0] + cap + pad
    FIGS.mkdir(parents=True, exist_ok=True)
    p = FIGS / "demo-geo-verify.jpg"
    sheet.save(p, quality=90)
    print(f"  ✓ {p.relative_to(ROOT)}  {sheet.size}  {p.stat().st_size // 1024} KB")


def make_detection_demo(n=0):   # n=0 表示全部未見過的照片（避免小樣本誤導）
    """新版模型在沒見過的實拍照片上的偵測。"""
    import csv as _csv
    from ultralytics import YOLO

    if not WEIGHTS.exists():
        print("  跳過偵測演示（缺權重）")
        return
    model = YOLO(str(WEIGHTS))
    # 以「不在訓練資料集 ATTRIBUTION 內」的 CC 照片為「沒見過」
    ds_titles = set()
    attr = ROOT / "datasets" / "macau-buildings" / "ATTRIBUTION.csv"
    if attr.exists():
        for r in _csv.DictReader(attr.open(encoding="utf-8-sig")):
            ds_titles.add(r["commons_title"])
    rows = list(_csv.DictReader((CC_FALLBACK / "ATTRIBUTION.csv").open(encoding="utf-8-sig")))
    unseen = [r for r in rows if r["commons_title"] not in ds_titles and r["class_id"] in ZH
              and (ROOT / r["file"]).exists()]
    if not unseen:
        print("  找不到沒見過的照片")
        return
    import random
    if n and n < len(unseen):
        random.seed(11)
        picks = random.sample(unseen, n)
    else:
        picks = unseen          # 全部，與 eval_on_cc.py 的獨立驗收同一批

    CW, PH, CAP, PAD = 300, 210, 46, 9
    cols = 4
    rows_n = (len(picks) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (CW + PAD) + PAD, rows_n * (PH + CAP + PAD) + 74), (247, 245, 240))
    d = ImageDraw.Draw(sheet)
    fb = ImageFont.truetype(FONT_B, 19)
    f = ImageFont.truetype(FONT, 12)
    d.rectangle((0, 0, sheet.width, 58), fill=INK)
    d.text((PAD, 13), f"新版 YOLO11s 偵測「沒見過」的實拍照片（{len(picks)} 張，獨立驗證）",
           font=fb, fill=(240, 244, 248))
    hit = det = 0
    for i, r in enumerate(picks):
        rr, cc = divmod(i, cols)
        x = PAD + cc * (CW + PAD)
        y = 66 + PAD + rr * (PH + CAP + PAD)
        img = imread(ROOT / r["file"])
        s = CW / img.shape[1]
        disp = cv2.resize(img, (CW, max(1, int(img.shape[0] * s))))
        disp = disp[:PH]
        res = model.predict(ROOT / r["file"], conf=0.25, verbose=False)[0]   # 與 eval_on_cc.py 同參數
        top = None
        for b in res.boxes:
            ci = int(b.cls[0]); cf = float(b.conf[0])
            x0, y0, x1, y1 = (v * s for v in b.xyxy[0].tolist())
            col = (200, 162, 74)
            cv2.rectangle(disp, (int(x0), int(y0)), (int(x1), int(y1)), col, 3)
            txt = f"{ZH.get(model.names[ci], model.names[ci])} {cf:.2f}"
            (tw, th), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_DUPLEX, 0.42, 1)
            ly = max(0, int(y0) - th - 10)
            cv2.rectangle(disp, (int(x0), ly), (int(x0) + tw + 12, ly + th + 10), col, -1)
            cv2.putText(disp, txt, (int(x0) + 6, ly + th + 3), cv2.FONT_HERSHEY_DUPLEX, 0.42, (30, 30, 30), 1, cv2.LINE_AA)
            if top is None:
                top = model.names[ci]
        truth = r["class_id"]
        ok = top == truth
        det += 1 if top else 0
        hit += 1 if ok else 0
        sheet.paste(Image.fromarray(cv2.cvtColor(disp, cv2.COLOR_BGR2RGB)), (x, y))
        d.text((x + 2, y + PH + 4), f"{r['building_zh']}（真實：{ZH[truth]}）", font=f, fill=INK)
        got = ZH.get(top, "（未偵測到）") if top else "（未偵測到）"
        d.text((x + 2, y + PH + 24), f"偵測：{got}", font=f, fill=(22, 130, 90) if ok else (180, 60, 50))
        d.text((x + CW - 26, y + PH + 4), "✓" if ok else "✗", font=ImageFont.truetype(FONT_B, 20),
               fill=(22, 130, 90) if ok else (180, 60, 50))
    d.text((PAD, sheet.height - 26),
           f"偵測率 {det}/{len(picks)} = {det / len(picks) * 100:.0f}%　"
           f"偵測到的當中類別正確 {hit}/{det} = {(hit / det * 100 if det else 0):.0f}%　"
           f"兩者皆對 {hit}/{len(picks)} = {hit / len(picks) * 100:.0f}%"
           f"（同批照片舊版 yolo11n：偵測 {28/49*100:.0f}%、偵測到的當中類別正確 {12/28*100:.0f}%）",
           font=f, fill=(90, 100, 110))
    p = FIGS / "demo-detection.jpg"
    sheet.save(p, quality=90)
    print(f"  ✓ {p.relative_to(ROOT)}  {sheet.size}  {p.stat().st_size // 1024} KB"
          f"　偵測 {det}/{len(picks)}、類別正確 {hit}/{len(picks)}")


if __name__ == "__main__":
    print("[demo] 產生現在效果的可視化…")
    make_geo_demo()
    make_detection_demo()
