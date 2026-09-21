import fs from "node:fs";
let r = fs.readFileSync("README.md", "utf8");
const bom = r.charCodeAt(0) === 0xFEFF ? "\uFEFF" : "";
r = r.replace(/^\uFEFF/, "");
const firstHead = "# 澳門立體誌 · 3D 立體澳門地圖";
const hero = `<div align="center">

# 澳門立體誌 · 3D Macau Atlas

**以開放資料建構的 3D 立體澳門地圖** — OpenStreetMap × Overture Maps × Copernicus DEM × 博物館文物三維掃描

[![MapLibre](https://img.shields.io/badge/MapLibre%20GL%20JS-6.x-3960a6)](https://maplibre.org/) [![three.js](https://img.shields.io/badge/three.js-r186-black)](https://threejs.org/) [![Vite](https://img.shields.io/badge/Vite-8-646cff)](https://vitejs.dev/) [![License](https://img.shields.io/badge/code-MIT-green)](LICENSE) [![Data](https://img.shields.io/badge/data-ODbL%20%2F%20Copernicus-orange)](#2-資料來源與授權)

![澳門 3D 立體地圖](preview/01-全景-3D澳門.jpg)

</div>

`;
if (r.startsWith(firstHead)) {
  r = hero + r.slice(firstHead.length);
  console.log("已插入主視覺區塊");
} else {
  console.log("開頭不是預期標題，實際為:", JSON.stringify(r.slice(0, 40)));
}
fs.writeFileSync("README.md", r, "utf8");
