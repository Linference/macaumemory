"""從存下來的 macaumemory 頁面萃取「使用條款 / 版權」正文，並找出它的資料 API。

用法：python tools/recognize/_mm_terms.py
"""
from __future__ import annotations

import html as H
import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"


def text_of(raw: str) -> str:
    raw = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", " ", raw, flags=re.S | re.I)
    raw = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</h\d>|</td>|</tr>", "\n", raw, flags=re.I)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = H.unescape(raw)
    raw = re.sub(r"[ \t\u00a0]+", " ", raw)
    raw = re.sub(r"\n\s*\n+", "\n", raw)
    return raw.strip()


p = OUT / "macaumemory_terms.html"
raw = p.read_text(encoding="utf-8", errors="replace")
txt = text_of(raw)
(OUT / "macaumemory-terms.txt").write_text(txt, encoding="utf-8")
print(f"terms 純文字 {len(txt)} 字 → out/macaumemory-terms.txt")

# 只保留含關鍵詞的行，縮短輸出
KEY = re.compile(r"版權|著作權|授權|使用條款|知識產權|轉載|重製|引用|下載|商業|同意|聲明|"
                 r"copyright|licen[cs]e|CC |creative commons", re.I)
lines = [l.strip() for l in txt.splitlines() if l.strip()]
hits = [l for l in lines if KEY.search(l)]
print(f"\n=== 命中關鍵詞的段落（{len(hits)} 行）===")
for l in hits[:60]:
    print("  " + l[:400])

# 找 SPA 的 API 端點與圖片路徑樣式
print("\n=== script / API 線索 ===")
apis = sorted(set(re.findall(r'["\'](/?[A-Za-z0-9_\-/]*(?:api|Api|API)[A-Za-z0-9_\-/]*)["\']', raw)))
for a in apis[:40]:
    print("  api:", a)
imgs = sorted(set(re.findall(r'(?:src|data-src|href)\s*=\s*["\']([^"\']+\.(?:jpg|jpeg|png|webp))["\']', raw, re.I)))
print(f"  圖片路徑 {len(imgs)} 個，樣本：")
for i in imgs[:15]:
    print("    ", i[:150])
scripts = sorted(set(re.findall(r'<script[^>]+src\s*=\s*["\']([^"\']+)["\']', raw, re.I)))
print("  外部 script：")
for s in scripts[:20]:
    print("    ", s[:150])
