"""解析文化遺產網站的 sitemap 與頁面結構：找出『建築詳細頁』的網址規則與圖片來源。

用法：python tools/recognize/_ch_explore.py
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "recognize" / "out"


def get(url: str, timeout: int = 30) -> tuple[int, str, str]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.headers.get("Content-Type", "")
    except Exception as e:
        return 0, f"__ERR__ {type(e).__name__} {e}", ""


def main() -> int:
    print("[1] 抓 sitemap")
    st, xml, _ = get("https://www.culturalheritage.mo/sitemap.xml")
    print(f"    status={st} bytes={len(xml)}")
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)
    print(f"    共 {len(locs)} 個 <loc>")
    # 依路徑樣式分群
    pat = Counter()
    for u in locs:
        p = urllib.parse.urlparse(u).path
        p = re.sub(r"/\d+", "/{n}", p)
        p = re.sub(r"/[0-9a-fA-F-]{8,}", "/{id}", p)
        pat[p] += 1
    print("    路徑樣式（前 25）：")
    for p, c in pat.most_common(25):
        print(f"      {c:5d}  {p}")

    jp = [u for u in locs if re.search(r"/jp|/detail|/item|/heritage|/building|/monument|/site", u, re.I)]
    print(f"    疑似詳細頁 {len(jp)} 個，前 20：")
    for u in jp[:20]:
        print("      ", u)

    print("\n[2] 首頁結構：找圖片與 API 端點")
    st, html, _ = get("https://www.culturalheritage.mo/cn/")
    print(f"    status={st} bytes={len(html)}")
    imgs = re.findall(r'(?:src|data-src|data-original|href)\s*=\s*["\']([^"\']+\.(?:jpg|jpeg|png|webp))["\']', html, re.I)
    print(f"    圖片連結 {len(imgs)} 個，樣本：")
    for i in sorted(set(imgs))[:25]:
        print("      ", i)
    ajax = re.findall(r'["\'](/ajax/[^"\']+)["\']', html)
    print(f"    ajax 端點 {len(set(ajax))} 個：", sorted(set(ajax))[:12])
    apis = re.findall(r'["\']([^"\']*\.(?:ashx|asmx|json|svc)[^"\']*)["\']', html, re.I)
    print(f"    疑似 API {len(set(apis))} 個：", sorted(set(apis))[:12])
    # 找「文物／建築」導覽連結
    links = re.findall(r'href\s*=\s*["\']([^"\']+)["\'][^>]*>([^<]{2,30})<', html)
    cand = [(h, t.strip()) for h, t in links if re.search(r"文物|建築|遺產|清單|名錄|monument|heritage|building", t, re.I)]
    print(f"    導覽連結 {len(cand)} 個：")
    for h, t in cand[:30]:
        print(f"      {t[:24]:24s} {h[:80]}")

    print("\n[3] robots.txt 全文")
    st, rb, _ = get("https://www.culturalheritage.mo/robots.txt")
    print(rb)

    print("\n[4] 找版權／使用條款連結")
    st, home, _ = get("https://www.culturalheritage.mo/cn/")
    terms = re.findall(r'href\s*=\s*["\']([^"\']+)["\'][^>]*>([^<]{2,30})<', home)
    for h, t in terms:
        if re.search(r"版權|著作|使用|條款|聲明|隱私|copyright|terms|privacy|disclaimer", t + h, re.I):
            print(f"      {t.strip()[:26]:26s} {h[:90]}")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ch-sitemap-locs.json").write_text(json.dumps(locs, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "ch-home.html").write_text(home, encoding="utf-8")
    print(f"\n→ {OUT/'ch-sitemap-locs.json'}、{OUT/'ch-home.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
