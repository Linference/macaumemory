"""擴充建築識別參考庫：從 Wikimedia Commons 各建築的分類抓「不同攝影者」的開放授權照片。

步驟（可中斷後續跑，狀態存在 tmp/expand/）
  list      解析每棟建築的 Commons 分類（Wikidata P373，查不到的用 OVERRIDE），列出檔案與授權、作者、日期
  download  下載 1280 px 縮圖到 tmp/expand/<building>/（只收 CC0／公有領域／CC BY／CC BY-SA，JPEG，寬 ≥ 800）
  filter    自動過濾：CLIP 判為室內、雕像、告示文字、食物、人物特寫者剔除；與該棟既有參考照片差太多者標記待人工看
  sheet     每棟輸出縮圖總表 tmp/expand/sheets/<building>.jpg，供人工確認
  install   依 tmp/expand/selection.json 複製到 photos-src/cc/<building>/ 並寫入 ATTRIBUTION.csv
選片原則：每棟同一攝影者最多 MAX_PER_AUTHOR 張、每棟新增最多 MAX_NEW 張；已在參考庫的同名檔案跳過。
說明：本腳本由 AI 程式助手（Claude）協助撰寫。
用法：python tools/photo-archive/expand_references.py list|download|filter|sheet|install
"""
from __future__ import annotations

import csv
import html
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "tmp" / "expand"
CC = ROOT / "photos-src" / "cc"
UA = {"User-Agent": "macaumemory-isef/1.0 (student science project; educational use)"}
MAX_PER_AUTHOR, MAX_NEW = 6, 20
OK_LIC = re.compile(r"^(CC0|Public domain|CC BY(-SA)? \d\.\d)$")

# Wikidata 沒有 P373 或沒有 QID 的建築：人工查證過的 Commons 分類
OVERRIDE = {
    "coloane-village": "Category:Coloane Village", "dom-pedro-v-theatre": "Category:Dom Pedro V Theatre",
    "guiuan-village": "Category:Taipa Village", "kun-iam-temple": "Category:Kun Iam Temple",
    "lai-chi-vun": "Category:Lai Chi Vun Shipyards", "lou-kau-house": "Category:Lou Kau Mansion",
    "macau-museum": "Category:Museum of Macau", "red-market": "Category:Red Market",
    "rua-da-felicidade": "Category:Rua da Felicidade, Macau", "st-dominic-church": "Category:Exterior of Igreja de São Domingos (Macau)",
    "st-lawrence-church": "Category:Igreja de São Lourenço (Macau)",
    "taipa-houses": "Category:Taipa Houses–Museum", "leal-senado": "Category:Leal Senado Building",
}
SKIP_WORDS = re.compile(r"(map|plan|logo|diagram|flag|stamp|coin|banknote|menu|ticket|sign|plaque|inscription|introduction|"
                        r"interior|inside|altar|statue|sculpture|exhibit|exhibition|showcase|museum piece|food|dish|"
                        r"festival lantern|fireworks?|night ?market|panoramio_\d+_thumb)", re.I)


def api(base, params, tries=6):
    url = base + "?" + urllib.parse.urlencode({**params, "format": "json"})
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("Retry-After") or 0) or 5 * (k + 1)
            print(f"    HTTP {e.code}，等 {wait}s", flush=True); time.sleep(wait)
        except Exception as e:
            print(f"    {type(e).__name__}，重試", flush=True); time.sleep(3 * (k + 1))
    raise RuntimeError("API 多次失敗：" + url[:120])


def clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", str(s or ""))).replace("\n", " ").strip()


def buildings():
    sys.path.insert(0, str(ROOT / "tools" / "recognize"))
    import build_embeddings as be
    att = json.loads((ROOT / "public/data/attractions.json").read_text(encoding="utf-8"))
    att = att if isinstance(att, list) else att.get("items") or att.get("attractions")
    wd = {a["id"]: a.get("wikidata") for a in att}
    drop = set(be.load_curation().get("exclude_buildings", {}))
    return {bid: {"zh": m["zh"], "qid": wd.get(m.get("spot"))} for bid, m in be.BUILDINGS.items() if bid not in drop}


