// 繁簡轉換（僅在切換到簡體時才動態載入 opencc-js 字典）
let converter = null;
let lang = "zh-Hant";
const listeners = new Set();

export const getLang = () => lang;
export const onLangChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function setLang(next) {
  if (next === "zh-Hans" && !converter) {
    try {
      const mod = await import("opencc-js/t2cn");
      converter = mod.Converter({ from: "hk", to: "cn" });
    } catch (e) {
      console.warn("簡繁轉換載入失敗，維持繁體顯示", e);
      next = "zh-Hant";
    }
  }
  lang = next;
  document.documentElement.lang = next === "zh-Hans" ? "zh-Hans" : "zh-Hant";
  for (const fn of listeners) fn(lang);
}

/** 將繁體字串轉為目前語言 */
export const T = (s) => (lang === "zh-Hans" && converter && typeof s === "string" ? converter(s) : s);
export const TJ = (obj) => obj == null ? obj : typeof obj === "string" ? T(obj) : Array.isArray(obj) ? obj.map(TJ) : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, TJ(v)]));
