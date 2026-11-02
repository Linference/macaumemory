"""整理可公開的「澳門建築開放資料集」（只在本機產生，不上傳）。

只收錄來源與授權可逐張查證的照片：
  ① 建築識別參考照片：photos-src/cc/ATTRIBUTION.csv（Wikimedia Commons，CC0／公有領域／CC BY／CC BY-SA）
  ② 建築偵測標註：datasets/macau-buildings 中能對回 ATTRIBUTION.csv 的 train/val 影像與 YOLO 標籤
排除：使用者提供、僅限內部評測的照片（photos-src/cc/ATTRIBUTION-user-provided.csv）、來源不明或授權欄位空白者。
輸出：output/dataset/macau-buildings-open-v1/
  images/recognition/<building_id>/*.jpg   images/detection/{train,val}/*.jpg   labels/detection/{train,val}/*.txt
  manifest.csv（每張：用途、建築、作者、授權、授權網址、日期、來源頁、SHA-256）  README.md  ATTRIBUTION.md
說明：本腳本由 AI 程式助手（Claude）協助撰寫。公開發布前須由研究者逐項確認授權條款。
用法：python tools/dataset/build_release.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output" / "dataset" / "macau-buildings-open-v1"
OK = ("CC0", "Public domain", "CC BY ", "CC BY-SA ")
LIC_URL = {
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/", "Public domain": "https://commons.wikimedia.org/wiki/Commons:Public_domain",
    "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/", "CC BY 2.5": "https://creativecommons.org/licenses/by/2.5/",
    "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/", "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/", "CC BY-SA 2.5": "https://creativecommons.org/licenses/by-sa/2.5/",
    "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/", "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
}
CLASSES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel", "civic", "industrial", "village", "monument", "market"]


def open_license(lic: str) -> bool:
    lic = (lic or "").strip()
    return lic in ("CC0", "Public domain") or any(lic.startswith(p) for p in OK[2:])


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rows(path: Path):
    with path.open(encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    manifest, skipped = [], Counter()
    internal = {r["file"] for r in rows(ROOT / "photos-src/cc/ATTRIBUTION-user-provided.csv")}

    # ① 識別參考照片
    for r in rows(ROOT / "photos-src/cc/ATTRIBUTION.csv"):
        src = ROOT / r["file"]
        if r["file"] in internal or not open_license(r["license"]) or not src.exists():
            skipped["recognition"] += 1; continue
        dst = OUT / "images" / "recognition" / r["building_id"] / src.name
        dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dst)
        manifest.append({"use": "recognition", "path": dst.relative_to(OUT).as_posix(), "building": r["building_id"], "class": r["class_id"],
                         "author": r["author"], "license": r["license"], "license_url": LIC_URL.get(r["license"].strip(), ""),
                         "date": r["date"], "source_page": r["source_page"], "sha256": sha(dst)})

    # ② 偵測標註（只收能對回授權紀錄者）
    attr = {}
    for r in rows(ROOT / "datasets/macau-buildings/ATTRIBUTION.csv"):
        stem = f"{r['class_id']}_{Path(r['file']).stem}"[:110]
        attr[stem + ".jpg"] = r
    for split in ("train", "val"):
        for img in sorted((ROOT / "datasets/macau-buildings/images" / split).glob("*.jpg")):
            r = attr.get(img.name)
            lab = ROOT / "datasets/macau-buildings/labels" / split / (img.stem + ".txt")
            if not r or not open_license(r["license"]) or not lab.exists():
                skipped["detection"] += 1; continue
            di = OUT / "images" / "detection" / split / img.name; dl = OUT / "labels" / "detection" / split / lab.name
            di.parent.mkdir(parents=True, exist_ok=True); dl.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(img, di); shutil.copy2(lab, dl)
            manifest.append({"use": f"detection-{split}", "path": di.relative_to(OUT).as_posix(), "building": "", "class": r["class_id"],
                             "author": r["author"], "license": r["license"], "license_url": LIC_URL.get(r["license"].strip(), ""),
                             "date": r["date"], "source_page": r["source_page"], "sha256": sha(di)})

    fields = list(manifest[0])
    with (OUT / "manifest.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(manifest)
    (OUT / "data.yaml").write_text("path: .\ntrain: images/detection/train\nval: images/detection/val\n\nnc: 11\nnames:\n" +
                                   "".join(f"  {i}: {c}\n" for i, c in enumerate(CLASSES)), encoding="utf-8")
    lic = Counter(m["license"] for m in manifest); use = Counter(m["use"] for m in manifest)
    (OUT / "ATTRIBUTION.md").write_text("# Attribution\n\n" + "\n".join(
        f"- `{m['path']}` — {m['author'] or 'unknown author'}, {m['license']} ({m['license_url']}), {m['source_page']}" for m in manifest) + "\n", encoding="utf-8")
    (OUT / "README.md").write_text(f"""# Macau Buildings Open Dataset v1（澳門建築開放資料集）

由「途見 TUJIAN」專案整理的澳門建築照片：建築識別參考照片與 YOLO 建築偵測標註。

| 子集 | 張數 |
|---|---|
{chr(10).join(f'| {k} | {v} |' for k, v in sorted(use.items()))}

- 照片全部來自 Wikimedia Commons，授權逐張記錄於 `manifest.csv` 與 `ATTRIBUTION.md`。
- 授權分布：{json.dumps(dict(lic.most_common()), ensure_ascii=False)}
- **使用條件**：每張照片沿用其原始授權。CC BY／CC BY-SA 須標示作者與授權；CC BY-SA 的衍生作品須以相同授權釋出。
- 偵測標註（YOLO 格式，11 類，見 `data.yaml`）為自動預標註加人工及模型複核，可能仍有誤差。
- 未收錄：使用者提供、僅限內部評測的照片，以及授權或來源無法查證的照片（共排除 {sum(skipped.values())} 張）。
- 標註與整理工作以 CC BY 4.0 釋出（照片本身依各自授權）。
""", encoding="utf-8")
    print("wrote", OUT, dict(use), "skipped", dict(skipped))


if __name__ == "__main__":
    main()
