// 澳門記憶 · 建築普查：GPS 精準定位（多次取樣 ＋ 精度加權）
//
// 為什麼不能只用一次 getCurrentPosition：
//   展示機器是筆電，筆電幾乎都沒有 GPS 晶片，navigator.geolocation 會退回
//   WiFi／基地台定位，單次讀數的 accuracy 可能是 20~100 公尺、甚至定到別的區。
//   單次讀數沒有辦法判斷「這次準不準」，所以這裡改成：
//
//   按「取得定位」
//     ↓  enableHighAccuracy: true、timeout 放寬、maximumAge: 0（強制新的讀數）
//   連續取樣（預設每 1 秒 1 次，最多 30 次）＋ 即時回報每一次讀數
//     ↓  停止條件（任一）：達到目標精度 ≤5 公尺 / 取滿 30 次 / 使用者按「完成」/ 連續失敗
//   以 1/accuracy² 加權平均算出最終座標，並保留：樣本數、最佳精度、最終精度、離散程度
//
//   失敗與品質不佳的每一種情況都有可讀的中文訊息與補救建議（見 geoWarnings）。
//
// 這個檔案不碰 DOM：UI 由 survey.js 負責，這裡只回呼事件。所以同一份邏輯可以用
// 假造的 geolocation 物件在 Node／測試裡跑。

import { summarizeSamples, geoSourceZh } from "./geo-math.js";

/**
 * 取樣計畫（普查現場用得到的三種情境）。
 * 平板／手機在戶外可以選「精確」；只是想先記錄位置就選「快速」。
 */
export const GEO_PLANS = {
  standard: {
    id: "standard", zh: "標準",
    maxSamples: 30, intervalMs: 1000, targetAccuracyM: 5,
    text: "30 次 × 1 秒 · 目標 ≤5 公尺",
  },
  quick: {
    id: "quick", zh: "快速",
    maxSamples: 8, intervalMs: 250, targetAccuracyM: 15,
    text: "8 次 × 0.25 秒 · 目標 ≤15 公尺",
  },
  precise: {
    id: "precise", zh: "精確",
    maxSamples: 40, intervalMs: 1000, targetAccuracyM: 3,
    text: "40 次 × 1 秒 · 目標 ≤3 公尺",
  },
};
export const DEFAULT_PLAN = "standard";

/** 門檻（使用者特別要求：精度差與跳動過大都要明確警告） */
export const GEO_LIMITS = {
  poorAccuracyM: 30,        // 最終／最佳精度比這個差 → 「這台裝置可能沒有 GPS 晶片」
  spreadWarnM: 50,          // 樣本離散超過這個 → 「讀數跳動過大」
  timeoutMs: 30000,         // 單次 getCurrentPosition 的 timeout（放寬）
  maximumAge: 0,            // 不接受快取讀數
  enableHighAccuracy: true,
  maxConsecutiveErrors: 3,  // 連續失敗幾次就放棄
  maxDurationMs: 120000,    // 整個取樣流程的硬上限
  minSamplesForStop: 3,     // 至少 3 個樣本才相信「已達目標精度」
};

/** 瀏覽器錯誤碼 → 可讀中文 ＋ 建議 */
export function describeGeoError(err, { supported = true, secureContext = true } = {}) {
  if (!supported) {
    return {
      code: "unsupported", zh: "這個瀏覽器沒有提供定位功能（navigator.geolocation 不存在）",
      hint: "可以直接跳過定位：存檔時不帶座標，或用「手動在地圖上標記」。",
    };
  }
  if (!secureContext) {
    return {
      code: "insecure", zh: "瀏覽器只在 HTTPS 或 localhost 底下允許定位",
      hint: "請改用 https 網址或本機網址開啟本頁；也可以直接用「手動在地圖上標記」。",
    };
  }
  const code = err?.code;
  if (code === 1) {
    return {
      code: "denied", zh: "你拒絕了定位授權",
      hint: "要重新授權：點瀏覽器網址列左側的鎖頭／ⓘ → 位置 → 允許，再按一次「取得定位」。也可以用「手動在地圖上標記」。",
    };
  }
  if (code === 2) {
    return {
      code: "unavailable", zh: "目前拿不到定位訊號（室內、訊號遮蔽，或裝置沒有定位硬體）",
      hint: "走到窗邊或戶外再試一次；筆電通常沒有 GPS 晶片，建議用手機開啟本頁，或用「手動在地圖上標記」。",
    };
  }
  if (code === 3) {
    return {
      code: "timeout", zh: "定位逾時（30 秒內沒拿到讀數）",
      hint: "可能是訊號太弱或系統定位服務沒開；可以直接重試，或用「手動在地圖上標記」。",
    };
  }
  return { code: "error", zh: `定位失敗：${err?.message ?? "瀏覽器沒有回報原因"}`, hint: "可以重試或改用「手動在地圖上標記」。" };
}

