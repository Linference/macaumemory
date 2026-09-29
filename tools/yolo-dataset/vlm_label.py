"""用 DeepSeek 視覺模型（deepseek-flash）複核／補標註建築類別。

為什麼要加這一層：
    本地模型（CLIP 零樣本、自訓 YOLO）在「資料集清洗」上有明顯極限——
    CLIP 會把大三巴判成教堂（類別關誤殺），自訓模型又只學過現有標註（無法發現自己的偏誤）。
    視覺語言模型對「這是哪一類建築」的判斷通常更接近人類，適合當第三方裁判。

定位（很重要）：
    ① 它**不是**要取代本地模型，而是「低信心時才呼叫」的雲端複核層；
       產品端的即時辨識仍以本地 CLIP + YOLO + 地理先驗為主（離線可用、零成本、低延遲）。
    ② 主要用途是**離線資料集品管**：修正訓練標籤、補上沒標到的圖，讓下一輪訓練更準。
    ③ 圖片會上傳到 DeepSeek 伺服器；公開授權的訓練圖沒問題，但**使用者私人照片不應送雲端**。

用法：
    python tools/yolo-dataset/vlm_label.py --verify --sample 60            # 抽樣複核現有標籤（只出報告）
    python tools/yolo-dataset/vlm_label.py --verify --apply                # 依 VLM 意見修正標籤類別
    python tools/yolo-dataset/vlm_label.py --label-unlabeled --apply       # 替沒有標註的圖補類別
    python tools/yolo-dataset/vlm_label.py --review-suspect                # 複核 images/suspect/ 裡的爭議圖
    python tools/yolo-dataset/vlm_label.py ... --model deepseek-flash --detail low
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import shutil
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DS = ROOT / "datasets" / "macau-buildings"
RAW = DS / "images" / "raw"
SUSPECT = DS / "images" / "suspect"
OUT = DS / "out"
CACHE = ROOT / ".cache" / "vlm"
API = "https://api.deepseek.com/chat/completions"

CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
           "civic", "industrial", "village", "monument", "market"]


def class_of(stem: str) -> str | None:
    """從檔名取出類別 id。類別名可能含底線（casino_hotel、tong_lau、residential_tower），
    因此必須用「最長前綴」比對，不能用 split("_")[0]（會得到 casino／tong／residential）。"""
    for cid in sorted(CLASSES, key=len, reverse=True):
        if stem.startswith(cid + "_"):
            return cid
    return None


ZH = {"portuguese": "葡式殖民建築", "temple": "中式廟宇", "church": "天主教教堂",
      "tong_lau": "騎樓與唐樓", "residential_tower": "現代高層住宅", "casino_hotel": "酒店與娛樂場",
      "civic": "公共建築", "industrial": "工業與倉庫", "village": "圍里與村落民居",
      "monument": "牌坊與紀念物", "market": "街市與市集", "not_building": "不是建築物"}

# 類別定義的邊界：這些配對的「不一致」屬於分類學歧義，不該自動改標籤。
# 例：大三巴牌坊本身就是教堂遺址（VLM 說 church、我們的類別定義是 monument），
#     殖民地官邸常同時是政府機關（portuguese vs civic），都是合理的兩種看法。
AMBIGUOUS = [
    frozenset({"monument", "church"}),          # 大三巴＝教堂遺址
    frozenset({"portuguese", "civic"}),         # 殖民地官邸／政府機關
    frozenset({"tong_lau", "village"}),         # 老街屋 vs 村落民居
    frozenset({"casino_hotel", "residential_tower"}),   # 度假村 vs 高層住宅
    frozenset({"market", "tong_lau"}),          # 街市常位於騎樓街區
    frozenset({"temple", "village"}),           # 村落小廟
    frozenset({"civic", "church"}),             # 教堂兼博物館
]

PROMPT = """你是澳門建築影像的資料集品管員。以下依序編號提供 {n} 張照片，每張都框住了建築物。
請判斷每一張照片中**最主要的那棟建築**屬於哪一類，只能從下列類別挑一個：

- portuguese：葡式殖民建築（葡式拱廊、殖民地官邸、薄荷綠/黃色洋房）
- temple：中式廟宇（紅牆、飛簷、廟門、香爐）
- church：天主教教堂（尖塔、十字架、哥德或巴洛克立面）
- tong_lau：騎樓與唐樓（連續拱廊店屋、舊式唐樓街屋）
- residential_tower：現代高層住宅（住宅大廈、公共房屋）
- casino_hotel：酒店與娛樂場（大型度假村、賭場、觀光酒店）
- civic：公共建築（政府機關、博物館、圖書館、學校、醫院）
- industrial：工業與倉庫（工廠、倉庫、船廠、碼頭設施）
- village：圍里與村落民居（低矮村屋、小巷民居）
- monument：牌坊與紀念物（牌坊、紀念碑、雕像、城牆、燈塔）
- market：街市與市集（傳統街市建築、紅街市）
- not_building：畫面不是建築物（食物、人物特寫、地圖、文件、室內商品等）

