"""核心創新動畫 v2：三維包圍盒 → 投影 → 二維標註（25 秒 / 750 帧）

v2 相對 v1 的七項質感升級（v1 被使用者評為「不夠絲滑、太 AI」）：
  ① 字體：改用 Noto Sans SC / Noto Serif SC（設計字體），不用系統預設的微軟正黑
  ② 輝光：線條以三層疊繪（寬而淡 → 窄而亮）模擬發光，而非單層死板細線
  ③ 景深：點雲依深度調暗、縮小；遠處的點自然退到背景
  ④ 真實影像：右側小窗改放真實影格照片，再疊投影框（v1 是空黑框，像佔位符）
  ⑤ 構圖：加入細參考格線、尺寸標註線（帶箭頭與數字），填掉大片空白
  ⑥ 節奏：分段使用不同緩動曲線，並讓元素錯開出現，避免整體勻速
  ⑦ 背景：微漸層 + 暗角，取代純黑

使用真實資料：點雲來自真實重建輸出的 PLY；包圍盒為實際擬合值
（center [-1.84, 1.21, 0.99]、size [12.70, 12.27, 3.54]）；小窗照片為真實影格。
唯一合成的是運鏡（相機繞行軌跡）。
"""
import math
import sys
from functools import lru_cache
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PLY = ROOT / ".cache" / "live-view" / "cloud.ply"
OUT = ROOT / "docs" / "video" / "_work" / "innovation"
FPS = 30
DUR = 25.0
N = int(FPS * DUR)
W, H, DPI = 1920, 1080, 100

# ── ① 字體：優先 Noto（設計字體），退而求其次才用系統字
FONTS = {
    "sans": ["Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei"],
    "serif": ["Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun"],
}


def pick_font(kind="sans"):
    """挑一個實際存在的中文字體，回傳 (family_name,) 供 matplotlib 使用。"""
    available = {f.name for f in font_manager.fontManager.ttflist}
    for name in FONTS[kind]:
        if name in available:
            return name
    return "sans-serif"


F_SANS = pick_font("sans")
F_SERIF = pick_font("serif")
plt.rcParams["font.family"] = F_SANS
plt.rcParams["axes.unicode_minus"] = False

GOLD = "#d4af37"
GOLD_D = "#8a6d24"
CYAN = "#4fd8e8"
INK = "#080b10"
INK2 = "#101720"
TEXT = "#eef1f5"
DIM = "#7f8fa3"

BOX_CENTER = np.array([-1.84, 1.21, 0.99])
BOX_SIZE = np.array([12.70, 12.27, 3.54])

# 真實影格（用於右側小窗）
FRAME_CANDIDATES = [
    ROOT / "docs" / "figs" / "demo-detection.jpg",
]
for base in (Path(r"D:\tujian_model"),):
    if base.is_dir():
        for proj in sorted(base.glob("*"), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)[:6]:
            f = proj / "work" / "frames"
            if f.is_dir():
                imgs = sorted(f.glob("*.jpg"))[:1] + sorted(f.glob("*.png"))[:1]
                FRAME_CANDIDATES.extend(imgs)


