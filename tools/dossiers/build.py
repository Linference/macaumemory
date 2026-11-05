"""合併所有景點資料檔案，校驗出處，輸出 public/data/building-dossiers.json 與審閱用總覽 docs/dossiers/review.md。
用法：python tools/dossiers/build.py
說明：本檔由 AI 程式助手（Claude）協助撰寫；內容須由作者覆核。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from churches import ACCESSED, DOSSIERS as CHURCHES, c  # noqa: E402
from others import NO_OFFICIAL, OTHERS, conflict, mg  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

# 旅遊局建議停留時間（分鐘），取自旅遊局網站資料 stayingTimeMin/Max，2026-11-04。
STAY = {"ruins-st-paul": (60, 180), "na-tcha-temple": (30, 60), "fortress-monte": (60, 180), "senado-square": (30, 60), "st-dominic": (15, 60),
        "leal-senado": (30, 60), "cathedral": (30, 60), "st-joseph-seminary": (30, 60), "mandarins-house": (60, 120), "lilau-square": (15, 30),
        "a-ma-temple": (60, 90), "moorish-barracks": (30, 60), "st-lawrence": (30, 60), "st-anthony": (30, 60), "camoes-garden": (60, 120),
        "tam-kung-temple": (15, 30), "st-francis-xavier": (15, 30), "carmel-church": (30, 60), "macau-museum-art": (60, 180),
        "grand-prix-museum": (30, 60), "handover-gifts": (60, 120), "macau-tower": (60, 180), "guia-fortress": (60, 120), "guia-cable-car": (60, 180),
        "macau-tower-note": (15, 30), "fisherman-wharf": (60, 120), "macau-science-center": (60, 180), "kun-iam-statue": (30, 60),
        "centro-cultural": (60, 120), "louvou-lim-ieoc": (60, 120), "tap-seac-square": (30, 60), "mgm-cotai": (30, 60), "mgm-macau": (30, 60),
        "coloane-peak": (60, 120), "seac-pai-van": (120, 240), "lai-chi-vun": (30, 60), "rua-do-cunha": (30, 45), "taipa-houses": (60, 180),
        "st-lazarus": (30, 60), "portas-do-cerco": (15, 30), "museum-poly-mgm": (30, 60), "museum-macau-museum": (60, 180), "st-paul-district": (15, 120)}

# 旅遊局資料對教堂檔案的補充，以及與文化局說法的矛盾
PATCH = {
    "st-francis-xavier": dict(src={"mg": mg("churches", "chapel-of-st-francis-xavier", "路環聖方濟各聖堂")},
        features=[c("教堂前有紀念碑，紀念 1910 年路環戰勝海盜一役。", "mg"),
                  c("銀色骨箱自 1978 年起存放於此，盛有聖方濟各手骸聖髑，現已送往聖若瑟修院收藏。", "mg")],
        conflicts=[conflict("建築風格", ("頗具葡式建築風格", "ch"), ("類似澳門一般教堂的巴洛克式", "mg")),
                   conflict("外牆顏色", ("奶黃色", "ch"), ("白色", "mg"))],
        drop_unverified=("1910", "巴洛克")),
    "carmel-church": dict(src={"mg": mg("churches", "our-lady-of-carmel-church", "嘉模聖母堂")},
        timeline=[c("1985 年重修。", "mg")]),
    "guia-fortress": dict(src={"mg": mg("macao-world-heritage", "guia-fortress-including-guia-chapel-and-lighthouse", "東望洋炮台")},
        conflicts=[conflict("燈塔年份", ("1865 年 9 月 24 日建成啟用", "wh"), ("建於 1864 年", "mg"))]),
    "st-joseph-seminary": dict(src={"gov": {"publisher": "澳門特區政府入口網站（文化局新聞）", "title": "聖若瑟修院藏珍館9月17日起停止對外開放", "url": "https://www.gov.mo/zh-hant/news/1171801/", "accessed": ACCESSED}},
        timeline=[c("2016 年 10 月 7 日：文化局與天主教澳門教區在修院內設「聖若瑟修院藏珍館」；2025 年 9 月 17 日起停止對外開放，展覽改為在教區歷史檔案及文物處網頁以虛擬實境瀏覽。", "gov")],
        features=[c("修院大樓不對外開放；聖堂仍可參觀。", "wh")]),
    "cathedral": dict(src={"mg": mg("macao-world-heritage", "cathedral-square", "大堂前地")},
        features=[c("大堂前地相傳是澳門首場彌撒的舉行地。", "mg")]),
}


def all_dossiers():
    out, others = [], {x["id"] for x in OTHERS}
    for dz in CHURCHES:
        if dz["id"] in others:  # 望德堂以 others.py 的區域版本為準
            continue
        dz = {**dz, "conflicts": list(dz.get("conflicts", [])), "oral": list(dz.get("oral", []))}
        p = PATCH.get(dz["id"])
        if p:
            dz["sources"] = {**dz["sources"], **p["src"]}
            dz["features"] = dz["features"] + p.get("features", [])
            dz["timeline"] = dz["timeline"] + p.get("timeline", [])
            dz["conflicts"] += p.get("conflicts", [])
            dz["unverified"] = [u for u in dz["unverified"] if not any(x in u for x in p.get("drop_unverified", ()))]
        out.append(dz)
    out += OTHERS
    for dz in out:
        if dz["id"] in STAY:
            dz["stay"] = {"min": STAY[dz["id"]][0], "max": STAY[dz["id"]][1], "source": "旅遊局建議停留時間"}
    return out


def validate(ds):
    for dz in ds:
        keys = set(dz["sources"])
        for cl in [dz["style"], *dz["timeline"], *dz["whyStyle"], *dz["features"], *dz["names"], *dz.get("oral", [])]:
            bad = set(cl["sources"]) - keys
            assert not bad, (dz["id"], cl["text"][:20], bad)
        for cf in dz.get("conflicts", []):
            for v in cf["values"]:
                assert v["source"] in keys, (dz["id"], cf["topic"])


def short(pubname):
    return pubname.replace("澳門特區政府", "")


def review_md(ds):
    def pub(dz, ks):
        return "、".join(dict.fromkeys(short(dz["sources"][k]["publisher"]) for k in ks))

    lines = ["# 途見景點資料總覽（待作者覆核）", "",
             f"查閱日期 {ACCESSED}。每句後的【】是出處；［推論］是依出處所作推論；⚠ 是官方資料互相矛盾之處。", "",
             f"共 {len(ds)} 個景點有官方出處；另 {len(NO_OFFICIAL)} 個景點在文化局、旅遊局找不到介紹頁，列在最後。", "",
             "## 官方資料互相矛盾的地方", "", "| 景點 | 項目 | 各出處說法 |", "|---|---|---|"]
    for dz in ds:
        for cf in dz.get("conflicts", []):
            lines.append(f"| {dz['name']} | {cf['topic']} | " + "；".join(f"{v['value']}（{pub(dz, [v['source']])}）" for v in cf["values"]) + " |")
    lines.append("")
    for dz in ds:
        lines += [f"## {dz['name']}", ""]
        meta = []
        if dz.get("heritage"):
            meta.append(f"文物編號：{dz['heritage']}")
        if dz.get("stay"):
            meta.append(f"旅遊局建議停留：{dz['stay']['min']}–{dz['stay']['max']} 分鐘")
        if meta:
            lines += ["　｜　".join(meta), ""]
        lines += [f"**建築風格**：{dz['style']['text']}【{pub(dz, dz['style']['sources'])}】", ""]
        for title, key in (("為什麼是這種風格", "whyStyle"), ("年表", "timeline"), ("特徵", "features"), ("名稱由來", "names"), ("口述歷史", "oral")):
            if dz.get(key):
                lines.append(f"**{title}**")
                lines += [f"- {'［推論］' if cl['kind'] == 'inference' else ''}{cl['text']}【{pub(dz, cl['sources'])}】" for cl in dz[key]]
                lines.append("")
        if dz.get("conflicts"):
            lines.append("**⚠ 出處矛盾**")
            lines += [f"- {cf['topic']}：" + "；".join(f"{v['value']}【{pub(dz, [v['source']])}】" for v in cf["values"]) for cf in dz["conflicts"]]
            lines.append("")
        if dz.get("unverified"):
            lines.append("**未核實（不可當作事實）**")
            lines += [f"- {u}" for u in dz["unverified"]]
            lines.append("")
        if dz.get("note"):
            lines += [f"> {dz['note']}", ""]
        lines += ["出處連結：" + "　".join(f"[{s['title']}]({s['url']})" for s in dz["sources"].values()), ""]
    lines += ["## 尚未找到官方介紹的景點", "", "、".join(NO_OFFICIAL.values()), "",
              "這些景點目前只保留網站原有簡介，尚未核實；需要從市政署、營運方或其他權威來源補充。", ""]
    return "\n".join(lines)


def main():
    ds = all_dossiers()
    validate(ds)
    data = {"version": 2, "accessed": ACCESSED,
            "note": "每條資料均附出處；kind=inference 為推論；conflicts 為官方資料互相矛盾之處；unverified 為未找到出處的常見說法。由 AI 程式助手協助整理，須作者覆核。",
            "noOfficialSource": NO_OFFICIAL, "dossiers": ds}
    (ROOT / "public/data/building-dossiers.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    out = ROOT / "docs/dossiers/review.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(review_md(ds), encoding="utf-8")
    n = sum(len(dz[k]) for dz in ds for k in ("timeline", "whyStyle", "features", "names", "oral")) + len(ds)
    print(f"{len(ds)} dossiers, {n} sourced claims, {sum(len(dz.get('conflicts', [])) for dz in ds)} conflicts")


if __name__ == "__main__":
    main()
