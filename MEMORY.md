# 澳門記憶 · SESSION MEMORY（交接記憶）

> 這份文件是從上一個爆掉的會話 `session-741f5a28`（264 MB 匯出檔）整理出來的專案記憶。
> 寫於 2026-09-23 09:00。之後新開會話，先讀這一份就能接著做。

---

## 1. 專案一句話

**澳門立體誌 / macaumemory** —— 3D 立體澳門地圖網站 + 「建築記憶點」拍照建檔系統。

| 項目 | 位置 |
|---|---|
| 線上版 | https://linference.github.io/macaumemory/ |
| 本機版 | http://127.0.0.1:4173/ （`啟動澳門立體誌.bat` 一鍵啟動；`npm run dev` 開發模式走 5173） |
| GitHub | https://github.com/Linference/macaumemory |
| 最新 commit | `e80ced3` feat(memory): 建築記憶點系統（拍拍自動歸戶 + 永久編號 + 視覺重辨識） |
| 工作目錄 | `D:\Users\LINKIT\Desktop\澳门记忆` |

## 2. 技術棧

- 前端：Vite + **MapLibre GL**（地圖/DEM 地形）+ **three.js**（GLB 模型檢視、導航動畫）
- 資料：OpenStreetMap（建築、道路）、OpenTopography（COP30 高程）、Overpass（巴士站）、專案自製 GeoJSON
- AI：DeepSeek `deepseek-flash`（對話＋建築解讀；思考模式可切）
- 視覺：本機 **CLIP**（`transformers` + PyTorch CUDA，RTX 5070 8 GB）＋ **YOLO**（人物偵測／人臉模糊）
- 語音：瀏覽器內建 `speechSynthesis`（TTS）＋ `SpeechRecognition`（ASR），免金鑰
- 部署：GitHub Actions → GitHub Pages（可選 CNAME 自訂網域）

## 3. 已上線功能

1. 3D 地形 + OSM 建築（8,112～18,470 棟）、DEM 等高線、水系、土地利用
2. **61 個景點**標記 + 點擊看簡介與 **GLB 立體模型**（大三巴、巴黎人、旅遊塔、科學館、銀河、倫敦人、唐三彩駱駝、青花扁瓶…）
3. 251 個地名標籤、POI 搜尋、可平移範圍限制（澳門 + 6 km 緩衝）
4. 圖層面板：巴士站（OSM 830 站／669 站有路線號）、輕軌、水系、等高線、**實景照片**
5. 導航：最快路徑搜尋 + 霓虹路線車流動畫 + 逐段指引
6. GPS 個人定位、全屏模式、深連結（`#zoom/lat/lng`）
7. AI 對話框（DeepSeek，可連動地圖跳點）+ 語音朗讀 🔊 / 語音輸入 🎤
8. (已移除) 程式化 3D 數位人「小澳」——程式碼保留在 git `9c5a693`，之後改用 GLB 版本

## 4. 建築記憶點系統（核心新功能，turn 33 完成）

使用者要的語意：**像貓臉辨識給每隻貓一個永久編號**，套在建築上——同一棟樓永遠同一個號，再拍一次要能自動認出併入。

```
新照片
├─ EXIF 取 GPS / 拍攝時間（iPhone HEIC 也支援）
├─ 自動轉正 → 產生網站大圖 + 縮圖
├─ YOLO 人物偵測（＋可選人臉模糊）
├─ CLIP 零樣本分類（12 類，靠 taxonomy.py 的 30 條英文提示詞）
├─ 位置推斷分類（用 24k 建築 + 61 景點，**優先採用**）
├─ 比對最近景點／建築 → 判定「這張拍的是哪棟」
├─ DeepSeek 寫 2–3 句建築解讀 + 標籤
└─ 歸戶（Visual Place Recognition）
     ├─ GPS 90 m 內的既有記憶點當候選
     ├─ CLIP 影像向量餘弦相似度 ≥ 0.86 → 併入既有記憶點
     ├─ ≥ 0.70 → 併入但標「待複核」
     └─ < 0.70 或無地理候選 → 新建記憶點 MM-####
```