@lru_cache(maxsize=1)
def load_frame_photo():
    for p in FRAME_CANDIDATES:
        try:
            if p.is_file():
                im = Image.open(p).convert("RGB")
                # 裁成 16:9，縮到小窗需要的尺寸以加快繪製
                w, h = im.size
                tw, th = 16, 9
                if w / h > tw / th:
                    nw = int(h * tw / th); im = im.crop(((w - nw) // 2, 0, (w + nw) // 2, h))
                else:
                    nh = int(w * th / tw); im = im.crop((0, (h - nh) // 2, w, (h + nh) // 2))
                return np.asarray(im.resize((560, 315), Image.LANCZOS))
        except Exception:
            continue
    return None


def load_points(limit=1900):
    if not PLY.is_file():
        return None
    raw = PLY.read_bytes()
    end = raw.find(b"end_header") + len(b"end_header\n")
    header = raw[:end].decode("ascii", "replace")
    n = int([l for l in header.splitlines() if l.startswith("element vertex")][0].split()[-1])
    data = np.loadtxt(PLY, skiprows=header.count("\n"), max_rows=n)
    if data.ndim == 1:
        data = data.reshape(1, -1)
    xyz = data[:, :3].astype(np.float64)
    rgb = (data[:, 3:6] / 255.0).astype(np.float64)
    xyz = xyz - (xyz.max(axis=0) + xyz.min(axis=0)) / 2
    if len(xyz) > limit:
        idx = np.linspace(0, len(xyz) - 1, limit).astype(int)
        xyz, rgb = xyz[idx], rgb[idx]
    return xyz, rgb


def project(pts, eye, target, fov, aspect):
    f = target - eye
    f = f / (np.linalg.norm(f) + 1e-9)
    up = np.array([0.0, 1.0, 0.0])
    r = np.cross(f, up)
    if np.linalg.norm(r) < 1e-6:
        r = np.cross(f, np.array([1.0, 0.0, 0.0]))
    r = r / (np.linalg.norm(r) + 1e-9)
    u = np.cross(r, f)
    d = pts - eye
    z = d @ f
    focal = 1.0 / math.tan(fov / 2)
    with np.errstate(divide="ignore", invalid="ignore"):
        return (d @ r) / z * focal / aspect, (d @ u) / z * focal, z


def box_corners(size, axes=None):
    axes = np.eye(3) if axes is None else np.asarray(axes)
    h = size / 2.0
    signs = np.array([[a, b, c] for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)], float)
    return (signs * h) @ axes


EDGES = [(0, 1), (0, 2), (0, 4), (1, 3), (1, 5), (2, 3), (2, 6), (3, 7), (4, 5), (4, 6), (5, 7), (6, 7)]


def ease(t, kind="io"):
    t = max(0.0, min(1.0, t))
    if kind == "io":          # 平滑進出
        return t * t * (3 - 2 * t)
    if kind == "out":         # 急出緩停（用於「長出」）
        return 1 - (1 - t) ** 3
    if kind == "in":
        return t ** 3
    if kind == "over":        # 帶過衝（用於落定）
        return 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2
    return t


def glow(ax, xs, ys, color, base_lw=1.6, alpha=0.95, z=5, passes=((7.0, 0.05), (3.4, 0.13), (1.0, 1.0))):
    """② 輝光：同一條線疊繪數層（寬而淡 → 窄而亮）。"""
    for mul, a in passes:
        ax.plot(xs, ys, "-", lw=base_lw * mul, color=color, alpha=alpha * a, zorder=z,
                solid_capstyle="round")


def render(i, pts, rgb, photo, fig):
    t = i / FPS
    fig.clf()
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.axis("off")
    fig.patch.set_facecolor(INK)

    # ⑦ 微漸層背景 + 暗角
    ax.add_patch(plt.Rectangle((0, 0), 1, 1, color=INK, zorder=0))
    ax.add_patch(plt.Rectangle((0, 0.42), 1, 0.58, color=INK2, alpha=0.55, zorder=0))
    # ⑤ 參考格線（細、低對比，填掉空白但不搶戲）
    for gx in np.arange(0.05, 1.0, 0.05):
        ax.plot([gx, gx], [0, 1], "-", lw=0.5, color="#7f8fa3", alpha=0.055, zorder=1)
    for gy in np.arange(0.05, 1.0, 0.05):
        ax.plot([0, 1], [gy, gy], "-", lw=0.5, color="#7f8fa3", alpha=0.055, zorder=1)

    # ── 運鏡（唯一合成處）
    az = 0.62 + ease(t / DUR, "io") * 0.34
    eye = np.array([math.cos(az) * 25.0, 13.5, math.sin(az) * 25.0])
    target = np.array([0.0, 0.5, 0.0])
    fov, aspect = 0.86, 1.0

    def w2a(p, cx=0.355, cy=0.50, scale=0.415):
        sx, sy, z = project(np.atleast_2d(p), eye, target, fov, aspect)
        if z[0] <= 0.02:
            return None
        return cx + sx[0] * scale, cy + sy[0] * scale

    # ── ① 點雲浮現（0~3.2s）：逐點、依深度淡出
    if pts is not None:
        appear = ease(t / 2.9, "out")
        k = max(1, int(len(pts) * appear))
        sx, sy, z = project(pts[:k], eye, target, fov, aspect)
        zb = z[z > 0.02]
        zlo, zhi = (zb.min(), zb.max()) if zb.size else (1.0, 2.0)
        for j in range(k):
            if z[j] <= 0.02:
                continue
            px, py = 0.355 + sx[j] * 0.415, 0.50 + sy[j] * 0.415
            if not (0 <= px <= 1 and 0 <= py <= 1):
                continue
            # ③ 景深：越遠越暗越小
            d = (z[j] - zlo) / max(1e-6, zhi - zlo)
            fade = 0.30 + 0.70 * (1 - d)
            c = np.clip(rgb[j] * fade + 0.06, 0, 1)
            ax.plot([px], [py], ".", ms=1.0 + 1.7 * (1 - d), color=tuple(c), zorder=2, alpha=0.95)

    # ── ② 相機軌跡環（3.2~8.4s）
    if t > 3.2:
        rt = ease((t - 3.2) / 3.4, "io")
        steps = 160
        arc = []
        for s in range(int(steps * rt) + 1):
            a = 0.62 + (s / steps) * 2 * math.pi
            q = w2a(np.array([math.cos(a) * 25.0, 13.5, math.sin(a) * 25.0]))
            if q:
                arc.append(q)
        if len(arc) > 1:
            xs, ys = zip(*arc)
            glow(ax, xs, ys, CYAN, base_lw=1.5, alpha=0.50, z=3,
                 passes=((6.0, 0.05), (2.6, 0.12), (1.0, 1.0)))
            # 環上的相機標記（帶小十字，像航跡上的節點）
            for f in (0.0, 0.34, 0.68):
                idx = int(f * (len(arc) - 1))
                ax.plot([arc[idx][0]], [arc[idx][1]], "o", ms=4.5, color=CYAN, alpha=0.9, zorder=6)

    # ── ③ 包圍盒長出（8.4~13.6s）帶過衝
    grow = 0.0
    if t > 8.4:
        g = min(1.0, (t - 8.4) / 2.4)
        grow = max(0.0, ease(g, "over")) if g < 1 else 1.0
        grow = min(grow, 1.10) if g < 1 else 1.0
    if grow > 0:
        corners = box_corners(BOX_SIZE * grow)
        proj = [w2a(c) for c in corners]
        # ⑥ 錯開：逐條邊長出，不是同時
        for ei, (a, b) in enumerate(EDGES):
            if not (proj[a] and proj[b]):
                continue
            stag = ease((t - 8.4 - ei * 0.055) / 1.5, "out") if t > 8.4 else 0
            if stag <= 0:
                continue
            pa, pb = proj[a], proj[b]
            xe = pa[0] + (pb[0] - pa[0]) * stag
            ye = pa[1] + (pb[1] - pa[1]) * stag
            glow(ax, [pa[0], xe], [pa[1], ye], GOLD, base_lw=1.9, alpha=0.95, z=5)
        for ci, q in enumerate(proj):
            if q and grow >= 1.0 and t > 11.0:
                ax.plot([q[0]], [q[1]], "o", ms=3.2, color="#fff3cf", alpha=0.85, zorder=7)

    # ⑤ 尺寸標註線（12.5s 後淡入，填補構圖並給出資訊）
    if t > 12.5 and grow >= 1.0:
        a_dim = ease((t - 12.5) / 1.2, "out")
        base = w2a(np.array([0.0, -BOX_SIZE[2] / 2 - 0.6, 0.0]))
        tip = w2a(np.array([BOX_SIZE[0], -BOX_SIZE[2] / 2 - 0.6, 0.0]))
        if base and tip:
            ax.annotate("", xy=tip, xytext=base, zorder=8,
                        arrowprops=dict(arrowstyle="<->", color=GOLD, lw=1.2, alpha=0.85 * a_dim))
            mx, my = (base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2
            ax.text(mx, my - 0.035, f"{BOX_SIZE[0]:.1f} m", color=GOLD, fontsize=14,
                    ha="center", va="top", alpha=a_dim, fontfamily=F_SANS)
        t2 = w2a(np.array([0.0, BOX_SIZE[1] / 2 + 0.5, 0.0]))
        if base and t2:
            ax.annotate("", xy=t2, xytext=base, zorder=8,
                        arrowprops=dict(arrowstyle="<->", color=GOLD_D, lw=1.0, alpha=0.6 * a_dim))
            ax.text(t2[0] + 0.012, (base[1] + t2[1]) / 2, f"{BOX_SIZE[2]:.1f} m", color=GOLD_D,
                    fontsize=13, ha="left", va="center", alpha=a_dim, fontfamily=F_SANS)

    # ── ④ 投影射線 → 影格（13.6~20.2s）
    if t > 13.6 and grow >= 1.0:
        corners = box_corners(BOX_SIZE)
        sheet_c = np.array([0.0, -2.9, 9.6])
        sheet_n = np.array([0.0, 0.10, -1.0]); sheet_n /= np.linalg.norm(sheet_n)
        e1 = np.cross(sheet_n, np.array([0.0, 1.0, 0.0])); e1 /= np.linalg.norm(e1)
        e2 = np.cross(sheet_n, e1)
        half = 6.4
        ra = ease((t - 13.6) / 2.2, "out")
        for c in corners:
            q = w2a(c)
            if not q:
                continue
            q2 = w2a(c + (sheet_c - c) * ra)
            if q2:
                ax.plot([q[0], q2[0]], [q[1], q2[1]], "-", lw=0.8, color=CYAN, alpha=0.38, zorder=4)
        quad = [sheet_c + e1 * half + e2 * half, sheet_c - e1 * half + e2 * half,
                sheet_c - e1 * half - e2 * half, sheet_c + e1 * half - e2 * half]
        qs = [w2a(p) for p in quad]
        if all(qs):
            xs = [q[0] for q in qs] + [qs[0][0]]
            ys = [q[1] for q in qs] + [qs[0][1]]
            ax.fill(xs, ys, color="#0d1219", alpha=0.88, zorder=6)
            ax.plot(xs, ys, "-", lw=1.1, color=DIM, alpha=0.55, zorder=7)

    # ── ④ 右側小窗：真實影格 + 投影框（15.6~25s）
    if t > 15.6:
        reveal = ease((t - 15.6) / 1.5, "out")
        bx = fig.add_axes([0.615, 0.205, 0.315, 0.585])
        bx.set_xlim(0, 1); bx.set_ylim(0, 9 / 16); bx.axis("off")
        bx.add_patch(plt.Rectangle((0, 0), 1, 9 / 16, color="#0b1016"))
        if photo is not None:
            bx.imshow(photo, extent=(0, 1, 0, 9 / 16), aspect="auto",
                      alpha=min(1.0, reveal), zorder=1)
        # 投影框（依此視角的包圍盒投影範圍）
        sx, sy, z = project(box_corners(BOX_SIZE), eye, target, fov, aspect)
        if np.all(z > 0):
            x0, x1, y0, y1 = sx.min(), sx.max(), sy.min(), sy.max()
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            bw, bh = (x1 - x0) * 2.35, (y1 - y0) * 2.35
            def m(px, py):
                return (0.5 + (px - cx) / bw), ((9 / 16) / 2 + (py - cy) / bh)
            p0, p1 = m(x0, y0), m(x1, y1)
            rw, rh = (p1[0] - p0[0]), (p1[1] - p0[1])
            for k, (lw, al) in enumerate(((7.0, 0.10), (3.0, 0.22), (2.2, 1.0))):
                bx.add_patch(plt.Rectangle(p0, rw, rh, fill=False, edgecolor=GOLD,
                                           lw=lw, alpha=al * reveal, zorder=5))
            ax.text(0.615, 0.795, "投影到影格", color=GOLD, fontsize=15, alpha=reveal,
                    fontfamily=F_SANS, fontweight="bold")
            if t > 17.6:
                # 影格翻頁疊影：每一張都有框
                for k in range(1, int(min(4, (t - 17.6) / 0.5)) + 1):
                    off = k * 0.020
                    bx.add_patch(plt.Rectangle((off * 0.7, -off), 1, 9 / 16, fill=False,
                                               edgecolor=GOLD, lw=1.0, alpha=max(0.05, 0.30 - off * 4)))
                    bx.add_patch(plt.Rectangle((p0[0] + off * 0.7, p0[1] - off), rw, rh,
                                               fill=False, edgecolor=GOLD, lw=1.2,
                                               alpha=max(0.04, 0.42 - off * 5)))

    # ── 字幕（簡體，逐字照腳本）
    caps = [
        (0.4, 3.4, "我们用三维几何，自动算出标注"),
        (3.6, 8.2, "拍一段环绕影片，重建出相机位姿"),
        (8.4, 13.4, "在三维空间拟合建筑包围盒"),
        (13.6, 20.2, "投影到每一张影格"),
        (20.4, 23.2, "几何一致 · 零漏框 · 全程无需人工"),
    ]
    cap = next((s for a, b, s in caps if a <= t < b), "")
    if cap:
        ax.add_patch(plt.Rectangle((0.5 - 0.30, 0.856), 0.60, 0.062,
                                   color="#0d1219", alpha=0.86, zorder=15))
        ax.plot([0.5 - 0.30, 0.5 + 0.30], [0.856, 0.856], "-", lw=1.6, color=GOLD,
                alpha=0.75, zorder=16)
        ax.text(0.5, 0.887, cap, color=TEXT, fontsize=24, ha="center", va="center",
                zorder=16, fontfamily=F_SANS)

    # ── 收尾金句（23.4~25s）：襯線字體，較有份量
    if t >= 23.4:
        p = ease((t - 23.4) / 0.9, "out")
        ax.text(0.5, 0.545, "别人用人工标框", color=GOLD, fontsize=40, ha="center",
                va="center", fontweight="bold", zorder=20, alpha=p, fontfamily=F_SERIF)
        ax.text(0.5, 0.448, "我们用几何算框", color=TEXT, fontsize=40, ha="center",
                va="center", fontweight="bold", zorder=20, alpha=p, fontfamily=F_SERIF)

    # 階段標籤
    stages = [(0.4, "① 点云"), (3.6, "② 相机轨迹"), (8.4, "③ 三维包围盒"),
              (13.6, "④ 投影"), (20.4, "⑤ 逐影格标注")]
    lab = next((s for a, s in reversed(stages) if t >= a), "")
    if lab:
        ax.text(0.028, 0.950, lab, color=DIM, fontsize=14, zorder=16, fontfamily=F_SANS)
        ax.plot([0.028, 0.028 + 0.055], [0.938, 0.938], "-", lw=1.2, color=GOLD, alpha=0.6, zorder=16)

    fig.savefig(OUT / f"{i:04d}.png", dpi=DPI, facecolor=INK)
    plt.close(fig)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    loaded = load_points()
    if loaded is None:
        print("  !! 找不到真實點雲，改用合成點雲")
        rng = np.random.default_rng(0)
        xyz = rng.normal(0, 3.2, (1800, 3)); xyz[:, 1] = np.abs(xyz[:, 1]) * 0.6
        loaded = (xyz, rng.random((1800, 3)) * 0.35 + 0.5)
    pts, rgb = loaded
    photo = load_frame_photo()
    print(f"  字體：正文={F_SANS}｜標題={F_SERIF}")
    print(f"  點雲 {len(pts)} 點 · 包圍盒 {BOX_SIZE[0]:.1f}×{BOX_SIZE[1]:.1f}×{BOX_SIZE[2]:.1f} m"
          f" · 小窗照片={'真實影格' if photo is not None else '無（將留空）'}")
    print(f"  渲染 {N} 帧 → {OUT}")
    fig = plt.figure(figsize=(W / DPI, H / DPI), dpi=DPI)
    for i in range(N):
        render(i, pts, rgb, photo, fig)
        if i % 50 == 0:
            print(f"    {i}/{N} …", flush=True)
    print(f"  ✓ 完成 {N} 帧")
    return 0


if __name__ == "__main__":
    sys.exit(main())
