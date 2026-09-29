// 驗證 GPS 這條線的「數學」與「流程」：精度加權、離散、來源判定、停止條件、失敗訊息。
//
// 為什麼不能只靠瀏覽器那支：browser-check-survey.mjs 用 CDP 模擬定位，只能造出
// 「每次讀數都一樣」的理想情境，看不出加權到底有沒有作用。這裡用 Node 直接餵
// 一組組不同的讀數給同一份模組（src/recognize/geo-math.js、geolocate.js），
// 把加權、離散、保守精度估計、停止條件與錯誤訊息全部驗過。
//
// 用法：node tools/recognize/check-survey-geo.mjs
import {
  summarizeSamples, weightedCentroid, spreadM, haversineM, bboxForRadius,
  circlePolygon, classifyGeoSource, geoSourceZh,
} from "../../src/recognize/geo-math.js";
import { createGeoSession, GEO_PLANS, GEO_LIMITS, describeGeoError, geoWarnings, GEO_STOP_ZH } from "../../src/recognize/geolocate.js";

const log = (...a) => console.log(...a);
const problems = [];
function ok(cond, msg, extra = "") {
  log(`  ${cond ? "✓" : "✗"} ${msg}${extra ? `　→ ${extra}` : ""}`);
  if (!cond) problems.push(msg);
}
const A = { lat: 22.197458, lng: 113.540839 };
const R = 6371008.8;
/** 以 A 為中心、往北北東移動 (northM, eastM) 公尺的座標 */
const at = (northM, eastM = 0) => ({
  lat: A.lat + northM / 111320,
  lng: A.lng + eastM / (111320 * Math.cos((A.lat * Math.PI) / 180)),
});
const sample = (northM, eastM, accuracyM) => ({ ...at(northM, eastM), accuracyM, at: new Date().toISOString() });

log("① 距離與查詢框（R-Tree 用的邊界框）");
ok(Math.abs(haversineM(A.lat, A.lng, at(100).lat, at(100).lng) - 100) < 0.5, "haversine：往北 100 公尺 ≈ 100 公尺");
ok(Math.abs(haversineM(A.lat, A.lng, at(0, 100).lat, at(0, 100).lng) - 100) < 0.5, "haversine：往東 100 公尺 ≈ 100 公尺");
const box = bboxForRadius(A.lat, A.lng, 50);
ok(box.minLat < A.lat && box.maxLat > A.lat && box.minLng < A.lng && box.maxLng > A.lng, "50 公尺的邊界框涵蓋中心");
ok(haversineM(box.maxLat, A.lng, A.lat, A.lng) >= 50, `邊界框有留安全邊際（北緣 ${haversineM(box.maxLat, A.lng, A.lat, A.lng).toFixed(1)} 公尺 > 50）`);
ok(circlePolygon(A.lat, A.lng, 30).length === 49, "精度圈多邊形有 49 個點（48 段 + 閉合）");
const ring = circlePolygon(A.lat, A.lng, 30);
const ringErr = Math.max(...ring.map(([lng, lat]) => Math.abs(haversineM(A.lat, A.lng, lat, lng) - 30)));
ok(ringErr < 0.5, `精度圈每個點都在 30 公尺上（最大誤差 ${ringErr.toFixed(2)} 公尺）`);

log("\n② 精度加權：精度好的讀數權重更大");
const w = weightedCentroid([sample(0, 0, 5), sample(100, 0, 50)]);
const dFromGood = haversineM(w.lat, w.lng, A.lat, A.lng);
const equal = { lat: (A.lat + at(100).lat) / 2, lng: A.lng };
log(`  5 公尺讀數（原點）＋ 50 公尺讀數（北 100 公尺）→ 加權中心離原點 ${dFromGood.toFixed(2)} 公尺（等權平均會是 50 公尺）`);
// 權重 1/5² = 0.04 與 1/50² = 0.0004 → 差 100 倍，壞讀數幾乎拉不動結果
ok(Math.abs(dFromGood - 0.99) < 0.05, `加權中心幾乎不動（${dFromGood.toFixed(2)} 公尺；權重差 100 倍）`);
ok(dFromGood < haversineM(equal.lat, equal.lng, A.lat, A.lng),
  `加權中心比等權平均更靠近高精度讀數（${dFromGood.toFixed(2)} vs ${haversineM(equal.lat, equal.lng, A.lat, A.lng).toFixed(2)} 公尺）`);
