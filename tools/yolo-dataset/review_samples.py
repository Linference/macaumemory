"""人工檢視用：把「採用」與「各規則剔除」的樣本各畫成聯絡表。

剔除的圖也會把 VLM 原本給的框畫出來，這樣才能判斷「是 VLM 錯了」還是「規則太嚴」。

用法：
    python tools/yolo-dataset/review_samples.py --n 24
"""
from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".cache" / "vlm-label"
SEL = WORK / "selection.json"
LABELS = WORK / "labels.json"
OUT = WORK / "review"
LONG = 620


def font(size: int):
    for n in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(n, size)
        except Exception:
            continue
    return ImageFont.load_default()


def render(rec: dict, labels: dict) -> Image.Image | None:
    p = Path(rec["file"])
    r = labels.get(rec["file"], {})
    try:
        with Image.open(p) as im:
            im = im.convert("RGB")
            sc = LONG / max(im.size)
            im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
            W, H = im.size
            gw, gh = (r.get("grid_size") or [W, H])
            sx, sy = W / gw, H / gh
            d = ImageDraw.Draw(im)
            fb = r.get("final_box")
            if fb and rec.get("kept"):
                x, y, w, h = fb
                d.rectangle([x * sx, y * sy, (x + w) * sx, (y + h) * sy], outline=(255, 0, 200), width=2)
            elif fb:
                x, y, w, h = fb
                d.rectangle([x * sx, y * sy, (x + w) * sx, (y + h) * sy], outline=(255, 210, 0), width=2)
            if r.get("stages", {}).get("full", {}).get("box"):
                x, y, w, h = r["stages"]["full"]["box"]
                d.rectangle([x * sx, y * sy, (x + w) * sx, (y + h) * sy], outline=(0, 255, 90), width=1)
            return im
    except Exception as e:
        print(f"[warn] {p.name}: {e}")
        return None


def sheet(items: list[tuple[dict, str]], out: Path, title: str, cols: int = 6, cell: int = 300,
          extra: dict | None = None):
    if not items:
        print(f"[skip] {title}：沒有樣本")
        return
    rows = (len(items) + cols - 1) // cols
    cap_h = 34
    sh = Image.new("RGB", (cols * (cell + 6) + 6, rows * (cell + cap_h + 6) + 6 + 34), (22, 22, 26))
    d = ImageDraw.Draw(sh)
    d.text((6, 4), f"{title}  (n={len(items)})", font=font(24), fill=(255, 235, 120))
    f = font(15)
    labels = extra or {}
    for i, (rec, cap) in enumerate(items):
        r, c = divmod(i, cols)
        x, y = 6 + c * (cell + 6), 40 + r * (cell + cap_h + 6)
        im = render(rec, labels)
        if im is None:
            d.text((x, y), f"ERR {rec['name']}", font=f, fill=(255, 90, 90))
            continue
        sc = min(cell / im.width, cell / im.height)
        im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
        sh.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        d.rectangle([x, y, x + cell, y + cell], outline=(70, 70, 80))
        for j, line in enumerate(cap.split("\n")[:2]):
            d.text((x + 2, y + cell + 4 + j * 16), line[:44], font=f, fill=(225, 225, 225))
    out.parent.mkdir(parents=True, exist_ok=True)
    sh.save(out, "JPEG", quality=85)
    print(f"[out] {out.relative_to(ROOT)} ({sh.width}x{sh.height})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=24)
    ap.add_argument("--seed", type=int, default=5)
    args = ap.parse_args()

    rows = json.loads(SEL.read_text(encoding="utf-8"))["rows"]
    labels = json.loads(LABELS.read_text(encoding="utf-8"))
    rng = random.Random(args.seed)

    kept = [r for r in rows if r.get("kept")]
    rej = [r for r in rows if not r.get("kept")]
    rej_by_rule = defaultdict(list)
    for r in rej:
        rej_by_rule[r["reject"].split(":")[0]].append(r)

    ds = [r for r in kept if r.get("class") == "casino_hotel"]
    others = [r for r in kept if r.get("class") != "casino_hotel"]
    sample_kept = rng.sample(others, min(args.n, len(others)))
    sample_casino = rng.sample(ds, min(args.n // 2, len(ds)))
    sheet([(r, f"{r['class']}\n{r['folder']}/{r['name']}") for r in sample_kept],
          OUT / "accepted-other.jpg", "ACCEPTED (non-casino) — magenta=VLM final box", extra=labels)
    sheet([(r, f"{r['class']}\n{r['folder']}/{r['name']}") for r in sample_casino],
          OUT / "accepted-casino.jpg", "ACCEPTED (casino_hotel) — magenta=final box", extra=labels)

    for rule, cap in (("R3", "框佔畫面 > 0.95（可疑：幾乎框滿整張）"),
                      ("R6", "VLM 判為非建築 / 低信心"),
                      ("R9", "近似重複圖"),
                      ("R5", "長寬比極端"), ("R8", "解析度過低"), ("R7", "自評落差過大")):
        rs = rej_by_rule.get(rule, [])
        if not rs:
            continue
        pick = rng.sample(rs, min(args.n, len(rs)))
        sheet([(r, f"{r['class']}\n{r['folder']}/{r['name']}") for r in pick],
              OUT / f"rejected-{rule}.jpg", f"REJECTED {rule}: {cap} — yellow=VLM box", extra=labels)


if __name__ == "__main__":
    main()
