# 獨立實拍採集計畫（GMVR 評測）

更新：2026-10-29。本計畫對應 `docs/evidence-register.md` 中「獨立實拍驗收：指標待採集」一項，目標是產出可在 ISEF 答辯中被追問的數字：**純影像、位置輔助、多照片一致**三種規則在同一批獨立照片上的比較。

評測工具已就緒：

- `tools/recognize/independent_queries.py`：凍結參考庫、審核來源與隔離。
- `tools/recognize/independent-eval.mjs`：與網頁同一套排序、判定規則；不在測試集上調參。

## 1. 採集前先登記（預先登記，之後不改）

在第一張測試照拍攝**之前**填好下表，並 `git commit`；commit 時間就是預先登記的證據。結果出來後不得回頭修改門檻或標準。

| 項目 | 值 |
|---|---|
| 參考庫 | `public/data/memory-embeddings.json`，38 棟、335 張；SHA-256 寫入 manifest 的 `librarySha256` |
| 判定門檻 | `hit 0.82`、`maybe 0.57`（庫的 `eval.suggested`，留一法得出，凍結） |
| 標準 1：庫外誤接受率 | Wilson 95% 上限 ≤ ___%（建議 3%） |
| 標準 2：高信心判定精確率 | 點估計 ≥ ___%（建議 95%） |
| 標準 3：庫內正確自動接受率 | 只報告，不設門檻（它與標準 1 互相取捨） |
| 假設：多照片規則 | 與首張單拍相比，庫外誤接受**減少**；代價是部分庫內正確接受改為人工確認 |
| 登記日期／登記人 | ___ |

## 2. 樣本量

以下數字用專案自己的 Wilson 區間（`proportion()`）算出，與報告使用的統計一致。

**庫內建築：Top-1／正確接受率的區間寬度**

| 預期比例 | ±10% | ±7% | ±5% |
|---|---|---|---|
| 70% | 78 張 | 161 張 | 320 張 |
| 80% | 60 張 | 125 張 | 245 張 |
| 90% | 34 張 | 72 張 | 141 張 |

**庫外建築：0 次誤接受時能宣稱的上限**

| 0 / n 誤接受 | 可宣稱誤接受率 ≤ |
|---|---|
| n = 73 | 5% |
| n = 125 | 3% |
| n = 189 | 2% |

**多照片比較（McNemar 配對檢定）**：至少要有 6 組「首張接受、多照片不接受」且反方向為 0，才可能達到 p < 0.05。若首張單拍在庫外建築上的誤接受率約 10%，約需 60 組庫外照片組。

**建議採集量（約 360 張，每次到訪 3 張 = 1 組 `viewGroup`）**

| | 建築數 | 到訪 | 每次張數 | 組數 | 張數 |
|---|---|---|---|---|---|
| 庫內 | ≥ 30 棟（共 38 棟） | 每棟 2 次（不同日期，最好不同攝影者） | 3 | 60 | 180 |
| 庫外 | ≥ 60 棟不同建築 | 1 次 | 3 | 60 | 180 |

每張照片也會單獨計入「純影像／位置輔助」的單張統計。同一組照片彼此相關，所以**建築數比張數更重要**：每棟庫內建築最多 6 張測試照，不要集中拍少數幾棟。

## 3. 隔離規則（審核會自動檢查，不通過就不產生數字）

- **攝影者不能出現在參考庫**：參考庫中「使用者提供」的照片若是某位隊員拍的，這位隊員就不能拍測試照。
- 每次外出是一個 `captureGroup`，例如 `2026-11-08-taipa-alice`；它不能和參考照片的 `captureGroup` 相同。
- 同一位攝影者、同一個 `captureGroup` 只能屬於 `test` 或 `calibration` 其中一邊。門檻已凍結，本計畫只需要 `test`。
- `independentCapture: true` 必須逐張明確填寫；與參考照片位元組相同的照片會被拒絕。
- 一個 `viewGroup` 必須是同一棟、同一攝影者、同一次外出的 2–3 張照片。
- **參考照片的來源欄位要先補齊**：`--init` 產生的模板裡 335 張參考照片的 `photographer`、`captureGroup`、`capturedAt`、`source` 目前都是空的，審核不會通過。Wikimedia 照片的作者可從 `fetch_references.py` 記錄的中繼資料取得；使用者提供的照片要找到實際拍攝者。

