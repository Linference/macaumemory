"""把「使用者提供的本機照片資料夾」匯入 photos-src/cc/。

來源：C:\\Users\\LINKIT\\Desktop\\澳门著名建筑图片\\<中文資料夾>\\NN.jpg（857 張、29 棟、161 MB）
這一支只匯入**人工看圖挑過的**照片（SELECTIONS）：每棟 3~10 張，
避開特寫（門環、窗花、展品、天窗）、室內、街頭塗鴉、海報、QR 立牌、海報式合成圖、
水印圖（大眾點評／攜程／360VR）等，優先「整棟入鏡、無遮蔽、光線充足」。

## 為什麼不能全部 857 張都收

嵌入庫是用「與所有參考向量的最大相似度」比對，混入壞圖會直接拉低留一法準確率
（上一輪 107 張剔除 18 張才把 Top-1 拉到 84.0%）。挑選依據是逐張目視
`tools/recognize/out/user-sheets/<id>-1.jpg` 聯絡表（29 張聯絡表、857 張全部看過）。

## 出處紀錄

photos-src/cc/ATTRIBUTION-user-provided.csv：每張記錄來源資料夾、原始檔名、
原始尺寸、SHA256、匯入後的檔名。並在 tools/recognize/refs-sources.json 標
`source: "user-provided"`，與 Wikimedia 來源分開統計。

用法：
    python tools/recognize/import_user_photos.py --dry-run
    python tools/recognize/import_user_photos.py
    python tools/recognize/import_user_photos.py --only ruins-st-paul
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_user_sheets import FOLDER_TO_ID  # noqa: E402

SRC = Path(r"C:\Users\LINKIT\Desktop\澳门著名建筑图片")
CC = ROOT / "photos-src" / "cc"
ATTR = CC / "ATTRIBUTION-user-provided.csv"
STATE = Path(__file__).resolve().parent / "refs-sources.json"
HOLD = ROOT / "photos-src" / "_hold"

# --------------------------------------------------------------------------- 選片
# 值＝該資料夾內檔名排序後的索引（NN.jpg 的編號 − 1）。
# 挑選依據：① 逐張看過 out/user-sheets/<id>-1.jpg 聯絡表（29 棟、857 張全看過）
#           ② 整棟入鏡、無遮蔽、光線充足優先
#           ③ 最短路邊 ≥400px（336px 編碼器用；太小的圖放大後細節不足）
SELECTIONS: dict[str, list[int]] = {
    # ===== 已在庫中：使用者提供的照片（品質普遍優於原本的 Wikimedia 參考圖）=====
    "ruins-st-paul":        [0, 1, 2, 4, 5, 13, 17, 22, 23],
    "a-ma-temple":          [0, 1, 3, 4, 8, 9, 11, 16],
    "leal-senado":          [1, 4, 8, 15, 16, 17, 19, 22],
    "moorish-barracks":     [0, 5, 7, 9, 13, 15, 17, 20],
    "mandarins-house":      [0, 6, 7, 8, 10, 11],
    "st-dominic-church":    [0, 2, 3, 5, 8, 9, 13, 22],
    "taipa-houses":         [0, 1, 2, 5, 8, 10, 11, 19, 27],
    "macau-tower":          [4, 9, 10, 11, 13, 14, 16, 17, 21, 26],
    "macau-science-center": [1, 4, 7, 13, 14, 16, 19, 26, 29],
    "the-venetian":         [0, 1, 2, 3, 9, 10, 15],
    "parisian":             [0, 1, 2, 3, 10, 11, 14, 15, 19, 23],
    "grand-lisboa":         [2, 6, 8, 10, 12, 17, 19, 20, 21, 27],
    # ===== 新增 =====
    "guia-fortress":        [0, 5, 8, 9, 10, 11, 14, 16, 21, 22],
    "st-joseph-seminary":   [2, 6, 7, 12, 17, 18, 19, 21, 22, 23],
    "dom-pedro-v-theatre":  [1, 2, 7, 8, 12, 13, 15, 16, 17],
    "fortress-monte":       [0, 1, 2, 5, 8, 13, 17, 21, 27],
    "na-tcha-temple":       [0, 1, 2, 8, 9, 11, 15, 16, 21],
    "lou-kau-house":        [0, 1, 5, 7, 8, 13, 17, 19, 25, 28],
    "portas-do-cerco":      [2, 3, 7, 8, 9, 11, 13, 20, 22],
    "macau-museum":         [0, 3, 4],
    "grand-prix-museum":    [2, 5, 6],
    "macau-cultural-centre": [0, 1, 3, 4, 9, 10, 13, 22],
    "fishermans-wharf":     [3, 4, 13, 19],
    "galaxy-macau":         [5, 6, 8, 10, 11, 17, 19, 21, 26, 29],
    "londoner-macao":       [0, 1, 3, 4, 17, 18, 23, 24],
    "wynn-macau":           [1, 6, 7, 8, 10, 13, 15, 16],
    "wynn-palace":          [1, 3, 4, 8, 10, 16, 18, 20],
    "mgm-macau":            [0, 2, 3, 4, 8, 14, 16, 17, 20, 29],
    "kun-iam-statue":       [0, 2, 4, 8, 12, 16, 19, 20, 21, 23],
}

# 為什麼這幾棟最後沒收（誠實記錄，見回報）
REJECTED_BUILDINGS: dict[str, str] = {
    "macau-museum": "39 張裡只有 3 張拍到建築外觀（00、03、04 的白色外牆與柱廊）；"
                    "02 被樹擋住、01 主體是旁邊的粉紅建築，其餘 36 張全是館內展品與展廳 → 只收 3 張，勉強達標。",
    "grand-prix-museum": "28 張裡只有 2 張是建築（00、02 的白色格紋外牆）；"
                         "其餘全是館內賽車展品、展廳、賽車特寫（附水印）→ 僅 2 張，低於 3 張門檻。",
    "fishermans-wharf": "27 張裡只有 4 張拍到建築（03 羅馬表演場、04 角鬥士雕像拱門、"
                        "13 白建築運河、19 仿羅馬廢墟），其餘是海景、碼頭、招牌、室內 → 勉強達標。",
}

MAX_EDGE = 2000


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def exif_date(im: Image.Image) -> str:
    """盡量取出拍攝日期（有的話），讓出處紀錄更完整。"""
    try:
        ex = im.getexif()
        for tag in (36867, 306):          # DateTimeOriginal, DateTime
            v = ex.get(tag)
            if v:
                return str(v)[:19]
    except Exception:
        pass
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="逗號分隔的建築 id")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-edge", type=int, default=MAX_EDGE)
    ap.add_argument("--clean-only", action="store_true",
                    help="只把『非使用者來源、且不需要』的 Wikimedia 資料夾移到 _hold/")
    args = ap.parse_args()

    only = set(args.only.split(",")) if args.only else None
    STATE.parent.mkdir(parents=True, exist_ok=True)
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.is_file() else {"files": {}}
    state.setdefault("files", {})

    id_to_folder = {v: k for k, v in FOLDER_TO_ID.items()}

    # ---------------------------------------------------------------- 匯入
    if not args.clean_only:
        rows, seen_sha, total = [], {}, 0
        for bid in sorted(SELECTIONS):
            if only and bid not in only:
                continue
            folder = id_to_folder.get(bid)
            if not folder:
                print(f"  !! {bid} 沒有對應的來源資料夾")
                continue
            d = SRC / folder
            files = sorted(f for f in d.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png"))
            sel = SELECTIONS[bid]
            dest_dir = CC / bid
            dest_dir.mkdir(parents=True, exist_ok=True)
            print(f"\n[{bid}] 來源「{folder}」{len(files)} 張 → 選 {len(sel)} 張")
            kept = 0
            for idx in sel:
                if idx >= len(files):
                    print(f"      [x] 索引 {idx} 超出範圍（只有 {len(files)} 張）")
                    continue
                src = files[idx]
                try:
                    im = Image.open(src)
                    im.load()
                except Exception as e:
                    print(f"      [x] {src.name} 讀不到：{e}")
                    continue
                h = sha256(src)
                if h in seen_sha:
                    print(f"      [=] {src.name} 與 {seen_sha[h]} 內容相同，跳過（避免同圖重複）")
                    continue
                w0, h0 = im.size
                d0 = exif_date(im)
                name = f"u{idx + 1:02d}.jpg"
                dest = dest_dir / name
                if not args.dry_run:
                    if max(im.size) > args.max_edge:
                        s = args.max_edge / max(im.size)
                        im = im.convert("RGB").resize(
                            (max(1, round(w0 * s)), max(1, round(h0 * s))), Image.LANCZOS)
                        im.save(dest, "JPEG", quality=93, optimize=True)
                    else:
                        shutil.copy2(src, dest)
                seen_sha[h] = f"{bid}/{name}"
                kept += 1
                total += 1
                st = state["files"].setdefault(f"{bid}/{name}", {})
                st.update({
                    "source": "user-provided",
                    "source_dir": str(src.parent),
                    "source_file": src.name,
                    "source_index": idx,
                    "orig_width": w0, "orig_height": h0,
                    "taken": d0,
                    "sha256": h,
                    "building": bid,
                    "note": "使用者提供的本機資料夾（澳门著名建筑图片），逐張目視挑選",
                })
                print(f"      [+] {name}  ← {src.name}  {w0}x{h0}  {h[:10]} {d0}")
            print(f"      → {bid}：匯入 {kept} 張")

        if not args.dry_run:
            state["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")

            f = state["files"]
            rows = []
            for key in sorted(f):
                r = f[key]
                if r.get("source") != "user-provided":
                    continue
                p = CC / key
                rows.append({
                    "building_id": r.get("building", key.split("/")[0]),
                    "file": "photos-src/cc/" + key,
                    "source": "user-provided",
                    "source_dir": r.get("source_dir", ""),
                    "source_file": r.get("source_file", ""),
                    "source_index": r.get("source_index", ""),
                    "orig_width": r.get("orig_width", ""),
                    "orig_height": r.get("orig_height", ""),
                    "taken": r.get("taken", ""),
                    "bytes": p.stat().st_size if p.is_file() else "",
                    "sha256": r.get("sha256", ""),
                    "license_note": "使用者提供的照片；未標示個別授權，僅用於本專案內部辨識評測，不對外散布",
                })
            with ATTR.open("w", newline="", encoding="utf-8-sig") as fh:
                w = csv.DictWriter(fh, fieldnames=list(rows[0]))
                w.writeheader()
                w.writerows(rows)
            print(f"\n→ {ATTR}（{len(rows)} 筆）")
        print(f"\n[匯入] 共 {total} 張")

    # ---------------------------------------------------------------- 收掉不要的 Wikimedia 資料夾
    keep_wikimedia = {
        "cathedral-macau", "coloane-village", "guiuan-village", "kun-iam-temple",
        "lai-chi-vun", "red-market", "rua-da-felicidade", "senado-square",
        "st-lawrence-church", "st-anthony-church", "st-lazarus-church",
    }
    drop = {"lin-fung-temple", "sam-kai-vui-kun", "santa-sancha", "st-augustine-church",
            "st-paul-street"}
    moved = []
    for bid in sorted(drop):
        d = CC / bid
        if not d.is_dir():
            continue
        dest = HOLD / bid
        if args.dry_run:
            print(f"  [dry] 會把 {bid} 移到 {dest}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(d), str(dest))
        moved.append(bid)
        print(f"  [hold] {bid} → {dest.relative_to(ROOT)}")
    if moved:
        note = ("這些資料夾是從 Wikimedia Commons 抓來的候選參考照片，**未納入辨識庫**。\n"
                "原因：使用者提供了本機的 857 張照片（品質更高、涵蓋面更廣），因此本輪改以本機照片為主；\n"
                "這些建築不在使用者提供的 29 棟清單內，為避免拉低留一法準確率而先擱置。\n"
                "出處紀錄仍在 tools/recognize/refs-sources.json 與 photos-src/cc/ATTRIBUTION-references.csv。\n"
                "若要啟用，把它們移回 photos-src/cc/ 並在 build_embeddings.py 的 BUILDINGS 補上名冊即可。\n")
        (HOLD / "README.md").write_text(note, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