- 自動命名：`MM-0001_20260923-084444.jpg`（編號 + 拍攝時間）
- 產出：`public/data/photo-archive.json`（完整檔案）+ `public/data/photos.geojson`（地圖圖層）
- 已有測試資料：MM-0001 大三巴牌坊、MM-0002 澳門巴黎人、MM-0003 澳門旅遊塔、MM-0004 澳門科學館（含「同棟第二次拍 → similarity 0.903/0.946 → merge」的驗證紀錄）

### 關鍵檔案

| 檔案 | 作用 |
|---|---|
| `tools/photo-archive/pipeline.py` | 產線主體（一鍵：照片 → 分類/解讀/歸戶 → GeoJSON） |
| `tools/photo-archive/taxonomy.py` | 12 類建築分類 + 30 條 CLIP 提示詞 |
| `tools/photo-archive/fetch_clip_modelscope.py` | 從魔搭／hf-mirror 下載 CLIP 權重到 `.cache/models/clip-vit-base-patch32` |
| `src/photos.js` | 網站端照片／記憶點圖層、彈窗、相簿、景點標記 📷 徽章 |
| `public/data/photo-archive.json` | 記憶點檔案（含 cls / conf / clsSource / clsWhy / clipTop / similarity / decision） |
| `scripts/dev/clip-*.py`、`explain-tech.py` | **未提交**的 CLIP 驗證腳本（turn 33–35 產物） |

## 5. 上一個會話為什麼爆掉（已用日誌證實，不是猜的）

**根因：那個會話用的是 `minimal` 代理預設，而 minimal 預設「沒有壓縮」。**

minimal preset 的原文註解就寫著：*"Context compaction is absent."*——它只提供一個常駐 `pwsh` 工具（連 fs/todo 工具都沒有）。

證據（`session-741f5a28` 的 3,086 筆事件）：

| 觀察 | 意義 |
|---|---|
| `seq=3 agent-preset/selected → minimal` | 全場用 minimal 預設 |
| 3,086 筆事件中 **0 筆 `compaction/*`** | 自動壓縮從未存在 |
| turn 20 / 21 使用者打的 `/compact` 變成 **普通 user 訊息**（訊息數 +3 token） | 該預設沒有 `/compact` 指令，斜線字串被當提示詞送出 |
| turn 18–21 錯誤：`795,20x in the messages, 256000 in the completion` | 撞 1 M 視窗 |
| 09-22 08:44 起 `maxTokens` 已改為 **65536** | 上限從 792 K 抬到 983 K，續命一天 |
| turn 35（今天 08:55）`983481 in the messages, 65536 in the completion` | 沒有壓縮 → 又撞新牆，會話死亡 |

**教訓：maxTokens 只是把牆往後推；真正需要的是「壓縮」。** 長會話不要用 minimal 預設。

## 6. 防再爆規則

1. 長會話一律用 **standard** 代理預設（有自動壓縮 + `/compact` + 完整工具）。在 UI 的代理預設選擇器切換。
2. 要手動壓縮時：輸入框打 `/`，**從彈出選單選 compact** 再 Enter（直接手打整行會被當普通訊息送出）。
3. `$DSH_HOME/settings.yaml` 已設 `llm-deepseek: maxTokens: 65536`（**不要**改回 256000）。
4. 大檔（日誌、GeoJSON、GLB）用腳本摘要後再讀，不要把整份內容貼進對話。
5. 需要保留的結論寫進 `MEMORY.md`（本檔），不要只留在對話裡。

## 7. 未完成的下一步

1. **CLIP 圖文對齊疑點收尾**（turn 35 中斷處）：文字相似度排序不合理（「一碗麵」竟高於「教堂前壁」）；已驗證程式兩條路徑一致、權重與投影正確，懷疑測試圖是 App 截圖（out-of-distribution）。真照片實測 CLIP 偏向通用類別（人 0.223／貓 0.194），建築類別信心只有 ~11%。
   - 方向：提示詞集成＋多裁切（multi-crop）、把「位置推斷」當主分類（現況已是）、或改用更強的視覺模型／少量標註微調。
