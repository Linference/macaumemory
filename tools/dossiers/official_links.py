"""整理各景點的官方資源連結（旅遊局介紹頁、文化局 VR 導覽、數字體驗、世界遺產網）及澳門記憶延伸閱讀，
輸出 public/data/official-links.json，供建築詳情面板「官方資源」區塊使用。

資料來源（2026-11-05 查閱）：
- 旅遊局各景點頁（含實時人流、語音介紹）及頁內的 VR／AR 連結
- 文化局世界遺產網、文化遺產網頁面中的 VR 導覽連結
- 澳門記憶（澳門公共圖書館）站內搜尋結果中的專題與詞條（tmp/sources/macaumemory-related.json）
說明：本檔由 AI 程式助手（Claude）協助撰寫。
用法：python tools/dossiers/official_links.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MG = "https://www.macaotourism.gov.mo/zh-hant/sightseeing/"

# 旅遊局景點頁（與資料檔案相同的對應）
MGTO = {"ruins-st-paul": "macao-world-heritage/ruins-of-st-pauls", "na-tcha-temple": "macao-world-heritage/na-tcha-temple", "fortress-monte": "macao-world-heritage/mount-fortress",
        "senado-square": "macao-world-heritage/senado-square", "st-dominic": "churches/st-dominics-church", "leal-senado": "macao-world-heritage/leal-senado-building",
        "cathedral": "macao-world-heritage/cathedral", "st-joseph-seminary": "macao-world-heritage/st-josephs-seminary-and-church", "mandarins-house": "macao-world-heritage/mandarins-house",
        "lilau-square": "macao-world-heritage/lilau-square", "a-ma-temple": "macao-world-heritage/a-ma-temple", "moorish-barracks": "macao-world-heritage/moorish-barracks",
        "st-lawrence": "churches/st-lawrences-church", "st-anthony": "churches/st-anthonys-church", "camoes-garden": "gardens/luis-de-camoes-park", "tam-kung-temple": "temples/tam-kong-temple",
        "st-francis-xavier": "churches/chapel-of-st-francis-xavier", "carmel-church": "churches/our-lady-of-carmel-church", "macau-museum-art": "museums-and-galleries/macao-museum-of-art",
        "grand-prix-museum": "museums-and-galleries/macao-grand-prix-museum", "handover-gifts": "museums-and-galleries/handover-gifts-museum-of-macao",
        "macau-tower": "other-attractions/macau-tower-convention-and-entertainment-centre", "guia-fortress": "macao-world-heritage/guia-fortress-including-guia-chapel-and-lighthouse",
        "guia-cable-car": "gardens/flora-park", "macau-tower-note": "other-attractions/lotus-square", "fisherman-wharf": "other-attractions/macau-fishermans-wharf",
        "macau-science-center": "museums-and-galleries/macao-science-center", "kun-iam-statue": "other-attractions/kun-iam-ecumenical-centre", "centro-cultural": "other-attractions/macao-cultural-centre",
        "louvou-lim-ieoc": "gardens/lou-lim-ioc-park", "tap-seac-square": "museums-and-galleries/tap-seac-gallery", "mgm-cotai": "other-attractions/the-spectacle-at-mgm-cotai",
        "mgm-macau": "other-attractions/the-grande-praca-at-mgm-macau", "coloane-peak": "gardens/coloane-height-park-and-statue-of-a-ma", "seac-pai-van": "gardens/seac-pai-van-park",
        "lai-chi-vun": "other-attractions/lai-chi-vun-shipyards", "rua-do-cunha": "other-attractions/rua-do-cunha", "taipa-houses": "museums-and-galleries/taipa-houses",
        "st-lazarus": "churches/st-lazarus-church", "portas-do-cerco": "other-attractions/border-gate-portas-do-cerco", "museum-poly-mgm": "museums-and-galleries/poly-mgm-museum",
        "museum-macau-museum": "museums-and-galleries/macao-museum", "st-paul-district": "other-attractions/travessa-da-paixao"}
# 旅遊局資料標有「客流狀況」（visitor-flow）的景點：其頁面顯示實時人流
CROWD = {"ruins-st-paul", "na-tcha-temple", "fortress-monte", "senado-square", "st-dominic", "leal-senado", "cathedral", "st-joseph-seminary", "mandarins-house",
         "lilau-square", "a-ma-temple", "moorish-barracks", "st-anthony", "camoes-garden", "tam-kung-temple", "st-francis-xavier", "carmel-church", "macau-museum-art",
         "grand-prix-museum", "handover-gifts", "macau-tower", "guia-fortress", "guia-cable-car", "macau-tower-note", "fisherman-wharf", "macau-science-center",
         "kun-iam-statue", "centro-cultural", "louvou-lim-ieoc", "tap-seac-square", "coloane-peak", "seac-pai-van", "rua-do-cunha", "taipa-houses", "st-lazarus",
         "museum-macau-museum", "st-paul-district"}
# 官方虛擬導覽與數字體驗（取自旅遊局、文化局頁面內的連結）
VR = {
    "ruins-st-paul": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/dashanbapaifang/"), ("「時空穿梭‧遊歷三巴」沉浸式數字體驗", "https://www.wh.mo/stpaulvr/")],
    "na-tcha-temple": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/nezhamiao/")],
    "fortress-monte": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/Fortress/")],
    "senado-square": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/square/")],
    "lilau-square": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/square/")],
    "leal-senado": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/IAM/")],
    "mandarins-house": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/mandarinhouse/"), ("鄭家大屋數字孿生", "https://www.mh-smartdt.com/"), ("鄭家大屋專題網頁", "https://www.wh.mo/mandarinhouse")],
    "a-ma-temple": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/aMaTemple/")],
    "moorish-barracks": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/marineAndWaterBureau/")],
    "guia-fortress": [("文化局 VR 導覽", "https://vr.icm.gov.mo/wh/guia/")],
    "macau-museum-art": [("藝博館虛擬展場", "https://vr.icm.gov.mo/dm/bmzh/")],
    "grand-prix-museum": [("旅遊局虛擬實境", "https://vrtours.macaotourism.gov.mo/index.html?m=1175_1")],
    "macau-science-center": [("科學館 720° 線上展廳", "https://720yun.com/t/c3vkcmreOpy?scene_id=69195540")],
    "taipa-houses": [("龍環葡韻虛擬實境", "https://vr.icm.gov.mo/dm/4Dtour/index.html?m=1014_1")],
    "museum-macau-museum": [("澳門博物館 VR/AR 應用（iOS）", "https://apps.apple.com/hk/app/macao-museum-vr-ar/id1332930326"), ("澳門博物館 VR/AR 應用（Android）", "https://play.google.com/store/apps/details?id=mo.gov.macaumuseum.vrApp")],
}


def main():
    dossiers = {d["id"]: d for d in json.loads((ROOT / "public/data/building-dossiers.json").read_text(encoding="utf-8"))["dossiers"]}
    raw = json.loads((Path(__file__).parent / "macaumemory_related.json").read_text(encoding="utf-8"))
    pre = {"s": "https://www.macaumemory.mo/specialtopic_", "e": "https://www.macaumemory.mo/entries_"}
    mm = {k: [{"t": t, "u": pre[ref[0]] + ref[2:], "a": a} for t, ref, a in v] for k, v in raw.items() if not k.startswith("_")}
    out = {}
    known = {a["id"] for a in json.loads((ROOT / "public/data/attractions.json").read_text(encoding="utf-8"))["attractions"]}
    ids = (set(MGTO) | set(VR) | set(mm) | set(dossiers)) & known  # 只為地圖上已有的景點產生
    for i in sorted(ids):
        d = dossiers.get(i)
        heritage = [{"title": s["title"], "url": s["url"], "publisher": s["publisher"]} for s in (d["sources"].values() if d else [])
                    if "wh.mo" in s["url"] or "culturalheritage" in s["url"]]
        entry = {
            "mgto": {"url": MG + MGTO[i], "crowd": i in CROWD} if i in MGTO else None,
            "stay": d.get("stay") if d else None,
            "vr": [{"title": t, "url": u} for t, u in VR.get(i, [])],
            "heritage": heritage[:3],
            "macauMemory": [{"title": x["t"], "url": x["u"], "author": x.get("a", "")} for x in mm.get(i, [])][:3],
        }
        if any([entry["mgto"], entry["vr"], entry["heritage"], entry["macauMemory"]]):
            out[i] = entry
    (ROOT / "public/data/official-links.json").write_text(json.dumps({"accessed": "2026-11-05", "note": "官方資源連結；實時人流與語音介紹在旅遊局頁面上。", "items": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(out), "sites;", sum(bool(v["vr"]) for v in out.values()), "with VR;", sum(bool(v["macauMemory"]) for v in out.values()), "with 澳門記憶")


if __name__ == "__main__":
    main()
