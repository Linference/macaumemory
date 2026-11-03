"""補充數據圖（與 figures_nature.py 同一套 Nature 規格：183 mm、Arial／微軟正黑體 5–7 pt、Okabe–Ito、矢量 PDF）。

  fig5-robustness  影像退化魯棒性：真實退化示例（同一張大三巴照片，四種干擾 × 四個等級）＋ 準確率曲線
  fig6-leakage     一般留一法 vs 攝影者隔離留一法：逐棟啞鈴圖＋整體對比
資料：tools/eval/out/extended.json（robust）、tools/eval/out/strict-loo.json（python tools/eval/strict_loo.py）
說明：本腳本由 AI 程式助手（Claude）協助撰寫；圖中數據的解讀由研究者負責。
用法：python tools/eval/figures_extra.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch, Rectangle
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "eval"))
OUT = ROOT / "docs" / "figs-nature"; OUT.mkdir(parents=True, exist_ok=True)
EV = ROOT / "tools" / "eval" / "out"
MM = 1 / 25.4
for f in ("arial.ttf", "arialbd.ttf", "msjh.ttc", "msjhbd.ttc"):
    font_manager.fontManager.addfont(f"C:/Windows/Fonts/{f}")
plt.rcParams.update({
    "font.family": ["Arial", "Microsoft JhengHei"], "font.size": 6, "axes.titlesize": 6.5, "axes.labelsize": 6,
    "xtick.labelsize": 5.5, "ytick.labelsize": 5.5, "legend.fontsize": 5.5, "axes.linewidth": 0.6,
    "xtick.major.width": 0.6, "ytick.major.width": 0.6, "xtick.major.size": 2.5, "ytick.major.size": 2.5,
    "axes.spines.top": False, "axes.spines.right": False, "legend.frameon": False, "pdf.fonttype": 42,
    "savefig.dpi": 600, "axes.unicode_minus": False,
})
OI = {"black": "#000000", "orange": "#E69F00", "sky": "#56B4E9", "green": "#009E73", "blue": "#0072B2", "red": "#D55E00", "grey": "#999999", "purple": "#CC79A7"}
NAVY = "#13233a"


def label(ax, s, x=-0.12, y=1.02):
    ax.text(x, y, s, transform=ax.transAxes, fontsize=8, fontweight="bold", va="bottom", ha="left")


def save(fig, name):
    for ext in ("pdf", "png"):
        fig.savefig(OUT / f"{name}.{ext}", bbox_inches="tight", pad_inches=0.03)
    plt.close(fig); print("wrote", name)


def wilson(k, n, z=1.959964):
    if not n:
        return np.nan, np.nan
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


# ════════════ 圖 5：魯棒性 ════════════
def fig_robustness():
    from extended import degrade, SEED
    ext = json.loads((EV / "extended.json").read_text(encoding="utf-8"))["robust"]
    KINDS = [("dark", "暗光", OI["blue"], "曝光 ×0.7ⁿ＋感光雜訊"), ("blur", "模糊", OI["red"], "高斯模糊（短邊 0.4%×n）"),
             ("occlude", "遮擋", OI["orange"], "灰色色塊遮擋（約 8%×n 面積）"), ("haze", "雨霧", OI["green"], "霧化混合＋雨絲")]
    SHOW = [0, 2, 4, 5]
    src = ImageOps.exif_transpose(Image.open(ROOT / "photos-src/cc/ruins-st-paul/Ruins_of_Saint_Paul_s_Macau_Ank_Kumar_01.jpg")).convert("RGB")
    w, h = src.size; side = min(w, h * 4 // 3)                         # 4:3 置中裁切
    m = int(side * 0.03)                                               # 去掉原圖左上角的黑邊
    src = src.crop(((w - side) // 2 + m, m, (w + side) // 2 - m, side * 3 // 4 - m)).resize((640, 480), Image.LANCZOS)

    fig = plt.figure(figsize=(183 * MM, 84 * MM))
    gs = fig.add_gridspec(1, 2, width_ratios=[1.12, 1], wspace=0.16)
    sub = gs[0].subgridspec(4, 4, wspace=0.04, hspace=0.05)
    acc = {k: {c["level"]: c["top1"] for c in ext["curves"][k]} for k, *_ in KINDS}
    first = None
    for r, (k, zh_, col, _) in enumerate(KINDS):
        for c_, lvl in enumerate(SHOW):
            ax = fig.add_subplot(sub[r, c_]); first = first or ax
            im = degrade(src, k, lvl, SEED) if lvl else src
            ax.imshow(np.asarray(im)); ax.set_xticks([]); ax.set_yticks([])
            for s in ax.spines.values():
                s.set_visible(True); s.set_color(col if lvl else "#BBBBBB"); s.set_linewidth(1.2 if lvl else 0.6)
            a = acc[k][lvl] * 100
            ax.text(0.04, 0.06, f"{a:.1f}%", transform=ax.transAxes, fontsize=5.4, fontweight="bold", color="white",
                    bbox=dict(boxstyle="round,pad=0.25", fc=col if lvl else "#555555", ec="none", alpha=0.92))
            if r == 0:
                ax.set_title("原圖" if lvl == 0 else f"等級 {lvl}", fontsize=5.8, pad=3)
            if c_ == 0:
                ax.set_ylabel(zh_, fontsize=6.4, fontweight="bold", color=col, rotation=0, ha="right", va="center", labelpad=6)
    first.text(-0.42, 1.28, "a", transform=first.transAxes, fontsize=8, fontweight="bold")
    first.text(-0.2, 1.28, "同一張查詢照片在四種干擾下的外觀（角標為該設定下全庫 Top-1）", transform=first.transAxes, fontsize=6.3)

    ax = fig.add_subplot(gs[1]); label(ax, "b", x=-0.14, y=1.03)
    base = acc["dark"][0] * 100
    ax.axhline(base, color="#BBBBBB", lw=0.6, ls=(0, (2, 2))); ax.text(0.05, base + 0.5, f"原圖 {base:.1f}%", fontsize=5, va="bottom", color="#777")
    for k, zh_, col, desc in KINDS:
        cv = ext["curves"][k]; lv = [c["level"] for c in cv]; m = np.array([c["top1"] for c in cv]) * 100
        lo = np.array([c["ci"][0] for c in cv]) * 100; hi = np.array([c["ci"][1] for c in cv]) * 100
        ax.fill_between(lv, lo, hi, color=col, alpha=0.12, lw=0)
        ls = (0, (3, 1.5)) if k == "dark" else "-"                       # 暗光與雨霧幾乎重疊：暗光用虛線
        ax.plot(lv, m, linestyle=ls, color=col, lw=1.1, zorder=4 if k == "dark" else 2)
        ax.scatter(lv, m, s=9, color=col, edgecolor="white", lw=0.5, zorder=5, marker="D" if k == "dark" else "o")
        dy = {"dark": 1.3, "haze": -0.4, "occlude": -0.9, "blur": 0}[k]
        ax.text(5.15, m[-1] + dy, f"{zh_} {m[-1]:.1f}%", fontsize=5.6, color=col, va="center", fontweight="bold")
    blur = np.array([c["top1"] for c in ext["curves"]["blur"]]) * 100
    ax.annotate("模糊是主要風險：\n等級 3 後急降，\n建議拍照時檢查清晰度", xy=(4, blur[4]), xytext=(1.25, 70), fontsize=5.2, color=OI["red"],
                arrowprops=dict(arrowstyle="-|>", color=OI["red"], lw=0.6, shrinkA=2, shrinkB=3))
    ax.set_xlim(-0.2, 6.4); ax.set_xticks(range(6)); ax.set_ylim(60, 95)
    ax.set_xlabel("退化等級（0 = 原圖）"); ax.set_ylabel("Top-1 準確率 (%)，95% 信賴區間")
    ax.spines["bottom"].set_bounds(0, 5)
    ax.set_title(f"影像退化下的穩定性（n = {ext['curves']['dark'][0].get('n', 335) if isinstance(ext['curves']['dark'][0], dict) and 'n' in ext['curves']['dark'][0] else 335} 次留一法查詢）", loc="left", pad=6)
    fig.text(0.01, -0.02, "照片：Ank Kumar，Wikimedia Commons，CC BY-SA 4.0。退化只加在查詢照片上，參考庫維持原圖。",
             fontsize=4.6, color="#777")
    save(fig, "fig5-robustness")


# ════════════ 圖 6：攝影者隔離 ════════════
def fig_leakage():
    d = json.loads((EV / "strict-loo.json").read_text(encoding="utf-8"))
    rows = [(k, v) for k, v in d["buildings"].items() if v["strict"][1] > 0]
    single = [(k, v) for k, v in d["buildings"].items() if v["strict"][1] == 0]
    rows.sort(key=lambda kv: (kv[1]["strict"][0] / kv[1]["strict"][1], kv[1]["plain"][0] / kv[1]["plain"][1]))
    fig = plt.figure(figsize=(183 * MM, 92 * MM))
    gs = fig.add_gridspec(1, 2, width_ratios=[1.9, 1], wspace=0.38)

    ax = fig.add_subplot(gs[0]); label(ax, "a", x=-0.3, y=1.02)
    for i, (k, v) in enumerate(rows):
        p = v["plain"][0] / v["plain"][1] * 100; s = v["strict"][0] / v["strict"][1] * 100
        drop = p - s
        col = OI["red"] if drop >= 30 else OI["orange"] if drop >= 10 else OI["blue"]
        ax.plot([s, p], [i, i], color=col, lw=1.6, alpha=0.35, solid_capstyle="round", zorder=1)
        ax.scatter([p], [i], s=14, color="white", edgecolor="#777", lw=0.7, zorder=2)
        ax.scatter([s], [i], s=16 + v["strict"][1] * 1.2, color=col, edgecolor="white", lw=0.4, zorder=3)
        ax.text(103, i, f"{v['photographers']} 人", fontsize=4.8, va="center", color="#666")
    ax.set_yticks(range(len(rows))); ax.set_yticklabels([v["zh"].split("（")[0] for _, v in rows], fontsize=5.2)
    ax.set_xlim(-3, 110); ax.set_xticks([0, 25, 50, 75, 100]); ax.set_xlabel("Top-1 準確率 (%)")
    ax.spines["left"].set_visible(False); ax.tick_params(axis="y", length=0)
    ax.text(103, len(rows) - 0.1, "攝影者", fontsize=4.8, color="#666", va="bottom")
    ax.scatter([], [], s=14, color="white", edgecolor="#777", lw=0.7, label="一般留一法")
    ax.scatter([], [], s=18, color=OI["blue"], label="攝影者隔離（點大小＝查詢數）")
    for c, t in ((OI["blue"], "下降 < 10"), (OI["orange"], "10–30"), (OI["red"], "≥ 30 個百分點")):
        ax.plot([], [], color=c, lw=3, alpha=0.6, label=t)
    ax.legend(loc="upper left", bbox_to_anchor=(-0.02, -0.11), ncol=5, handletextpad=0.35, columnspacing=0.9, handlelength=1.3)
    ax.set_title(f"逐棟比較（{len(rows)} 棟有 ≥ 2 位攝影者，可做隔離測試）", loc="left", pad=6)

    axb = fig.add_subplot(gs[1]); label(axb, "b", x=-0.22, y=1.02)
    P, S = d["plain"], d["strict"]
    vals = [(f"一般留一法\n（n = {P['n']}）", P["top1"], P["n"], "#B9C3CF"), (f"攝影者隔離\n（n = {S['n']}）", S["top1"], S["n"], OI["blue"])]
    for i, (nm, v, n, col) in enumerate(vals):
        lo, hi = wilson(round(v * n), n)
        axb.bar(i, v * 100, width=0.5, color=col, lw=0)
        axb.errorbar(i, v * 100, yerr=[[v * 100 - lo * 100], [hi * 100 - v * 100]], color=NAVY, lw=0.8, capsize=2.5)
        axb.text(i, hi * 100 + 2.5, f"{v * 100:.1f}%", ha="center", fontsize=8, fontweight="bold", color=NAVY)
    axb.annotate("", xy=(1, S["top1"] * 100 + 13), xytext=(0, P["top1"] * 100 + 9),
                 arrowprops=dict(arrowstyle="-|>", color=OI["red"], lw=0.8, connectionstyle="arc3,rad=-0.25"))
    axb.text(0.5, P["top1"] * 100 + 17, f"−{(P['top1'] - S['top1']) * 100:.1f} 個百分點", ha="center", fontsize=6, color=OI["red"], fontweight="bold")
    axb.set_xticks([0, 1]); axb.set_xticklabels([v[0] for v in vals]); axb.set_ylim(0, 118); axb.set_yticks([0, 25, 50, 75, 100])
    axb.set_ylabel("Top-1 準確率 (%)，95% 信賴區間")
    axb.set_title("整體：同一攝影者的照片會抬高分數", loc="left", pad=6)
    axb.text(0, -0.17, f"另有 {len(single)} 棟只有 1 位攝影者，無法做隔離測試；\n優先為這些建築補充不同來源的照片。",
             transform=axb.transAxes, fontsize=5, color="#555", va="top")
    save(fig, "fig6-leakage")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    fig_robustness(); fig_leakage()