2. **網站端記憶點 UI**：記憶點聚合、單棟時間軸、`needsReview` 待複核佇列。
3. **手機端拍照入口**：PWA / 上傳頁，讓照片直接進產線。
4. README Roadmap 的數位人（改成 GLB 虛擬人 + blend shape 嘴型）。

## 8. 常用指令

```powershell
cd 'D:\Users\LINKIT\Desktop\澳门记忆'
npm run dev                 # 開發模式 http://127.0.0.1:5173
npm run build; npm run preview   # 打包預覽 http://127.0.0.1:4173
python tools\photo-archive\pipeline.py   # 跑照片產線（需 CLIP 權重已在 .cache）
git push                    # 觸發 GitHub Pages 自動部署
```

---

## 9. ISEF 參賽包裝進度（2026-09-23 起）

**目標**：澳門創新學界（ISEF 選拔賽），類別 **Technology Enhances the Arts (TECA)**，兩週內交付。

### 已完成：量化評測（`tools/eval/`）

一鍵重現：`render_views.py` → `build_dataset.py` → `evaluate.py` → `analyze_errors.py`（詳見 `tools/eval/README.md`）。
資料集：7 個 GLB 模型 × 20 視角 = 140 張受控渲染 + 4 張既有地圖截圖 + 2 張裁切對照。

| 實驗 | 結果 |
|---|---|
| E1 同環境多視角（5 棟建築） | **AUC 0.950**；同棟 0.901±0.036、不同棟 0.758±0.073；閾值 0.86 → 認出率 86.1%、誤判率 12.2% |
| E1b 文物（唐三彩／青花扁瓶） | **AUC 0.998**；閾值 0.86 → 誤判 0% |
| E2 跨條件（仰角／距離／光照） | **AUC 0.850**（下降）；閾值 0.86 認出率僅 46% → 實拍應放寬到 ~0.80 |
| E3 文物 vs 建築誤併風險 | 37/2400 對 > 0.86（1.5%） |
| E4 跨呈現方式（渲染 ↔ 地圖截圖） | 平均僅 **0.66** → 域偏移嚴重，證明照片來源必須一致 |
| E5 資料洩漏對照 | 舊流程「同棟第二張」是**原圖裁切**（0.946/0.903），已排除；真實多視角 0.901 |
| E6 CLIP 零樣本分類 | top-1 僅 **2.8%**（舊聚合 0.9%）→ 分類不可靠，**位置推驗必須當主分類**（現行設計正確） |

**錯誤分析（最有說服力的一段）**：所有誤判都集中在路氹城三間相似的度假村
（倫敦人 vs 銀河 72.2%、巴黎人 vs 銀河 31.2%、倫敦人 vs 巴黎人 18.8%），
其他配對誤判率 **0%**；而這些建築兩兩相距 **≥296 m** → 90 m 的 GPS 先驗可直接排除全部誤判候選。
**結論句**：視覺只負責「同一棟的不同角度」，地理先驗負責「不可能是我」——兩者互補。

### 下一個關鍵路徑（使用者要做的事）

**實拍照片**：`photos-src/real/<building_id>/`，每棟 3~5 張（正面／45°／側面／近景／遠景），
優先 8 棟（大三巴、旅遊塔、科學館、巴黎人、銀河、倫敦人、威尼斯人、保利美高梅博物館）。
協議與命名見 `tools/eval/SHOOTING.md`。拍完後重跑 build_dataset + evaluate 即得實拍版數字。

### 已完成：真實照片資料集與真實世界評測（2026-09-23，第二階段）

**資料來源**：Wikimedia Commons（開放授權，含作者／授權／日期），
`python tools/photo-archive/fetch_commons.py` → **101 張、20 棟澳門建築、11 個類別**
（大三巴、媽閣廟、觀音堂、玫瑰堂、聖老楞佐堂、主教座堂、鄭家大屋、龍環葡韻、港務局大樓、市政署大樓、
福隆新街、紅街市、路環市區、荔枝碗船廠、旅遊塔、葡京、威尼斯人、議事亭前地、大三巴街景、氹仔舊城區）。
授權分布：CC BY-SA 4.0 ×29、CC BY 2.0 ×17、CC BY-SA 3.0 ×19、公有領域 ×13、CC BY 3.0 ×9、CC0 ×7、其他 ×7。
檔案在 `photos-src/cc/<building_id>/`，標註在 `photos-src/cc/ATTRIBUTION.csv`；聯絡表 `tools/eval/out/cc-contact-sheet.jpg`。

