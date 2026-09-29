"""參考照片品管（用 YOLO 檢查「照片主體是不是這棟建築」）→ 產生審核清單與 curated 清單。

為什麼要做：
    嵌入庫的品質上限就是參考照片的品質。實測發現 photos-src/cc 裡有幾張照片的
    「主體」根本不是該棟建築（例如澳門威尼斯人資料夾裡有一張麥當勞門面、
    大三巴牌坊資料夾裡有大三巴前銅像的特寫、旅遊塔有一張室內隔玻璃往下拍）。
    這些圖會把該棟的向量拉向錯誤方向，並且在檢索時變成「黑洞」把別人的查詢吸走。
    純演算法救不了，必須在資料層過濾。

做法（可覆核，不是黑箱）：
    對每張參考照片跑一次 public/models/macau-buildings-yolo.onnx（與前端同一顆模型），
    看「面積最大的偵測框」屬於哪一類：
        A. 命中該棟類別（cls 或 accept_cls 之一）           → ok
        B. 完全沒偵測到任何建築框                            → no_detection（可疑）
        C. 偵測到別的類別                                    → other_class（可疑）
    另外記錄 top-1 框的照片面積占比（主體大小），太小的也標可疑。

輸出：
    tools/recognize/out/ref-audit.json     每張圖的判定（人可讀）
    tools/recognize/curation.json          要排除哪些圖 + 每棟類別覆寫（build_embeddings.py 會讀）

用法：
    python tools/recognize/audit_references.py                # 只稽核、寫出報告
    python tools/recognize/audit_references.py --write-curation
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
from build_embeddings import BUILDINGS, collect_references  # noqa: E402

YOLO_ONNX = ROOT / "public" / "models" / "macau-buildings-yolo.onnx"
YOLO_META = ROOT / "public" / "models" / "macau-buildings-yolo.json"
OUT_DIR = Path(__file__).resolve().parent / "out"
CURATION = Path(__file__).resolve().parent / "curation.json"


def letterbox(img: np.ndarray, size: int):
    """與 src/recognize/preprocess.js 的 letterbox 等價（灰邊 114、等比例）。"""
    h, w = img.shape[:2]
    s = min(size / w, size / h)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    canvas = np.full((size, size, 3), 114, np.uint8)
    pil = Image.fromarray(img).resize((nw, nh), Image.BILINEAR)
    px, py = (size - nw) // 2, (size - nh) // 2
    canvas[py:py + nh, px:px + nw] = np.asarray(pil)
    x = canvas.astype(np.float32) / 255.0
    return np.transpose(x, (2, 0, 1))[None], s, px, py


def decode(out: np.ndarray, names: list[str], s: float, px: int, py: int, w: int, h: int, conf: float = 0.20):
    """ultralytics 偵測頭輸出 (1, 4+nc, N) → [(cls, score, x, y, w, h)]（原圖座標）"""
    a = out[0] if out.ndim == 3 else out
    if a.shape[0] > a.shape[1]:
        a = a.T
    boxes, scores = a[:4], a[4:]
    best = scores.max(0)
    keep = best >= conf
    if not keep.any():
        return []
    cls_idx = scores.argmax(0)[keep]
    cx, cy, bw, bh = boxes[:, keep]
    x1 = (cx - bw / 2 - px) / s
    y1 = (cy - bh / 2 - py) / s
    x2 = (cx + bw / 2 - px) / s
    y2 = (cy + bh / 2 - py) / s
    x1 = np.clip(x1, 0, w); y1 = np.clip(y1, 0, h)
    x2 = np.clip(x2, 0, w); y2 = np.clip(y2, 0, h)
    return [{"cls": names[int(c)], "score": float(sc),
             "x": float(x1[i]), "y": float(y1[i]),
             "w": float(x2[i] - x1[i]), "h": float(y2[i] - y1[i])}
            for i, (c, sc) in enumerate(zip(cls_idx, best[keep])) if x2[i] > x1[i] and y2[i] > y1[i]]


def box_area(d: dict) -> float:
    """一定要回 Python float：np.float32 在 max(key=...) 的比較上會出意外。"""
    return float(d["w"]) * float(d["h"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--imgsz", type=int, default=768)
    ap.add_argument("--conf", type=float, default=0.20)
    ap.add_argument("--min-area", type=float, default=0.06, help="top-1 框佔畫面比例低於此值 → 主體太小")
    ap.add_argument("--only", default=None,
                    help="逗號分隔的建築 id：只稽核這些資料夾，結果合併進既有的 out/ref-audit.json")
    ap.add_argument("--write-curation", action="store_true")
    args = ap.parse_args()

    import onnxruntime as ort

    meta = json.loads(YOLO_META.read_text(encoding="utf-8"))
    names = meta["names"]
    print(f"YOLO {YOLO_ONNX.name} · {len(names)} 類 · imgsz {args.imgsz}")
    sess = ort.InferenceSession(str(YOLO_ONNX), providers=["CPUExecutionProvider"])
    iname = sess.get_inputs()[0].name

    refs = collect_references()
    print(f"參考影像 {len(refs)} 張 · {len({r['id'] for r in refs})} 棟")
    prev: list[dict] = []
    audit_path = OUT_DIR / "ref-audit.json"
    if audit_path.is_file():
        try:
            old = json.loads(audit_path.read_text(encoding="utf-8"))
        except Exception:
            old = []
        # 只保留「現在還在、而且會被納入」的舊判定，避免已刪除／已排除的照片留在報告裡
        live = {r["id"] + "/" + r["path"].name for r in refs}
        prev = [r for r in old if f"{r.get('id')}/{r.get('file')}" in live]
        dropped = len(old) - len(prev)
        if dropped:
            print(f"      報告清理：移除 {dropped} 筆已不存在／已排除的舊判定")
    if args.only:
        keep = set(args.only.split(","))
        refs = [r for r in refs if r["id"] in keep]
        print(f"      --only：只稽核 {len(refs)} 張（{len(keep)} 棟）")
        prev = [r for r in prev if r.get("id") not in keep]

    rows = []
    t0 = time.time()
    for i, r in enumerate(refs, 1):
        entry = BUILDINGS[r["id"]]
        want = {entry["cls"]} | set(entry.get("accept_cls", []) or [])
        try:
            img = np.asarray(Image.open(r["path"]).convert("RGB"))
            h, w = img.shape[:2]
            x, s, px, py = letterbox(img, args.imgsz)
            out = sess.run(None, {iname: x.astype(np.float32)})[0]
            dets = decode(out, names, s, px, py, w, h, args.conf)
        except Exception as e:
            rows.append({"id": r["id"], "file": r["path"].name, "verdict": "error", "why": repr(e)})
            continue
        # 只看屬於本棟類別的框，以及面積最大的框
        of_class = [d for d in dets if d["cls"] in want]
        biggest = max(dets, key=box_area, default=None)
        area = box_area(biggest) / max(1, w * h) if biggest else 0.0
        if of_class:
            verdict = "ok"
            why = f"{of_class[0]['cls']} {of_class[0]['score']:.2f}"
        elif not dets:
            verdict = "no_detection"
            why = "沒有任何建築框"
        else:
            verdict = "other_class"
            why = "只偵測到 " + ", ".join(f"{d['cls']}({d['score']:.2f})" for d in dets[:3])
        if verdict == "ok" and area < args.min_area:
            verdict = "tiny_subject"
            why += f" · 主體僅占畫面 {area*100:.1f}%"
        rows.append({
            "id": r["id"], "zh": entry["zh"], "cls": entry["cls"], "file": r["path"].name,
            "isDemo": r["isDemo"], "verdict": verdict, "why": why,
            "top": f"{biggest['cls']} {biggest['score']:.2f} {area*100:.1f}%" if biggest else "—",
            "n_dets": len(dets),
        })
        if i % 20 == 0:
            print(f"  {i}/{len(refs)} … {time.time()-t0:.0f}s")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = prev + rows
    rows.sort(key=lambda r: (r.get("id", ""), r.get("file", "")))
    (OUT_DIR / "ref-audit.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")

    from collections import Counter, defaultdict
    print("\n判定統計：" + json.dumps(Counter(r["verdict"] for r in rows), ensure_ascii=False))
    per = defaultdict(lambda: defaultdict(int))
    focus = set(args.only.split(",")) if args.only else None
    for r in rows:
        per[r["id"]][r["verdict"]] += 1
    print(f"\n{'建築':24s} {'總數':>4s} {'ok':>4s} {'狀況'}")
    suspects = []
    for bid in sorted(per):
        c = per[bid]
        n = sum(c.values())
        flag = "" if c.get("ok", 0) >= 3 else "  ← ok 少於 3 張"
        if focus and bid not in focus:
            flag += "  (沿用上次稽核)"
        print(f"{bid:24s} {n:4d} {c.get('ok',0):4d} {dict(c)}{flag}")
        for r in rows:
            if r["id"] == bid and r["verdict"] != "ok":
                suspects.append(r)
    # --only 時另外列一份「本次稽核」的乾淨清單，方便逐張複核
    if focus:
        fresh = [r for r in rows if r.get("id") in focus]
        fresh_susp = [r for r in fresh if r["verdict"] != "ok"]
        print(f"\n本次稽核 {len(fresh)} 張，其中可疑 {len(fresh_susp)} 張：")
        for r in fresh_susp:
            print(f"  {r['verdict']:14s} {r['id']:22s} {r['file'][:46]:46s} {r['why']}")
    print(f"\n可疑影像 {len(suspects)} 張（前 25 筆）：")
    for r in suspects[:25]:
        print(f"  {r['verdict']:14s} {r['id']:22s} {r['file'][:44]:44s} {r['why']}")

    if args.write_curation:
        # 注意：這裡只「建議」候選，最後仍要人工看圖（make_audit_sheet.py）再寫進 curation.json，
        # 因為 YOLO 沒偵測到不等於照片錯（旅遊塔就是已知弱項）。本檔不直接覆蓋 curation.json。
        suggestion = {
            "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "method": "YOLO(macau-buildings-yolo.onnx, imgsz=768, conf=%.2f) 檢查每張參考照片的主體類別" % args.conf,
            "suspects": sorted({f"{r['id']}/{r['file']}" for r in suspects if r["verdict"] != "error"}),
            "note": "這是『建議複核』清單，不是最終排除清單；請用 make_audit_sheet.py 看圖後再更新 curation.json",
        }
        (OUT_DIR / "curation-suggestion.json").write_text(
            json.dumps(suggestion, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n→ {OUT_DIR / 'curation-suggestion.json'}（建議複核 {len(suggestion['suspects'])} 張，非最終排除清單）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