def cmd_list():
    WORK.mkdir(parents=True, exist_ok=True)
    f = WORK / "catalog.json"
    cat = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    for bid, b in buildings().items():
        if bid in cat and cat[bid].get("files"):
            continue
        c = OVERRIDE.get(bid)
        if not c and b["qid"]:
            cl = api("https://www.wikidata.org/w/api.php", {"action": "wbgetclaims", "entity": b["qid"], "property": "P373"}).get("claims", {}).get("P373")
            c = "Category:" + cl[0]["mainsnak"]["datavalue"]["value"] if cl else None
            time.sleep(1.0)
        if not c:
            print(f"{bid}: 找不到分類，略過"); cat[bid] = {"zh": b["zh"], "category": None, "files": []}; continue
        def members(cat_, kind):
            out, cont = [], {}
            while True:
                d = api("https://commons.wikimedia.org/w/api.php", {"action": "query", "list": "categorymembers", "cmtitle": cat_, "cmtype": kind, "cmlimit": 500, **cont})
                out += [m["title"] for m in d.get("query", {}).get("categorymembers", [])]
                if "continue" not in d:
                    return out
                cont = d["continue"]
        titles = members(c, "file")
        if len(titles) < 30:                                    # 照片多放在子分類（例如「XX 的外觀」）：往下一層
            for sub in members(c, "subcat")[:25]:
                if not re.search(r"(interior|inside|exhibit|statue|map|people|events?|festival|night)", sub, re.I):
                    titles += members(sub, "file"); time.sleep(0.5)
        titles = list(dict.fromkeys(titles))[:400]
        files = []
        for i in range(0, len(titles), 15):
            d = api("https://commons.wikimedia.org/w/api.php", {"action": "query", "titles": "|".join(titles[i:i + 15]), "prop": "imageinfo",
                                                                 "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 1280})
            for p in d.get("query", {}).get("pages", {}).values():
                ii = (p.get("imageinfo") or [{}])[0]; m = ii.get("extmetadata", {})
                g = lambda k: clean(m.get(k, {}).get("value"))
                files.append({"title": p["title"], "url": ii.get("thumburl") or ii.get("url"), "w": ii.get("width"), "mime": ii.get("mime"),
                              "license": g("LicenseShortName"), "author": g("Artist") or "unknown",
                              "date": g("DateTimeOriginal") or g("DateTime"), "page": ii.get("descriptionurl")})
            time.sleep(0.6)
        cat[bid] = {"zh": b["zh"], "category": c, "files": files}
        f.write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{bid} {b['zh']}：{c} · {len(files)} 個檔案", flush=True)
    f.write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")


def existing_titles():
    t = set()
    for r in csv.DictReader(open(CC / "ATTRIBUTION.csv", encoding="utf-8-sig")):
        t.add(r["commons_title"])
    return t


def cmd_download(per_building=60):
    """每棟最多下載 per_building 張：先按攝影者輪流挑（不同攝影者優先）。已下載的不重抓。"""
    cat = json.loads((WORK / "catalog.json").read_text(encoding="utf-8"))
    have = existing_titles(); jobs = []
    for bid, e in cat.items():
        d = WORK / bid; d.mkdir(parents=True, exist_ok=True)
        by_author = {}
        for i, f in enumerate(e["files"]):
            ok = (f["mime"] == "image/jpeg" and (f["w"] or 0) >= 800 and OK_LIC.match(f["license"] or "")
                  and f["title"] not in have and not SKIP_WORDS.search(f["title"]))
            f["eligible"] = bool(ok)
            if ok:
                f["local"] = str((d / f"c{i:03d}.jpg").relative_to(ROOT))
                by_author.setdefault(f["author"][:60], []).append(f)
        picked, k = [], 0
        while len(picked) < per_building and any(len(v) > k for v in by_author.values()):
            picked += [v[k] for v in by_author.values() if len(v) > k]; k += 1
        picked = picked[:per_building]
        for f in e["files"]:
            if f.get("eligible") and f not in picked and not (ROOT / f["local"]).exists():
                f["local"] = None                            # 超出名額者不下載
        jobs += [f for f in picked if not (ROOT / f["local"]).exists()]

    done = [0]

    def thumb(u):
        # 原圖網址（upload.wikimedia.org，本機連不上）改成縮圖伺服器的 800 px 版本
        m = re.match(r"https://upload\.wikimedia\.org/wikipedia/commons/(\w)/(\w\w)/([^?]+)", u)
        if not m or "/thumb/" in u:
            return u
        a_, ab, name = m.groups()
        w = 960 if (cur.get("w") or 0) > 960 else 500           # 縮圖伺服器只接受標準寬度（500、960、1280…）
        return f"https://thumb.wikimedia.org/wikipedia/commons/thumb/{a_}/{ab}/{name}/{w}px-{name}"

    cur = {}

    def fetch(f):
        cur.clear(); cur.update(f)
        f["url"] = thumb(f["url"])
        for k in range(3):
            try:
                (ROOT / f["local"]).write_bytes(urllib.request.urlopen(urllib.request.Request(f["url"], headers=UA), timeout=20).read())
                done[0] += 1
                if done[0] % 25 == 0:
                    print("  已下載", done[0], "/", len(jobs), flush=True)
                time.sleep(0.3); return True
            except urllib.error.HTTPError as e:
                time.sleep(min(60, int(e.headers.get("Retry-After") or 0) or 5 * (k + 1)))   # 限流時最多等 60 秒
            except Exception:
                time.sleep(3 * (k + 1))
        f["local"] = None; return False

    print("待下載", len(jobs), flush=True)
    ok = 0
    for n, f in enumerate(jobs, 1):                          # 依序下載（並行下載會卡在限流等待）
        ok += fetch(f)
        if n % 10 == 0:
            print("  進度", n, "/", len(jobs), flush=True)
        if n % 50 == 0:
            (WORK / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    (WORK / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    print("完成", ok, "/", len(jobs))
    for bid, e in cat.items():
        print(bid, sum(1 for f in e["files"] if f.get("local") and (ROOT / f["local"]).exists()), end=" · ")


def cmd_filter():
    """CLIP 零樣本：建築外觀 vs 室內／雕像／文字／食物／人物；另算與該棟既有參考照片的最高 DINOv2 相似度。"""
    import numpy as np
    import torch
    from PIL import Image, ImageOps
    from transformers import CLIPModel, CLIPProcessor
    sys.path.insert(0, str(ROOT / "tools" / "eval"))
    import ablation as ab
    cat = json.loads((WORK / "catalog.json").read_text(encoding="utf-8"))
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    m = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(dev).eval(); pr = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    prompts = ["a photo of the exterior of a building", "a street view with historic buildings", "a photo of a temple or church facade",
               "an indoor photo of a room interior", "a close-up photo of a statue", "a photo of a sign or text", "a photo of food",
               "a close-up portrait of people", "a photo of a museum exhibit"]
    with torch.no_grad():
        T = m.get_text_features(**pr(text=prompts, return_tensors="pt", padding=True).to(dev)); T = getattr(T, "pooler_output", T)
        T = T / T.norm(dim=-1, keepdim=True)
    emb = json.loads((ROOT / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
    refs = {b["id"]: np.asarray(b["vectors"], np.float32) for b in emb["buildings"]}
    dino = ab.OnnxSingle(ROOT / "public/models/dinov2-vits14-336.onnx")
    for bid, e in cat.items():
        for f in e["files"]:
            if not f.get("local") or "clip_ok" in f:
                continue
            im = ImageOps.exif_transpose(Image.open(ROOT / f["local"])).convert("RGB")
            with torch.no_grad():
                v = m.get_image_features(**pr(images=im, return_tensors="pt").to(dev)); v = getattr(v, "pooler_output", v)
                p = ((v / v.norm(dim=-1, keepdim=True)) @ T.T * 100).softmax(-1)[0].cpu().numpy()
            f["clip_building"] = round(float(p[:3].sum()), 3); f["clip_ok"] = bool(p[:3].sum() >= 0.5)
            dv = dino.embed_one(im); f["dino_vec"] = None
            f["dino_ref_max"] = round(float((refs[bid] @ dv).max()), 3) if bid in refs else None
        (WORK / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
        ok = [f for f in e["files"] if f.get("clip_ok")]
        print(f"{bid}: 外觀 {len(ok)} 張（與既有參考最低相似 {min([f['dino_ref_max'] for f in ok if f['dino_ref_max'] is not None] or [0]):.2f}）", flush=True)


def candidates(e):
    """候選：CLIP 判為建築外觀；同一攝影者最多 MAX_PER_AUTHOR；順序隨機（固定種子）。
    不用 DINOv2 相似度挑片：用「模型已經認得的照片」補參考庫會讓評測虛高（選擇偏差）。
    相似度只標在縮圖總表上，提醒人工檢查可能拍錯建築的照片。"""
    import random
    ok = [f for f in e["files"] if f.get("clip_ok")]
    random.Random(20261102).shuffle(ok)
    per, out = {}, []
    for f in ok:
        a = f["author"][:60]
        if per.get(a, 0) >= MAX_PER_AUTHOR:
            continue
        per[a] = per.get(a, 0) + 1; out.append(f)
        if len(out) >= MAX_NEW:
            break
    return out


def cmd_sheet():
    from PIL import Image, ImageDraw, ImageOps
    cat = json.loads((WORK / "catalog.json").read_text(encoding="utf-8"))
    (WORK / "sheets").mkdir(exist_ok=True)
    sel = {}
    for bid, e in cat.items():
        c = candidates(e)
        sel[bid] = [f["local"] for f in c]
        if not c:
            continue
        cols, tw, th = 10, 180, 130
        W = Image.new("RGB", (cols * tw, ((len(c) + cols - 1) // cols) * (th + 14)), "white"); d = ImageDraw.Draw(W)
        for i, f in enumerate(c):
            im = ImageOps.exif_transpose(Image.open(ROOT / f["local"])).convert("RGB"); im.thumbnail((tw - 4, th - 4))
            x, y = (i % cols) * tw, (i // cols) * (th + 14); W.paste(im, (x + 2, y + 2))
            low = (f.get("dino_ref_max") or 1) < 0.35                 # 與既有參考差很多：可能拍錯建築，人工重點看
            d.text((x + 3, y + th), f"{Path(f['local']).stem} {f['dino_ref_max']}{' ?' if low else ''}", fill=(220, 0, 0) if low else (90, 90, 90))
        W.save(WORK / "sheets" / f"{bid}.jpg", quality=82)
    (WORK / "selection.json").write_text(json.dumps(sel, ensure_ascii=False, indent=1), encoding="utf-8")
    print({k: len(v) for k, v in sel.items()})


def cmd_install():
    from PIL import Image
    cat = json.loads((WORK / "catalog.json").read_text(encoding="utf-8"))
    sel = json.loads((WORK / "selection.json").read_text(encoding="utf-8"))
    with open(CC / "ATTRIBUTION.csv", encoding="utf-8-sig") as fh:
        rd = csv.DictReader(fh); fields = rd.fieldnames; old = list(rd)
    have = {r["commons_title"] for r in old}
    sys.path.insert(0, str(ROOT / "tools" / "recognize"))
    import build_embeddings as be
    new = []
    for bid, locals_ in sel.items():
        byloc = {f.get("local"): f for f in cat[bid]["files"]}
        for loc in locals_:
            f = byloc[loc]
            if f["title"] in have:
                continue
            stem = re.sub(r"[^A-Za-z0-9._-]+", "_", f["title"][5:].rsplit(".", 1)[0]).strip("_")[:60] or Path(loc).stem
            dst = CC / bid / f"cm_{stem}.jpg"
            if dst.exists():
                dst = CC / bid / f"cm_{stem}_{Path(loc).stem}.jpg"
            dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(ROOT / loc, dst)
            w, h = Image.open(dst).size
            dm = re.search(r"(18|19|20)\d\d-\d\d-\d\d", f["date"] or "")
            new.append({"building_id": bid, "building_zh": be.BUILDINGS[bid]["zh"], "class_id": be.BUILDINGS[bid]["cls"],
                        "file": dst.relative_to(ROOT).as_posix(), "commons_title": f["title"], "author": f["author"],
                        "license": f["license"], "date": dm.group(0) if dm else (f["date"] or "")[:40], "description": "",
                        "source_page": f["page"], "width": w, "height": h, "bytes": os.path.getsize(dst)})
    with open(CC / "ATTRIBUTION.csv", "w", newline="", encoding="utf-8-sig") as fh:
        wr = csv.DictWriter(fh, fieldnames=fields); wr.writeheader(); wr.writerows(old + new)
    print("新增", len(new), "張")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    {"list": cmd_list, "download": cmd_download, "filter": cmd_filter, "sheet": cmd_sheet, "install": cmd_install}[sys.argv[1]]()