**真實世界重辨識（E1r）**：205 組正樣本 / 4845 組負樣本（同棟不同攝影者、年份、角度）
→ **AUC 0.796**；同棟 0.716±0.136（5% 分位 0.448）、不同棟 0.578±0.093。

| 閾值 | 渲染：認出 / 誤判 | 實拍：認出 / 誤判 |
|---|---|---|
| 0.70 | 100.0% / 75.8% | **61.0% / 8.8%** |
| 0.80 | 99.1% / 27.9% | 28.8% / 0.9% |
| 0.86（現行產品值） | 86.1% / 12.2% | **14.1% / 0.0%** |

→ **結論：0.86 是在渲染圖上調出來的，套到真實照片只認得出 14.1%；實拍應改用 0.70–0.80，精確率交給地理先驗。**

**分類（E6）分層**：實拍 **53.5%**（n=101）vs 渲染 3.0%（n=100）
→ 先前「CLIP 分類只有 2.8%」的結論是**在分布外的渲染圖上測出來的假象**；真實照片上零樣本分類可用但不足以單獨決定類型。

**跨域（E4）**：渲染↔實拍平均相似度僅 **0.563**（渲染↔地圖截圖 0.661）→ 域偏移再次確認。

**隱私模組修好並實測**：根因是 **OpenCV 5.0 移除了 `cv2.CascadeClassifier`，且其 ONNX 解析器讀不了 YuNet 2023mar**
→ 人臉模糊一直是靜默失效。改用 `yolov11n-face.pt`（hf-mirror 取得）＋ yolo11n person 做**兩級模糊**，
方法與次數寫進輸出 `privacyBlur`。實測 107 張（6 測試 + 101 實拍）：45 張偵測到物件，
**模糊人臉 28 處、人物 205 處**（yolo-person 31、yolo-face+yolo-person 13、yolo-face 1、無 62）。

**資料完整性修正**：早期檔名截斷 70 字造成 4 張圖互相覆蓋（ATTRIBUTION 101 筆但只有 97 個檔案，
且重複列會讓同一張圖被當成不同照片 → E1r 虛高到 0.813）。
已加雜湊後綴修根因、用 `repair_cc_collisions.py` 救回 4 張，現為 **101 筆 = 101 個檔案**，AUC 修正為 0.796。

### 待辦

1. 學生手機實拍（`photos-src/real/`）→ 第三層驗證（協議見 `tools/eval/SHOOTING.md`）
2. 依實測把 `pipeline.py` 的 `--same` 預設從 0.86 改為 ~0.75，並加人工複核佇列（**需使用者確認**）
3. 中英文摘要 Abstract（250 詞）+ 參賽版 README
4. 把 `tools/eval`、`tools/poster`、`tools/demo`、`tools/photo-archive`、`tools/mascot`、`MEMORY.md` commit（尚未提交）

### 已完成：吉祥物阿獅（`tools/mascot/`，2026-09-23）

使用者用生圖工具產生阿獅三視圖（大三巴石獅寶寶），已接進網站：
`public/mascot/ashih-{front,side,back,avatar}.jpg`（`prepare_assets.py` 裁掉生成器水印並做 512×512 頭像裁切）。
網站改為**吉祥物對話面板**：`index.html` 新增 `.ai-hero` 歡迎頁（大圖阿獅＋自我介紹）、
`.ai-head-avatar`、`.ai-msg-row`（每則阿獅回覆帶頭像）；`main.js` 的 `addAiMsg()` 改成頭像＋氣泡列；
`chat.js` 的系統提示詞換成阿獅人格（會跳地圖、不編造、被問準確率時誠實回答 AUC 0.796）。
提示詞包在 `PROMPTS-阿獅.md`、人格在 `persona.txt`。

