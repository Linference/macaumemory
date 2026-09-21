<div align="center">

# 澳門立體誌 · 3D Macau Atlas

**以開放資料建構的 3D 立體澳門地圖** — OpenStreetMap × Overture Maps × Copernicus DEM × 博物館文物三維掃描

[![MapLibre](https://img.shields.io/badge/MapLibre%20GL%20JS-6.x-3960a6)](https://maplibre.org/) [![three.js](https://img.shields.io/badge/three.js-r186-black)](https://threejs.org/) [![Vite](https://img.shields.io/badge/Vite-8-646cff)](https://vitejs.dev/) [![License](https://img.shields.io/badge/code-MIT-green)](LICENSE) [![Data](https://img.shields.io/badge/data-ODbL%20%2F%20Copernicus-orange)](#2-資料來源與授權)

![澳門 3D 立體地圖](preview/01-全景-3D澳門.jpg)

</div>



以**開放資料**建構的 3D 立體澳門地圖：從 OpenStreetMap / Overture Maps 下載建築與道路、從
OpenTopography 下載 Copernicus DEM 海拔資料，在瀏覽器裡以 MapLibre GL JS + three.js 呈現
可旋轉、可點選的立體城市，並把博物館文物的高精度三維掃描模型放進地圖中。

地圖上的每一個景點都是可點擊的標記：點擊後會打開景點簡介；若該景點是博物館，還會列出館藏文物，
點擊文物即可開啟三維檢視器，自由旋轉、縮放、觀察細節。

## 預覽

`preview/` 目錄內附實際執行截圖：全景 3D 澳門、大三巴三維建築、路環疊石塘山地形、
路氹城度假村群、等高線與地形、博物館與文物列表、兩件文物的三維檢視器、簡體中文介面、全螢幕模式。

---

## 1. 快速開始

```bash
npm install                 # 安裝依賴（vite / maplibre-gl / three / gltf-transform）
# ✅ 圖資、地形、模型都已隨附在 public/，可直接啟動
npm run data                # （可選）重新下載並處理所有開放資料（約 5–10 分鐘，需網路）
npm run models              # 把高精度掃描 GLB 優化成網頁可用版本（可選，已附成品）
npm run dev                 # 開發伺服器 http://127.0.0.1:5173
npm run build && npm run preview   # 打包並預覽 http://127.0.0.1:4173
```

> `npm run data` 會用到 Python 的 `overturemaps` CLI 與 OpenTopography API：
> `python -m pip install --user overturemaps`，並把 API key 放在 `scripts/fetch-opentopography.mjs`（預設已填入）。

### 資料處理指令一覽

| 指令 | 內容 | 產出 |
| --- | --- | --- |
| `npm run data:overture` | 下載 Overture Maps 圖資（含 OSM 與 Microsoft ML 建築足跡） | `public/data/macau-*.geojson` |
| `npm run data:dem` | 下載開放地形圖磚並清理海底異常值 | `public/dem/{z}/{x}/{y}.png` |
| `npm run data:cop30` | 由 OpenTopography 下載 Copernicus DEM GLO-30，計算統計、等高線、山體陰影 | `public/data/elevation/*`、`macau-dem-contours.geojson` |
| `npm run data:poi` | 把人工整理的景點資料與 OSM 圖資比對、修正座標 | `public/data/attractions.json` |
| `npm run models` | 掃描模型簡化 + 貼圖壓縮（gltf-transform） | `public/models/*.glb`、`manifest.json` |
| `npm run data:osm` | （選用）以 Overpass API 抓取 OSM 原始圖資（含 building:levels 推估高度） | `public/data/osm/macau-*.geojson` |
| `npm run data:merge` | 把 OSM 的實測／推估高度併入 Overture 建築（依 OSM way id 對應） | 更新 `macau-buildings.geojson` |

> Overpass API 為社群服務，尖峰時段常回傳 429/504；本專案已實作分塊下載與快取，
> 中斷後重跑會自動接續。若 `public/data/osm/` 不存在，`data:merge` 會自動跳過，不影響主要流程。

---

## 2. 資料來源與授權

| 資料 | 來源 | 授權／標示 |
| --- | --- | --- |
| 建築物、道路、土地利用、水體、POI、行政邊界 | [Overture Maps Foundation](https://overturemaps.org)（含 OpenStreetMap 與 Microsoft ML 建築足跡） | ODbL 1.0 / Overture 授權，需標示 © OpenStreetMap contributors 與 Overture Maps Foundation |
| 原始 OSM 圖資（實驗性管線） | OpenStreetMap 貢獻者，經 Overpass API | ODbL 1.0 |
| 海拔資料 | **Copernicus DEM GLO-30**，經 [OpenTopography](https://opentopography.org) Global DEM API 下載 | © DLR e.V. 2010-2014 / © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA |
| 即時地形圖磚 | Terrain Tiles（AWS Open Data / Mapzen，terrarium 編碼） | Public domain / CC-BY（Mapzen、SRTM、ETOPO1 等） |
| 文物三維模型 | 使用者提供之唐三彩、青花瓷掃描檔 | 僅供學習研究使用，版權歸原提供者所有 |
| 程式框架 | MapLibre GL JS（BSD-3）、three.js（MIT）、Vite（MIT）、opencc-js（MIT） | 見 `node_modules` 各套件授權 |

### 海拔資料重點數字（由 Copernicus DEM GLO-30 計算）

- 澳門陸域面積（高程 > 0.5 m 的網格）：**約 33 平方公里**
- 最高點：**172.1 公尺**，位於路環疊石塘山
- 平均高程：約 42 公尺（陸域）
- 等高線以 5 公尺為間距，產出 `macau-dem-contours.geojson`（可於圖層面板開啟）

---

## 3. 專案結構

```
├─ index.html                 應用程式外殼（地圖、側欄、文物三維檢視器）
├─ src/
│  ├─ main.js                 應用主流程：地圖、標記、面板、圖層切換
│  ├─ map-style.js            MapLibre 樣式：向量底圖 + 3D 建築 + 地形
│  ├─ markers.js              景點標記（DOM Marker）
│  ├─ viewer.js               three.js 文物檢視器（LOD → 高精度模型）
│  ├─ icons.js / i18n.js      圖示與繁簡轉換
│  └─ styles.css
├─ scripts/                   資料處理管線（Node ESM）
│  ├─ lib.mjs                 共用工具（Overpass、簡化、GeoJSON 輸出）
│  ├─ attractions.data.mjs    ✏️ 人工整理的景點／博物館／文物資料（可直接編輯）
│  ├─ fetch-overture.mjs      Overture Maps → GeoJSON
│  ├─ fetch-terrain.mjs       terrarium 地形圖磚下載
│  ├─ clean-dem.mjs           清除海底負值與異常尖峰
│  ├─ fetch-opentopography.mjs / process-dem-cop30.mjs   Copernicus DEM 下載與分析
│  ├─ build-attractions.mjs   景點資料編譯（含 OSM 座標校正）
│  ├─ optimize-models.mjs     掃描模型優化（meshopt + WebP）
│  └─ dev/                    驗證工具（headless 瀏覽器截圖、模型檢視）
├─ public/
│  ├─ data/                   GeoJSON、景點資料、高程資料
│  ├─ dem/                    地形圖磚（terrarium 編碼，z10–z15）
│  ├─ models/                 文物 GLB 與 manifest
│  └─ draco/                  Draco 解碼器（若放入 Draco 壓縮模型時使用）
└─ dist/                      打包輸出（可直接部署到任何靜態伺服器）
```

---

## 4. 3D 模型與文物

### 已收錄文物

| 模型 | 類別 | 三維模型 | 原始檔案 |
| --- | --- | --- | --- |
| 唐三彩雙峰駱駝俑 | 博物館文物 | ✅ `tang-sancai-camel.glb`（33 萬面 / 2.7 MB）＋ LOD | 76.6 MB / 150 萬面 |
| 明永樂青花輪花紋綬帶耳葫蘆扁瓶 | 博物館文物 | ✅ `yongle-blue-white-flask.glb`（33 萬面 / 2.4 MB）＋ LOD | 72.4 MB / 150 萬面 |
| 澳門旅遊塔 | 地標建築 | ✅ `macau-tower.glb`（27 萬面 / 2.3 MB）＋ LOD | 62.0 MB / 193 萬面 |
| 澳門科學館 | 地標建築 | ✅ `macau-science-center.glb`（27 萬面 / 2.4 MB）＋ LOD | 61.5 MB / 190 萬面 |
| 澳門巴黎人 | 娛樂度假 | ✅ `parisian.glb`（27 萬面 / 3.1 MB）＋ LOD | 65.4 MB / 190 萬面 |
| 澳門倫敦人 | 娛樂度假 | ✅ `londoner-macao.glb`（27 萬面 / 2.3 MB）＋ LOD | 56.5 MB / 190 萬面 |
| 澳門銀河 | 娛樂度假 | ✅ `galaxy-macau.glb`（26 萬面 / 2.7 MB）＋ LOD | 57.7 MB / 189 萬面 |
| 黑沙遺址出土陶器與石器 | 澳門博物館 | 尚無模型（卡片式介紹） | — |
| 傳統手工業作坊（爆竹、神香、火柴） | 澳門博物館 | 尚無模型 | — |
| 土生葡人家庭客廳場景 | 澳門博物館 | 尚無模型 | — |

> 建築模型為使用者提供的 AI 三維生成檔（Tripo / VAST），**非實測比例**；掃描類模型（唐三彩、青花扁瓶）為 1:1 尺度。
> 三維檢視器採**左模型、右介紹文字**的版面，並標示模型來源與是否為實際比例。

模型處理流程（`npm run models`）：

```
weld（焊接頂點） → simplify（meshoptimizer，保留 22% 面數）→ textureCompress（WebP 2048px）
  → quantize（量化） → meshopt（EXT_meshopt_compression）→ prune
同時輸出 .lod.glb（3.5% 面數、1024px 貼圖），檢視器會先顯示 LOD 再換上高精度模型。
```

### 如何加入自己的文物模型

1. 把 `.glb` 放進 `public/models/`（Draco 壓縮檔亦可，已附解碼器）。
2. 在 `public/models/manifest.json` 的 `models` 加入一筆：
   ```json
   "my-artifact": {
     "id": "my-artifact",
     "titleZh": "文物名稱",
     "dimensionsMeters": [寬, 高, 深],
     "full": { "file": "my-artifact.glb", "bytes": 1234567, "triangles": 200000 }
   }
   ```
3. 在 `scripts/attractions.data.mjs` 的 `ARTIFACTS` 加入文物（`model: "my-artifact"`），
   並在對應博物館的 `artifactIds` 中引用。
4. `npm run data:poi && npm run build`。

沒有模型的文物會顯示為卡片並提示尚未提供三維模型，不會出現破圖。

---

## 7. 地圖操作

- **拖曳**平移、**右鍵拖曳或雙指**旋轉／傾斜、**滾輪**縮放
- 點擊金色標記 → 右側面板顯示簡介；標記右上角有 `3D` 者代表設有文物模型
- 博物館面板下方列出館藏文物卡片 → 點擊開啟三維檢視器（拖曳旋轉、滾輪縮放、自動旋轉、線框、全螢幕）
- 右上角圖層面板：三維建築、地勢起伏（1.0–3.0 倍）、山體陰影、等高線、道路／輕軌、水體與綠地、行政邊界
- 左下角可展開資料來源標示；右下角即時顯示游標座標、**地形海拔**與比例尺
- 側欄可搜尋景點、依類別篩選（世界遺產、廟宇教堂、博物館、地標、娛樂度假、山海自然、街區美食、口岸交通）
- 右上角「繁」可切換繁體／簡體中文（opencc-js 動態載入）
- 點擊地名標籤可飛到該處；點擊周邊設施圓點會顯示名稱小卡
- 右上角全螢幕圖示（或鍵盤 **F**）可切換全站全螢幕，Esc 返回；文物檢視器另有獨立全螢幕
- **個人定位**：右上角定位圖示，三段式操作 **定位 → 跟隨 → 停止**
  - 藍點為你的位置，外圈是 GPS 精度範圍，有方向資料時會顯示箭頭（隨地圖旋轉校正）
  - 「跟隨模式」地圖會跟著你移動（手動拖曳地圖即暫停跟隨）
  - 景點詳情會顯示「距離你 X 公尺（方位）」；側欄「📍 附近」可依距離排序
  - 需在瀏覽器允許位置權限；**僅在 HTTPS 或 localhost 下可用**（瀏覽器安全限制），權限被拒時會提示
- **標記位置校正**：圖層面板按「✎ 校正標記位置」後可直接**拖曳標記**到正確位置，
  修正會存在瀏覽器（localStorage）並可「匯出校正檔」（JSON）回饋到資料檔
- 景點詳情面板會顯示座標、**海拔**與**定位來源**（OSM 建築輪廓／公園圖資／維基百科座標／人工標定）

---

## 8. 已知限制

- 建築高度以 Overture/OSM 的 `height`、`num_floors` 為主；沒有的建築依類型推估（會以顏色區分），因此天際線是「合理推估」而非實測。
- 地形起伏使用開放的 terrarium 圖磚（SRTM/AW3D30 等 30 公尺網格資料），城市平坦地區的起伏會被誇大倍率放大。
- 海底高程已被壓平為 0 公尺，海面不會出現深海溝。
- 座標解析流程：`scripts/geocode-attractions.mjs`（Wikipedia/Wikidata）→ `scripts/build-attractions.mjs`
  （名稱詞級比對、同名建築物／公園多邊形、權威座標互相佐證、防誤配規則）。
- 景點座標以「名稱詞級比對 → 同名建築物／公園多邊形 → 維基百科／Wikidata 座標 → 人工座標」四層解析：
  49 個建築類景點中有 39 個精確落在對應的建築輪廓內，其餘為廣場、海灘、山頂等非建築地點；
  實際來源與位移量記錄在 `public/data/coord-report.json`。
- 若以「單頁應用 fallback」的靜態伺服器部署（所有 404 都回傳 `index.html`），缺少的圖磚會被當成圖片解碼而產生警告；`vite preview` 已加入對應處理，正式部署建議使用一般靜態伺服器（缺少檔案回傳 404）。

---

## 9. 後續優化 · Roadmap

### 短期（已規劃、成本低）
- [ ] **日夜光影切換**：調整 `map.setLight()` 方位角與色溫，做出清晨／黃昏／夜景氛圍，夜間讓建築窗戶發光
- [ ] **PWA 可安裝離線**：加入 Service Worker，把地圖、地形、模型全部快取，可「加到主畫面」當 App 使用（目前所有資料已在本機，只差快取策略）
- [ ] **手機版底部抽屜**：詳情面板改為可拖曳的 bottom sheet，並放大標記點擊熱區
- [ ] **步行路線規劃**：以已下載的 OSM 路網計算 A→B 步行路徑與時間
- [ ] **降低推估高度比例**：目前 71% 建築高度為類型推估，可用 OSM `building:levels` 補上（`npm run data:osm && npm run data:merge`）把實測比例從 29% 提升到約 59%
- [ ] **校正流程自動化**：提供 `npm run apply-fixes`，把使用者匯出的 `macau-coord-fixes.json` 直接寫回資料檔

### 中期（體驗與內容）
- [ ] **英文／葡文介面**：資料已有 `name:en` / `name:pt`，可做出三語切換
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
- **引用建議**：`Linference (2026). 澳門立體誌 3D Macau Atlas. https://github.com/Linference/macaumemory`
