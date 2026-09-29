"""用 Python 內建的 sqlite3（獨立的 SQLite 實作）打開普查頁匯出的 .sqlite 檔。

為什麼要這支：browser-check-survey.mjs 只檢查下載檔的檔頭是不是 "SQLite format 3"，
那還不足以證明「別的裝置／工具打得開」。這裡用完全不同的執行環境（CPython 的 sqlite3）
把檔案打開、列出資料表、把資料讀出來、再跑一次 R-Tree 空間查詢，
用 JSON 印給測試腳本比對——這是「可攜」最直接的證據。

用法：python tools/recognize/check-exported-sqlite.py <檔案.sqlite> [lat] [lng] [半徑公尺]
"""
import json
import math
import sqlite3
import sys

# Windows 的 stdout 預設不是 UTF-8（被 pipe 時是 cp950），
# 中文字會變亂碼；這裡強制 UTF-8，讓呼叫端（Node 測試）拿到正確的 JSON。
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 - 舊版 Python 沒有 reconfigure
    pass


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法：check-exported-sqlite.py <檔案.sqlite> [lat] [lng] [radius_m]"}))
        return 2
    path = sys.argv[1]
    lat = float(sys.argv[2]) if len(sys.argv) > 2 else 22.197458
    lng = float(sys.argv[3]) if len(sys.argv) > 3 else 113.540839
    radius = float(sys.argv[4]) if len(sys.argv) > 4 else 50.0

    # 唯讀開啟（uri=True），確保我們不會動到匯出檔
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    out = {"sqlite_version": sqlite3.sqlite_version, "tables": [], "rtree": None}
    out["tables"] = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")]

    # R-Tree 查詢：與前端同一段 SQL（粗篩），再用 haversine 精算距離
    d_lat = (radius + 2) / 111320.0
    d_lng = (radius + 2) / (111320.0 * math.cos(math.radians(lat)))
    rows = cur.execute(
        """
        SELECT b.code, b.name, b.type, b.lat, b.lng, b.accuracy_m, b.geo_source, b.sample_count
          FROM buildings_rtree r JOIN buildings b ON b.id = r.id
         WHERE r.minlat <= ? AND r.maxlat >= ? AND r.minlng <= ? AND r.maxlng >= ?
        """,
        (lat + d_lat, lat - d_lat, lng + d_lng, lng - d_lng),
    ).fetchall()

    def haversine(lat1, lng1, lat2, lng2):
        r = 6371008.8
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lng2 - lng1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * r * math.asin(min(1.0, math.sqrt(a)))

    hits = []
    for r in rows:
        if r["lat"] is None:
            continue
        d = haversine(lat, lng, r["lat"], r["lng"])
        if d <= radius:
            hits.append({"code": r["code"], "name": r["name"], "distance_m": round(d, 2), "type": r["type"]})
    hits.sort(key=lambda x: x["distance_m"])

    out["rtree"] = {
        "radius_m": radius,
        "center": [lat, lng],
        "coarse_candidates": len(rows),
        "hits": hits,
    }
    out["buildings"] = [dict(r) for r in cur.execute(
        "SELECT code, name, type, lat, lng, accuracy_m, sample_count, geo_source, status, created_at "
        "FROM buildings ORDER BY code")]
    out["count"] = len(out["buildings"])
    con.close()
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