### 已完成：YOLO 澳門建築偵測資料集（`tools/yolo-dataset/`，2026-09-23）

目的：讓 YOLO 真的能認建築（COCO 無此類別）。流程：抓圖 → CLIP 清洗 → YOLO-World 自動框 → 分層分組切分。

| 階段 | 結果 |
|---|---|
| 抓圖（Commons 策展分類優先 + 全文檢索補足） | **1116 張**、11 類（授權記在 `datasets/macau-buildings/ATTRIBUTION.csv`） |
| CLIP 清洗（類別關＋雜物關＋室內關） | 保留 **496 張（44%）**，其餘移到 `images/rejected/`（`--restore` 可還原） |
| YOLO-World 自動框（類別用資料夾標籤） | **379 張**有框 |
| 防洩漏＋分層切分（CLIP 聚組） | train **322** / val **57**，**11 類在 val 都有代表** |

各類 train/val：portuguese 32/6、temple 37/6、church 31/5、tong_lau 21/4、residential_tower 21/4、
casino_hotel 29/5、civic 29/5、industrial **14**/3、village 47/8、monument 51/9、market **10**/2。
（`industrial`/`market` 樣本過少，AP 會偏低 → 建議補抓或先只訓 9 類。）

踩到的三個坑（都已修）：
1. Commons 全文檢索會回傳店內商品、吊燈、酒杯 → 改用**策展分類** `Category:...` 為主。
2. 雜物關用絕對閾值幾乎不觸發 → 實測校準後改用**相對判定**（雜物分 > 最佳建築類分）。
3. 室內關會把 `market`/`industrial` 殺光（街市內部、船廠本來就是主體）→ 這兩個類別豁免。
4. 整組切分導致 church 全進 val、village/market 全進 train → 改為**按類別分層**的分組切分。

下一步（使用者）：`labelImg datasets\macau-buildings\images\train` 修正框 → `python tools\yolo-dataset\train.py`。

### 已完成：訓練與驗收（2026-09-23 下午）

`python tools\yolo-dataset\train.py --epochs 100 --batch 16` → 權重 `datasets/macau-buildings/runs/train/weights/best.pt`
（另存 `.cache/models/yolo/macau-buildings-best.pt`），約 25~35 秒/輪。

**驗證集（val 69 張，弱標註）**：mAP50 **0.594**、mAP50-95 0.410、P 0.77 / R 0.50
各類 AP50：temple 0.995、portuguese 0.845、residential_tower 0.822、church 0.795、monument 0.675、
industrial 0.670、village 0.650、tong_lau 0.404、casino_hotel 0.318、civic 0.271、market 0.089。

**獨立驗收（`eval_on_cc.py`，用 photos-src/cc 的照片，排除不在偵測器類別內的 street）**：

| 組別 | 張數 | 偵測率 | 類別準確率 | 平均信心 |
|---|---|---|---|---|
| 訓練時見過 | 72 | **85%** | **75%** | 0.86 |
| 完全沒見過 | 19 | **37%** | **57%** | 0.61 |

→ **val 的 0.594 是樂觀上界**；沒見過的照片偵測率掉到 37%，泛化仍弱。
主因：資料少（train 322，每類 ~30）、標註是自動弱標註、未見過組樣本小（19 張）且風格不同（夜拍、近景）。

**一個要更正的判斷**：先前用 CLIP 相似度說「val 有 39% 與 train ≥0.85＝洩漏」是**過頭了**——
細看案例後發現很多是「不同建築長得像」（例：聖多明我教堂 vs 聖老楞佐教堂 0.934），
同類建築本來就高度相似。已改用檔名建築鍵＋CLIP 的分組切分，並以獨立照片集驗收取代單看 val。

**提升路徑（依投報率排序）**：① 人工修框 1~3h（弱標註是最大瓶頸）② 補抓 church/tong_lau/industrial/market
③ 增加 epochs 與更強增強 ④ 把 detector 接進產品管線（CLIP 分類信心低時用它兜底）。



### ⚠️ 誠實性修正（2026-09-23，使用者質問「真的用了 YOLO 和 CLIP 嗎」後的查核）