若照片主要是室內、或看不出建築外觀，也選 not_building。
**只輸出 JSON**，格式為：{{"results":[{{"index":1,"class":"temple","confidence":0.9}}, ...]}}
index 對應我提供的編號，務必每張都給一個結果。"""


def api_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY")
    if key:
        return key
    for p in (ROOT / "public" / "ai-local.json", ROOT / ".cache" / "deepseek.json"):
        if p.exists():
            try:
                d = json.loads(p.read_text(encoding="utf-8-sig"))
                if d.get("key"):
                    return d["key"]
            except Exception:
                pass
    raise SystemExit("缺少 DeepSeek 金鑰：請設 DEEPSEEK_API_KEY 環境變數，或確認 public/ai-local.json 存在")


def ask(images: list[Path], key: str, model: str, detail: str, retries: int = 3) -> list[dict]:
    """送一批圖片問類別；回傳 [{index, class, confidence}]。"""
    content = [{"type": "text", "text": PROMPT.format(n=len(images))}]
    for i, p in enumerate(images, 1):
        b64 = base64.b64encode(p.read_bytes()).decode()
        mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
        content.append({"type": "text", "text": f"第 {i} 張："})
        content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}", "detail": detail}})
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}],
                       "response_format": {"type": "json_object"}, "temperature": 0.1}).encode()
    for i in range(retries):
        try:
            req = urllib.request.Request(API, data=body, headers={
                "Content-Type": "application/json", "Authorization": f"Bearer {key}"})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            txt = data["choices"][0]["message"]["content"]
            parsed = json.loads(txt)
            out = parsed.get("results") or parsed.get("data") or []
            if isinstance(out, dict):
                out = list(out.values())
            return [x for x in out if isinstance(x, dict)]
        except Exception as e:
            if i == retries - 1:
                print(f"    [warn] VLM 呼叫失敗：{type(e).__name__}: {str(e)[:90]}")
                return []
            time.sleep(2 * (i + 1))
    return []


def vlm_classify(paths: list[Path], key: str, model: str, detail: str, batch: int) -> dict[str, dict]:
    """分批送圖，回傳 {檔名: {class, confidence}}；已有快取者不重送。"""
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE / "labels.json"
    cache = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}
    todo = [p for p in paths if str(p.relative_to(ROOT)) not in cache]
    print(f"[vlm] 共 {len(paths)} 張，快取命中 {len(paths) - len(todo)}，需呼叫 {len(todo)}")
    for s in range(0, len(todo), batch):
        chunk = todo[s:s + batch]
        res = ask(chunk, key, model, detail)
        got = 0
        for r in res:
            try:
                idx = int(r.get("index"))
            except (TypeError, ValueError):
                continue
            if 1 <= idx <= len(chunk):
                cls = str(r.get("class", "")).strip()
                if cls:
                    cache[str(chunk[idx - 1].relative_to(ROOT))] = {
                        "class": cls, "confidence": float(r.get("confidence") or 0)}
                    got += 1
        print(f"    {s + len(chunk)}/{len(todo)} 已送出（本批取得 {got} 筆）", flush=True)
        cache_file.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(1.0)
    return {p: cache.get(str(p.relative_to(ROOT)), {}) for p in paths}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true", help="複核 train/val 的現有標籤")
    ap.add_argument("--label-unlabeled", action="store_true", help="替沒有標籤的 raw 圖補類別")
    ap.add_argument("--review-suspect", action="store_true", help="複核 images/suspect/ 的爭議圖")
    ap.add_argument("--apply", action="store_true", help="依 VLM 結果實際修正（修正標籤類別／把 suspect 圖放回或刪除）")
    ap.add_argument("--sample", type=int, default=0, help="只抽樣 N 張（0=全部）")
    ap.add_argument("--batch", type=int, default=12, help="每次請求幾張圖（省呼叫次數）")
    ap.add_argument("--model", default="deepseek-flash")
    ap.add_argument("--detail", default="low", choices=["low", "high", "original", "auto"])
    ap.add_argument("--min-conf", type=float, default=0.6, help="VLM 信心低於此值不採用其建議")
    args = ap.parse_args()

    key = api_key()
    print(f"[vlm] 模型 {args.model} · detail={args.detail} · batch={args.batch} · key {key[:6]}…{key[-4:]}")

    targets: list[tuple[str, str, Path]] = []      # (模式, 資料夾類別, 路徑)
    if args.verify:
        for split in ("train", "val"):
            for p in sorted((DS / "images" / split).glob("*")):
                cid = class_of(p.stem)
                if cid in CLASSES:
                    targets.append(("verify", cid, p))
    if args.label_unlabeled:
        stems = {p.stem for p in (DS / "images" / "train").glob("*")} | {p.stem for p in (DS / "images" / "val").glob("*")}
        for cid in CLASSES:
            for p in sorted((RAW / cid).glob("*")):
                if f"{cid}_{p.stem}" not in stems:
                    targets.append(("unlabeled", cid, p))
    if args.review_suspect:
        for cid in CLASSES:
            for p in sorted((SUSPECT / cid).glob("*")) if (SUSPECT / cid).exists() else []:
                targets.append(("suspect", cid, p))

    if not targets:
        raise SystemExit("沒有要處理的目標：請加 --verify／--label-unlabeled／--review-suspect")
    if args.sample:
        import random
        random.seed(3)
        targets = random.sample(targets, min(args.sample, len(targets)))
        print(f"[vlm] 抽樣 {len(targets)} 張")

    by_mode = defaultdict(list)
    for m, _, p in targets:
        by_mode[m].append(p)
    verdicts: dict[str, dict] = {}
    for mode, paths in by_mode.items():
        print(f"\n=== 模式 {mode}：{len(paths)} 張 ===")
        verdicts.update(vlm_classify(paths, key, args.model, args.detail, args.batch))

    # ---- 統計與套用 ----
    change = 0
    stats = Counter()
    rows = []
    for mode, folder_cid, p in targets:
        v = verdicts.get(p, {})
        vc, vconf = v.get("class"), float(v.get("confidence") or 0)
        if not vc:
            stats[f"{mode}：VLM 無回應"] += 1
            continue
        agree = vc == folder_cid
        ambiguous = (not agree) and any({folder_cid, vc} == s for s in AMBIGUOUS)
        if ambiguous:
            stats[f"{mode}：類別定義歧義（不改，待人工）"] += 1
        else:
            stats[f"{mode}：{'VLM 同意' if agree else 'VLM 不同意'}（{'高' if vconf >= args.min_conf else '低'}信心）"] += 1
        rows.append(dict(mode=mode, file=str(p.relative_to(ROOT)).replace("\\", "/"), folder_class=folder_cid,
                         vlm_class=vc, vlm_conf=round(vconf, 2), agree=agree, ambiguous=ambiguous))
        # ① VLM 說「不是建築物」且高信心 → 這張圖對偵測器是純雜訊，移出訓練集（最高價值的修正）
        if mode == "verify" and vc == "not_building" and vconf >= args.min_conf:
            stats["verify：判為非建築→移出訓練集"] += 1
            change += 1
            if args.apply:
                dst = SUSPECT / folder_cid
                dst.mkdir(parents=True, exist_ok=True)
                shutil.move(str(p), str(dst / p.name))
                for split in ("train", "val"):
                    lb = DS / "labels" / split / (p.stem + ".txt")
                    if lb.exists():
                        lb.rename(lb.with_suffix(".txt.rejected"))
            continue
        # ② 跨類別的真錯誤（非歧義）→ 修正標籤類別並搬到正確類別
        if mode == "verify" and not agree and not ambiguous and vconf >= args.min_conf:
            change += 1
            if args.apply:
                # 把這張圖移到 VLM 認為正確的類別資料夾，並修正 split 內的標籤類別
                dst_dir = RAW / vc
                dst_dir.mkdir(parents=True, exist_ok=True)
                stem = p.stem.split("_", 1)[1] if "_" in p.stem else p.stem
                lbl = DS / "labels" / ("train" if (DS / "images" / "train" / p.name).exists() else "val") / (p.stem + ".txt")
                if lbl.exists():
                    ci = CLASSES.index(vc)
                    old = lbl.read_text().split()
                    if len(old) >= 5:
                        lbl.write_text(f"{ci} " + " ".join(old[1:5]) + "\n")
                shutil.move(str(p), str(dst_dir / f"{vc}_{stem}.jpg"))
        if mode == "suspect" and agree and vconf >= args.min_conf and args.apply:
            dst = DS / "images" / "raw" / folder_cid / p.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(p), str(dst))     # VLM 認為它其實屬於原資料夾 → 放回
    OUT.mkdir(parents=True, exist_ok=True)
    rep = OUT / "vlm-report.csv"
    with rep.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["mode", "file", "folder_class", "vlm_class", "vlm_conf", "agree", "ambiguous"])
        w.writeheader()
        w.writerows(rows)

    print("\n[vlm] 統計：")
    for k, v in stats.most_common():
        print(f"  {k:34} {v:5d}")
    print(f"\n[out] {rep.relative_to(ROOT)}（{len(rows)} 筆）")
    print(f"[vlm] 建議修正 {change} 張" + ("（已套用）" if args.apply else "（未套用，加 --apply）"))


if __name__ == "__main__":
    main()
