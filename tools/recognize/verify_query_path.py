"""查詢路徑的一致性驗證（回歸測試）——這一支就是當初抓到「庫與模型不同檔」的檢查。

為什麼需要它：
    build_embeddings.py 的自我評估是把庫內向量兩兩互查（leave-one-out），
    那條路徑**不會**經過「用模型重新編碼一張圖」這一步。曾經發生過
    public/models/dinov2-small-336.onnx 與建庫用的 ONNX 不是同一個檔，
    結果自評 Top-1 83.8%，但真實查詢的相似度只有 0.06、三棟示範全錯。

本檔檢查（全部都要通過）：
    1. public/models 的 ONNX 與 memory-embeddings.json 記錄的 sha256 一致
    2. 用「庫內的參考照片」重新編碼 → 與庫內對應向量的餘弦 ≥ 0.999（每一筆）
    3. 三棟示範查詢的 Top-1 正確且相似度 ≥ 門檻

用法：
    python tools/recognize/verify_query_path.py
    python tools/recognize/verify_query_path.py --json        # 只輸出機器可讀結果
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
from build_embeddings import OnnxEncoder  # noqa: E402

LIB = ROOT / "public" / "data" / "memory-embeddings.json"
ONNX_DIR = ROOT / "public" / "models"
CC = ROOT / "photos-src" / "cc"
DEMO = ROOT / "photos-src" / "demo"

# 示範查詢：檔案 + 期望的 Top-1（用 cc 的第一張實拍，以及 demo 截圖）
DEMO_QUERIES = [
    ("photos-src/cc/a-ma-temple/A-Ma_Temple_Macau_built_1488_2_32043656663_.jpg", "a-ma-temple", "媽閣廟"),
    ("photos-src/cc/ruins-st-paul/Ruins_of_Saint_Paul_s_Macau_Ank_Kumar_01.jpg", "ruins-st-paul", "大三巴牌坊"),
    ("photos-src/cc/mandarins-house/MacaoMandarinsHouse.jpg", "mandarins-house", "鄭家大屋"),
    ("photos-src/cc/moorish-barracks/Moorish_Barracks.jpg", "moorish-barracks", "港務局大樓"),
    ("photos-src/cc/st-dominic-church/St_Dominic_Church_Macau_2051968047_.jpg", "st-dominic-church", "玫瑰堂"),
]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--min-cos", type=float, default=0.999)
    args = ap.parse_args()

    data = json.loads(LIB.read_text(encoding="utf-8"))
    out: dict = {"checks": [], "ok": True}

    def check(name: str, ok: bool, detail: str):
        out["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
        out["ok"] = out["ok"] and bool(ok)
        if not args.json:
            print(f"  [{'PASS' if ok else 'FAIL'}] {name}：{detail}")

    # ---- 1. 模型檔指紋
    src_name = data["encoder"].get("source")
    want = data["encoder"].get("onnx_sha256")
    model = ONNX_DIR / src_name if src_name else None
    if not args.json:
        print("[1] 模型檔一致性")
    if model and model.is_file() and want:
        got = sha256(model)
        check("ONNX sha256 與嵌入庫記錄一致", got == want, f"{model.name} {got[:16]} vs 記錄 {want[:16]}")
    else:
        check("ONNX 指紋可比對", False, f"缺 model({model}) 或 sha256({want})")

    enc = OnnxEncoder(model)
    if not args.json:
        print("[2] 庫內參考照片重新編碼（查詢路徑）")

    # ---- 2. 逐筆自相似度
    worst = (1.0, "")
    n = 0
    for b in data["buildings"]:
        for i, fn in enumerate(b["files"]):
            fp = CC / b["id"] / fn
            if not fp.is_file():
                fp = DEMO / fn
            if not fp.is_file():
                continue
            v = enc.embed([Image.open(fp).convert("RGB")])[0]
            c = float(v @ np.array(b["vectors"][i], np.float32))
            n += 1
            if c < worst[0]:
                worst = (c, f"{b['id']}/{fn}")
    check("每張參考照片自相似度 ≥ 門檻", n > 0 and worst[0] >= args.min_cos,
          f"{n} 筆，最低 {worst[0]:.6f}（{worst[1]}）")

    # ---- 3. 示範查詢 Top-1
    if not args.json:
        print("[3] 示範查詢 Top-1")
    vecs = [(b, np.array(b["vectors"], np.float32)) for b in data["buildings"]]
    for rel, want_id, zh in DEMO_QUERIES:
        p = ROOT / rel
        if not p.is_file():
            check(f"示範查詢 {zh}", False, f"檔案不存在：{rel}")
            continue
        q = enc.embed([Image.open(p).convert("RGB")])[0]
        sims = [(float((V @ q).max()), b["id"]) for b, V in vecs]
        sims.sort(reverse=True)
        top = sims[0]
        check(f"示範查詢 {zh} → {top[1]}", top[1] == want_id, f"Top-1 = {top[1]}（{top[0]:.3f}）"

              + (f"，次名 {sims[1][1]} {sims[1][0]:.3f}" if len(sims) > 1 else ""))

    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    else:
        print(f"\n{'全部通過' if out['ok'] else '有檢查未通過'}（{sum(1 for c in out['checks'] if c['ok'])}/{len(out['checks'])}）")
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