**CLIP：確實使用且可複驗。** `pipeline.py` 的 `ClipEngine` 用 transformers CLIPModel
（權重 `.cache/models/clip-vit-base-patch32`，577 MB）；本次 `evaluate.py` 在 CUDA 上編碼 146 張圖，
獨立算出的 0.903 / 0.946 與 archive 記錄一致。**所有辨識指標都只來自 CLIP。**

**YOLO：模型真的跑了（`yolo11n.pt` 5.4 MB 在專案根目錄），但原表述過度宣稱，已修正：**
- 實測 6 張測試圖僅 1 張偵測到物件，且類別錯誤（`refrigerator`）——測試圖是 3D 渲染，對 YOLO 屬分布外，
  **不能用來評估 YOLO 效果**。
- **`facesBlurred: 0` 是假的**：OpenCV 5.0 已不再隨附 `haarcascade_frontalface_default.xml`
  （`cv2/data/` 只剩 `__init__.py`），`cv2.CascadeClassifier()` 拿到空分類器 → `blur_faces()` 永遠回 0。
  即「沒偵測到臉」實為「根本沒偵測」。
- 修正：`Detector` 顯式檢查級聯檔；不可用時**退回 YOLO person 模式**（偵測 person 類並模糊整個人員區域），
  並把實際方法與次數寫進輸出（新增 `privacyBlur: {method, count, reason}`）；
  新增 `tools/photo-archive/verify_detector.py` → `tools/eval/out/yolo-check.json`；
  演示頁第②步改顯示實測值；展板 ④ 新增 YOLO 實測與「指標僅來自 CLIP」兩條；
  評測報告新增「範圍界定」。


### 已完成：離線演示頁 + 90 秒劇本（`tools/demo/`）

`python tools/demo/build_demo.py` → `tools/demo/index.html`（61 KB，內嵌 photo-archive.json 與澳門邊界，
**file:// 可離線執行**）。現場話術與 Q&A 見 `tools/demo/DEMO.md`，操作見 `tools/demo/README.md`。

- 三面板：① 六步歸戶流程（逐步亮起）② 手機（照片／EXIF／判定卡／同棟時間軸）③ 記憶點地圖 SVG
  （永久編號＋90 m 地理先驗圈＋路氹城相似度假村群標註）。
- 「▶ 開始 90 秒示範」自動播 5 幕（10/22/22/16/20 秒）；空白鍵逐步、R 重播、D 答辯細節、F 全螢幕。
- **示範數字全部取自產線實際輸出**（0.903 merge 等），頁首標籤明示「示範重播」「測試素材為 3D 截圖非實拍」。
- 沙箱無瀏覽器 → 附 `smoke_test.mjs`：用最小 DOM 樁在 Node 內真的執行頁面腳本（驗證資料、照片路徑、
  5 幕流程產出關鍵結果），目前 **全部通過**；`check_map.py` 驗證地圖投影與落點。


### 已完成：A0 展板（`tools/poster/`）

`python tools/poster/build_poster.py` → `tools/poster/out/澳門記憶_展板_A0.pdf`（A0 直式，向量文字＋向量圖表，
作品圖帶 8 張系統截圖）+ `…_A0.png` 預覽。詳見 `tools/poster/README.md`。

- 技術路線：沙箱禁止啟動瀏覽器 → 用 **PyMuPDF** 排版並自己 rasterize 預覽；
  圖表以 **SVG → convert_to_pdf → show_pdf_page** 嵌入（放大不失真）；QR 由 reportlab 產生後同樣轉 PDF 嵌入。
- 版面：標題帶＋作品圖帶 / 研究問題＋三個創新點 / ①方法流程 / ②結果一（ROC＋分布＋大數字）/
  ③結果二（閾值表＋誤判來源）/ ④資料來源與研究誠信 / ⑤限制與下一步。
- 腳本會印 `[layout] 內容底部 y = …` 做溢出檢查（目前 1151 mm < 頁腳 1163 mm，OK）。
- 送印：**100% 原尺寸**、不要 fit to page；建議霧面 PP 或相紙＋啞膜。
- 實拍照片到位後：把結果（一）換成實拍版圖表、圖帶加入學生實拍照。