/** 取樣結果的品質警語（UI 直接顯示；level=warn 會用警示色） */
export function geoWarnings(result, { plan = GEO_PLANS[DEFAULT_PLAN] } = {}) {
  const out = [];
  if (!result || !result.sampleCount) return out;
  const acc = result.accuracyM;
  const best = result.bestAccuracyM;
  const worst = acc == null ? null : Math.max(acc, best ?? 0);

  if (worst != null && worst > GEO_LIMITS.poorAccuracyM) {
    out.push({
      key: "poor-accuracy", level: "warn",
      zh: `精度一直很差（最好也只有 ±${Math.round(best ?? acc)} 公尺）`,
      hint: "此裝置可能沒有 GPS 晶片（筆電常見），現在這個座標可能是 WiFi／基地台推出來的，誤差可達數十至上百公尺。建議用手機開啟本頁重新定位，或打開下方的「手動定位（在地圖上拖曳標記）」把標記拖到建築的位置。",
    });
  }
  if (result.spreadM != null && result.spreadM > GEO_LIMITS.spreadWarnM) {
    out.push({
      key: "spread", level: "warn",
      zh: `讀數跳動過大（樣本離散 ±${Math.round(result.spreadM)} 公尺）`,
      hint: "可能是在移動中取樣，或訊號被建築物反射干擾。請站定、面向開闊方向重取，或直接手動標記。",
    });
  }
  if (result.sampleCount < GEO_LIMITS.minSamplesForStop) {
    out.push({
      key: "few-samples", level: "info",
      zh: `樣本偏少（只有 ${result.sampleCount} 次）`,
      hint: "多取幾次可以讓平均更穩；按「重新取樣」即可。",
    });
  }
  if (acc != null && acc <= plan.targetAccuracyM && result.sampleCount >= GEO_LIMITS.minSamplesForStop
      && (result.spreadM ?? 0) <= Math.max(5, plan.targetAccuracyM)) {
    out.push({
      key: "target", level: "ok",
      zh: `已達目標精度（±${acc.toFixed(1)} 公尺 ≤ 目標 ${plan.targetAccuracyM} 公尺，離散 ±${(result.spreadM ?? 0).toFixed(1)} 公尺）`,
      hint: "這個座標可以直接建檔。",
    });
  }
  if (result.source === "wifi") {
    out.push({
      key: "source-wifi", level: "info",
      zh: "來源判定為 WiFi／基地台（不是衛星）",
      hint: "瀏覽器不會直接說座標怎麼來的；這裡是用精度與讀數離散回推的。WiFi 定位在市區通常還可用，但請務必看一下精度圈的大小。",
    });
  }
  if (result.lat == null) {
    out.push({ key: "no-fix", level: "warn", zh: "沒有任何有效讀數", hint: "請重試，或改用「手動在地圖上標記」。" });
  }
  return out;
}

/** 停止原因 → 中文（顯示在結果摘要，日後也可用來篩選資料品質） */
export const GEO_STOP_ZH = {
  target: "達到目標精度",
  "max-samples": "取滿設定的樣本數",
  manual: "使用者按了完成",
  error: "連續失敗，提前結束",
  unsupported: "瀏覽器不支援定位",
  insecure: "非安全來源（非 HTTPS／localhost）",
  "time-budget": "達到時間上限",
  canceled: "已取消",
};

/**
 * 建立一次取樣工作階段。
 *
 * @param {object} o
 * @param {object} [o.plan]        取樣計畫（GEO_PLANS 的其中一個）
 * @param {object} [o.geolocation] 預設 navigator.geolocation（測試可注入假的）
 * @param {boolean}[o.secureContext] 預設 window.isSecureContext
 * @param {(s:{lat,lng,accuracyM,altitude,at,index})=>void} [o.onSample]
 * @param {(s:{...})=>void} [o.onStatus]  狀態文字（開始、等待中、失敗）
 * @param {(r:object)=>void} [o.onEnd]    結束（附最終座標、樣本、警語、停止原因）
 */
