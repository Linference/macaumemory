// 記憶點座標跟隨景點：照片產線（tools/photo-archive/publish_real_photos.py）發布時，
// 記憶點直接沿用對應景點（nearId / spotId）的座標。build-attractions.mjs 重新定位景點之後，
// 這支把已發布資料裡的座標同步過去，否則地圖標記和記憶點、到達提醒會對不上。
// 只改座標欄位；寫回前先確認檔案格式能原樣重現，避免整檔被重新排版。
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./lib.mjs";

const attractions = JSON.parse(fs.readFileSync(path.join(DATA, "attractions.json"), "utf8")).attractions;
const coordsOf = new Map(attractions.map((a) => [a.id, a.coords]));
const same = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

function update(file, indent, apply) {
  const p = path.join(DATA, file);
  const raw = fs.readFileSync(p, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";   // Python 產線在 Windows 上寫出 CRLF，沿用原本的換行
  const text = raw.replaceAll("\r\n", "\n");
  const data = JSON.parse(text);
  if (JSON.stringify(data, null, indent) !== text) throw new Error(`${file}：格式無法原樣重現，不自動改寫`);
  let changed = 0;
  const set = (id, read, write) => {
    const c = coordsOf.get(id);
    if (!c || same(read(), c)) return;
    write([...c]);
    changed++;
  };
  apply(set, data);
  if (changed) fs.writeFileSync(p, JSON.stringify(data, null, indent).replaceAll("\n", eol));
  console.log(`  ${file}：更新 ${changed} 筆座標`);
}

// 只同步「座標取自景點」的記憶點（geoSource = building-catalog）；其他來源（如照片 EXIF）保留原值
const fromCatalog = (props) => props.geoSource === "building-catalog";
const syncFeatures = (set, gj) => {
  for (const f of gj.features) {
    if (!fromCatalog(f.properties)) continue;
    set(f.properties.nearId, () => f.geometry.coordinates, (c) => { f.geometry.coordinates = c; f.properties.lon = c[0]; f.properties.lat = c[1]; });
  }
};

console.log("記憶點座標同步：");
update("places.geojson", 1, syncFeatures);
update("photos.geojson", 1, syncFeatures);
update("photo-archive.json", 1, (set, d) => {
  for (const p of d.places) if (fromCatalog(p)) set(p.nearId, () => p.coords, (c) => { p.coords = c; p.lon = c[0]; p.lat = c[1]; });
});
update("system-catalog.json", 2, (set, d) => {
  for (const p of d.places) set(p.spotId, () => p.coordinates, (c) => { p.coordinates = c; });
});