const w3 = weightedCentroid([sample(0, 0, 10), sample(50, 0, 10), sample(100, 0, 10)]);
ok(Math.abs(haversineM(w3.lat, w3.lng, A.lat, A.lng) - 50) < 1, `三個等精度讀數 → 加權中心在正中間（${haversineM(w3.lat, w3.lng, A.lat, A.lng).toFixed(1)} 公尺）`);

log("\n③ 樣本離散＝讀數跳動程度");
ok(spreadM([sample(0, 0, 10), sample(0, 0, 10)]).rmsM === 0, "兩個完全相同的讀數 → 離散 0");
const sp = spreadM([sample(0, 0, 10), sample(200, 0, 10)]);
ok(Math.abs(sp.rmsM - 100) < 1, `兩個相距 200 公尺的讀數 → 離散 ${sp.rmsM.toFixed(1)} 公尺（約等於各離中心 100 公尺）`);

log("\n④ 最終精度估計：保守，不會假裝很準");
const same8 = summarizeSamples([sample(0, 0, 8), sample(0, 0, 8), sample(0, 0, 8)]);
log(`  3 次都 ±8 公尺 → 最終精度 ±${same8.accuracyM} 公尺（最佳 ±${same8.bestAccuracyM}）`);
ok(same8.accuracyM === 8, "讀數完全一致時，最終精度＝最佳單次精度（不除以 √n 假裝更準）");
const same8x20 = summarizeSamples(Array.from({ length: 20 }, () => sample(0, 0, 8)));
ok(same8x20.accuracyM === 8, "20 次一致的 ±8 公尺也是 ±8 公尺（誤差是相關的，平均不會變準）");
const noisy = summarizeSamples([sample(0, 0, 30), sample(12, 0, 30), sample(-12, 0, 30), sample(4, 0, 30)]);
log(`  4 次 ±30 公尺但彼此差 12 公尺 → 最終精度 ±${noisy.accuracyM} 公尺（離散 ±${noisy.spreadM}）`);
ok(noisy.accuracyM < 30 && noisy.accuracyM >= 15, `有隨機成分時允許改善，但最多好 2 倍（實得 ${noisy.accuracyM}）`);
ok(noisy.improved === true, "improved 旗標＝true（有實際改善）");
const poor8 = summarizeSamples(Array.from({ length: 8 }, () => sample(0, 0, 120)));
ok(poor8.accuracyM === 120, `筆電沒有 GPS 晶片的情境：8 次都 ±120 公尺 → 誠實回報 ±${poor8.accuracyM} 公尺`);

log("\n⑤ 來源判定（瀏覽器沒有提供 provider，只能用精度＋高度回推）");
ok(classifyGeoSource({ bestAccuracyM: 8, spreadM: 0, hasAltitude: true }) === "gps", "±8 公尺＋有高度 → gps");
ok(classifyGeoSource({ bestAccuracyM: 12, spreadM: 0, hasAltitude: false }) === "gps", "±12 公尺＋讀數穩定 → gps");
ok(classifyGeoSource({ bestAccuracyM: 120, spreadM: 0 }) === "wifi", "±120 公尺 → wifi");
ok(classifyGeoSource({ bestAccuracyM: 25, spreadM: 60 }) === "wifi", "±25 公尺但讀數跳動 60 公尺 → wifi（不硬掰成 GPS）");
ok(geoSourceZh("manual") === "手動標記" && geoSourceZh("wifi") === "WiFi／基地台", "來源中文對照正確");

