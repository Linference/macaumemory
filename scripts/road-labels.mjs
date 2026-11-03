// 道路標籤名稱：澳門 OSM 的道路名多為「中文 葡文」雙語（例：新馬路 Avenida de Almeida Ribeiro），
// 地圖沿街標籤只顯示開頭的中文部分，否則標籤太長、彼此擠掉；純葡文／英文的名稱不標。
// 結果存在道路的 zh 欄位（l 已用於車道數）。fetch-osm.mjs 下載時會一併產生；
// 直接執行本檔則為現有的 public/data/macau-roads.geojson 補上 zh，不必重新下載 OSM。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CJK = /[㐀-鿿豈-﫿\u{20000}-\u{3134f}]/u;

export function roadLabel(name) {
  if (typeof name !== "string") return null;
  // 葡文序數（學院四徑 4ª）的「4ª」也屬葡文部分，一併去掉
  const head = name.trim().split(/[A-Za-zªºÀ-ÿ(（]/u)[0].replace(/(\s+\d+)?[\s·・,，、/-]*$/u, "").trim();
  return CJK.test(head) ? head : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { DATA, writeJson } = await import("./lib.mjs");
  const file = path.join(DATA, "macau-roads.geojson");
  const roads = JSON.parse(fs.readFileSync(file, "utf8"));
  let labelled = 0;
  for (const f of roads.features) {
    const zh = roadLabel(f.properties?.n);
    if (zh) { f.properties.zh = zh; labelled++; } else delete f.properties?.zh;
  }
  writeJson(file, roads);
  console.log(`道路標籤：${labelled} / ${roads.features.length} 段有中文名稱`);
}
