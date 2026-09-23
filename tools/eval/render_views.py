"""多視角渲染器（VTK 離屏）—— 為「建築記憶點」重辨識評測產生資料集。

為什麼不用瀏覽器：本機沙箱禁止程式建立具名管道，headless Chrome 無法啟動。
VTK 在同一個行程內用 OpenGL 離屏渲染，速度快、可重現、不需要網路。

用法：
    python tools/eval/render_views.py --models=macau-tower --tiers=base
    python tools/eval/render_views.py                       # 5 棟建築 + 2 件文物
    python tools/eval/render_views.py --res=768 --force

輸出：
    tools/eval/dataset/renders/<model>/<model>__az090_el20_d100_studio.png
    tools/eval/dataset/manifest.json（每張圖的完整參數，供報告與評審追溯）
"""
import argparse
import io
import json
import math
import os
import struct
import sys
import time
from pathlib import Path

import numpy as np
import vtk
from PIL import Image
from vtk.util.numpy_support import numpy_to_vtk, vtk_to_numpy

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / ".cache" / "models-src"
OUT_DIR = ROOT / "tools" / "eval" / "dataset" / "renders"
MANIFEST = ROOT / "tools" / "eval" / "dataset" / "manifest.json"

BUILDINGS = ["macau-tower", "parisian", "macau-science-center", "galaxy-macau", "londoner-macao"]
ARTIFACTS = ["tang-sancai-camel", "yongle-blue-white-flask"]

# 三種取像分層：base＝同環境環繞；cond／cond2＝改變仰角、距離與光照（跨條件配對）
TIERS = {
    "base": [dict(az=a, el=20, dist=1.00, bg="studio") for a in range(0, 360, 30)],
    "cond": [dict(az=a, el=42, dist=0.72, bg="overcast") for a in (0, 90, 180, 270)],
    "cond2": [dict(az=a, el=7, dist=1.28, bg="sunset") for a in (45, 135, 225, 315)],
}

BG = {
    "studio": dict(color=(0.97, 0.97, 0.96), key=1.15, fill=0.45, back=0.35, warm=0.95),
    "overcast": dict(color=(0.73, 0.76, 0.79), key=0.75, fill=0.55, back=0.35, warm=0.6),
    "sunset": dict(color=(1.00, 0.84, 0.68), key=1.25, fill=0.35, back=0.25, warm=1.1),
    "night": dict(color=(0.08, 0.10, 0.14), key=0.45, fill=0.25, back=0.5, warm=0.4),
}


def log(*a):
    print(*a, flush=True)


def load_glb_texture(path: Path):
    """從 GLB 直接取出第一張 baseColor 貼圖，做成 vtkTexture。
    vtkGLTFImporter 在這台機器上不會自動接貼圖（texture=None），所以自己接。"""
    raw = path.read_bytes()
    if raw[:4] != b"glTF":
        return None
    offset, js, bin_chunk = 12, None, None
    while offset + 8 <= len(raw):
        clen, ctype = struct.unpack_from("<I4s", raw, offset)
        chunk = raw[offset + 8: offset + 8 + clen]
        if ctype == b"JSON":
            js = json.loads(chunk.decode("utf-8"))
        elif ctype[:3] == b"BIN":
            bin_chunk = chunk
        offset += 8 + clen
    if not js or bin_chunk is None or not js.get("images"):
        return None
    img = js["images"][0]
    bv = js.get("bufferViews", [])[img["bufferView"]]
    start = bv.get("byteOffset", 0)
    data = bin_chunk[start:start + bv["byteLength"]]
    pil = Image.open(io.BytesIO(data)).convert("RGB")
    arr = np.asarray(pil)[::-1]  # glTF 的 UV 原點在左上，VTK 貼圖在左下 → 垂直翻轉
    h, w, _ = arr.shape
    vimg = vtk.vtkImageData()
    vimg.SetDimensions(w, h, 1)
    vimg.SetOrigin(0, 0, 0)
    vimg.SetSpacing(1, 1, 1)
    va = numpy_to_vtk(np.ascontiguousarray(arr.reshape(-1, 3), dtype=np.uint8), deep=True, array_type=vtk.VTK_UNSIGNED_CHAR)
    va.SetNumberOfComponents(3)
    vimg.GetPointData().SetScalars(va)
    tex = vtk.vtkTexture()
    tex.SetInputData(vimg)
    tex.InterpolateOn()
    tex.MipmapOn()
    tex.SetColorModeToDirectScalars()
    return tex


