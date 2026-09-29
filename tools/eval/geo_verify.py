"""② 幾何驗證：檢索 top-1 → 用局部特徵匹配 + RANSAC 確認，專治「外觀相近的不同建築」誤判。

問題背景：
    全局描述子（CLIP／DINOv2）只看整體相似度，因此路氹城三棟度假村這種「長得像但不同棟」
    會互相誤判（實測 倫敦人 vs 銀河 相似度 0.874、誤判率 72%）。地理先驗能擋掉這種情況，
    但沒有 GPS 時就沒轍。幾何驗證提供第二道防線：**同棟不同角度會有大量一致的特徵對應，
    不同棟即使整體相似，也很難找到幾何一致的內點**。

方法（兩階段級聯）：
    ① 全局檢索：DINOv2 餘弦相似度取 top-1 候選
    ② 幾何驗證：DISK + LightGlue 特徵匹配 → RANSAC 估計單應/相似變換 → 內點數與內點比
    只有「全局相似度 ≥ 低閾值」且「幾何內點 ≥ K」才接受歸戶。

用法：
    python tools/eval/geo_verify.py --method disk        # DISK + LightGlue（預設）
    python tools/eval/geo_verify.py --method sift        # OpenCV SIFT + RANSAC（無需下載）
    python tools/eval/geo_verify.py --pairs 60           # 限制評估配對數（快速版）
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "eval" / "out"
sys.path.insert(0, str(ROOT / "tools" / "eval"))


# ---------------------------------------------------------------- 特徵抽取器
class SiftMatcher:
    """OpenCV SIFT + 比率檢驗 + RANSAC（完全離線、CPU 即可）。"""

    name = "SIFT + RANSAC"

    def __init__(self, max_kp=2048):
        self.sift = cv2.SIFT_create(nfeatures=max_kp)
        self.bf = cv2.BFMatcher(cv2.NORM_L2)

    def _feat(self, path):
        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        if img is None:
            return None, None
        scale = 1024 / max(img.shape)
        if scale < 1:
            img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        kp, des = self.sift.detectAndCompute(img, None)
        return kp, des

    def verify(self, pa, pb) -> dict:
        ka, da = self._feat(pa)
        kb, db = self._feat(pb)
        if da is None or db is None or len(ka) < 8 or len(kb) < 8:
            return dict(inliers=0, ratio=0.0, ok=False)
        raw = self.bf.knnMatch(da, db, k=2)
        good = [m for m, n in (p for p in raw if len(p) == 2) if m.distance < 0.75 * n.distance]
        if len(good) < 8:
            return dict(inliers=0, ratio=0.0, ok=False, matches=len(good))
        src = np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([kb[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, 3.0, maxIters=5000, confidence=0.999)
        inl = int(mask.sum()) if mask is not None else 0
        return dict(inliers=inl, ratio=inl / max(len(good), 1), ok=inl >= 12, matches=len(good))


class DiskLightGlueMatcher:
    """kornia DISK + LightGlue（學習式特徵與匹配器，通常比 SIFT 穩）。"""

    name = "DISK + LightGlue"

    def __init__(self, max_kp=2048, device=None):
        import torch
        from kornia.feature import DISK, LightGlueMatcher

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.disk = DISK.from_pretrained("depth").to(self.device).eval()
        self.matcher = LightGlueMatcher("disk", {"depth_confidence": -1, "width_confidence": -1,
                                                 "filter_threshold": 0.2}).to(self.device).eval()
        self.max_kp = max_kp

    def _feat(self, path):
        from kornia.feature import laf_from_center_scale_ori

        img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
        if img is None:
            return None, None
        h, w = img.shape
        scale = 1024 / max(h, w)
        if scale < 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        t = self.torch.from_numpy(np.stack([img] * 3, 0)[None]).float().to(self.device) / 255.0
        with self.torch.no_grad():
            out = self.disk(t, self.max_kp, score_threshold=0.0, pad_if_not_divisible=True)[0]
        kp = out.keypoints[None]                       # (1,N,2)
        desc = out.descriptors[None]                   # (1,N,D)
        # LightGlue 需要 LAF（(N,2,3) 的局部仿射座標），由關鍵點 + 單位尺度/零旋轉建構
        laf = laf_from_center_scale_ori(kp, self.torch.ones(1, kp.shape[1], 1, 1, device=self.device),
                                        self.torch.zeros(1, kp.shape[1], 1, device=self.device))
        return laf, desc

    def verify(self, pa, pb) -> dict:
        la, da = self._feat(pa)
        lb, db = self._feat(pb)
        if da is None or db is None or len(da) < 8 or len(db) < 8:
            return dict(inliers=0, ratio=0.0, ok=False)
        with self.torch.no_grad():
            dist, idx = self.matcher(da, db, la, lb)      # 需批次維度：(B,N,D) 與 (B,N,2,3)
        if idx is None or len(idx) < 8:
            return dict(inliers=0, ratio=0.0, ok=False, matches=0 if idx is None else len(idx))
        src = la[0][:, :2, 2][idx[:, 0]].cpu().numpy()
        dst = lb[0][:, :2, 2][idx[:, 1]].cpu().numpy()
        H, mask = cv2.findHomography(src.astype(np.float32).reshape(-1, 1, 2),
                                     dst.astype(np.float32).reshape(-1, 1, 2),
                                     cv2.USAC_MAGSAC, 4.0, maxIters=5000, confidence=0.999)
        inl = int(mask.sum()) if mask is not None else 0
        return dict(inliers=inl, ratio=inl / max(len(idx), 1), ok=inl >= 15, matches=len(idx))


# ---------------------------------------------------------------- 評估
def load_cc_rows():
    """載入實拍 CC 照片（含建築標籤）；沿用 evaluate.py 的資料表，確保同一批圖。"""
    import evaluate as ev
    rows = ev.load_dataset()
    cc = [r for r in rows if r["tier"] == "real-cc"]
    return cc


def embeddings(cc, encoder="dino"):
    """取得已快取的嵌入向量（由 evaluate.py 產生）。"""
    feats = {}
    for f in OUT.glob("embeddings-*.npz"):
        z = np.load(f, allow_pickle=True)
        for r in cc:
            if r["file"] in z.files:
                feats[r["file"]] = z[r["file"]]
    return feats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--method", default="disk", choices=["disk", "sift"])
    ap.add_argument("--pairs", type=int, default=0, help="限制評估的查詢數（0=全部）")
    ap.add_argument("--global-thr", type=float, default=0.15, help="進入幾何驗證的全局相似度下限")
    ap.add_argument("--min-inliers", type=int, default=15)
    args = ap.parse_args()

    cc = load_cc_rows()
    feats = embeddings(cc)
    missing = [r for r in cc if r["file"] not in feats]
    print(f"[geo] CC 照片 {len(cc)} 張；有嵌入 {len(cc) - len(missing)} 張"
          f"（缺 {len(missing)}，先跑 evaluate.py --encoder dino 產生）")

    matcher = DiskLightGlueMatcher() if args.method == "disk" else SiftMatcher()
    print(f"[geo] 驗證器：{matcher.name} · 全局門檻 {args.global_thr} · 內點門檻 {args.min_inliers}")

    # 對每張圖取「不同檔案」的 top-1 候選（模擬真實歸戶：新照片 vs 既有記憶點）
    keys = [r for r in cc if r["file"] in feats]
    t0 = time.time()
    n = 0
    stats = dict(total=0, same=0, diff=0,
                 base_tp=0, base_fp=0,      # 只用全局閾值
                 geo_tp=0, geo_fp=0,        # 全局 + 幾何驗證
                 geo_rejected_same=0, geo_rejected_diff=0)
    rows_out = []
    for r in keys:
        if args.pairs and n >= args.pairs:
            break
        v = feats[r["file"]]
        best, bs = None, -2.0
        for o in keys:
            if o["file"] == r["file"]:
                continue
            s = float(v @ feats[o["file"]])
            if s > bs:
                best, bs = o, s
        if best is None or bs < args.global_thr:
            continue
        n += 1
        same = best["building_id"] == r["building_id"]
        stats["total"] += 1
        stats["same" if same else "diff"] += 1
        if bs >= 0.86 if args.method == "sift" else bs >= 0.35:      # 各編碼器的粗略高信心閾值
            stats["base_tp" if same else "base_fp"] += 1
        g = matcher.verify(r["path"], best["path"])
        ok = g["inliers"] >= args.min_inliers
        if ok:
            stats["geo_tp" if same else "geo_fp"] += 1
        else:
            stats["geo_rejected_same" if same else "geo_rejected_diff"] += 1
        rows_out.append(dict(query=r["file"], cand=best["file"], global_sim=round(bs, 4),
                             same_building=same, inliers=g["inliers"],
                             inlier_ratio=round(g.get("ratio", 0), 3), accepted=ok))
        if n % 10 == 0:
            print(f"    {n} 對（{time.time() - t0:.0f}s）", flush=True)

    print(f"\n=== 結果（top-1 檢索，{stats['total']} 對；同棟 {stats['same']}、不同棟 {stats['diff']}）===")
    print(f"  幾何驗證接受：同棟 {stats['geo_tp']}/{stats['same']}、不同棟 {stats['geo_fp']}/{stats['diff']}")
    print(f"  幾何驗證擋掉：同棟 {stats['geo_rejected_same']}（漏接）、不同棟 {stats['geo_rejected_diff']}（正確阻擋）")
    if stats["diff"]:
        print(f"  不同棟誤判率：全局 {stats['base_fp'] / stats['diff'] * 100:.1f}% → "
              f"加幾何驗證後 {stats['geo_fp'] / stats['diff'] * 100:.1f}%")
    if stats["same"]:
        print(f"  同棟接受率：{stats['geo_tp'] / stats['same'] * 100:.1f}%")
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"geo-verify-{args.method}.csv"
    with p.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows_out[0].keys()) if rows_out else ["query"])
        w.writeheader()
        w.writerows(rows_out)
    print(f"\n[out] {p.relative_to(ROOT)}（{len(rows_out)} 筆，可用於分析誤判案例）")
    (OUT / f"geo-verify-{args.method}.json").write_text(
        json.dumps(dict(method=matcher.name, stats=stats, params=vars(args)), ensure_ascii=False, indent=1),
        encoding="utf-8")


if __name__ == "__main__":
    main()
