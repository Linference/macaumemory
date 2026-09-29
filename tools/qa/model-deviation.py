"""量測模型壓縮造成的幾何誤差：優化後模型相對原始模型的表面偏差。

方法：在「優化後模型」表面取樣 N 個點，對「原始模型」求最近點距離，統計平均／p95／最大值。
因為只是把取樣點投影到原模型表面，不需同一套拓撲，適合比較不同簡化比例的版本。

輸出單位為模型座標（與 GLB 一致），另依 manifest 的實際尺寸換算成公釐。

用法：python tools/qa/model-deviation.py --samples 20000
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / ".cache" / "qa"
MANIFEST = ROOT / "public" / "models" / "manifest.json"


def load(path: Path) -> trimesh.Trimesh:
    scene = trimesh.load(str(path), force="scene")
    geo = scene.to_geometry() if hasattr(scene, "to_geometry") else scene.dump(concatenate=True)
    if isinstance(geo, list):
        geo = trimesh.util.concatenate(geo)
    return geo


def deviation(ref: trimesh.Trimesh, test: trimesh.Trimesh, n: int) -> dict:
    pts, _ = trimesh.sample.sample_surface(test, n)
    _, dist, _ = trimesh.proximity.closest_point(ref, pts)
    return {
        "mean": float(np.mean(dist)),
        "p95": float(np.percentile(dist, 95)),
        "max": float(np.max(dist)),
        "faces": int(len(test.faces)),
        "ref_faces": int(len(ref.faces)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=20000)
    ap.add_argument("--models", default="macau-tower,tang-sancai-camel")
    args = ap.parse_args()

    dims = {}
    if MANIFEST.exists():
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        for k, v in m["models"].items():
            d = v.get("dimensionsMeters")
            if d:
                dims[v["full"]["file"].replace(".glb", "")] = max(d)

    rows = []
    for base in args.models.split(","):
        src = ROOT / ".cache" / "models-src" / f"{base}.glb"
        if not src.exists():
            print(f"  跳過 {base}（找不到原始模型）")
            continue
        ref = load(src)
        span = float(np.max(ref.bounds[1] - ref.bounds[0]))
        scale_mm = (dims.get(base, span) / span) * 1000      # 模型單位 → 公釐
        print(f"\n=== {base} ===")
        print(f"  原始：{len(ref.faces):,} 面，外框 {span:.3f} 單位（約 {dims.get(base, span):.1f} m）")
        for label, p in (
            ("高精度 舊(14%)", QA / f"{base}.old.glb"),
            ("高精度 新(40%)", QA / f"{base}.new.glb"),
            ("LOD 舊(3%)", QA / f"{base}.old.lod.glb"),
            ("LOD 新(12%)", QA / f"{base}.new.lod.glb"),
        ):
            if not p.exists():
                continue
            t = load(p)
            d = deviation(ref, t, args.samples)
            rows.append((base, label, d, scale_mm))
            print(f"  {label:16} {d['faces']:>9,} 面  平均偏差 {d['mean'] * scale_mm:7.2f} mm  "
                  f"p95 {d['p95'] * scale_mm:7.2f} mm  最大 {d['max'] * scale_mm:8.2f} mm")

    print("\n=== 摘要（平均表面偏差，越小越好）===")
    for base in args.models.split(","):
        old = next((r for r in rows if r[0] == base and "舊(14%)" in r[1]), None)
        new = next((r for r in rows if r[0] == base and "新(40%)" in r[1]), None)
        oldl = next((r for r in rows if r[0] == base and "LOD 舊" in r[1]), None)
        newl = next((r for r in rows if r[0] == base and "LOD 新" in r[1]), None)
        if old and new:
            f = old[2]["mean"] / new[2]["mean"] if new[2]["mean"] else float("nan")
            print(f"  {base:22} 高精度 {old[2]['mean'] * old[3]:.2f} mm → {new[2]['mean'] * new[3]:.2f} mm"
                  f"（改善 {f:.2f}×）" + (f"；LOD {oldl[2]['mean'] * oldl[3]:.2f} → {newl[2]['mean'] * newl[3]:.2f} mm"
                                          if oldl and newl else ""))


if __name__ == "__main__":
    main()