## 4. 現場拍攝規範

**每次到訪拍 3 張**，互相之間要有明顯差異，否則會被判為「資訊重複」（特徵相似度 > 0.995）：

1. 正面或主要立面，整棟建築入鏡。
2. 換到左或右斜約 30–60°。
3. 換距離（走近或退遠），或換到另一側立面。

**分層**：每個人在每次外出時，刻意涵蓋以下困難情況，並記在 `source` 備註中：

- 夜景
- 部分遮擋（樹、車、施工圍板）
- 路氹相似酒店群（倫敦人、巴黎人、銀河、威尼斯人）
- 遠距離拍攝
- 雨天或逆光

**庫外建築要挑「容易混淆」的**，例如：其他教堂、其他賭場酒店、未建檔的騎樓／唐樓、其他葡式立面、其他廟宇。只拍明顯不同的建築，誤接受率會被高估得過於樂觀。`buildingId` 寫成 `unknown:<自訂名稱>`，同一棟不同組要用同一個名稱。

**位置**：只填這張照片本身拍攝時的位置，並設 `confirmedPhotoLocation: true`。`accuracyM` 必須有值（iPhone 的 EXIF `GPSHPositioningError` 可用；否則在拍照當下用辨識頁的定位功能記錄精度）。沒有可靠精度就不要填 `location`，該張只計入純影像。

**隱私**：只拍建築；畫面中清楚可辨的路人臉孔，比照 `tools/photo-archive/pipeline.py --blur-faces` 的人臉模糊處理後，再以模糊後的檔案作為 `path` 放入測試集。本採集只由隊員拍攝建築，不涉及其他人使用 app 或填問卷，不屬於人類參與者研究。若要找隊員以外的人幫忙拍或試用 app，先向賽區 SRC 確認，必要時先取得 IRB 核准。

## 5. manifest 範例

```json
{
  "id": "taipa-alice-0001",
  "path": "photos-src/independent/2026-11-08-taipa-alice/IMG_0001.jpg",
  "buildingId": "taipa-houses",
  "split": "test",
  "independentCapture": true,
  "captureGroup": "2026-11-08-taipa-alice",
  "photographer": "Alice",
  "capturedAt": "2026-11-08T15:42:10+08:00",
  "source": "隊員實拍；iPhone 15；逆光",
  "viewGroup": "taipa-houses-2026-11-08-alice",
  "location": { "lng": 113.5531, "lat": 22.1534, "accuracyM": 8, "capturedAt": "2026-11-08T15:42:10+08:00", "source": "exif" },
  "confirmedPhotoLocation": true
}
```

## 6. 執行步驟

```sh
python tools/recognize/independent_queries.py --init
# 編輯 tools/recognize/out/independent/manifest.template.json：補齊參考照片來源、加入 queries
python tools/recognize/independent_queries.py --manifest tools/recognize/out/independent/manifest.template.json --audit-only
python tools/recognize/independent_queries.py --manifest tools/recognize/out/independent/manifest.template.json
node tools/recognize/independent-eval.mjs tools/recognize/out/independent/queries.json
```

輸出的 `report.md` 有三張表：

- 純影像 vs 位置輔助（單位：張）
- 首張單拍 vs 多照片一致（單位：組，附 McNemar 精確 p 值）
- 每張／每組的逐筆結果（在 `report.json`），用於錯誤分析

## 7. 報告時的口徑

- 只報告 `test`；門檻沒有用測試集調整過。
- 同組照片有相關性，Wilson 區間按張計算，不等於跨建築泛化的完整不確定性；同時報告建築數與外出次數。
- 位置輔助實際使用的張數太少時，不宣稱改進。
- 多照片規則只會減少自動接受，結論應寫成「誤接受減少多少、改為人工確認的比例增加多少」，而不是「準確率提高」。
- render、留一法、獨立實拍、端到端結果分開列出，不互相替代。
- 本評測只測整張圖檢索，不包括 YOLO 偵測與瀏覽器速度。
