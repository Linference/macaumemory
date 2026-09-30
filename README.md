<div align="center">

# 澳門立體誌 · 3D Macau Atlas

**以開放資料建構的 3D 立體澳門地圖** — OpenStreetMap × Overture Maps × Copernicus DEM × 博物館文物三維掃描

[![MapLibre](https://img.shields.io/badge/MapLibre%20GL%20JS-6.x-3960a6)](https://maplibre.org/) [![three.js](https://img.shields.io/badge/three.js-r186-black)](https://threejs.org/) [![Vite](https://img.shields.io/badge/Vite-8-646cff)](https://vitejs.dev/) [![License](https://img.shields.io/badge/code-MIT-green)](LICENSE) [![Data](https://img.shields.io/badge/data-ODbL%20%2F%20Copernicus-orange)](#資料來源與授權)

![澳門 3D 立體地圖](preview/01-全景-3D澳門.jpg)

**24,904 棟三維建築 · 172.1 公尺地形 · 61 個景點 · 7 個三維模型 · 最快路徑導航**

</div>

---

## 這是什麼

把**開放資料**變成一座可以在瀏覽器裡轉動、點選、導航的 3D 澳門：

- **地圖模型**：從 Overture Maps（含 OpenStreetMap）下載 24,904 棟建築、20,972 條道路、水體與土地利用，在 MapLibre GL JS 上以 3D 擠出呈現
- **海拔資料**：從 OpenTopography 下載 Copernicus DEM GLO-30（30 公尺網格），產生地形起伏、等高線與山體陰影；澳門陸域最高點 172.1 公尺（路環疊石塘山）
- **文物模型**：把高精度掃描檔（唐三彩雙峰駱駝俑、明永樂青花葫蘆扁瓶）與 5 座地標建築模型放進地圖，點擊即可開啟三維檢視器
- **導航**：以真實路網計算最快路徑，附「搜尋最快道路」的波前動畫與車流效果

> 所有資料都已隨附在 `public/`，clone 下來就能直接跑，不需重新下載。

### 建築普查與本次改進

`recognize.html` 提供實拍示範、YOLO 建築分類、DINOv2 查重、人工定位、永久編號、SQLite 本機保存與 R-Tree 空間查重；工作台與檔案頁沿用主站的深藍／金色。

- **位置輔助辨識**：每張照片主動開啟；精度不足或 GPS 過期時使用影像排序。位置只小幅降權遠方候選，影像分數不變，候選接近或位置衝突須人工確認。
- **高面數地標接入**：巴黎人、科學館、銀河和倫敦人已直接放入地圖，保留原始約 190 萬面幾何；遠處預覽，16.5 級按視野載入完整細節。成功載入才隱藏指定白膜。尺寸／朝向暫定，並非實測模型，見 [接入指南](docs/high-precision-glb.md)。
- **獨立實拍評測**：參考庫凍結、攝影者／拍攝批次隔離、重複照片檢查與純影像／位置輔助對照。現有 38 棟／335 張的 Top-1 88.96% 是參考庫留一法，不能當作獨立準確率；完整範圍見 [證據口徑](docs/evidence-register.md)。

```sh
npm test
python -m unittest discover -s tests -p '*_test.py'
```

---

## 預覽

`preview/` 內附 24 張實際執行截圖：

| 檔案 | 內容 |
| --- | --- |
| `01-全景-3D澳門` | 立體澳門全景 |
| `02-大三巴-三維建築`、`04-路氹城-度假村群` | 3D 建築細節 |
| `03-路環疊石塘山-地形`、`05-等高線與地形` | 地形與等高線 |
| `06-博物館與文物列表`、`07`、`08` | 博物館與文物三維檢視器 |
| `12`–`16` | 旅遊塔／科學館／巴黎人／銀河／倫敦人模型與介紹（左模型、右文字） |
| `18-地名標籤與周邊設施`、`19-低縮放標記去雜亂` | 標籤、POI、標記分層 |
| `22-個人定位` | GPS 藍點與精度圈 |
| `26`–`28` | **導航：搜尋動畫 → 路線與車流 → 路線指引** |
| `24`、`25` | 可平移範圍與邊界 |

---

## 快速開始

```bash
npm install                 # 安裝依賴（vite / maplibre-gl / three / gltf-transform）
npm run dev                 # 開發伺服器 http://127.0.0.1:5173
npm run build && npm run preview   # 打包並預覽 http://127.0.0.1:4173
```

Windows 可直接雙擊 **`啟動澳門立體誌.bat`**（自動打包＋開伺服器＋開瀏覽器）。

### 重新產生資料（可選）

```bash
npm run data        # 全部重建：Overture 圖資 → 地形磚 → Copernicus DEM → 景點座標 → 合併 OSM 高度
npm run models      # 重新優化三維模型（需要原始掃描檔）
npm run verify      # 檢查景點座標是否落在建築物／水域（QA）
```

| 指令 | 內容 | 產出 |
| --- | --- | --- |
| `npm run data:overture` | Overture Maps 圖資（建築、道路、水體、土地利用、邊界、POI） | `public/data/macau-*.geojson` |
| `npm run data:dem` | terrarium 地形圖磚下載＋清除海底異常值 | `public/dem/**`（683 張） |
| `npm run data:cop30` | Copernicus DEM GLO-30 下載＋高程統計＋等高線＋山體陰影 | `public/data/elevation/*` |
| `npm run data:geocode` | Wikipedia／Wikidata 權威座標 | `.cache/geocode.json` |
| `npm run data:poi` | 景點資料編譯（座標四層解析、標籤、POI 精簡檔） | `public/data/attractions.json` |
| `npm run data:osm` → `data:merge` | 用 OSM `building:levels` 補上更多實測高度 | 更新 `macau-buildings.geojson` |

> 需要 Python 的 `overturemaps` CLI 與 OpenTopography API key（見 `scripts/fetch-opentopography.mjs`）。

---

## 功能總覽

### 3D 地圖
- 24,904 棟建築以 3D 擠出呈現，高度分「實測」（`height`／`building:levels`）與「依類型推估」兩級
- 可切換：三維建築、地勢起伏（1.0–3.0 倍）、山體陰影、等高線、道路／輕軌、水體與綠地、行政邊界
- 滑鼠拖曳平移、右鍵拖曳旋轉傾斜、滾輪縮放；**可平移範圍＝澳門＋約 6 公里緩衝（21.5 公里見方）**，最低縮放依視窗自動調整，任何縮放都能左右上下移動
- 離開範圍時下方出現「**回到澳門**」浮動鈕

### 內容與標註
- **61 個景點**分 8 類（世界遺產、廟宇教堂、博物館、地標、娛樂度假、山海自然、街區美食、口岸交通），座標以「同名建築詞級比對 → 權威座標互相佐證 → 人工座標」四層解析，其中 35 個精確落在對應建築輪廓內
- **地名標籤 251 個**（區域 6、堂區 8、公園海灘 68、主要街道 171）：DOM 標籤＋螢幕碰撞剔除，依縮放分層出現，點擊可飛到該處
- **周邊設施 6,569 筆**，分 9 類可勾選；餐飲／購物預設關閉，低縮放只顯示核心類別（文化／交通／政府／醫療／住宿），點圓點顯示名稱
- **標記去雜亂**：依重要度分三層，低縮放只顯示世界遺產／博物館／地標／有 3D 模型者

### 個人定位
- 右上角定位圖示三段式：**定位 → 跟隨 → 停止**；藍點＋GPS 精度圈，有方向資料時顯示箭頭（隨地圖旋轉校正）
- 景點詳情顯示「距離你 X 公尺（方位）」；側欄「📍 附近」依距離排序
- 需瀏覽器允許位置權限，**僅在 HTTPS 或 localhost 可用**

### 導航（最快路徑）
- 景點詳情按「🧭 導航到這裡」→ 以你的位置為起點（未開定位時以地圖中心代替）
- **搜尋動畫**：光點依 Dijkstra 造訪順序波前擴散（青→金），呈現「搜尋所有可能道路」的過程
- **定案動畫**：探索淡出、金色霓虹路線由起點長出（外光暈＋白色核心線）
- **車流動畫**：26 個光點沿路線流動，終點脈衝圈
- 依距離自動選**步行／開車**（< 2.5 km 步行），可手動切換；附**逐段路線指引**（左右轉圖示＋街名＋距離）
- 實測：大三巴 520 m／步行 7 分、旅遊塔 1.9 km／步行 25 分、黑沙海灘 11 km／開車 16 分

### 其他
- **全站全螢幕**（右上角圖示或 **F**）、文物檢視器另有獨立全螢幕
- **標記位置校正**：圖層面板按「✎ 校正標記位置」可直接拖曳標記，修正存於瀏覽器並可「匯出校正檔」
- **澳門記憶 · 記憶點**：照片自動歸戶到「建築記憶點」（永久編號 MM-0001…），一棟建築一個點、可看照片時間軸與建築解讀；景點標記顯示 📷 張數徽章
- **深連結**：網址即時反映鏡頭與選取景點（`#16.20/22.17982/113.53680/spot/macau-tower`）
- **快捷鍵**：`L` 圖層面板、`S` 景點清單、`F` 全螢幕、`Esc` 關閉面板／結束導航
- **繁簡切換**（opencc-js 動態載入）

---

## 部署（GitHub Pages）

已內建 GitHub Actions：推送 `main` 即自動 `npm ci → npm run build → 部署 dist`。

1. 到 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**
2. 推送後約 1–2 分鐘即可在網址看到（自訂網域請於 Pages 設定 Custom domain 並開啟 Enforce HTTPS）
3. 產物包含 `public/` 全部圖資、地形與模型（約 76 MB），**完全靜態、離線可跑、無需伺服器**

### 自訂網域 DNS 設定（macaumemory.com）

repo 內已有 `CNAME`（`macaumemory.com`），請到網域註冊商的 DNS 加上以下記錄，GitHub 才會簽發 TLS 憑證：

| 類型 | 名稱 | 值 |
| --- | --- | --- |
| A | `@` | `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153` |
| AAAA（可選） | `@` | `2606:50c0:8000::153`、`2606:50c0:8001::153`、`2606:50c0:8002::153`、`2606:50c0:8003::153` |
| CNAME（可選） | `www` | `linference.github.io` |

設好後在 **Settings → Pages** 勾選 **Enforce HTTPS**（憑證約 10–30 分鐘簽發）。
若暫時不想用自訂網域，移除 `CNAME` 後即可改用 `https://linference.github.io/macaumemory/`（已驗證可用）。

> 程式已改為**相對路徑**，因此根目錄（自訂網域）與子路徑（`帳號.github.io/專案名/`）都能運作；
> MapLibre worker 另提供 `.js` 版本並以 `setWorkerUrl()` 指定，避免部分伺服器對 `.mjs` 回傳
> `application/octet-stream` 而導致 module worker 被瀏覽器拒絕。

> 若改用 `帳號.github.io/專案名/` 子路徑，請把 `vite.config.js` 加上 `base: "/專案名/"` 並將程式內路徑改為相對路徑。

---

## AI 導覽助理（DeepSeek）

右下角「**問 AI**」→ 串流對話，回答會**連動地圖**：

- 問「大三巴有什麼必看？」→ 回答後自動 `[[goto:ruins-st-paul]]`，地圖飛到該景點並開啟介紹
- 問「我要怎麼去澳門旅遊塔？」→ 回答後自動 `[[route:macau-tower]]`，**直接啟動導航**規劃最快路線
- 系統提示會帶入本圖 61 個景點清單、目前選中景點與使用者位置，所以能算距離、排行程

**API Key 安全**（重要）：
- 預設模型 **`deepseek-flash`**（會自動向 `/models` 取得此帳號可用清單，例如 `deepseek-flash`／`deepseek-v4-pro`）；
  可勾選「**深度思考模式**」，開啟後會先顯示思考過程再給答案
- 新型號預設會先輸出思考內容（`reasoning_content`）而吃掉 token，本專案以 `thinking: {type:"disabled"}` 控制，
  並同時解析 `reasoning_content` 與 `content`，避免出現「按了卻沒有回覆」
- 金鑰只存在**你的瀏覽器 localStorage**，或本機 `public/ai-local.json`（已加入 `.gitignore`，不會被提交）
- 本站為公開網站，**請勿把金鑰寫進程式碼或提交到 Git**；若要做成公開服務，建議用 Cloudflare Worker 代理（可參考 `worker/bus-proxy.js` 的寫法）
- DeepSeek API 允許瀏覽器直呼（CORS 開放），因此靜態網站也能運作；若更換金鑰或模型，在設定面板留空金鑰即可沿用舊金鑰

---

## 語音對話（自動朗讀 ＋ 語音輸入）

AI 對話框右上角提供兩個語音功能，**都使用瀏覽器內建能力，免任何 API 金鑰**：

| 按鈕 | 功能 | 說明 |
| --- | --- | --- |
| 🔊 | **自動朗讀（TTS）** | 使用 `speechSynthesis`，自動挑選 zh-TW／zh-HK／zh-CN 中文語音（Windows／macOS 內建），可離線；會移除 Markdown 與 emoji，以句子為單位排隊朗讀，並附保險計時器避免卡住 |
| 🎤 | **語音輸入（ASR）** | 使用 `SpeechRecognition`（zh-TW）即時聽寫，說完自動送出提問；Chrome／Edge 支援，其他瀏覽器會提示改用打字 |

流程：🎤 說出問題 → 即時字幕 → 送到 DeepSeek → 串流回答 → 🔊 自動逐句唸出。

> 想換成雲端語音（Azure／ElevenLabs／MiniMax 等）以獲得更自然的音色與精準嘴型，
> 只要改 `src/speech.js` 的 `Speaker.speak()`；架構已預留 onStart／onProgress／onEnd 回呼。

---

## 巴士站與即時報站

- **已內建 830 個巴士站**（OpenStreetMap，822 個有站名、669 個已對應路線號），圖層面板可開啟「巴士站（OSM）」，點站點會列出經過的路線
- **即時到站**：澳門官方（DSAT「巴士報站」）與 data.gov.mo 的實時服務**沒有開放跨網域（CORS）**，靜態網站無法直呼；本專案提供可插拔設定：
  1. 圖層面板 →「🚌 設定即時報站 API」
  2. 填入任一可回傳 JSON 的網址，網址可用 `{stop}`（站點 ID）、`{name}`（站名）佔位
  3. 回傳格式：`[{"route":"9A","eta":"3 分鐘"}]`（也支援 `route_no`／`min`／`t` 等常見欄位）
- 附 **Cloudflare Worker 代理範本** `worker/bus-proxy.js`：幫你加上 CORS、把 API Key 留在伺服器端

---

## 澳門記憶 · 建築記憶點（拍照 → 辨識 → 編號 → 放進空間）

**核心概念**：以「建築」為單位建立記憶點（Place），每棟建築一個永久編號 `MM-0001`。
同一棟建築不論拍幾次、從哪個角度拍、隔多久再拍，都會自動歸到同一個記憶點 —— 就像用深度學習幫流浪貓做臉部辨識、給每隻貓一個編號一樣。

### 快速開始

```bash
# 1. 手機拍的照片放進 photos-src/（HEIC 也支援；拍照請開啟「記錄位置」）
# 2. 跑產線（可重複執行，已處理過的照片會自動略過）
python tools/photo-archive/pipeline.py

# 常用選項
python tools/photo-archive/pipeline.py --blur-faces     # 自動模糊路人臉
python tools/photo-archive/pipeline.py --list-places    # 列出目前所有記憶點
python tools/photo-archive/pipeline.py --rebuild        # 清空重建（會重新編號）
python tools/photo-archive/pipeline.py --same 0.9       # 提高「同一棟」判定門檻（更保守）
```

### 「拍過了」是怎麼判定的

```
新照片
 ├─ 1. GPS 落入 / 緊鄰同一棟 OSM 建築（或同一景點）→ 取得地理候選（預設 90 公尺內）
 ├─ 2. CLIP 影像向量餘弦相似度驗證（同一棟不同角度仍會相似）
 │      ≥ 0.86 → 併入既有記憶點（新照片加入該建築的時間軸）
 │      ≥ 0.70 → 併入，但標記「待複核」等人工確認
 │      < 0.70 → 建立新記憶點，並標記「待複核」（可能是同棟不同風格面，或旁邊另一棟）
 └─ 3. 沒有地理候選 → 建立新記憶點
```

**實測**（同一棟拍兩次）：

| 照片 | 結果 |
| --- | --- |
| 大三巴牌坊 第 1 張 | 新建 **MM-0001** |
| 大三巴牌坊 第 2 張（裁切、調亮、轉 3 度） | **併入 MM-0001**（相似度 0.90） |
| 澳門旅遊塔 第 2 張 | **併入 MM-0003**（相似度 0.95） |
| 澳門巴黎人、科學館 | 各自新建 MM-0002 / MM-0004 |

→ 6 張照片 = **4 個記憶點**，每棟建築有自己的編號與照片時間軸。

### 自動命名

輸出檔名 = **記憶點編號 + 拍攝時間**，例如 `MM-0001_20260301-143022.jpg`（同一秒多張會加 `-2`）。
原始檔名保留在檔案的 `orig` 欄位。

### 準確度設計（避免出錯）

| 機制 | 說明 |
| --- | --- |
| 地理為主、視覺為輔 | GPS 決定候選，影像相似度決定併入或新建；單靠影像容易誤判（同風格建築會互相像） |
| 待複核佇列 | 低信心者標記 `needsReview`，網站卡片會顯示「待複核」，可人工合併／拆分 |
| 手動覆寫 | `photos-src/labels.csv` 可指定 `記憶點` 欄位強制歸到某個編號，或指定類別與解讀 |
| 累積式註冊表 | `.cache/photo-archive/places-registry.json` 保存每個記憶點的座標與影像向量，可長期累積 |

### 網站端

- 圖層面板開「**記憶點**」→ 地圖上一個記憶點一個點（依類別上色，徽章顯示照片張數）
- 點記憶點 → 彈窗（封面、編號、張數、建築解讀）→「查看 N 張照片」打開**記憶點卡片**：
  大圖 + 照片時間軸（可切換）+ 解讀 + 標籤 + 座標 + 首次/最近拍攝 + 分類依據 + 來源標示
- 景點詳情面板會列出附近的記憶點（含編號）
- 景點標記顯示 📷 數量徽章（照片點被標記蓋住時的主要入口）

### 分類（12 類）與其他

- 類別：葡式殖民建築、中式廟宇、天主教教堂、騎樓與唐樓、現代高層住宅、酒店與娛樂場、公共建築、工業與倉庫、圍里與村落民居、牌坊與紀念物、街市與市集、街景與其他（改類別只要改 `taxonomy.py`）
- CLIP 模型：`.cache/models/clip-vit-base-patch32`（`python tools/photo-archive/fetch_clip_modelscope.py` 從 ModelScope 下載；HF 被封鎖時自動走 hf-mirror）
- DeepSeek 解讀：讀 `public/ai-local.json` 或環境變數 `DEEPSEEK_API_KEY`（沒有金鑰也能跑）
- 授權：自己拍的照片沒問題；用他人照片請在 `labels.csv` 的 `credit` 欄填作者與授權（網站會顯示）

---

## 資料來源與授權

| 資料 | 來源 | 授權 |
| --- | --- | --- |
| 巴士站與路線 | OpenStreetMap 貢獻者，經 Overpass API | ODbL 1.0 |
| 建築、道路、土地利用、水體、POI、行政邊界 | [Overture Maps Foundation](https://overturemaps.org)（含 OpenStreetMap 與 Microsoft ML 建築足跡） | ODbL 1.0／Overture 授權，需標示 © OpenStreetMap contributors |
| 海拔 | **Copernicus DEM GLO-30**，經 [OpenTopography](https://opentopography.org) Global DEM API | © DLR e.V. 2010-2014 / © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA |
| 即時地形圖磚 | Terrain Tiles（AWS Open Data / Mapzen，terrarium 編碼） | Public domain / CC-BY |
| 三維模型 | 專案作者提供之高精度掃描與 AI 生成檔 | 僅供學習研究使用，版權歸原提供者 |
| 程式框架 | MapLibre GL JS（BSD-3）、three.js（MIT）、Vite（MIT）、opencc-js（MIT） | 見各套件授權 |

**海拔重點數字**：澳門陸域面積約 **33 平方公里**、最高點 **172.1 公尺**（路環疊石塘山）、平均高程 20.6 公尺；等高線以 5 公尺間距共 9,956 條。

---

## 導航是怎麼算的

```
OSM/Overture 路網 (public/data/macau-roads.geojson, 20,972 段)
  → 客戶端建圖：6 公尺內重複節點合併（含交叉路口）＋ 連通分量過濾
      步行 53,246 節點 / 55,706 邊　　開車 29,005 節點 / 31,596 邊
  → Dijkstra（權重＝預估行進時間，非距離）
      步行：footway 4.8／steps 2.6 km/h…　開車：motorway 65／primary 45／residential 25 km/h…
  → 回溯路徑 → 依街名合併為逐段指引（含左右轉判斷）
  → 動畫：① 造訪順序波前 ② 路線逐段繪出 ③ 車流光點
```

- 起訖點吸附最近道路節點（預設 500 公尺，失敗時自動放寬、並可換另一種交通方式）
- 計算只需 **4–10 毫秒**（客戶端即時運算，無需伺服器）
- **限制**：Overture 澳門路網沒有單行道屬性，開車路線未考慮單行；未計入即時路況；範圍僅限澳門

---

## 三維模型

| 模型 | 類別 | 檔案 | 原始檔 |
| --- | --- | --- | --- |
| 唐三彩雙峰駱駝俑 | 文物掃描（1:1） | `tang-sancai-camel.glb` 33 萬面 / 2.7 MB ＋ LOD | 76.6 MB / 150 萬面 |
| 明永樂青花輪花紋綬帶耳葫蘆扁瓶 | 文物掃描（1:1） | `yongle-blue-white-flask.glb` 33 萬面 / 2.4 MB ＋ LOD | 72.4 MB / 150 萬面 |
| 澳門旅遊塔 | 地標建築（AI 生成） | `macau-tower.glb` 27 萬面 / 2.3 MB ＋ LOD | 62.0 MB / 193 萬面 |
| 澳門科學館 | 地標建築 | `macau-science-center.glb` 27 萬面 / 2.4 MB ＋ LOD | 61.5 MB / 190 萬面 |
| 澳門巴黎人 | 娛樂度假 | `parisian.glb` 27 萬面 / 3.1 MB ＋ LOD | 65.4 MB / 190 萬面 |
| 澳門倫敦人 | 娛樂度假 | `londoner-macao.glb` 27 萬面 / 2.3 MB ＋ LOD | 56.5 MB / 190 萬面 |
| 澳門銀河 | 娛樂度假 | `galaxy-macau.glb` 26 萬面 / 2.7 MB ＋ LOD | 57.7 MB / 189 萬面 |

處理流程：`weld → simplify(meshoptimizer) → textureCompress(WebP 2048) → quantize → meshopt(EXT_meshopt_compression) → prune`，
並輸出 `.lod.glb`；檢視器採**左模型、右介紹文字**，先載 LOD 再換高精度版本。

### 加入自己的文物模型
1. 把 `.glb` 放進 `public/models/`（Draco 壓縮檔亦可，已附解碼器）
2. 在 `public/models/manifest.json` 加一筆（`file`、`bytes`、`triangles`、`dimensionsMeters`）
3. 在 `scripts/attractions.data.mjs` 的 `ARTIFACTS` 加入文物（`model: "my-artifact"`），並在博物館 `artifactIds` 引用
4. `npm run data:poi && npm run build`

---

## 專案結構

```
├─ index.html                  應用外殼（地圖、側欄、檢視器、導航列）
├─ src/
│  ├─ main.js                  主流程：地圖、標記、面板、圖層、深連結、定位、導航接線
│  ├─ map-style.js             MapLibre 樣式（向量底圖 + 3D 建築 + 地形 + 等高線延遲載入）
│  ├─ markers.js               景點標記（分層顯示、可拖曳校正）
│  ├─ labels.js                地名標籤層（DOM + 碰撞剔除）
│  ├─ pois.js                  周邊設施圖層（分組、縮放分層、點擊小卡）
│  ├─ geolocate.js             個人定位（GPS 藍點、精度圈、距離方位）
│  ├─ routing.js               路網建圖 + Dijkstra + 逐段指引
│  ├─ navigation.js            導航控制與三段動畫
│  ├─ viewer.js                three.js 模型檢視器（LOD → 高精度）
│  ├─ icons.js / i18n.js       圖示、繁簡轉換
│  └─ styles.css
├─ scripts/                    資料管線（Node ESM）＋ dev/ 驗證工具
├─ public/
│  ├─ data/                    GeoJSON、景點、標籤、高程資料（約 21 MB）
│  ├─ dem/                     地形圖磚 z10–15（683 張 / 24 MB）
│  ├─ models/                  7 個 GLB ＋ manifest（24.7 MB）
│  └─ draco/                   Draco 解碼器
└─ preview/                    24 張執行截圖
```

---

## 效能

| 項目 | 數值 |
| --- | --- |
| 首次就緒 | 約 3.8 秒（headless 軟體渲染；等高線 4.3 MB 延遲載入後由 5.4 秒降下） |
| 單次瀏覽傳輸 | 約 8.4 MB（地形圖磚 6 MB、周邊設施 1 MB、GeoJSON 與程式 0.5 MB） |
| 路線計算 | 4–10 毫秒（客戶端 Dijkstra，步行 5.3 萬節點／開車 2.9 萬節點） |
| 3D 建築 | 24,904 棟，依視野自動分塊載入 |
| 模型 | 7 個，每個 2.3–3.1 MB ＋ LOD 0.6–1.5 MB |

---

## 已知限制

- 建築高度以 `height`／`num_floors` 為主，沒有的依類型推估（約 71%）；天際線為「合理推估」
- 地形為 30 公尺網格資料，平坦市區的起伏靠誇大倍率呈現；海底高程已壓平為 0
- 開車導航未考慮單行道（資料缺）；導航範圍僅澳門路網
- 個人定位需 HTTPS 或 localhost；桌機無 GPS 時以 Wi-Fi 推估，誤差可能達數百公尺（已顯示精度圈）
- 地名標籤與周邊設施仍在完善中，部分名稱取自 OSM，可能有缺漏或誤植

---

## 後續優化 · Roadmap

### 短期
- [ ] **日夜光影切換**：`map.setLight()` 方位與色溫，夜間讓建築窗戶發光
- [ ] **PWA 可安裝離線**：Service Worker 快取地圖、地形與模型
- [ ] **手機版底部抽屜**：詳情面板改為可拖曳 bottom sheet，放大標記熱區
- [ ] **降低推估高度比例**：用 OSM `building:levels` 把實測比例由 29% 提升到約 59%（`npm run data:osm && npm run data:merge`）
- [ ] **校正流程自動化**：`npm run apply-fixes` 把匯出的 `macau-coord-fixes.json` 寫回資料檔

### 中期（體驗與內容）
- [x] ~~步行路線規劃~~ → **已完成**（含開車模式、最快路徑動畫、逐段指引）
- [ ] **導航進階**：單行道、即時路況、多點行程、大眾運輸（輕軌／巴士）與語音播報
- [ ] **英文／葡文介面**：資料已有 `name:en` / `name:pt`
- [ ] **景點照片與語音導覽**：補上授權照片（Wikimedia Commons）與語音介紹
- [ ] **更多文物模型**：持續擴充博物館館藏三維掃描
- [ ] **歷史時間軸**：老照片／歷史地圖對照今日 3D 城市
- [ ] **主題路線**：世界遺產步行路線、美食路線一鍵展開

### 長期（技術深度）
- [ ] **更精細的城市模型**：屋頂形狀、3D Tiles／CityGML
- [ ] **即時資料**：巴士到站、輕軌班次、人流
- [ ] **室內導覽**：博物館室內 3D 平面與文物定位
- [ ] **測試與 CI**：資料管線與前端單元測試，GitHub Actions 自動建置與部署 GitHub Pages
- [ ] **向量圖磚化**：24,904 棟建築改以 PMTiles 提供，首屏更快

---

## 授權

- **程式碼**：MIT（見 [LICENSE](LICENSE)）
- **資料**：各自授權，使用時請保留標示（見上方「資料來源與授權」）
- **引用**：`Linference (2026). 澳門立體誌 3D Macau Atlas. https://github.com/Linference/macaumemory`