### 已完成：建築普查建檔（資料庫 ＋ GPS 精準定位 ＋ 建檔表單）

產品定位從「辨識這是哪一棟名建築」改成**普查建檔**：拍照 → 判類型 → 取 GPS → 給編號 → 入庫。
「標記為新發現」原本只是查重 < 0.48 時的次要分支，現在升為**每次辨識後都顯示的主流程**。

| 檔案 | 作用 |
|---|---|
| `src/recognize/db.js` | SQLite（**@sqlite.org/sqlite-wasm**）：schema、`MM-YYYY-NNNN` 配號、R-Tree 空間查重、統計、匯出 JSON／`.sqlite` |
| `src/recognize/geo-math.js` | 純地理計算（haversine、R-Tree 查詢框、精度圈、1/accuracy² 加權、最終精度估計） |
| `src/recognize/geolocate.js` | 多次取樣的狀態機：停止條件、來源判定、每一種失敗的中文訊息與補救建議 |
| `src/recognize/minimap.js` | 手動定位用的 MapLibre 小地圖（精度圈、可拖曳標記、街道／景點名、選用建築輪廓） |
| `src/recognize/survey.js` | 建檔表單（類型／GPS／編號／名稱／備註／查重提示／存檔） |
| `src/recognize/ledger.js` | 「③ 普查資料庫」面板：總筆數、依類型統計、記錄列表、匯出、localStorage 鏡射 |

- **為什麼不用 sql.js**：實測 `sql.js@1.14.2` 的 WASM **沒有編進 R-Tree**（`CREATE VIRTUAL TABLE … USING rtree`
  → `no such module: rtree`），而普查的核心需求就是 R-Tree 查重；官方 `@sqlite.org/sqlite-wasm@3.53.4`
  的 `compile_options` 有 `ENABLE_RTREE`（另有 FTS5／JSON／OPFS VFS，第二階段持久化可直接沿用）。
- **WASM 在 Vite 的載入方式**（先前踩過 `Cannot import non-asset file … inside /public` 的白屏）：
  套件在 `node_modules`，用 Vite 的資產寫法 `import url from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url"`
  再交給 `initSqlite({ locateFile })`；**不要放 `public/` 再 import**，也不要讓套件自己用
  `import.meta.url` 猜（打包後會 404）。`vite.config.js` 的 `optimizeDeps.exclude` 必須含這個套件。
  dev（`/node_modules/.../sqlite3.wasm`）與 build（`assets/sqlite3-<hash>.wasm`）都已實測。
- **筆電沒有 GPS 晶片**是設計前提：一律顯示 accuracy；精度 >30 公尺 → 「此裝置可能沒有 GPS 晶片（筆電常見）」
  並**自動展開手動定位**（直接載入建築輪廓讓人對位）；樣本離散 >50 公尺 → 「讀數跳動過大」。
  最終精度**保守**：讀數完全一致時就回報最佳單次精度，不除以 √n 假裝變準。手動座標 `geo_source='manual'`、
  `accuracy_m=NULL`，原 GPS 讀數留在 `geo_note`。
- **第一階段不做 OPFS 持久化**：資料庫在記憶體，靠匯出 `.sqlite`／JSON 保存（每筆同時鏡射到
  localStorage `macau-memory.pending-discoveries`）。持久化介面已預留：`openDb({ persistence })`
  換一個有三個非同步方法的 adapter 即可，其餘程式碼不用動。
- 測試：`tools/recognize/browser-check-survey.mjs`（新 E2E，用 CDP `Emulation.setGeolocationOverride`
  造出理想／精度差 120 公尺／讀數跳動三種情境，並用 Python 內建 sqlite3 驗證匯出的 `.sqlite` 可攜）、
  `check-survey-db.mjs`、`check-survey-geo.mjs`、`check-exported-sqlite.py`；
  既有 `browser-check.mjs`、`browser-check-discover.mjs` 的斷言配合新流程調整（改動理由寫在檔案開頭）。