export function createGeoSession({
  plan = GEO_PLANS[DEFAULT_PLAN],
  geolocation = typeof navigator !== "undefined" ? navigator.geolocation : null,
  secureContext = typeof window !== "undefined" ? window.isSecureContext !== false : true,
  onSample = () => {}, onStatus = () => {}, onEnd = () => {},
  limits = GEO_LIMITS,
} = {}) {
  const samples = [];
  let active = false;
  let timer = null;
  let errors = 0;
  let lastError = null;
  let startedAt = 0;
  let finished = false;

  const supported = !!geolocation && typeof geolocation.getCurrentPosition === "function";

  function finish(reason) {
    if (finished) return;
    finished = true;
    active = false;
    clearTimeout(timer);
    timer = null;
    const summary = summarizeSamples(samples);
    const result = {
      ...summary,
      reason,
      reasonZh: GEO_STOP_ZH[reason] ?? reason,
      sourceZh: geoSourceZh(summary.lat == null ? "none" : summary.source),
      samples: samples.map((s) => ({ ...s })),
      durationMs: startedAt ? Date.now() - startedAt : 0,
      error: lastError,
      plan: { ...plan },
    };
    result.warnings = geoWarnings(result, { plan });
    onEnd(result);
  }

  function tick() {
    if (!active) return;
    if (Date.now() - startedAt > limits.maxDurationMs) { finish("time-budget"); return; }
    geolocation.getCurrentPosition(
      (pos) => {
        if (!active) return;
        errors = 0;
        const c = pos.coords;
        const sample = {
          lat: c.latitude, lng: c.longitude,
          accuracyM: Number.isFinite(c.accuracy) ? c.accuracy : null,
          altitude: Number.isFinite(c.altitude) ? c.altitude : null,
          at: new Date(pos.timestamp || Date.now()).toISOString(),
          index: samples.length + 1,
          t: Date.now(),
        };
        samples.push(sample);
        const live = summarizeSamples(samples);
        onSample(sample, live, samples.length);
        if (samples.length >= plan.maxSamples) { finish("max-samples"); return; }
        // 「達到目標精度」有兩個條件：平均精度夠好，**而且讀數要穩**
        // （只看平均會出現「離散 94 公尺卻宣布達到目標精度」的矛盾結果，實測踩過）
        const tight = live.spreadM <= Math.max(5, plan.targetAccuracyM);
        if (live.accuracyM != null && live.accuracyM <= plan.targetAccuracyM && tight && samples.length >= limits.minSamplesForStop) {
          onStatus(`已達目標精度（±${live.accuracyM.toFixed(1)} 公尺、離散 ±${live.spreadM.toFixed(1)} 公尺），停止取樣`);
          finish("target");
          return;
        }
        timer = setTimeout(tick, plan.intervalMs);
      },
      (err) => {
        if (!active) return;
        errors++;
        const d = describeGeoError(err, { supported, secureContext });
        lastError = { code: d.code, zh: d.zh, hint: d.hint, raw: String(err?.message ?? "") };
        onStatus(`第 ${samples.length + 1} 次讀數失敗：${d.zh}`, lastError);
        // 權限被拒絕時重試沒有意義（要使用者去改設定），立刻結束並給補救說明；
        // 訊號類的失敗（拿不到／逾時）才重試。
        if (d.code === "denied" || errors >= limits.maxConsecutiveErrors) { finish("error"); return; }
        timer = setTimeout(tick, plan.intervalMs);
      },
      { enableHighAccuracy: limits.enableHighAccuracy, timeout: limits.timeoutMs, maximumAge: limits.maximumAge },
    );
  }

  return {
    plan,
    get samples() { return samples.map((s) => ({ ...s })); },
    get active() { return active; },
    /** 開始取樣。前置檢查（不支援／非安全來源）會直接以對應的 reason 結束 */
    start() {
      if (active) return;
      finished = false;
      active = true;
      startedAt = Date.now();
      errors = 0;
      lastError = null;
      if (!supported) {
        const d = describeGeoError(null, { supported: false, secureContext });
        lastError = { code: d.code, zh: d.zh, hint: d.hint };
        onStatus(d.zh, lastError);
        finish("unsupported");
        return;
      }
      if (!secureContext) {
        const d = describeGeoError(null, { supported: true, secureContext: false });
        lastError = { code: d.code, zh: d.zh, hint: d.hint };
        onStatus(d.zh, lastError);
        finish("insecure");
        return;
      }
      onStatus(`開始取樣：${plan.text}（瀏覽器可能會跳出授權詢問）`);
      tick();
    },
    /** 使用者按「完成」/「停止」 */
    stop() { if (active) finish("manual"); },
    /** 取消（離開這一輪，不留結果） */
    cancel() { if (active) { active = false; clearTimeout(timer); timer = null; finished = true; } },
  };
}

/** 依目前狀態給下一句提示（UI 的狀態列用） */
export function progressText(count, plan, live) {
  const acc = live?.accuracyM != null ? `±${live.accuracyM.toFixed(1)} 公尺` : "精度未知";
  const best = live?.bestAccuracyM != null ? `最佳 ±${live.bestAccuracyM.toFixed(1)} 公尺` : "最佳 —";
  return `取樣中：第 ${count}/${plan.maxSamples} 次 · 目前座標 ${live?.lat?.toFixed(5) ?? "—"}, ${live?.lng?.toFixed(5) ?? "—"} · ${acc} · ${best}`;
}