log("\n⑥ 失敗訊息（每一種都要有可讀中文 ＋ 補救方式）");
for (const [err, key, must] of [
  [{ code: 1 }, "denied", "你拒絕了定位授權"],
  [{ code: 2 }, "unavailable", "目前拿不到定位訊號"],
  [{ code: 3 }, "timeout", "定位逾時"],
]) {
  const d = describeGeoError(err);
  ok(d.code === key && d.zh.includes(must) && d.hint.length > 10, `${key}：${d.zh}`);
}
const unsupported = describeGeoError(null, { supported: false });
ok(unsupported.code === "unsupported" && unsupported.hint.includes("手動"), `不支援定位：${unsupported.zh}`);
const insecure = describeGeoError(null, { secureContext: false });
ok(insecure.code === "insecure" && insecure.zh.includes("HTTPS"), `非安全來源：${insecure.zh}`);

log("\n⑦ 取樣流程（用假的 geolocation 驅動，驗停止條件與精度差警語）");
/** 假瀏覽器：依照腳本逐次回傳座標／錯誤 */
function fakeGeo(script) {
  let i = 0;
  return {
    calls: 0,
    getCurrentPosition(ok_, err_) {
      this.calls++;
      const step = script[Math.min(i++, script.length - 1)];
      setTimeout(() => {
        if (step.error) err_(step.error);
        else ok_({ coords: { latitude: step.lat, longitude: step.lng, accuracy: step.accuracyM, altitude: step.altitude ?? null }, timestamp: Date.now() });
      }, 0);
    },
  };
}
const runSession = (script, plan, extra = {}) => new Promise((resolve) => {
  const geo = fakeGeo(script);
  const events = [];
  const s = createGeoSession({
    plan, geolocation: geo, secureContext: true,
    onSample: (sm, live, n) => events.push({ type: "sample", n, acc: live.accuracyM, spread: live.spreadM }),
    onStatus: (t, err) => events.push({ type: "status", t, err: !!err }),
    onEnd: (r) => resolve({ result: r, events, calls: geo.calls }),
    ...extra,
  });
  s.start();
});

