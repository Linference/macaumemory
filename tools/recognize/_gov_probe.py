"""調查澳門政府開放資料來源：授權條款、結構化程度、圖片可及性。

第一優先：culturalheritage.mo（文化局文化遺產資料庫）
第二：data.gov.mo（政府資料開放平台）
其餘：icm.gov.mo / macaumemory.mo / macaotourism.gov.mo / wh.mo

用法：python tools/recognize/_gov_probe.py
輸出：tools/recognize/out/gov-probe.json（原始探測結果，供回報引用）
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "recognize" / "out"


def fetch(url: str, timeout: int = 25, method: str = "GET") -> dict:
    t = time.time()
    try:
        req = urllib.request.Request(url, headers=UA, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return {"url": url, "status": r.status, "ctype": r.headers.get("Content-Type", ""),
                    "bytes": len(body), "secs": round(time.time() - t, 2),
                    "body": body.decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        body = b""
        try:
            body = e.read()
        except Exception:
            pass
        return {"url": url, "status": e.code, "ctype": e.headers.get("Content-Type", ""),
                "bytes": len(body), "secs": round(time.time() - t, 2),
                "body": body.decode("utf-8", "replace")}
    except Exception as e:
        return {"url": url, "status": 0, "ctype": type(e).__name__, "bytes": 0,
                "secs": round(time.time() - t, 2), "body": str(e)[:200]}


def summarize(r: dict, n: int = 200) -> str:
    body = re.sub(r"\s+", " ", r["body"])
    return f"{r['status']:>4} {r['ctype'][:26]:26s} {r['bytes']:>7}B {r['secs']:>5.1f}s  {body[:n]}"


PROBES: dict[str, list[str]] = {
    "culturalheritage.mo": [
        "https://www.culturalheritage.mo/",
        "https://www.culturalheritage.mo/cn/",
        "https://www.culturalheritage.mo/en/",
        "https://www.culturalheritage.mo/cn/detail/",
        "https://www.culturalheritage.mo/robots.txt",
        "https://www.culturalheritage.mo/sitemap.xml",
    ],
    "data.gov.mo": [
        "https://data.gov.mo/",
        "https://data.gov.mo/robots.txt",
        "https://data.gov.mo/api/",
        "https://data.gov.mo/list",
        "https://data.gov.mo/c/dataset",
    ],
    "icm.gov.mo": [
        "https://www.icm.gov.mo/",
        "https://www.icm.gov.mo/cn/",
        "https://www.icm.gov.mo/robots.txt",
    ],
    "macaumemory.mo": [
        "https://www.macaumemory.mo/",
        "https://www.macaumemory.mo/terms",
        "https://www.macaumemory.mo/copyright",
        "https://www.macaumemory.mo/about",
    ],
    "macaotourism.gov.mo": [
        "https://www.macaotourism.gov.mo/zh-hant/",
        "https://www.macaotourism.gov.mo/robots.txt",
    ],
    "wh.mo": [
        "https://www.wh.mo/",
        "https://www.wh.mo/cn/",
    ],
}


def main() -> int:
    results = {}
    for group, urls in PROBES.items():
        print("=" * 96)
        print(f"### {group}")
        results[group] = []
        for u in urls:
            r = fetch(u)
            results[group].append({k: v for k, v in r.items()})
            print(f"  {u[:66]:66s} {summarize(r, 120)}")
            time.sleep(0.6)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "gov-probe.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n→ {OUT / 'gov-probe.json'}")

    # 把抓到的頁面存檔，方便逐一檢視授權聲明
    raw = OUT / "gov-html"
    raw.mkdir(parents=True, exist_ok=True)
    for group, rows in results.items():
        for i, r in enumerate(rows):
            if r["bytes"] > 200 and "<" in r["body"][:200]:
                safe = re.sub(r"[^\w]+", "_", r["url"])[:80]
                (raw / f"{group}__{i}__{safe}.html").write_text(r["body"], encoding="utf-8")
    print(f"→ {raw}\\*.html（{len(list(raw.glob('*.html')))} 個頁面存檔）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
