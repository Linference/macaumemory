// 檢查 build_embeddings.py 的 BUILDINGS 名冊能不能對到 public/data/attractions.json 的景點 id。
// 這支只是開發期檢查，不會被網站載入。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const data = JSON.parse(readFileSync(resolve(ROOT, "public/data/attractions.json"), "utf8"));
const byId = new Map(data.attractions.map((a) => [a.id, a]));

const spots = [
  "ruins-st-paul", "macau-tower", "macau-science-center", "venetian", "grand-lisboa",
  "a-ma-temple", "kun-iam-temple", "st-dominic-church", "st-lawrence-church", "cathedral-macau",
  "mandarins-house", "taipa-houses", "moorish-barracks", "leal-senado", "senado-square",
  "rua-da-felicidade", "red-market", "coloane-village", "guiuan-village", "lai-chi-vun",
];

let bad = 0;
for (const s of spots) {
  const a = byId.get(s);
  if (!a) { console.log(`MISSING  ${s}`); bad++; continue; }
  console.log(`ok  ${s.padEnd(22)} ${a.zh}  cat=${a.cat}${a.model ? " model=" + a.model : ""}`);
}
console.log(bad ? `\n${bad} 個 id 對不到，請修正` : "\n全部對得上");