def make_renderer(path: Path, preset: dict):
    """回傳 (renderer, bounds)。優先走 vtkGLTFImporter（自動處理材質與貼圖）。"""
    imp = vtk.vtkGLTFImporter()
    imp.SetFileName(str(path))
    imp.Update()
    ren = imp.GetRenderer()
    if ren is None:
        raise RuntimeError("vtkGLTFImporter 沒有產生 renderer")

    # 以場景實際幾何的 bounds 為準（跳過光源、輔助物件與空 actor）
    b = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9]
    actors = ren.GetActors()
    actors.InitTraversal()
    for _ in range(actors.GetNumberOfItems()):
        a = actors.GetNextActor()
        mapper = a.GetMapper()
        if not a.GetVisibility() or mapper is None:
            continue
        data = mapper.GetInput()
        try:
            if data is None or data.GetNumberOfPoints() < 8:
                continue
        except AttributeError:
            continue
        ab = a.GetBounds()
        b = [min(b[0], ab[0]), max(b[1], ab[1]), min(b[2], ab[2]), max(b[3], ab[3]), min(b[4], ab[4]), max(b[5], ab[5])]
    if b[0] > b[1]:
        raise RuntimeError("找不到任何可見幾何，無法決定相機範圍")

    # 貼圖：自行接上（importer 不會自動接）
    texture = load_glb_texture(path)
    if texture is not None:
        actors.InitTraversal()
        for _ in range(actors.GetNumberOfItems()):
            a = actors.GetNextActor()
            if a.GetVisibility() and a.GetMapper() is not None:
                a.SetTexture(texture)
                p = a.GetProperty()
                p.SetColor(1.0, 1.0, 1.0)
                p.SetAmbient(0.10)
                p.SetDiffuse(1.0)
                p.SetSpecular(0.12)
                p.SetSpecularPower(18.0)
    else:
        log(f"  [warn] {path.name} 找不到可用貼圖，將以純幾何灰階渲染")

    # 移除 importer 自帶光源，改用可控光源
    lights = ren.GetLights()
    lights.InitTraversal()
    for _ in range(lights.GetNumberOfItems()):
        ren.RemoveLight(lights.GetNextItem())

    ren.SetBackground(*preset["color"])
    key = vtk.vtkLight()
    key.SetLightTypeToSceneLight()
    key.SetPosition(4.5, 5.0, 4.0)
    key.SetFocalPoint((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2)
    key.SetIntensity(preset["key"] * 1.6)
    key.SetColor(1.0, 1.0 - 0.06 * preset["warm"], 1.0 - 0.16 * preset["warm"])
    ren.AddLight(key)
    fill = vtk.vtkLight()
    fill.SetLightTypeToSceneLight()
    fill.SetPosition(-5.0, 2.0, 3.0)
    fill.SetFocalPoint((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2)
    fill.SetIntensity(preset["fill"] * 1.4)
    fill.SetColor(0.75, 0.82, 1.0)
    ren.AddLight(fill)
    back = vtk.vtkLight()
    back.SetLightTypeToSceneLight()
    back.SetPosition(-2.0, 3.0, -5.0)
    back.SetFocalPoint((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2)
    back.SetIntensity(preset["back"] * 1.2)
    back.SetColor(1.0, 0.92, 0.8)
    ren.AddLight(back)
    return ren, b


def place_camera(ren, bounds, az, el, dist, fov=38.0, fill=0.88):
    cx, cy, cz = ((bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, (bounds[4] + bounds[5]) / 2)
    r = max(
        math.dist((bounds[0], bounds[2], bounds[4]), (bounds[1], bounds[3], bounds[5])) / 2,
        1e-4,
    )
    d = (r / math.sin(math.radians(fov) / 2)) * dist / fill
    a, e = math.radians(az), math.radians(el)
    cam = ren.GetActiveCamera()
    cam.SetViewAngle(fov)
    cam.SetPosition(
        cx + d * math.cos(e) * math.sin(a),
        cy + d * math.sin(e),
        cz + d * math.cos(e) * math.cos(a),
    )
    cam.SetFocalPoint(cx, cy, cz)
    cam.SetViewUp(0, 1, 0)
    ren.ResetCameraClippingRange()
    return r, d


def save_png(win, path: Path):
    w2i = vtk.vtkWindowToImageFilter()
    w2i.SetInput(win)
    w2i.SetReadFrontBuffer(False)
    w2i.Update()
    img = w2i.GetOutput()
    if img is None or img.GetPointData().GetScalars() is None:
        raise RuntimeError("render produced no pixels")
    arr = vtk_to_numpy(img.GetPointData().GetScalars())
    if float(arr.std()) < 1.0:
        raise RuntimeError("render is a flat image (std %.2f) — 可能沒東西被畫出來" % float(arr.std()))
    w = vtk.vtkPNGWriter()
    w.SetFileName(str(path))
    w.SetInputConnection(w2i.GetOutputPort())
    w.Write()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=None, help="逗號分隔；預設 5 棟建築 + 2 件文物")
    ap.add_argument("--tiers", default="base,cond,cond2")
    ap.add_argument("--res", type=int, default=640)
    ap.add_argument("--force", action="store_true", help="已存在的圖也重畫")
    args = ap.parse_args()

    models = args.models.split(",") if args.models else BUILDINGS + ARTIFACTS
    tiers = [t.strip() for t in args.tiers.split(",") if t.strip() in TIERS]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    if MANIFEST.exists():
        try:
            manifest = json.loads(MANIFEST.read_text(encoding="utf-8")).get("renders", [])
        except Exception:
            manifest = []
    known = {r["file"] for r in manifest}

    t0 = time.time()
    added = skipped = failed = 0
    for model in models:
        src = SRC_DIR / f"{model}.glb"
        if not src.exists():
            log(f"[skip] 找不到來源模型 {src}")
            continue
        jobs = []
        for tier in tiers:
            for v in TIERS[tier]:
                tag = f"{model}__az{v['az']:03d}_el{v['el']:02d}_d{int(round(v['dist'] * 100)):03d}_{v['bg']}"
                out = OUT_DIR / model / f"{tag}.png"
                rel = str(out.relative_to(ROOT)).replace("\\", "/")
                if out.exists() and not args.force:
                    skipped += 1
                    continue
                jobs.append((tier, v, out, rel))
        if not jobs:
            log(f"[{model}] 全部已存在，略過（{len(TIERS)} 層）")
            continue

        log(f"[{model}] 載入 {src.name}（{src.stat().st_size / 1e6:.0f} MB）… {len(jobs)} 個視角")
        try:
            ren, bounds = make_renderer(src, BG["studio"])
        except Exception as e:
            log(f"[{model}] 載入失敗：{e}")
            failed += len(jobs)
            continue

        win = vtk.vtkRenderWindow()
        win.SetOffScreenRendering(1)
        win.SetMultiSamples(0)
        win.SetSize(args.res, args.res)
        win.AddRenderer(ren)

        for tier, v, out, rel in jobs:
            preset = BG[v["bg"]]
            ren.SetBackground(*preset["color"])
            # 依預設調整三盞燈（簡化：用 key 強度代表光照條件）
            lights = ren.GetLights()
            lights.InitTraversal()
            for i in range(lights.GetNumberOfItems()):
                L = lights.GetNextItem()
                L.SetIntensity(preset["key"] * (1.6 if i == 0 else (1.4 if i == 1 else 1.2)) * (1.0 if i == 0 else 0.6))
            radius, dist = place_camera(ren, bounds, v["az"], v["el"], v["dist"])
            out.parent.mkdir(parents=True, exist_ok=True)
            try:
                win.Render()
                save_png(win, out)
            except Exception as e:
                failed += 1
                log(f"  [fail] {rel}: {e}")
                continue
            added += 1
            if rel not in known:
                manifest.append(dict(
                    model=model, tier=tier, az=v["az"], el=v["el"], dist=v["dist"], bg=v["bg"],
                    res=args.res, file=rel, radius=radius, camera_distance=dist,
                    source=str(src.relative_to(ROOT)).replace("\\", "/"),
                ))
                known.add(rel)
        win.RemoveRenderer(ren)
        log(f"[{model}] 完成（累計 {added} 張，{time.time() - t0:.0f}s）")

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(
        generated=time.strftime("%Y-%m-%dT%H:%M:%S"),
        renderer="tools/eval/render_views.py (VTK %s, offscreen OpenGL, textures via vtkGLTFImporter)" % vtk.vtkVersion.GetVTKVersion(),
        params=dict(res=args.res, tiers=tiers, models=models),
        counts=dict(total=len(manifest), added=added, skipped=skipped, failed=failed),
        renders=sorted(manifest, key=lambda r: r["file"]),
    )
    MANIFEST.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"[done] 新增 {added} · 略過 {skipped} · 失敗 {failed} · manifest {len(manifest)} 筆 → {MANIFEST.relative_to(ROOT)}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
