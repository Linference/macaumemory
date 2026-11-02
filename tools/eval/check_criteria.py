"""對照設計指標：讀 tools/eval/criteria.json，用最新結果逐項判定是否達標。

結果來源（存在才讀）：
  tools/recognize/out/independent/report.json   實地 test 組（C1–C5）
  tools/eval/out/latency.json                    手機耗時（C6，{"median_s": …}）
目標值（target）未填寫的指標只列出基準，不判定。
說明：本腳本由 AI 程式助手（Claude）協助撰寫。
用法：python tools/eval/check_criteria.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.stdout.reconfigure(encoding="utf-8")
crit = json.loads((ROOT / "tools/eval/criteria.json").read_text(encoding="utf-8"))


def load(p):
    f = ROOT / p
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


field = load("tools/recognize/out/independent/report.json")
lat = load("tools/eval/out/latency.json")
measured = {}
if field:
    # independent-eval.mjs 的 report.visual：每項為 {successes, total, value, interval95}（純影像口徑）
    s = field.get("visual", {})
    val = lambda k: (s.get(k) or {}).get("value")
    for cid, key in (("C1", "top1"), ("C2", "top3"), ("C3", "confidentPrecision"), ("C5", "unknownFalseAcceptance")):
        if isinstance(val(key), (int, float)):
            measured[cid] = val(key) * 100
    if isinstance(val("reviewRate"), (int, float)):
        measured["C4"] = (1 - val("reviewRate")) * 100     # 高信心覆蓋率 = 1 − 需人工確認比例（含庫外照片）
if lat and isinstance(lat.get("median_s"), (int, float)):
    measured["C6"] = lat["median_s"]

print(f"指標凍結日期：{crit.get('frozen_on') or '尚未凍結（實地測試前請填寫 target 與 frozen_on）'}\n")
print(f"{'代號':<4}{'指標':<16}{'目標':>10}{'實地實測':>10}{'基準':>10}  判定")
for c in crit["criteria"]:
    t, m, b = c["target"], measured.get(c["id"]), c["baseline"]["value"]
    ok = "—" if t is None or m is None else ("達標" if (m >= t if c["direction"] == ">=" else m <= t) else "未達標")
    ts = f"{c['direction']}{t}" if t is not None else "未填"
    ms = f"{m:.2f}" if m is not None else "未測"
    print(f"{c['id']:<4}{c['name']:<16}{ts:>10}{ms:>10}{b:>10}  {ok}　（基準口徑：{c['baseline']['scope']}）")
print()
for k in crit["constraints"]:
    print(f"{k['id']}  {k['name']}：{k['status'] or '未檢查'}　— {k['check']}")
