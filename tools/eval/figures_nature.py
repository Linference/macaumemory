"""Nature 規格的數據圖：183 mm 雙欄、Arial／微軟正黑體 5–7 pt、Okabe–Ito 配色、只留左下軸、矢量 PDF。

資料（皆為本機實測，先跑 tools/eval/ablation.py）
  tools/eval/out/ablation.json, ablation-outcomes.npz   消融與多視角結果
  tools/eval/out/ablation-cache/ref-*.npy                 參考庫 335 張照片的向量（DINOv2-small／base、CLIP）
輸出：docs/figs-nature/fig{1,2,3}.pdf（矢量）與 .png（600 dpi 預覽）
說明：本腳本由 AI 程式助手（Claude）協助撰寫；圖中數據的解讀由研究者負責。
用法：python tools/eval/figures_nature.py
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
from matplotlib.colors import LogNorm

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "recognize"))
import build_embeddings as be  # noqa: E402

OUT = ROOT / "docs" / "figs-nature"
OUT.mkdir(parents=True, exist_ok=True)
EV = ROOT / "tools" / "eval" / "out"
MM = 1 / 25.4

for f in ("arial.ttf", "arialbd.ttf", "msjh.ttc", "msjhbd.ttc"):
    font_manager.fontManager.addfont(f"C:/Windows/Fonts/{f}")
plt.rcParams.update({
    "font.family": ["Arial", "Microsoft JhengHei"], "font.size": 6, "axes.titlesize": 6.5, "axes.labelsize": 6,
    "xtick.labelsize": 5.5, "ytick.labelsize": 5.5, "legend.fontsize": 5.5, "axes.linewidth": 0.6,
    "xtick.major.width": 0.6, "ytick.major.width": 0.6, "xtick.major.size": 2.5, "ytick.major.size": 2.5,
    "xtick.direction": "out", "ytick.direction": "out", "axes.spines.top": False, "axes.spines.right": False,
    "legend.frameon": False, "lines.linewidth": 0.9, "pdf.fonttype": 42, "svg.fonttype": "none",
    "savefig.dpi": 600, "axes.unicode_minus": False,
})
# Okabe–Ito
OI = {"black": "#000000", "orange": "#E69F00", "sky": "#56B4E9", "green": "#009E73", "yellow": "#F0E442",
      "blue": "#0072B2", "red": "#D55E00", "purple": "#CC79A7", "grey": "#999999"}


def label(ax, s, x=-0.16, y=1.04):
    ax.text(x, y, s, transform=ax.transAxes, fontsize=8, fontweight="bold", va="bottom", ha="left")


def save(fig, name):
    for ext in ("pdf", "png"):
        fig.savefig(OUT / f"{name}.{ext}", bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)
    print("wrote", name)


def wilson(k, n, z=1.959964):
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


# ─────────── 資料 ───────────
abl = json.loads((EV / "ablation.json").read_text(encoding="utf-8"))
oc = np.load(EV / "ablation-outcomes.npz")
refs = be.collect_references()
ids = sorted({r["id"] for r in refs}); bidx = {b: i for i, b in enumerate(ids)}
y = np.array([bidx[r["id"]] for r in refs]); nb = len(ids)
valid = np.bincount(y, minlength=nb)[y] >= 2
R = np.load(EV / "ablation-cache" / "ref-small-tta.npy")
VB = np.load(EV / "ablation-cache" / "ref-dino-base.npy")
VC = np.load(EV / "ablation-cache" / "ref-clip-b32.npy")
zh = {b: be.BUILDINGS[b]["zh"] for b in ids}
cls = {b: be.BUILDINGS[b]["cls"] for b in ids}
CLS_ZH = {"portuguese": "葡式", "temple": "廟宇", "church": "教堂", "tong_lau": "唐樓", "residential_tower": "住宅",
          "casino_hotel": "酒店", "civic": "公共", "industrial": "工業", "village": "圍里", "monument": "牌坊", "market": "街市"}


def loo(V):
    """留一法：每棟取其餘參考照片最高分。回傳 (每棟分數矩陣, 同棟分數, 最近異棟分數)。"""
    S = V @ V.T; np.fill_diagonal(S, -np.inf)
    sc = np.full((len(V), nb), -np.inf, np.float32)
    for b in range(nb):
        sc[:, b] = S[:, y == b].max(1)
    same = sc[np.arange(len(V)), y]
    other = np.array([np.max(np.delete(sc[i], y[i])) for i in range(len(V))])
    return sc, same, other


sc_small, same_s, other_s = loo(R)
top_s = sc_small.max(1); hit = sc_small.argmax(1) == y
HIT, MAYBE = 0.82, 0.57

# ════════════ 圖 1：設計選擇 ════════════
fig = plt.figure(figsize=(183 * MM, 62 * MM))
gs = fig.add_gridspec(1, 3, width_ratios=[1.45, 0.8, 1.0], wspace=0.62)

# a 森林圖
ax = fig.add_subplot(gs[0]); label(ax, "a", x=-0.62)
rows = abl["rows"]
LAB = {"B": "基準：YOLO 裁切", "A1": "整張圖（不裁切）", "A2": "整張圖・無多裁切翻轉", "A3": "每棟取平均向量",
       "A4": "不用類別提示", "A5": "DINOv2-base", "A6": "CLIP ViT-B/32"}
order = ["B", "A4", "A3", "A1", "A2", "A5", "A6"]
by = {r["name"]: r for r in rows}
for k, name in enumerate(order):
    r = by[name]; yk = len(order) - 1 - k
    mc = r.get("mcnemar_vs_base") or r.get("mcnemar_vs_A1")
    sig = mc is not None and mc["p"] < 0.05
    better = mc is not None and mc["b01"] > mc["b10"]
    col = OI["black"] if name == "B" else (OI["blue"] if sig and better else OI["red"] if sig else OI["grey"])
    lo, hi = np.array(r["top1_ci"]) * 100
    ax.plot([lo, hi], [yk, yk], color=col, lw=1.0, solid_capstyle="butt")
    ax.plot(r["top1"] * 100, yk, "o" if name != "B" else "D", color=col, ms=3.6, mec="white", mew=0.4, zorder=3)
    ref = "" if mc is None else ("†" if "mcnemar_vs_A1" in r else "")
    ptxt = "對照" if mc is None else (f"P = {mc['p']:.3f}{ref}" if mc["p"] >= 0.001 else f"P < 0.001{ref}")
    ax.text(93.6, yk, f"{r['top1'] * 100:.1f}%", va="center", ha="left", fontsize=5, color=col)
    ax.text(96.8, yk, ptxt, va="center", ha="left", fontsize=5, color=col)
ax.axvline(by["B"]["top1"] * 100, color=OI["black"], lw=0.5, ls=(0, (2, 2)))
ax.set_yticks(range(len(order))); ax.set_yticklabels([LAB[n] for n in reversed(order)])
ax.set_xlim(77, 101.5); ax.set_xticks([80, 85, 90]); ax.set_xlabel("Top-1 準確率 (%)，95% 信賴區間")
ax.text(0, -0.2, "藍：顯著較佳　紅：顯著較差　灰：差異不顯著（McNemar 檢定，對基準；† 對整張圖）", transform=ax.transAxes, fontsize=4.5, color="#555")
ax.set_title("消融實驗（n = 335 次留一法查詢）", loc="left", pad=6)
ax.spines["left"].set_visible(False); ax.tick_params(axis="y", length=0)

# b 配對斜線圖：多視角
ax = fig.add_subplot(gs[1]); label(ax, "b", x=-0.42)
ms, mm = oc["mv_margin_single"], oc["mv_margin_multi"]
cs, cm = oc["mv_single"], oc["mv_multi"]
rng = np.random.default_rng(1)
for a_, b_, s1, s2 in zip(ms, mm, cs, cm):
    col = OI["blue"] if (not s1 and s2) else OI["red"] if (s1 and not s2) else "#C8C8C8"
    lw, z = (0.8, 3) if col != "#C8C8C8" else (0.35, 1)
    j = rng.uniform(-0.06, 0.06)
    ax.plot([0 + j, 1 + j], [a_, b_], color=col, lw=lw, zorder=z, alpha=0.9)
    ax.plot([0 + j, 1 + j], [a_, b_], "o", color=col, ms=1.4, zorder=z, mew=0)
ax.axhline(0, color=OI["black"], lw=0.5, ls=(0, (2, 2)))
ax.text(1.12, 0.005, "判斷正確", fontsize=4.6, va="bottom", color="#555"); ax.text(1.12, -0.005, "判斷錯誤", fontsize=4.6, va="top", color="#555")
ax.set_xticks([0, 1]); ax.set_xticklabels(["單張", "三張平均"]); ax.set_xlim(-0.3, 1.55)
ax.set_ylabel("分數差（正確建築 − 最高其他）")
mc = abl["multiview"]["mcnemar"]
ax.set_title(f"多視角（94 組）：{abl['multiview']['single_top1'] * 100:.1f}% → {abl['multiview']['multi_top1'] * 100:.1f}%\nMcNemar P = {mc['p']:.3f}", loc="left", pad=4)
ax.plot([], [], color=OI["blue"], label=f"錯→對（{mc['b01']}）"); ax.plot([], [], color=OI["red"], label=f"對→錯（{mc['b10']}）")
ax.legend(loc="lower right", handlelength=1.2)

# c 雲雨圖：同棟 vs 最近異棟
ax = fig.add_subplot(gs[2]); label(ax, "c", x=-0.2)
from scipy.stats import gaussian_kde
for k, (vals, col, name) in enumerate(((other_s[valid], OI["red"], "最相近的其他建築"), (same_s[valid], OI["blue"], "同一建築"))):
    yy = np.linspace(0, 1.05, 300); kde = gaussian_kde(vals, bw_method=0.18)(yy)
    kde = kde / kde.max() * 0.36
    ax.fill_betweenx(yy, k + 0.08, k + 0.08 + kde, color=col, alpha=0.35, lw=0)
    ax.plot(k + 0.08 + kde, yy, color=col, lw=0.6)
    q1, med, q3 = np.percentile(vals, [25, 50, 75])
    ax.plot([k - 0.02, k - 0.02], [q1, q3], color=col, lw=2.4, solid_capstyle="butt")
    ax.plot(k - 0.02, med, "o", color="white", ms=1.8, mec=col, mew=0.6, zorder=4)
    ax.scatter(k - 0.2 + rng.uniform(-0.07, 0.07, len(vals)), vals, s=1.2, color=col, alpha=0.55, lw=0)
for t, nm in ((HIT, "高信心"), (MAYBE, "待確認")):
    ax.axhline(t, color=OI["black"], lw=0.5, ls=(0, (2, 2)))
    ax.text(1.58, t + 0.012, f"{nm} {t}", fontsize=4.6, va="bottom", ha="right", bbox=dict(fc="white", ec="none", pad=0.3, alpha=0.85))
ax.set_xticks([0, 1]); ax.set_xticklabels(["最相近的\n其他建築", "同一建築\n（其餘照片）"]); ax.set_xlim(-0.45, 1.6)
ax.set_ylabel("餘弦相似度"); ax.set_ylim(0, 1.05)
ax.set_title("相似度分布（n = 335）", loc="left", pad=6)
save(fig, "fig1-design")

# ════════════ 圖 2：可靠性與編碼器 ════════════
fig = plt.figure(figsize=(183 * MM, 60 * MM))
gs = fig.add_gridspec(1, 3, width_ratios=[1, 1, 1], wspace=0.45)

# a 可靠性曲線
ax = fig.add_subplot(gs[0]); label(ax, "a")
edges = np.array([0.3, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0])
cent, acc, lo, hi, cnt = [], [], [], [], []
for a_, b_ in zip(edges[:-1], edges[1:]):
    m = valid & (top_s >= a_) & (top_s < b_)
    if m.sum() < 3:
        continue
    k = int(hit[m].sum()); n = int(m.sum()); l, h = wilson(k, n)
    cent.append(top_s[m].mean()); acc.append(k / n); lo.append(l); hi.append(h); cnt.append(n)
cent, acc, lo, hi = map(np.array, (cent, acc, lo, hi))
ax.axvspan(HIT, 1.0, color=OI["green"], alpha=0.08, lw=0); ax.axvspan(MAYBE, HIT, color=OI["orange"], alpha=0.08, lw=0)
ax.errorbar(cent, acc * 100, yerr=[np.clip(acc - lo, 0, None) * 100, np.clip(hi - acc, 0, None) * 100], fmt="o-", color=OI["blue"], ms=2.6, lw=0.8, elinewidth=0.6, capsize=1.2)
for x_, n in zip(cent, cnt):
    ax.text(x_, 2, str(n), fontsize=4.2, ha="center", va="bottom", color="#666", rotation=90)
ax.text(0.305, 2, "n =", fontsize=4.2, va="bottom", color="#666")
ax.text(0.83, 22, "高信心", fontsize=5, color=OI["green"]); ax.text(0.585, 22, "待確認", fontsize=5, color="#B07A00")
ax.set_xlabel("首位候選相似度"); ax.set_ylabel("首位候選正確率 (%)")
ax.set_ylim(0, 105); ax.set_xlim(0.3, 1.0)
ax.set_title("分數越高越可靠", loc="left", pad=6)

# b ROC＋bootstrap 帶
ax = fig.add_subplot(gs[1]); label(ax, "b")
iu = np.triu_indices(len(y), 1); same_pair = (y[iu[0]] == y[iu[1]])


def roc(scores, labels):
    o = np.argsort(-scores); l = labels[o]
    tp = np.cumsum(l) / l.sum(); fp = np.cumsum(~l) / (~l).sum()
    return np.r_[0, fp], np.r_[0, tp]


def auc(fp, tp):
    return float(np.trapezoid(tp, fp))


grid = np.linspace(0, 1, 201)
aucs = {}
for V, col, nm in ((VC, OI["grey"], "CLIP ViT-B/32"), (R, OI["blue"], "DINOv2-small（途見）"), (VB, OI["orange"], "DINOv2-base")):
    S = (V @ V.T)[iu]
    fp, tp = roc(S, same_pair); a0 = auc(fp, tp)
    boots, bauc = [], []
    br = np.random.default_rng(7)
    for _ in range(200):                                    # 以照片為單位重抽（避免成對樣本相關造成區間過窄）
        pick = np.unique(br.choice(len(y), len(y), replace=True))
        mask = np.isin(iu[0], pick) & np.isin(iu[1], pick)
        f2, t2 = roc(S[mask], same_pair[mask]); boots.append(np.interp(grid, f2, t2)); bauc.append(auc(f2, t2))
    boots = np.array(boots); lo_, hi_ = np.percentile(boots, [2.5, 97.5], 0)
    ax.fill_between(grid, lo_, hi_, color=col, alpha=0.18, lw=0)
    ax.plot(fp, tp, color=col, lw=0.9, label=f"{nm}\nAUC {a0:.3f} [{np.percentile(bauc, 2.5):.3f}–{np.percentile(bauc, 97.5):.3f}]")
    aucs[nm] = a0
ax.plot([0, 1], [0, 1], color="#BBBBBB", lw=0.5, ls=(0, (2, 2)))
ax.set_xlabel("假陽性率"); ax.set_ylabel("真陽性率"); ax.set_xlim(0, 1); ax.set_ylim(0, 1.01)
ax.legend(loc="lower right", fontsize=4.5, handlelength=1.2, labelspacing=0.5)
ax.set_title("同棟／異棟照片對辨別（55,945 對）", loc="left", pad=6)

# c 各類別 Top-1（點＋CI）
ax = fig.add_subplot(gs[2]); label(ax, "c", x=-0.3)
cy = np.array([cls[ids[b]] for b in y])
cats = sorted({c for c in cy[valid]}, key=lambda c: -hit[valid & (cy == c)].mean())
for k, c in enumerate(cats):
    m = valid & (cy == c); n = int(m.sum()); kk = int(hit[m].sum()); l, h = wilson(kk, n)
    yk = len(cats) - 1 - k
    ax.plot([l * 100, h * 100], [yk, yk], color=OI["blue"], lw=0.9)
    ax.plot(kk / n * 100, yk, "o", color=OI["blue"], ms=3, mec="white", mew=0.4)
    ax.text(105, yk, f"{kk}/{n}", va="center", fontsize=4.6, color="#555")
ax.axvline(hit[valid].mean() * 100, color=OI["black"], lw=0.5, ls=(0, (2, 2)))
ax.set_yticks(range(len(cats))); ax.set_yticklabels([CLS_ZH.get(c, c) for c in reversed(cats)])
ax.set_xlim(20, 104); ax.set_xticks([20, 40, 60, 80, 100]); ax.set_xlabel("Top-1 準確率 (%)，95% 信賴區間")
ax.spines["left"].set_visible(False); ax.tick_params(axis="y", length=0)
ax.set_title("按建築類別", loc="left", pad=6)
save(fig, "fig2-reliability")

# ════════════ 圖 3：混淆氣泡矩陣（整張圖口徑） ════════════
# 對角線＝該建築被認對的比例（藍色圓面積）；非對角＝誤判次數（紅色圓面積＋數字）；
# 底色區塊標出同類建築；右側為每棟建築的 Top-1；下方列出最常見的混淆。
from matplotlib.patches import Rectangle, FancyBboxPatch
CLS_COL = {"casino_hotel": "#E69F00", "church": "#56B4E9", "civic": "#009E73", "industrial": "#999999", "market": "#CC79A7",
           "monument": "#D55E00", "portuguese": "#0072B2", "temple": "#B8860B", "tong_lau": "#882255", "village": "#44AA99",
           "residential_tower": "#666666"}
ordr = sorted(range(nb), key=lambda b: (cls[ids[b]], zh[ids[b]]))
pos = {b: i for i, b in enumerate(ordr)}
pred = sc_small.argmax(1)
M = np.zeros((nb, nb))
for t, p in zip(y[valid], pred[valid]):
    M[pos[t], pos[p]] += 1
rowsum = M.sum(1)
acc_row = np.divide(np.diag(M), rowsum, out=np.zeros(nb), where=rowsum > 0)
names = [zh[ids[b]].split("（")[0] for b in ordr]
cl = [cls[ids[b]] for b in ordr]
starts = [0] + [i for i in range(1, nb) if cl[i] != cl[i - 1]] + [nb]

fig = plt.figure(figsize=(183 * MM, 172 * MM))
gs = fig.add_gridspec(2, 2, width_ratios=[1, 0.17], height_ratios=[1, 0.13], wspace=0.04, hspace=0.62)
ax = fig.add_subplot(gs[0, 0]); label(ax, "a", x=-0.17, y=1.035)
# 同類建築的底色區塊
for a_, b_ in zip(starts[:-1], starts[1:]):
    c = CLS_COL.get(cl[a_], "#999")
    ax.add_patch(Rectangle((a_ - 0.5, a_ - 0.5), b_ - a_, b_ - a_, facecolor=c, alpha=0.10, lw=0, zorder=0))
    ax.add_patch(Rectangle((-1.05, a_ - 0.42), 0.38, b_ - a_ - 0.16, facecolor=c, lw=0, clip_on=False))   # 左側類別色條
    ax.add_patch(Rectangle((a_ - 0.42, -1.05), b_ - a_ - 0.16, 0.38, facecolor=c, lw=0, clip_on=False))   # 上方類別色條
    if b_ - a_ >= 2:
        ax.text((a_ + b_ - 1) / 2, -1.45, CLS_ZH.get(cl[a_], cl[a_]), ha="center", va="bottom", fontsize=5.2, fontweight="bold", color=c)
# 細格線
for k in range(nb + 1):
    ax.axhline(k - 0.5, color="#EEEEEE", lw=0.3, zorder=0.5); ax.axvline(k - 0.5, color="#EEEEEE", lw=0.3, zorder=0.5)
R_MAX = 0.46
for i in range(nb):
    if rowsum[i]:
        r = R_MAX * np.sqrt(acc_row[i])
        ax.add_patch(plt.Circle((i, i), r, color=OI["blue"], alpha=0.9, lw=0, zorder=2))
    for j in range(nb):
        if i != j and M[i, j]:
            r = 0.17 + 0.1 * (M[i, j] - 1)
            ax.add_patch(plt.Circle((j, i), min(r, 0.48), color=OI["red"], lw=0, zorder=3))
            if M[i, j] >= 2:
                ax.text(j, i, int(M[i, j]), ha="center", va="center", fontsize=4.4, color="white", fontweight="bold", zorder=4)
ax.set_xlim(-0.5, nb - 0.5); ax.set_ylim(nb - 0.5, -0.5); ax.set_aspect("equal")
ax.set_xticks(range(nb)); ax.set_xticklabels(names, rotation=90, fontsize=4.6)
ax.set_yticks(range(nb)); ax.set_yticklabels(names, fontsize=4.6)
ax.tick_params(length=0, pad=6)
for t_, c_ in zip(ax.get_yticklabels(), cl): t_.set_color("#333")
ax.set_xlabel("預測建築", labelpad=4); ax.set_ylabel("真實建築", labelpad=4)
for s in ("top", "right", "left", "bottom"):
    ax.spines[s].set_visible(False)
ax.set_title(f"留一法混淆氣泡矩陣（DINOv2-small，整張圖；n = {int(valid.sum())}）", loc="left", pad=22)

# b 每棟 Top-1
axb = fig.add_subplot(gs[0, 1], sharey=ax)
cols_b = [OI["blue"] if a_ >= 0.85 else OI["orange"] if a_ >= 0.7 else OI["red"] for a_ in acc_row]
axb.barh(range(nb), acc_row * 100, color=cols_b, height=0.62, lw=0)
for i, (a_, n_) in enumerate(zip(acc_row, rowsum)):
    axb.text(103, i, f"{int(M[i, i])}/{int(n_)}", va="center", fontsize=4.2, color="#555")
axb.axvline(hit[valid].mean() * 100, color=OI["black"], lw=0.5, ls=(0, (2, 2)), zorder=0)
axb.set_xlim(0, 135); axb.set_xticks([0, 50, 100]); axb.set_xlabel("Top-1 (%)")
axb.tick_params(axis="y", left=False, labelleft=False); axb.spines["left"].set_visible(False)
axb.set_title("b", loc="left", fontsize=8, fontweight="bold", pad=22)

# c 最常見的混淆（雙向合計）
pairs = {}
for i in range(nb):
    for j in range(nb):
        if i != j and M[i, j]:
            k = tuple(sorted((i, j))); pairs[k] = pairs.get(k, 0) + M[i, j]
top = sorted(pairs.items(), key=lambda kv: -kv[1])[:6]
axc = fig.add_subplot(gs[1, :]); axc.axis("off")
axc.text(0, 1.12, "c", fontsize=8, fontweight="bold", transform=axc.transAxes)
axc.text(0.03, 1.12, "最常見的混淆（雙向合計）", fontsize=6.5, transform=axc.transAxes)
axc.text(1.0, 1.12, "a 圖例：藍圓面積＝該建築被認對的比例　紅圓＝誤判（數字為 ≥ 2 次）", fontsize=4.8, color="#555", ha="right", transform=axc.transAxes)
for k, ((i, j), n_) in enumerate(top):
    x0 = (k % 3) / 3; y0 = 0.5 - (k // 3) * 0.6
    axc.add_patch(FancyBboxPatch((x0 + 0.005, y0 - 0.04), 0.31, 0.44, boxstyle="round,pad=0.01,rounding_size=0.02",
                                 transform=axc.transAxes, facecolor="#F6F7F9", edgecolor="#DDDDDD", lw=0.5, clip_on=False))
    axc.text(x0 + 0.02, y0 + 0.18, f"{int(n_)}", fontsize=10, fontweight="bold", color=OI["red"], transform=axc.transAxes, va="center")
    same = "同類" if cl[i] == cl[j] else "跨類"
    axc.text(x0 + 0.07, y0 + 0.26, f"{names[i]}  ↔  {names[j]}", fontsize=5.6, transform=axc.transAxes, va="center")
    axc.text(x0 + 0.07, y0 + 0.08, f"{CLS_ZH.get(cl[i])}／{CLS_ZH.get(cl[j])} · {same}", fontsize=4.8, color="#666", transform=axc.transAxes, va="center")
save(fig, "fig3-confusion")

(OUT / "figures.json").write_text(json.dumps({"auc_pairs": aucs, "n_pairs": int(same_pair.size)}, ensure_ascii=False, indent=1), encoding="utf-8")

# ════════════ 圖 4：擴展性與可靠性（tools/eval/extended.py） ════════════
ext_f = EV / "extended.json"
if ext_f.exists():
    ext = json.loads(ext_f.read_text(encoding="utf-8"))
    fig = plt.figure(figsize=(183 * MM, 118 * MM))
    gs = fig.add_gridspec(2, 2, wspace=0.32, hspace=0.62)

    # a 學習曲線
    if "learning" in ext:
        ax = fig.add_subplot(gs[0, 0]); label(ax, "a")
        cv = ext["learning"]["curve"]; k = [c["k"] for c in cv]
        for key, col, nm in (("top1", OI["blue"], "Top-1"), ("top3", OI["orange"], "Top-3")):
            m = np.array([c[key] for c in cv]) * 100; lo = np.array([c[key + "_ci"][0] for c in cv]) * 100; hi = np.array([c[key + "_ci"][1] for c in cv]) * 100
            ax.fill_between(k, lo, hi, color=col, alpha=0.18, lw=0); ax.plot(k, m, "o-", color=col, ms=2.8, lw=0.9, label=nm)
            for x_, y_ in zip(k, m):
                if x_ in (1, 3, 7):
                    ax.text(x_, y_ + 1.6, f"{y_:.1f}", fontsize=4.8, ha="center", color=col)
        ax.set_xlabel("每棟建築的參考照片數"); ax.set_ylabel("準確率 (%)"); ax.set_xticks(k); ax.set_ylim(60, 101)
        ax.legend(loc="lower right")
        ax.set_title(f"需要幾張參考照片（{ext['learning']['buildings']} 棟，隨機 30 次，95% 區間）", loc="left", pad=6)

    # b 魯棒性
    if "robust" in ext:
        ax = fig.add_subplot(gs[0, 1]); label(ax, "b")
        NM = {"dark": ("暗光", OI["blue"]), "blur": ("模糊", OI["orange"]), "occlude": ("遮擋", OI["red"]), "haze": ("雨霧", OI["green"])}
        for kind, cv in ext["robust"]["curves"].items():
            lv = [c["level"] for c in cv]; m = np.array([c["top1"] for c in cv]) * 100
            ax.plot(lv, m, "o-", color=NM[kind][1], ms=2.6, lw=0.9, label=NM[kind][0])
            ax.fill_between(lv, np.array([c["ci"][0] for c in cv]) * 100, np.array([c["ci"][1] for c in cv]) * 100, color=NM[kind][1], alpha=0.10, lw=0)
        ax.set_xlabel("退化程度（0 = 原圖）"); ax.set_ylabel("Top-1 準確率 (%)"); ax.set_xticks(ext["robust"]["levels"])
        ax.legend(loc="lower left", ncol=2)
        ax.set_title("影像退化下的穩定性（n = 335）", loc="left", pad=6)

    # c 校準
    if "calib" in ext:
        ax = fig.add_subplot(gs[1, 0]); label(ax, "c")
        for rows_, col, nm, e in ((ext["calib"]["bins_raw"], OI["grey"], "原始相似度", ext["calib"]["ece_raw"]),
                                  (ext["calib"]["bins_isotonic"], OI["blue"], "保序回歸校準（5 折）", ext["calib"]["ece_isotonic_cv"])):
            rr = [r for r in rows_ if r["n"] >= 5]                     # 少於 5 次查詢的區間不畫（比例不穩）
            ax.plot([r["conf"] for r in rr], [r["acc"] for r in rr], "-", color=col, lw=0.9, label=f"{nm}  ECE {e:.3f}")
            ax.scatter([r["conf"] for r in rr], [r["acc"] for r in rr], s=[4 + r["n"] * 0.35 for r in rr], color=col, edgecolor="white", lw=0.4, zorder=3)
        ax.plot([0, 1], [0, 1], color="#BBBBBB", lw=0.5, ls=(0, (2, 2)))
        ax.set_xlim(0, 1); ax.set_ylim(0, 1.02); ax.set_xlabel("預測的正確機率"); ax.set_ylabel("實際正確比例")
        ax.legend(loc="lower right"); ax.text(0.02, 0.97, "點的大小＝該區間查詢數；n < 5 的區間不畫", transform=ax.transAxes, fontsize=4.6, va="top", color="#555")
        ax.set_title("信心校準：對角線代表「說 80% 就真的 80% 對」", loc="left", pad=6)

    # d 庫外偵測
    if "openset" in ext:
        ax = fig.add_subplot(gs[1, 1]); label(ax, "d")
        o = ext["openset"]
        ks, us = np.array(o["known_scores"]), np.array(o["unknown_scores"])
        bins = np.linspace(0, 1, 41)
        ax.hist(us, bins=bins, color=OI["red"], alpha=0.45, lw=0, label=f"庫外建築（n = {o['n_unknown']}）")
        ax.hist(ks, bins=bins, color=OI["blue"], alpha=0.45, lw=0, label=f"庫內建築（n = {o['n_known']}）")
        ax.axvline(HIT, color=OI["black"], lw=0.5, ls=(0, (2, 2)))
        ax.text(HIT + 0.01, ax.get_ylim()[1] * 0.92, f"0.82：庫外誤接受 {o['far_at_0.82'] * 100:.1f}%\n庫內接受 {o['known_accept_at_0.82'] * 100:.1f}%", fontsize=4.8, va="top")
        ax.set_xlabel("最高相似度"); ax.set_ylabel("查詢數"); ax.legend(loc="upper left")
        ax.set_title(f"庫外建築偵測（留一棟法，AUROC = {o['auroc']:.3f}）", loc="left", pad=6)
    save(fig, "fig4-scaling")
