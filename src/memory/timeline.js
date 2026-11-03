// 地點照片時間軸：從照片的拍攝日期欄位取年份，按時間排序，供「城市變化」呈現。
// 日期來源格式不一（"2011-12-10"、"Taken on 30 January 2012"、空字串），只取四位數年份；取不到的排在最後。

export function photoYear(ph) {
  const m = `${ph?.taken ?? ""} ${ph?.dateOriginal ?? ""}`.match(/\b(18|19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

/** 回傳 { photos: 依年份排序（無年份者在後，保持原順序）, first, last, span, dated } */
export function timelineOf(gallery = []) {
  const items = gallery.map((ph, i) => ({ ph, i, year: photoYear(ph) }));
  items.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.i - b.i);
  const years = items.map((x) => x.year).filter((y) => y != null);
  const first = years.length ? years[0] : null, last = years.length ? years.at(-1) : null;
  return { photos: items.map((x) => ({ ...x.ph, year: x.year })), first, last, span: first == null ? 0 : last - first, dated: years.length };
}
