"""抓「澳門建築偵測」YOLO 訓練資料集（含授權標註）。

與 photos-src/cc 的差別：那份是「每棟建築幾張」用於重辨識評測；
這份是「每個類別大量圖片」用於**訓練偵測器**，所以按類別分資料夾、數量多。

輸出結構（YOLO 標準）：
    datasets/macau-buildings/
        images/raw/<class_id>/*.jpg      ← 原始下載（尚未切分／尚未標註）
        ATTRIBUTION.csv                  ← 每張圖的作者、授權、來源頁
        data.yaml                        ← 類別定義（給 ultralytics 用）

用法：
    python tools/yolo-dataset/fetch_dataset.py --per-class 60
    python tools/yolo-dataset/fetch_dataset.py --only=temple,church --per-class 80
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "datasets" / "macau-buildings"
RAW = DEST / "images" / "raw"
ATTR = DEST / "ATTRIBUTION.csv"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "macaumemory-isef-dataset/1.0 (student science project)"}

# 類別 → (中文名, 搜尋關鍵字)。刻意排除「街景」（那是場景不是物件，偵測框無法界定）。
CLASSES = {
    "portuguese":        ("葡式殖民建築", ["Portuguese colonial architecture Macau", "Macau colonial building",
                                        "Taipa Houses Museum", "Mandarin's House Macau", "龍環葡韻", "鄭家大屋"]),
    "temple":            ("中式廟宇",     ["Chinese temple Macau", "A-Ma Temple Macau", "Kun Iam Temple Macau",
                                        "澳門 廟宇", "觀音堂 澳門", "蓮峰廟"]),
    "church":            ("天主教教堂",   ["church Macau", "St Dominic Church Macau", "St Lawrence Church Macau",
                                        "Macau cathedral", "教堂 澳門", "玫瑰堂 澳門"]),
    "tong_lau":          ("騎樓與唐樓",   ["shophouse Macau", "Rua da Felicidade Macau", "Macau old tenement building",
                                        "騎樓 澳門", "唐樓 澳門", "福隆新街"]),
    "residential_tower": ("現代高層住宅", ["residential tower Macau", "apartment building Macau", "Macau housing estate",
                                        "澳門 住宅大廈", "澳門 高層住宅"]),
    "casino_hotel":      ("酒店與娛樂場", ["casino Macau", "hotel Macau", "Macau resort building", "Grand Lisboa",
                                        "澳門 酒店", "澳門 娛樂場"]),
    "civic":             ("公共建築",     ["government building Macau", "Leal Senado Macau", "Macau museum building",
                                        "Macau library building", "市政署大樓", "澳門 公共建築"]),
    "industrial":        ("工業與倉庫",   ["factory Macau", "warehouse Macau", "Lai Chi Vun shipyard",
                                        "澳門 工廠", "荔枝碗船廠", "澳門 倉庫"]),
    "village":           ("圍里與村落民居", ["village house Macau", "Coloane village Macau", "Macau old village lane",
                                        "路環 村屋", "澳門 村落", "九澳村"]),
    "monument":          ("牌坊與紀念物", ["monument Macau", "Ruins of Saint Paul Macau", "Macau arch monument",
                                        "大三巴牌坊", "澳門 紀念碑", "澳門 牌坊"]),
    "market":            ("街市與市集",   ["market building Macau", "Red Market Macau", "Macau wet market",
                                        "紅街市", "澳門 街市", "營地街市"]),
}

BAD = re.compile(r"(map|plan|logo|diagram|coat of arms|flag|chart|graph|svg|icon|banknote|stamp|"
                 r"floor plan|3d model|panorama of the museum)", re.I)

# Commons 的「策展分類」——人工維護，精度遠高於全文檢索。
# 全文檢索會回傳店內商品、吊燈、酒杯；分類則幾乎都是該主題的照片。
# 大分類底下還有子分類（例如 Category:Churches in Macau → 各教堂），
# 因此抓圖時會一併走訪子分類（--subcats），這是數量的主要來源。
CATEGORIES = {
    "portuguese": ["Category:Portuguese colonial architecture in Macau", "Category:Taipa Houses Museum",
                   "Category:Mandarin's House", "Category:Moorish Barracks", "Category:Colonial architecture in Macau",
                   "Category:Portuguese architecture in Macau", "Category:Buildings in Macau",
                   "Category:Santa Sancha Centre", "Category:Dom Pedro V Theatre",
                   "Category:Guia Fortress", "Category:Fortresses in Macau", "Category:Macau Government Headquarters"],
    "temple": ["Category:Temples in Macau", "Category:A-Ma Temple", "Category:Kun Iam Temple",
               "Category:Chinese temples in Macau", "Category:Lin Fung Temple",
               "Category:Taoist temples in Macau", "Category:Tin Hau temples in Macau",
               "Category:Sam Kai Vui Kun", "Category:Na Tcha Temple", "Category:Pagodas in Macau",
               "Category:Shrines in Macau"],
    "church": ["Category:Churches in Macau", "Category:St. Dominic's Church (Macau)",
               "Category:St. Lawrence's Church (Macau)", "Category:Cathedral of Macau",
               "Category:Saint Joseph's Seminary and Church", "Category:Roman Catholic churches in Macau",
               "Category:St. Augustine's Church (Macau)", "Category:St. Anthony's Church (Macau)",
               "Category:Chapels in Macau", "Category:Protestant churches in Macau"],
    "tong_lau": ["Category:Rua da Felicidade", "Category:Shophouses in Macau", "Category:Buildings in Macau",
                 "Category:Avenida de Almeida Ribeiro", "Category:Tong lau",
                 "Category:Arcades in Macau", "Category:Rua Central (Macau)", "Category:Rua do Cunha"],
    "residential_tower": ["Category:Residential buildings in Macau", "Category:Apartment buildings in Macau",
                          "Category:Towers in Macau", "Category:Skyscrapers in Macau",
                          "Category:Housing estates in Macau", "Category:Public housing in Macau",
                          "Category:Residential skyscrapers in Macau"],
    "casino_hotel": ["Category:Casinos in Macau", "Category:Hotels in Macau", "Category:Grand Lisboa",
                     "Category:The Venetian Macao", "Category:Hotel Lisboa",
                     "Category:Resorts in Macau", "Category:Galaxy Macau", "Category:City of Dreams (Macau)",
                     "Category:Wynn Macau", "Category:MGM Macau", "Category:Sands Macao",
                     "Category:Hotel buildings in Macau", "Category:Studio City (Macau)",
                     "Category:The Parisian Macao", "Category:The Londoner Macao"],
    "civic": ["Category:Government buildings in Macau", "Category:Leal Senado", "Category:Museums in Macau",
              "Category:Libraries in Macau", "Category:Post offices in Macau",
              "Category:Schools in Macau", "Category:Universities and colleges in Macau",
              "Category:Hospitals in Macau", "Category:Public buildings in Macau",
              "Category:Macau Science Center", "Category:Macau Tower", "Category:Fire stations in Macau",
              "Category:Police stations in Macau", "Category:Railway stations in Macau"],
    "industrial": ["Category:Industrial buildings in Macau", "Category:Lai Chi Vun Shipyards",
                   "Category:Warehouses in Macau", "Category:Factory buildings in Macau",
                   "Category:Docks in Macau", "Category:Piers in Macau", "Category:Power stations in Macau",
                   "Category:Industrial heritage in Macau"],
    "village": ["Category:Villages in Macau", "Category:Coloane", "Category:Taipa Village",
                "Category:Houses in Macau", "Category:Vernacular architecture in Macau",
                "Category:Coloane Village", "Category:Rua do Cunha", "Category:Macau houses",
                "Category:Traditional houses in Macau", "Category:Village houses in Macau"],
    "monument": ["Category:Monuments and memorials in Macau", "Category:Ruins of Saint Paul",
                 "Category:Arches in Macau", "Category:Statues in Macau",
                 "Category:Memorials in Macau", "Category:Fountains in Macau",
                 "Category:Walls in Macau", "Category:Lighthouses in Macau",
                 "Category:Gates in Macau", "Category:World Heritage Sites in Macau"],
    "market": ["Category:Markets in Macau", "Category:Red Market (Macau)", "Category:Market buildings in Macau",
               "Category:Wet markets in Macau", "Category:Street markets in Macau",
               "Category:Almirante Lacerda Municipal Market", "Category:Municipal markets in Macau"],
}


def api(params: dict, retries=4):
    params = {**params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if i == retries - 1:
                print(f"    [warn] API {type(e).__name__}: {str(e)[:60]}")
                return {}
            time.sleep(2 * (i + 1))
    return {}


def search(query: str, limit: int, offset: int = 0):
    data = api({"action": "query", "generator": "search", "gsrsearch": query, "gsrnamespace": 6,
                "gsrlimit": limit, "gsroffset": offset, "prop": "imageinfo",
                "iiprop": "url|extmetadata|size|mime|sha1", "iiurlwidth": 1024})
    out = []
    for page in (data.get("query", {}).get("pages") or []):
        ii = (page.get("imageinfo") or [{}])[0]
        if not ii or ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        if (ii.get("width") or 0) < 800:
            continue
        title = page.get("title", "")
        if BAD.search(title):
            continue
        out.append(dict(title=title, url=ii.get("thumburl") or ii.get("url"), mime=ii.get("mime"),
                        width=ii.get("width"), height=ii.get("height"), meta=ii.get("extmetadata", {}),
                        sha1=ii.get("sha1")))
    return out


def category_files(cat: str, limit: int):
    """取得某個 Commons 分類下的檔案（人工策展，精度高）。"""
    data = api({"action": "query", "generator": "categorymembers", "gcmtitle": cat,
                "gcmtype": "file", "gcmlimit": limit, "prop": "imageinfo",
                "iiprop": "url|extmetadata|size|mime|sha1", "iiurlwidth": 1024})
    out = []
    for page in (data.get("query", {}).get("pages") or []):
        ii = (page.get("imageinfo") or [{}])[0]
        if not ii or ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        if (ii.get("width") or 0) < 800:
            continue
        title = page.get("title", "")
        if BAD.search(title):
            continue
        out.append(dict(title=title, url=ii.get("thumburl") or ii.get("url"), mime=ii.get("mime"),
                        width=ii.get("width"), height=ii.get("height"), meta=ii.get("extmetadata", {}),
                        sha1=ii.get("sha1")))
    return out


def subcategories(cat: str, limit: int = 60):
    """取得分類下的子分類名稱（用來遞迴抓圖，數量主要來源）。"""
    data = api({"action": "query", "generator": "categorymembers", "gcmtitle": cat,
                "gcmtype": "subcat", "gcmlimit": limit})
    return [p.get("title") for p in (data.get("query", {}).get("pages") or []) if p.get("title")]


def category_files_deep(cat: str, limit: int, depth: int, sleep: float):
    """抓分類本身的檔案，並遞迴走訪子分類（depth 層）。"""
    files = category_files(cat, limit)
    if depth <= 0:
        return files
    for sub in subcategories(cat):
        # 只在仍是「澳門相關」的子分類往下走，避免爬到 Category:Asia 之類的巨型分類
        if not re.search(r"Macau|Macao|Taipa|Coloane|Cotai|澳門|氹仔|路環", sub, re.I):
            continue
        time.sleep(sleep)
        files.extend(category_files(sub, limit))
        if depth >= 2:
            for sub2 in subcategories(sub):
                if not re.search(r"Macau|Macao|Taipa|Coloane|Cotai|澳門|氹仔|路環", sub2, re.I):
                    continue
                time.sleep(sleep)
                files.extend(category_files(sub2, limit))
    return files


def strip_html(s) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", str(s or ""))).replace("\n", " ").strip()


def download(url: str, path: Path, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if len(data) < 5000:
                raise ValueError(f"檔案過小（{len(data)} bytes）")
            path.write_bytes(data)
            return len(data)
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(3 * (i + 1))     # 429 之類的限流：退避重試
    return 0


def save_item(item: dict, cid: str, zh: str, folder: Path, rows: list) -> int:
    """下載單張圖片並記錄授權資訊；成功回傳 1，失敗回傳 0。"""
    safe = re.sub(r"[^\w.\-]+", "_", item["title"].replace("File:", ""))[:56]
    safe += "_" + hashlib.md5(item["title"].encode()).hexdigest()[:6]
    ext = ".png" if item["mime"] == "image/png" else ".jpg"
    out = folder / (safe + ext)
    if out.exists():
        return 0
    try:
        n = download(item["url"], out)
    except Exception as e:
        print(f"    [warn] {item['title'][:36]}: {str(e)[:44]}")
        return 0
    em = item["meta"]
    rows.append(dict(class_id=cid, class_zh=zh, file=str(out.relative_to(ROOT)).replace("\\", "/"),
                     commons_title=item["title"], sha1=item.get("sha1", ""),
                     author=strip_html(em.get("Artist", {}).get("value", ""))[:80],
                     license=strip_html(em.get("LicenseShortName", {}).get("value", "")),
                     date=strip_html(em.get("DateTimeOriginal", {}).get("value", ""))[:19],
                     source_page="https://commons.wikimedia.org/wiki/" +
                                 urllib.parse.quote(item["title"].replace(" ", "_")),
                     width=item["width"], height=item["height"], bytes=n))
    return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=60)
    ap.add_argument("--only", default=None)
    ap.add_argument("--sleep", type=float, default=0.6)
    ap.add_argument("--subcats", type=int, default=1, help="走訪子分類的深度（1=子分類、2=孫分類）；數量主要來源")
    ap.add_argument("--cat-limit", type=int, default=120, help="每個分類最多取幾張檔案")
    ap.add_argument("--search-pages", type=int, default=3, help="每個關鍵字翻幾頁（每頁 20 筆）")
    args = ap.parse_args()

    wanted = set(args.only.split(",")) if args.only else set(CLASSES)
    RAW.mkdir(parents=True, exist_ok=True)
    rows, seen, seen_sha = [], set(), set()
    # 已有的 SHA1 先載入，避免重複下載同一張圖（不同標題但同內容）
    if ATTR.exists():
        with ATTR.open(encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                if r.get("sha1"):
                    seen_sha.add(r["sha1"])

    for cid, (zh, queries) in CLASSES.items():
        if cid not in wanted:
            continue
        folder = RAW / cid
        folder.mkdir(parents=True, exist_ok=True)
        have = len(list(folder.glob("*.jpg"))) + len(list(folder.glob("*.png")))
        got = 0
        if have >= args.per_class:
            print(f"  {cid:20} {zh:8} 已有 {have} 張（達標，略過）")
            continue
        # ① 先抓策展分類（含子分類，精度高、數量多）
        for cat in CATEGORIES.get(cid, []):
            if got + have >= args.per_class:
                break
            for item in category_files_deep(cat, args.cat_limit, args.subcats, args.sleep):
                if got + have >= args.per_class:
                    break
                if item["title"] in seen or (item.get("sha1") and item["sha1"] in seen_sha):
                    continue
                seen.add(item["title"])
                n = save_item(item, cid, zh, folder, rows)
                if n:
                    got += n
                    if item.get("sha1"):
                        seen_sha.add(item["sha1"])
                time.sleep(args.sleep)
            time.sleep(args.sleep)
        # ② 再用全文檢索補足
        for q in queries:
            if got + have >= args.per_class:
                break
            for page in range(args.search_pages):
                if got + have >= args.per_class:
                    break
                for item in search(q, 20, page * 20):
                    if got + have >= args.per_class:
                        break
                    if item["title"] in seen or (item.get("sha1") and item["sha1"] in seen_sha):
                        continue
                    seen.add(item["title"])
                    n = save_item(item, cid, zh, folder, rows)
                    if n:
                        got += n
                        if item.get("sha1"):
                            seen_sha.add(item["sha1"])
                    time.sleep(args.sleep)
                time.sleep(args.sleep)
        print(f"  {cid:20} {zh:8} 新增 {got:3d}（原有 {have}）→ {have + got} 張")

    # 合併寫入
    old = []
    if ATTR.exists():
        with ATTR.open(encoding="utf-8-sig") as f:
            old = [r for r in csv.DictReader(f)]
    files_now = {r["file"] for r in rows}
    keep = [r for r in old if r["file"] not in files_now and (ROOT / r["file"]).exists()]
    allrows = keep + rows
    fields = ["class_id", "class_zh", "file", "commons_title", "sha1", "author", "license", "date",
              "source_page", "width", "height", "bytes"]
    ATTR.parent.mkdir(parents=True, exist_ok=True)
    with ATTR.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in allrows:
            w.writerow({k: r.get(k, "") for k in fields})

    # data.yaml（ultralytics 用，0-based 類別索引）
    names = [f"{cid}  # {CLASSES[cid][0]}" for cid in CLASSES]
    yaml_lines = ["path: datasets/macau-buildings", "train: images/train", "val: images/val", "",
                  f"nc: {len(CLASSES)}", "names:"] + [f"  {i}: {cid}" for i, cid in enumerate(CLASSES)]
    (DEST / "data.yaml").write_text("\n".join(yaml_lines) + "\n", encoding="utf-8")

    counts = {}
    for r in allrows:
        counts[r["class_id"]] = counts.get(r["class_id"], 0) + 1
    print(f"\n[dataset] 本次新增 {len(rows)} 張；總計 {len(allrows)} 張 → {DEST.relative_to(ROOT)}")
    print("[dataset] 各類別張數：", json.dumps(counts, ensure_ascii=False))
    print(f"[dataset] data.yaml 已產生（{len(CLASSES)} 類）")


if __name__ == "__main__":
    main()
