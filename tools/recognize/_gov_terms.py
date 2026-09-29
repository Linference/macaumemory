"""逐來源查核：robots.txt（是否允許自動存取）＋ 使用條款／版權聲明（是否允許再利用）。

這是「來源 × 授權 × 可用性」對照表的證據來源。所有頁面原文都存到 out/gov-evidence/。
用法：python tools/recognize/_gov_terms.py
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}
ROOT = Path(__file__).resolve().parents[2]
EVID = ROOT / "tools" / "recognize" / "out" / "gov-evidence"

HOSTS = [
    "https://www.culturalheritage.mo",
    "https://www.icm.gov.mo",
    "https://www.macaumemory.mo",
    "https://www.macaotourism.gov.mo",
    "https://www.wh.mo",
    "https://data.gov.mo",
    "https://www.gov.mo",
    "https://www.macau.gov.mo",
    "https://webmap.gis.gov.mo",
]

TERM_PATHS = ["/robots.txt", "/terms", "/cn/terms", "/copyright", "/cn/copyright", "/disclaimer",
              "/cn/disclaimer", "/privacy", "/cn/privacy", "/about", "/cn/about",
              "/zh-hant/terms", "/zh-hant/privacy", "/zh-hant/disclaimer",
              "/open-data", "/opendata", "/opendata/terms", "/api", "/sitemap.xml"]

KEY = re.compile(r"著作權|版權|知識產權|智慧財產|授權|使用條款|使用條件|公開|再利用|重製|轉載|引用|"
                 r"copyright|licen[cs]e|terms of use|public domain|attribution|CC BY|creative commons",
                 re.I)


def get(url: str, timeout: int = 25):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            body = r.read()
            return r.status, body, r.headers.get("Content-Type", ""), round(time.time() - t, 1)
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, body, e.headers.get("Content-Type", ""), round(time.time() - t, 1)
    except Exception as e:
        return 0, str(e).encode(), type(e).__name__, round(time.time() - t, 1)


def text_of(raw: bytes) -> str:
    html = raw.decode("utf-8", "replace")
    html = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", " ", html, flags=re.S | re.I)
    html = re.sub(r"<[^>]+>", " ", html)
    import html as H
    return re.sub(r"\s+", " ", H.unescape(html)).strip()


def main() -> int:
    EVID.mkdir(parents=True, exist_ok=True)
    report = {}
    for host in HOSTS:
        print("=" * 96)
        print(f"### {host}")
        report[host] = {}
        for path in TERM_PATHS:
            url = host + path
            st, raw, ct, secs = get(url, timeout=20)
            if st == 0:
                continue
            txt = text_of(raw) if "html" in ct or path.endswith((".txt", ".xml")) else ""
            tag = "TEXT" if path == "/robots.txt" else ("XML" if path == "/sitemap.xml" else "HTML")
            print(f"  {path:22s} {st:>4} {len(raw):>8}B {secs:>5.1f}s {tag}", end="")
            if path == "/robots.txt" and st == 200:
                print("\n      " + raw.decode("utf-8", "replace").replace("\n", "\n      ")[:900])
                report[host]["robots"] = raw.decode("utf-8", "replace")
                (EVID / f"{re.sub(r'[^a-z0-9]+','_',host)}__robots.txt").write_text(
                    raw.decode("utf-8", "replace"), encoding="utf-8")
            elif path == "/sitemap.xml" and st == 200:
                locs = re.findall(r"<loc>\s*([^<\s]+)", raw.decode("utf-8", "replace"))
                print(f"  → {len(locs)} 個 URL")
                report[host]["sitemap_n"] = len(locs)
                report[host]["sitemap_sample"] = locs[:12]
            else:
                hits = sorted(set(KEY.findall(txt))) if txt else []
                print(f"  關鍵詞命中 {hits[:8]}")
                if hits:
                    # 抓出命中詞附近的一小段，人工判讀
                    snips = []
                    for m in KEY.finditer(txt):
                        a = max(0, m.start() - 130)
                        snips.append(txt[a:m.end() + 220])
                        if len(snips) >= 3:
                            break
                    for s in snips:
                        print(f"        …{s}…")
                    report[host][path] = {"status": st, "hits": hits, "snippets": snips}
                    safe = re.sub(r"[^a-z0-9]+", "_", host + path)
                    (EVID / f"{safe}.html").write_text(raw.decode("utf-8", "replace"), encoding="utf-8")
            time.sleep(0.4)
    (ROOT / "tools" / "recognize" / "out" / "gov-terms.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n→ out/gov-terms.json、out/gov-evidence/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
