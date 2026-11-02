"""延伸評測：樣本量學習曲線、魯棒性衰減、信心校準、庫外建築偵測、int8 量化。

全部基於 38 棟／335 張參考照片（photos-src/cc，curation 後）與網站同一套檢索（整張圖三裁切＋翻轉、每棟取最高分）。
  learning   每棟只留 k 張參考照片（k = 1…7，限 ≥ 8 張的 27 棟），其餘當查詢；隨機 30 次取平均與 95% 區間
  robust     對查詢照片加四種退化（暗光、模糊、遮擋、雨霧）各五級，參考庫維持原圖；留一法 Top-1
  calib      以首位相似度預測「是否正確」：原始分數與保序回歸（5 折交叉驗證）各自的 ECE 與可靠性
  openset    留一棟法：把查詢所屬建築的全部參考照片移出庫，視為「庫外建築」；與庫內查詢比較 ROC
  int8       public/models 與 tools/recognize/out 的 int8 ONNX：準確率、大小、單張 CPU 耗時
編碼器：DINOv2 ViT-S/14 ONNX（與瀏覽器同一顆）；魯棒性實驗的大量退化影像改用同權重的 PyTorch GPU 版本以節省時間，
        並先驗證兩者向量一致（餘弦 > 0.99）。
說明：本腳本由 AI 程式助手（Claude）協助撰寫；結果解讀由研究者負責。
用法：python tools/eval/extended.py [learning robust calib openset int8]   （不給參數＝全部）
輸出：tools/eval/out/extended.json 與 ablation-cache 下的向量快取
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "eval"))
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
import ablation as ab  # noqa: E402
import build_embeddings as be  # noqa: E402

OUT = ROOT / "tools" / "eval" / "out"
CACHE = ab.CACHE
SEED = 20261102
HIT = 0.82


def load():
    refs = be.collect_references()
    ids = sorted({r["id"] for r in refs}); idx = {b: i for i, b in enumerate(ids)}
    y = np.array([idx[r["id"]] for r in refs])
    R = np.load(CACHE / "ref-small-tta.npy")
    return refs, ids, y, R


def building_scores(Q, R, y, nb, mask=None):
    """Q (nq,d) 對參考 R 每棟取最高分；mask (nq, nr) 為 False 的參考不參與。"""
    S = Q @ R.T
    if mask is not None:
        S = np.where(mask, S, -np.inf)
    out = np.full((len(Q), nb), -np.inf, np.float32)
    for b in range(nb):
        cols = y == b
        if cols.any():
            out[:, b] = S[:, cols].max(1)
    return out


def ci(v):
    v = np.asarray(v, float)
    return [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)]


# ─────────── 1 學習曲線 ───────────
def learning(refs, ids, y, R):
    nb = len(ids); counts = np.bincount(y, minlength=nb)
    keep_b = np.where(counts >= 8)[0]
    rng = np.random.default_rng(SEED)
    res = []
    for k in range(1, 8):
        t1s, t3s = [], []
        for _ in range(30):
            ref_mask = np.zeros(len(y), bool)
            for b in keep_b:
                mem = np.where(y == b)[0]
                ref_mask[rng.choice(mem, k, replace=False)] = True
            q = np.where(np.isin(y, keep_b) & ~ref_mask)[0]
            sc = building_scores(R[q], R[ref_mask], y[ref_mask], nb)
            order = np.argsort(-sc, 1)
            t1s.append(float(np.mean(order[:, 0] == y[q])))
            t3s.append(float(np.mean([y[q][i] in order[i, :3] for i in range(len(q))])))
        res.append({"k": k, "top1": round(float(np.mean(t1s)), 4), "top1_ci": ci(t1s),
                    "top3": round(float(np.mean(t3s)), 4), "top3_ci": ci(t3s)})
        print("learning", res[-1])
    return {"buildings": int(len(keep_b)), "repeats": 30, "curve": res}


# ─────────── 2 魯棒性 ───────────
LEVELS = [0, 1, 2, 3, 4, 5]


def degrade(im: Image.Image, kind: str, lvl: int, seed: int) -> Image.Image:
    if lvl == 0:
        return im
    r = np.random.default_rng(seed)
    if kind == "dark":          # 曝光逐級降低（亮度 ×0.7^lvl）並加感光雜訊
        out = ImageEnhance.Brightness(im).enhance(0.7 ** lvl)
        a = np.asarray(out, np.float32) + r.normal(0, 3 * lvl, (out.height, out.width, 3))
        return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    if kind == "blur":          # 高斯模糊，半徑為短邊的 0.4%×lvl
        return im.filter(ImageFilter.GaussianBlur(radius=min(im.size) * 0.004 * lvl))
    if kind == "occlude":       # 隨機灰色矩形遮擋，總面積約 8%×lvl
        out = im.copy(); w, h = im.size; a = np.asarray(out).copy()
        target = 0.08 * lvl * w * h; covered = 0
        while covered < target:
            bw, bh = int(w * r.uniform(0.15, 0.35)), int(h * r.uniform(0.15, 0.35))
            x, y0 = int(r.uniform(0, w - bw)), int(r.uniform(0, h - bh))
            a[y0:y0 + bh, x:x + bw] = (110, 110, 110); covered += bw * bh
        return Image.fromarray(a)
    if kind == "haze":          # 雨霧：與灰白色混合（透明度 0.15×lvl）並疊雨絲
        a = np.asarray(im, np.float32)
        a = a * (1 - 0.15 * lvl) + 215 * 0.15 * lvl
        w, h = im.size; out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        from PIL import ImageDraw
        d = ImageDraw.Draw(out)
        for _ in range(int(40 * lvl)):
            x, y0 = r.uniform(0, w), r.uniform(0, h); L = h * 0.05
            d.line((x, y0, x - L * 0.25, y0 + L), fill=(235, 235, 235), width=max(1, w // 600))
        return out
    raise ValueError(kind)


def robust(refs, ids, y, R):
    enc = ab.TorchDino("facebook/dinov2-small")
    imgs = [ab.load_img(r["path"]) for r in refs]
    nb = len(ids); valid = np.bincount(y, minlength=nb)[y] >= 2
    # 一致性檢查：PyTorch 與 ONNX 向量
    chk = np.stack([enc.embed_one(im) for im in imgs[:20]])
    agree = float(np.mean(np.sum(chk * R[:20], 1)))
    print("torch vs onnx cosine", round(agree, 4))
    Rt = CACHE / "ref-small-torch.npy"
    Rtorch = np.load(Rt) if Rt.exists() else np.stack([enc.embed_one(im) for im in imgs])
    np.save(Rt, Rtorch)
    out = {"torch_onnx_cosine": round(agree, 4), "levels": LEVELS, "curves": {}}
    for kind in ("dark", "blur", "occlude", "haze"):
        curve = []
        for lvl in LEVELS:
            f = CACHE / f"rob-{kind}-{lvl}.npy"
            if f.exists():
                Q = np.load(f)
            else:
                Q = np.stack([enc.embed_one(degrade(im, kind, lvl, SEED + i)) for i, im in enumerate(imgs)])
                np.save(f, Q)
            mask = ~np.eye(len(y), dtype=bool)          # 留一法：不與自己的原圖比
            sc = building_scores(Q, Rtorch, y, nb, mask)
            hit = (sc.argmax(1) == y)[valid]
            lo, hi = ab.wilson(int(hit.sum()), int(hit.size))
            top = sc.max(1)[valid]
            curve.append({"level": lvl, "top1": round(float(hit.mean()), 4), "ci": [round(lo, 4), round(hi, 4)],
                          "confident_rate": round(float(np.mean(top >= HIT)), 4),
                          "confident_precision": round(float(hit[top >= HIT].mean()), 4) if (top >= HIT).any() else None})
            print("robust", kind, curve[-1])
        out["curves"][kind] = curve
    # 存一張示例退化圖供論文附圖
    demo = imgs[[r["path"].name for r in refs].index(next(r["path"].name for r in refs if r["id"] == "ruins-st-paul"))]
    demo.thumbnail((480, 480))
    row = Image.new("RGB", (demo.width * 4, demo.height * 2), "white")
    for j, kind in enumerate(("dark", "blur", "occlude", "haze")):
        for i, lvl in enumerate((2, 5)):
            row.paste(degrade(demo, kind, lvl, SEED), (j * demo.width, i * demo.height))
    row.save(OUT / "robust-examples.jpg", quality=90)
    return out


# ─────────── 3 校準 ───────────
def calib(refs, ids, y, R):
    from sklearn.isotonic import IsotonicRegression
    nb = len(ids); valid = np.bincount(y, minlength=nb)[y] >= 2
    sc = building_scores(R, R, y, nb, ~np.eye(len(y), dtype=bool))
    s = sc.max(1)[valid]; c = (sc.argmax(1) == y)[valid].astype(float)
    rng = np.random.default_rng(SEED); folds = rng.permutation(len(s)) % 5
    p_iso = np.zeros_like(s)
    for f in range(5):
        tr, te = folds != f, folds == f
        p_iso[te] = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(s[tr], c[tr]).predict(s[te])

    def ece(p, n_bins=10):
        edges = np.linspace(0, 1, n_bins + 1); e = 0.0; rows = []
        for a, b in zip(edges[:-1], edges[1:]):
            m = (p >= a) & (p < b if b < 1 else p <= b)
            if m.any():
                e += m.mean() * abs(p[m].mean() - c[m].mean())
                rows.append({"bin": [round(a, 2), round(b, 2)], "n": int(m.sum()), "conf": round(float(p[m].mean()), 4), "acc": round(float(c[m].mean()), 4)})
        return round(float(e), 4), rows

    raw_e, raw_rows = ece(np.clip(s, 0, 1)); iso_e, iso_rows = ece(p_iso)
    brier = lambda p: round(float(np.mean((p - c) ** 2)), 4)
    out = {"n": int(len(s)), "ece_raw": raw_e, "ece_isotonic_cv": iso_e, "brier_raw": brier(np.clip(s, 0, 1)), "brier_isotonic_cv": brier(p_iso),
           "bins_raw": raw_rows, "bins_isotonic": iso_rows,
           "mapping": [{"sim": round(float(t), 2), "p": round(float(IsotonicRegression(out_of_bounds='clip', y_min=0, y_max=1).fit(s, c).predict([t])[0]), 4)} for t in np.arange(0.4, 1.0001, 0.05)]}
    print("calib", {k: v for k, v in out.items() if not isinstance(v, list)})
    return out


# ─────────── 4 庫外偵測 ───────────
def openset(refs, ids, y, R):
    nb = len(ids); valid = np.bincount(y, minlength=nb)[y] >= 2
    S = R @ R.T
    np.fill_diagonal(S, -np.inf)
    known = np.max(np.where(np.eye(len(y), dtype=bool), -np.inf, S), 1)          # 庫內：最高分（含同棟其餘照片）
    same = y[:, None] == y[None, :]
    unknown = np.max(np.where(same, -np.inf, S), 1)                                  # 庫外：同棟全部移出後的最高分
    k, u = known[valid], unknown                                                     # 庫外以全部 335 張計
    labels = np.r_[np.ones(len(k)), np.zeros(len(u))]; scores = np.r_[k, u]
    o = np.argsort(-scores); l = labels[o]
    tpr = np.r_[0, np.cumsum(l) / l.sum()]; fpr = np.r_[0, np.cumsum(1 - l) / (1 - l).sum()]
    auc = float(np.trapezoid(tpr, fpr))
    out = {"n_known": int(len(k)), "n_unknown": int(len(u)), "auroc": round(auc, 4),
           "far_at_0.82": round(float(np.mean(u >= HIT)), 4), "far_at_0.57": round(float(np.mean(u >= 0.57)), 4),
           "known_accept_at_0.82": round(float(np.mean(k >= HIT)), 4),
           "roc": {"fpr": [round(float(x), 4) for x in fpr[::7]], "tpr": [round(float(x), 4) for x in tpr[::7]]},
           "known_scores": [round(float(x), 4) for x in k], "unknown_scores": [round(float(x), 4) for x in u]}
    print("openset", {kk: v for kk, v in out.items() if not isinstance(v, (list, dict))})
    return out


# ─────────── 5 int8 量化 ───────────
def int8(refs, ids, y, R):
    nb = len(ids); valid = np.bincount(y, minlength=nb)[y] >= 2
    imgs = [ab.load_img(r["path"]) for r in refs]
    res = {}
    for name, path in (("fp32", ROOT / "public/models/dinov2-vits14-336.onnx"), ("int8", ROOT / "public/models/dinov2-vits14-336.int8.onnx")):
        enc = ab.OnnxSingle(path)
        f = CACHE / f"ref-{name}-onnx.npy"
        V = np.load(f) if f.exists() else np.stack([enc.embed_one(im) for im in imgs])
        np.save(f, V)
        t = []
        for im in imgs[:20]:
            t0 = time.perf_counter(); enc.embed_one(im); t.append(time.perf_counter() - t0)
        sc = building_scores(V, V, y, nb, ~np.eye(len(y), dtype=bool))
        hit = (sc.argmax(1) == y)[valid]
        res[name] = {"mb": round(path.stat().st_size / 1e6, 1), "top1": round(float(hit.mean()), 4),
                     "ms_per_image_cpu_6views": round(float(np.median(t)) * 1000, 1)}
        res[name]["_hit"] = hit
    res["mcnemar_int8_vs_fp32"] = ab.mcnemar_exact(res["fp32"].pop("_hit"), res["int8"].pop("_hit"))
    Vf, Vi = np.load(CACHE / "ref-fp32-onnx.npy"), np.load(CACHE / "ref-int8-onnx.npy")
    res["vector_cosine_int8_vs_fp32"] = round(float(np.mean(np.sum(Vf * Vi, 1))), 4)
    print("int8", res)
    return res


def main():
    want = sys.argv[1:] or ["learning", "robust", "calib", "openset", "int8"]
    refs, ids, y, R = load()
    f = OUT / "extended.json"
    out = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    for name in want:
        out[name] = globals()[name](refs, ids, y, R)
        f.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", f)


if __name__ == "__main__":
    main()
