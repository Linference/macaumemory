import fs from "node:fs";
let r = fs.readFileSync("README.md", "utf8");

// 1) 開頭加入徽章與主視覺
const hero = `<div align="center">

# 澳門立體誌 · 3D Macau Atlas

**以開放資料建構的 3D 立體澳門地圖** — OpenStreetMap × Overture Maps × Copernicus DEM × 博物館文物三維掃描

[![MapLibre](https://img.shields.io/badge/MapLibre%20GL%20JS-6.x-3960a6)](https://maplibre.org/) [![three.js](https://img.shields.io/badge/three.js-r186-black)](https://threejs.org/) [![Vite](https://img.shields.io/badge/Vite-8-646cff)](https://vitejs.dev/) [![License](https://img.shields.io/badge/code-MIT-green)](LICENSE) [![Data](https://img.shields.io/badge/data-ODbL%20%2F%20Copernicus-orange)](#2-資料來源與授權)

![澳門 3D 立體地圖](preview/01-全景-3D澳門.jpg)

</div>

`;
r = r.replace(/^# 澳門立體誌 · 3D 立體澳門地圖\n/, hero);

// 2) 快速開始補上「資料已隨附」
r = r.replace(
  `npm install                 # 安裝依賴（vite / maplibre-gl / three / gltf-transform）
npm run data                # 下載並處理所有開放資料（約 5–10 分鐘，需網路）`,
  `npm install                 # 安裝依賴（vite / maplibre-gl / three / gltf-transform）
# ✅ 圖資、地形、模型都已隨附在 public/，可直接啟動
npm run data                # （可選）重新下載並處理所有開放資料（約 5–10 分鐘，需網路）`
);

// 3) 新增後續優化（Roadmap）與授權段落
const roadmap = `
---

## 9. 後續優化 · Roadmap

### 短期（已規劃、成本低）
- [ ] **日夜光影切換**：調整 \`map.setLight()\` 方位角與色溫，做出清晨／黃昏／夜景氛圍，夜間讓建築窗戶發光
- [ ] **PWA 可安裝離線**：加入 Service Worker，把地圖、地形、模型全部快取，可「加到主畫面」當 App 使用（目前所有資料已在本機，只差快取策略）
- [ ] **手機版底部抽屜**：詳情面板改為可拖曳的 bottom sheet，並放大標記點擊熱區
- [ ] **步行路線規劃**：以已下載的 OSM 路網計算 A→B 步行路徑與時間
- [ ] **降低推估高度比例**：目前 71% 建築高度為類型推估，可用 OSM \`building:levels\` 補上（\`npm run data:osm && npm run data:merge\`）把實測比例從 29% 提升到約 59%
- [ ] **校正流程自動化**：提供 \`npm run apply-fixes\`，把使用者匯出的 \`macau-coord-fixes.json\` 直接寫回資料檔

### 中期（體驗與內容）
- [ ] **英文／葡文介面**：資料已有 \`name:en\` / \`name:pt\`，可做出三語切換
- [ ] **景點照片與語音導覽**：為 61 個景點補上授權照片（Wikimedia Commons）與語音介紹
- [ ] **更多文物模型**：持續擴充博物館館藏的三維掃描，並加入模型對比（不同朝代器物同框比較）
- [ ] **時間軸模式**：以歷史地圖／老照片對照今日 3D 城市（澳門歷史城區變遷）
- [ ] **路線主題**：一鍵展開「世界遺產步行路線」「美食路線」等主題導覽

### 長期（技術深度）
- [ ] **更精細的城市模型**：接入 Overture 建築高度 + 屋頂形狀，或改用 3D Tiles／CityGML 呈現
- [ ] **即時資料**：巴士到站、輕軌班次、人流擁擠度等開放 API
- [ ] **室內導覽**：博物館室內 3D 平面與文物定位
- [ ] **單元測試與 CI**：為資料管線與前端元件補上測試，GitHub Actions 自動建置與部署到 GitHub Pages
- [ ] **向量圖磚化**：把 24,904 棟建築改以預切 PMTiles 提供，首屏更快、可支援更大範圍

---

## 10. 授權

- **程式碼**：MIT（見 [LICENSE](LICENSE)）
- **資料**：各自授權，使用時請保留標示 —
  - 地圖與建築：© OpenStreetMap contributors（ODbL 1.0）、Overture Maps Foundation
  - 海拔：Copernicus DEM GLO-30 © DLR e.V. / Airbus Defence and Space GmbH，經 OpenTopography 提供
  - 地形圖磚：Terrain Tiles（AWS Open Data / Mapzen）
  - 三維模型：由專案作者提供，僅供學習與研究使用
- **引用建議**：\`Linference (2026). 澳門立體誌 3D Macau Atlas. https://github.com/Linference/macaumemory\`
`;
r = r.trimEnd() + "\n" + roadmap;
fs.writeFileSync("README.md", r);
console.log("README 已加入主視覺、Roadmap 與授權段落");
