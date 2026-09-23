"""列出最終 YOLO 資料集的各類別標籤數（train/val）。"""
import collections
from pathlib import Path

NAMES = ["portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
         "civic", "industrial", "village", "monument", "market"]
ZH = ["葡式殖民", "廟宇", "教堂", "騎樓唐樓", "高層住宅", "酒店娛樂場",
      "公共建築", "工業倉庫", "村落民居", "牌坊紀念物", "街市"]

tr, va = collections.Counter(), collections.Counter()
for split, c in (("train", tr), ("val", va)):
    d = Path(f"datasets/macau-buildings/labels/{split}")
    for p in d.glob("*.txt") if d.exists() else []:
        for line in p.read_text().split("\n"):
            if line.strip():
                c[NAMES[int(line.split()[0])]] += 1

print(f"{'類別':<24}{'train':>7}{'val':>6}{'合計':>7}")
for n, z in zip(NAMES, ZH):
    print(f"{z + ' ' + n:<24}{tr.get(n, 0):>7}{va.get(n, 0):>6}{tr.get(n, 0) + va.get(n, 0):>7}")
print(f"{'總計':<24}{sum(tr.values()):>7}{sum(va.values()):>6}{sum(tr.values()) + sum(va.values()):>7}")

size = sum(f.stat().st_size for f in Path("datasets").rglob("*") if f.is_file())
weak = [n for n in NAMES if tr.get(n, 0) < 25]
print(f"\n資料集佔用 {size / 1024 / 1024:.0f} MB")
print(f"train 少於 25 張的類別（AP 會偏低）：{weak}")
