"""攝影者隔離的留一法：查詢時把「同棟、同一攝影者」的參考照片全部移出，避免同一人同日拍的相似照片抬高準確率。

攝影者來源：photos-src/cc/ATTRIBUTION.csv 的 author；使用者提供的照片以來源資料夾視為同一來源（保守）。
輸出每棟與整體的一般留一法、隔離留一法 Top-1，寫入 tools/eval/out/strict-loo.json。
說明：本腳本由 AI 程式助手（Claude）協助撰寫；結果解讀由研究者負責。
用法：python tools/eval/strict_loo.py
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def author_map():
    a = {}
    for r in csv.DictReader(open(ROOT / "photos-src/cc/ATTRIBUTION.csv", encoding="utf-8-sig")):
        a[(r["building_id"], Path(r["file"]).name)] = r["author"] or "unknown"
    up = ROOT / "photos-src/cc/ATTRIBUTION-user-provided.csv"
    if up.exists():
        for r in csv.DictReader(open(up, encoding="utf-8-sig")):
            a[(r["building_id"], Path(r["file"]).name)] = "user:" + (r.get("source_dir") or "")
    return a


def main():
    d = json.loads((ROOT / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
    A = author_map(); V, y, au = [], [], []
    for bi, b in enumerate(d["buildings"]):
        for f, v in zip(b["files"], b["vectors"]):
            V.append(v); y.append(bi); au.append(A.get((b["id"], Path(f).name), "?"))
    V = np.asarray(V, np.float32); y = np.asarray(y); au = np.asarray(au)
    ids = [b["id"] for b in d["buildings"]]; zh = [b.get("zh", b["id"]) for b in d["buildings"]]
    S = V @ V.T
    out = {"buildings": {}}
    for mode in ("plain", "strict"):
        hits = {}
        for i in range(len(y)):
            m = np.ones(len(y), bool); m[i] = False
            if mode == "strict":
                m &= ~((au == au[i]) & (y == y[i]))
            if not (m & (y == y[i])).any():
                continue
            sc = np.full(len(ids), -np.inf)
            for b in range(len(ids)):
                mm = m & (y == b)
                if mm.any():
                    sc[b] = S[i][mm].max()
            hits.setdefault(int(y[i]), []).append(bool(np.argmax(sc) == y[i]))
        allh = [h for v in hits.values() for h in v]
        out[mode] = {"top1": round(float(np.mean(allh)), 4), "n": len(allh)}
        for b in range(len(ids)):
            e = out["buildings"].setdefault(ids[b], {"zh": zh[b], "photos": int((y == b).sum()),
                                                    "photographers": int(len(set(au[y == b])))})
            h = hits.get(b, [])
            e[mode] = [int(sum(h)), len(h)]
    (ROOT / "tools/eval/out/strict-loo.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("plain", out["plain"], "strict", out["strict"])
    rows = sorted(out["buildings"].items(), key=lambda kv: (kv[1]["strict"][0] / kv[1]["strict"][1]) if kv[1]["strict"][1] else -1)
    for k, e in rows:
        print(f"{e['zh'][:12]:<14} photos {e['photos']:>3}  photographers {e['photographers']:>2}  plain {e['plain'][0]}/{e['plain'][1]}  strict {e['strict'][0]}/{e['strict'][1]}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
