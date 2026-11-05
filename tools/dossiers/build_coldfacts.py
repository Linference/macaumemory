"""把逐條核對後的冷知識寫入知識庫：public/data/cold-facts.json，並產出審閱報告 docs/dossiers/coldfacts-review.md。

規則
- verified：整則收錄（用查核員依原文改寫的繁體版本）。
- partly：只收錄原文支持的部分；被刪掉的說法逐條記錄在 removed，供作者覆核。
- contradicted / unverifiable：不收錄，只寫進報告。
- 每則附原始網頁連結；文字為依原文的摘要改寫，須由作者覆核。
說明：本檔由 AI 程式助手（Claude）協助撰寫。
用法：python tools/dossiers/build_coldfacts.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tmp/sources/coldfacts-verify.json"

# 資料集條目 → 網站景點（沒有對應景點的留空，之後新增地點時再掛上）
PLACE = {1: "st-joseph-seminary", 8: "st-joseph-seminary", 2: "st-lawrence", 4: "st-anthony", 44: "st-anthony", 6: "mandarins-house",
         7: "moorish-barracks", 9: "fortress-monte", 10: "fortress-monte", 11: "ruins-st-paul", 43: "ruins-st-paul", 19: "red-market",
         20: "senado-square", 21: "senado-square", 23: "st-paul-district", 24: "st-paul-district", 25: "st-paul-district",
         32: "lilau-square", 33: "lilau-square", 40: "guia-fortress", 41: "guia-fortress", 42: "guia-fortress",
         46: "st-paul-district", 47: "st-paul-district", 48: "lai-chi-vun", 49: "lai-chi-vun", 50: "lai-chi-vun", 54: "lai-chi-vun"}
# 尚未建檔、但資料集提到的地點（未來新增）
TOPIC = {3: "聖奧斯定堂", 5: "崗頂劇院", 12: "崗頂前地", 13: "新馬路", 14: "新馬路", 15: "福隆新街", 16: "福隆新街", 17: "福隆新街", 18: "福隆新街",
         22: "紅窗門街", 58: "紅窗門街", 26: "營地大街", 27: "十月初五街", 59: "美麗街", 28: "澳門水史", 29: "澳門水史", 30: "澳門水史", 31: "澳門水史",
         34: "益隆炮竹廠", 35: "益隆炮竹廠", 36: "益隆炮竹廠", 37: "路環碼頭", 38: "路環平民村", 39: "氹仔菜園路", 45: "盧家大屋",
         51: "氹仔漁民", 52: "氹仔三家村", 53: "氹仔周家村", 55: "福隆新街", 56: "福隆新街", 57: "福隆新街"}
PUBLISHER = lambda u: ("文化局（澳門世界遺產網）" if "wh.mo" in u else "文化局（澳門文化遺產網）" if "culturalheritage" in u else "文化局（公開諮詢文本）" if "edocs.icm" in u
                       else "澳門記憶（澳門公共圖書館）" if "macaumemory" in u else "新聞局《澳門雜誌》" if "macauzine" in u else "澳門大學" if "um.edu.mo" in u
                       else "經濟及科技發展局" if "dsedt" in u else u)


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    rows = [data[k] for k in sorted(data, key=int)]
    kept, report = [], []
    for r in rows:
        claims = r.get("claims", [])
        removed = [c["claim"] for c in claims if c["status"] != "supported"]
        contradicted = [c for c in claims if c["status"] == "contradicted"]
        ok = r["verdict"] in ("verified", "partly") and r.get("corrected")
        entry = {"id": f"cold-{r['n']:02d}", "n": r["n"], "title": r["title"], "text": r.get("corrected", ""), "status": r["verdict"],
                 "placeId": PLACE.get(r["n"]), "topic": TOPIC.get(r["n"]), "sources": [{"publisher": PUBLISHER(u), "url": u} for u in r["urls"]],
                 "evidence": [c["evidence"] for c in claims if c["status"] == "supported" and c.get("evidence")][:4],
                 "removed": removed, "contradicted": [{"claim": c["claim"], "source": c.get("evidence", "")} for c in contradicted],
                 "accessed": "2026-11-04", "note": "依原文改寫，須由作者覆核"}
        if ok:
            kept.append(entry)
        report.append((r, entry, ok))
    (ROOT / "public/data/cold-facts.json").write_text(json.dumps({"version": 1, "from": "《澳門本地冷知識與特殊記憶資料集》逐條核對", "items": kept}, ensure_ascii=False, indent=1), encoding="utf-8")

    n = len(rows); ver = sum(r["verdict"] == "verified" for r in rows); part = sum(r["verdict"] == "partly" for r in rows)
    bad = [r for r in rows if r["verdict"] not in ("verified", "partly")]
    contra = [(r, e) for r, e, _ in report if e["contradicted"]]
    L = ["# 《澳門本地冷知識與特殊記憶資料集》逐條核對報告", "",
         f"共 {n} 則。逐則抓取原始網頁，由查核模型把每個具體說法與原文對照，並抽查部分結果。", "",
         f"- **完全有原文支持**：{ver} 則", f"- **部分有原文支持**：{part} 則（只收錄有支持的部分）", f"- **找不到原文支持**：{len(bad)} 則（不收錄）",
         f"- **與原文矛盾的說法**：{sum(len(e['contradicted']) for _, e in contra)} 處，分佈在 {len(contra)} 則", "",
         "## 與原文矛盾的說法（資料集寫錯的地方）", "", "| # | 資料集寫的 | 原文 |", "|---|---|---|"]
    for r, e in contra:
        for c in e["contradicted"]:
            L.append(f"| {r['n']} | {c['claim']} | {c['source']} |")
    L += ["", "## 找不到原文支持、不收錄的", ""]
    L += [f"- #{r['n']} {r['title']}：{r.get('note', '')}" for r in bad]
    L += ["", "## 逐則結果", ""]
    for r, e, ok in report:
        tag = {"verified": "✅ 完全支持", "partly": "🟡 部分支持", "unverifiable": "❌ 找不到", "contradicted": "❌ 矛盾"}.get(r["verdict"], r["verdict"])
        L += [f"### {r['n']:02d}　{r['title']}　{tag}", "", f"**收錄文字**：{e['text'] or '（不收錄）'}", ""]
        if e["removed"]:
            L += ["**刪去（原文沒有或不符）**："] + [f"- {x}" for x in e["removed"]] + [""]
        L += ["出處：" + "　".join(f"[{s['publisher']}]({s['url']})" for s in e["sources"]), ""]
    out = ROOT / "docs/dossiers/coldfacts-review.md"; out.write_text("\n".join(L), encoding="utf-8")
    print(f"kept {len(kept)}/{n}; verified {ver}, partly {part}, dropped {len(bad)}; contradictions {sum(len(e['contradicted']) for _, e in contra)}")


if __name__ == "__main__":
    main()
