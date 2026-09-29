// 澳門記憶 · 建築辨識：類別標籤與相似度的口語等級
//
// 這個檔案只放「資料」層級的東西（類別對照、門檻、格式），不 import 任何模型執行環境，
// 所以在主執行緒、Worker、Node 測試裡都能安全載入。

/**
 * YOLO 輸出通道的類別順序（= datasets/macau-buildings/data.yaml 的 names，索引 0~10）。
 * 這個順序必須與權重一致，前端解碼時靠它把 channel 轉成類別名。
 * 沒有傳這個陣列的話，偵測結果只會是 class_0…class_10（實際踩過）。
 */
export const CLASS_NAMES = [
  "portuguese", "temple", "church", "tong_lau", "residential_tower", "casino_hotel",
  "civic", "industrial", "village", "monument", "market",
];

/** YOLO 的 11 類（順序 = datasets/macau-buildings/data.yaml 的索引）→ 給使用者看的中文 */
export const CLASS_ZH = {
  portuguese: "葡式殖民建築",
  temple: "中式廟宇",
  church: "天主教教堂",
  tong_lau: "騎樓與唐樓",
  residential_tower: "現代高層住宅",
  casino_hotel: "酒店與娛樂場",
  civic: "公共建築",
  industrial: "工業與倉庫",
  village: "圍里與村落民居",
  monument: "牌坊與紀念物",
  market: "街市與市集",
  street: "街景與其他",
};

/** 英文類別名一律不直接顯示；查不到就回一個安全的中文說法 */
export const clsZh = (cls) => CLASS_ZH[cls] ?? "其他建築";

export const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
export const fixed = (x, n = 3) => (Number(x) || 0).toFixed(n);

// ---------------------------------------------------------------------------
// 相似度門檻：不是憑感覺訂的，是量出來的。
//   編碼器 DINOv2 ViT-S/14 + CLS pooling + 336px + 3 裁切 × 水平翻轉
//   庫：photos-src/cc 的開放授權實拍（已套 curation.json 排除主體不對的照片）+ 本站模型截圖
//      = 84 張 / 21 棟（tools/recognize/build_embeddings.py）
//   留一法分布（tools/recognize/threshold_table.py 實測）：
//       同棟配對 157 組：平均 0.453
//       不同棟配對 3329 組：平均 0.098 · 95% 分位 0.369
//   門檻取捨（同表）：
//       0.50 → 檢索 Top-1 的 92.4% 落在門檻之上，不同棟誤判率 1.5%，涵蓋 75.3% 的查詢
//       0.35 → 誤判率 5.9%；0.25 → 誤判率 13.7%
//   所以：≥0.50 高度相似；0.35~0.50 中度；0.25~0.35 低度；<0.25 誠實說「可能不在庫裡」。
//   ⚠️ 這批參考照片來自同一批 Wikimedia Commons 策展分類，同一棟的 5 張可能同作者／同年代，
//      因此比「真實世界的陌生人隨手拍」樂觀；tools/eval 的 E1r（同棟不同攝影者）AUC 0.796
//      是比較誠實的下界，實際上傳照片的命中率會低於上表的覆蓋率。
// ---------------------------------------------------------------------------
export const SIM_THRESHOLDS = { hit: 0.5, maybe: 0.35, low: 0.25 };

/** 相似度 → 口語等級（只給顯示用；排序另外處理） */
export function simLabel(sim, th = SIM_THRESHOLDS) {
  if (sim >= th.hit) return { key: "high", zh: "高度相似" };
  if (sim >= th.maybe) return { key: "mid", zh: "中度相似" };
  if (sim >= th.low) return { key: "low", zh: "低度相似" };
  return { key: "vlow", zh: "不相似" };
}

/** 深連結回主站（沿用主站既有的 #zoom/lat/lng/spot/<id> 規則） */
export function mapUrl(spot, base = null) {
  const b = base ?? new URL("./", document.baseURI).href;
  if (!spot) return b;
  const q = new URLSearchParams({ spot, from: "recognize" });
  return `${b}?${q.toString()}`;
}