// ⑦-1 達到目標精度就停（精度好＋讀數穩）
{
  const { result, events } = await runSession([{ ...at(0), accuracyM: 6 }], { ...GEO_PLANS.quick, targetAccuracyM: 15, maxSamples: 8, intervalMs: 5 });
  log(`  目標精度情境：樣本 ${result.sampleCount} 次 · ${result.reasonZh} · ±${result.accuracyM} 公尺`);
  ok(result.reason === "target", `精度好＋讀數穩 → 提前停止（${result.reasonZh}）`);
  ok(result.sampleCount === 3, `停在最少樣本數 3（實得 ${result.sampleCount}）`);
  ok(events.some((e) => e.type === "sample" && e.n === 1), "第一次取樣就有即時回報（onSample）");
}
// ⑦-2 精度一直很差 → 跑滿上限並給「筆電沒有 GPS」警語
{
  const { result } = await runSession([{ ...at(0), accuracyM: 85 }], { ...GEO_PLANS.quick, intervalMs: 5, targetAccuracyM: 5 });
  const warn = result.warnings.find((w) => w.key === "poor-accuracy");
  log(`  精度差情境：樣本 ${result.sampleCount} 次 · ±${result.accuracyM} 公尺 · ${result.reasonZh}`);
  ok(result.reason === "max-samples", "達不到目標精度 → 取滿設定的樣本數才停");
  ok(result.sampleCount === 8, `取滿 8 次（實得 ${result.sampleCount}）`);
  ok(!!warn && warn.level === "warn", `產生 lv-warn 等級的警語：${warn?.zh}`);
  ok(/精度一直很差/.test(warn.zh), "警語本體說明「精度一直很差」");
  ok(/GPS 晶片/.test(warn.hint) && /手機/.test(warn.hint) && /手動/.test(warn.hint), `補救建議含「沒有 GPS 晶片／用手機／手動標記」：${warn.hint.slice(0, 46)}…`);
}
// ⑦-3 讀數跳動過大 → 不得宣布「達到目標精度」
{
  const script = [{ ...at(0), accuracyM: 10 }, { ...at(220), accuracyM: 10 }];
  const { result } = await runSession(script, { ...GEO_PLANS.quick, intervalMs: 5, targetAccuracyM: 15 });
  const jump = result.warnings.find((w) => w.key === "spread");
  log(`  跳動情境：樣本 ${result.sampleCount} 次 · 離散 ±${result.spreadM} 公尺 · ${result.reasonZh}`);
  ok(result.reason !== "target", `讀數跳動時不會宣布達到目標精度（實際：${result.reasonZh}）`);
  ok(!!jump && /跳動過大/.test(jump.zh), `產生跳動警語：${jump?.zh}`);
  ok(!result.warnings.some((w) => w.key === "target"), "同時不會出現「已達目標精度」的矛盾訊息");
}
// ⑦-4 使用者按「完成」
{
  const geo = fakeGeo([{ ...at(0), accuracyM: 40 }]);
  const done = new Promise((resolve) => {
    const s = createGeoSession({ plan: { ...GEO_PLANS.quick, intervalMs: 30 }, geolocation: geo, onEnd: resolve });
    s.start();
    setTimeout(() => s.stop(), 60);
  });
  const result = await done;
  log(`  手動停止：樣本 ${result.sampleCount} 次 · ${result.reasonZh}`);
  ok(result.reason === "manual", `使用者按「完成取樣」→ 立即以目前結果結束（${result.reasonZh}）`);
}
// ⑦-5 權限被拒絕 → 立刻結束（不重試）
{
  const geo = fakeGeo([{ error: { code: 1, message: "User denied Geolocation" } }]);
  const result = await new Promise((resolve) => {
    const s = createGeoSession({ plan: { ...GEO_PLANS.quick, intervalMs: 5 }, geolocation: geo, onEnd: resolve });
    s.start();
  });
  log(`  拒絕授權：呼叫 ${geo.calls} 次 · ${result.error?.zh} · ${result.reasonZh}`);
  ok(geo.calls === 1, `權限被拒絕只試一次（重試沒意義）——實得 ${geo.calls} 次`);
  ok(result.error?.code === "denied" && result.reason === "error", "結束原因記為 denied / error");
  ok(result.lat === null && result.sampleCount === 0, "沒有樣本時 lat=null、sampleCount=0（呼叫端據此記為 unavailable）");
}
// ⑦-6 不支援定位
{
  const result = await new Promise((resolve) => {
    const s = createGeoSession({ geolocation: null, onEnd: resolve });
    s.start();
  });
  ok(result.reason === "unsupported" && result.error?.code === "unsupported", `瀏覽器不支援 → ${result.error?.zh}`);
}
// ⑦-7 非安全來源
{
  const result = await new Promise((resolve) => {
    const s = createGeoSession({ geolocation: fakeGeo([{ ...at(0), accuracyM: 5 }]), secureContext: false, onEnd: resolve });
    s.start();
  });
  ok(result.reason === "insecure", `非 HTTPS／localhost → ${result.error?.zh}`);
}

log("\n⑧ 停止原因的中文對照完整");
ok(Object.keys(GEO_STOP_ZH).length >= 7 && GEO_STOP_ZH.target === "達到目標精度", `共 ${Object.keys(GEO_STOP_ZH).length} 種：${Object.values(GEO_STOP_ZH).join("、")}`);
ok(GEO_LIMITS.poorAccuracyM === 30 && GEO_LIMITS.spreadWarnM === 50, `門檻：精度差 ${GEO_LIMITS.poorAccuracyM} 公尺、跳動 ${GEO_LIMITS.spreadWarnM} 公尺`);

log(`\n=== 摘要 ===`);
log(problems.length ? `發現 ${problems.length} 個問題：\n  ${problems.join("\n  ")}` : "GPS 取樣、精度加權、失敗訊息全部通過");
if (problems.length) process.exitCode = 1;
