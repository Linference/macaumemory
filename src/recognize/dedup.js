// 澳門記憶 · 建築辨識：查重（這棟建築記錄過了嗎？）
//
// 定位說明：辨識頁的主結果是「這是一棟什麼類型的建築」（標註），
// 「這是哪一棟」只是查重的手段。這個檔案把「相似度 → 查重結論」的規則集中在一處，
// 讓 UI、測試、Node 腳本用同一套判斷，不會各寫一份。
//
// 門檻來源：public/data/memory-embeddings.json 的 eval.suggested（由留一法實測建議）
//   hit   0.82 → 與已記錄建築高度相似
//   maybe 0.57 → 落在「不同棟也可能出現」的區間，需要人工確認（隨庫版本變動）
// 讀不到 eval.suggested 時退回 labels.js 的 SIM_THRESHOLDS，不讓 UI 壞掉。

import { SIM_THRESHOLDS } from "./labels.js";
import { verdict } from "./compare.js";

/** 查重門檻（優先序：庫的 eval.suggested → labels.js 的實測門檻） */
export function dedupThresholds(meta = null) {
  const s = meta?.eval?.suggested ?? null;
  const hit = Number(s?.hit);
  const maybe = Number(s?.maybe);
  if (Number.isFinite(hit) && Number.isFinite(maybe) && hit > maybe && maybe >= 0) return { hit, maybe, low: Math.min(SIM_THRESHOLDS.low, maybe), source: "eval.suggested" };
  return { ...SIM_THRESHOLDS, source: "labels.SIM_THRESHOLDS" };
}

const round3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;

/**
 * 用既有的 verdict()（compare.js）判斷，再翻譯成「查重」的語意。
 * 不另寫一套判斷邏輯——門檻與分數區間都由 verdict 決定，這裡只換說法。
 *
 * @param {Array} top   rankTop() 的 Top-K（每筆有 sim / zh / clsZh）
 * @param {number} margin 第一名與第二名的差距
 * @param {{hit:number, maybe:number}} th 查重門檻
 */
export function dedupVerdict(top, margin, th) {
  const list = top ?? [];
  const best = list[0] ?? null;
  const v = verdict(list, margin, th);
  const sim = best ? round3(best.sim) : null;
  const name = best ? (best.zh ?? best.id ?? "（未命名）") : null;

  if (v.key === "confident" && sim != null && sim >= th.hit) {
    return {
      key: "known", verdictKey: v.key, zh: v.zh, detail: v.detail,
      recorded: true, sim, name,
      title: "已記錄：這棟在記憶庫裡",
      text: `很可能已記錄：這棟與「${name}」高度相似（${sim.toFixed(3)}）`,
      hint: "影像與既有紀錄高度相似，請核對建築名稱與位置；相似度不是正確機率。",
    };
  }
  if ((v.key === "likely" || v.key === "weak") && sim != null && sim >= th.maybe) {
    return {
      key: "maybe", verdictKey: v.key, zh: v.zh, detail: v.detail,
      recorded: false, sim, name,
      title: "尚不確定：需要人工確認",
      text: `需要確認：與「${name}」相似度 ${sim.toFixed(3)}；${v.detail}`,
      hint: "查重結果：分數不足以斷定，先確認是不是既有紀錄，再決定要不要入庫。",
    };
  }
  return {
    key: "unknown", verdictKey: v.key, zh: v.zh, detail: v.detail,
    recorded: false, sim, name,
    title: "未找到可靠匹配：可能是新發現",
    text: sim == null
      ? `目前沒有可比的已記錄建築（門檻 ${th.maybe}）`
      : `未找到可靠匹配：最高相似度 ${sim.toFixed(3)}（門檻 ${th.maybe}），也可能受視角、遮擋或光線影響`,
    hint: "低相似度無法證明尚未建檔。請核對候選與附近檔案，再決定是否建立新紀錄。",
  };
}
