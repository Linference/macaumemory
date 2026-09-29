# tools/recognize · 建築辨識（上傳照片 → 認出是哪一棟）

把「使用者拍一張澳門建築照片」變成「這是哪一棟記憶點建築 + 相似度 + 可點進三維模型」。

```
照片
 ├─ ① YOLO11s（11 類澳門建築，768px）框出建築          public/models/macau-buildings-yolo.onnx
 ├─ ② 裁切該框
 ├─ ③ DINOv2 ViT-S/14（336px）取 384 維向量            public/models/dinov2-vits14-336.onnx
 └─ ④ 與記憶點嵌入庫算餘弦相似度 → Top-3               public/data/memory-embeddings.json
```

前端在 `recognize.html` + `src/recognize/`（原生 ES modules、無框架）。
主站 `index.html` 右上角相機圖示是入口；辨識結果的「在地圖上開啟」用 `?spot=<id>` 深連結回主站。

---

## 一、編碼器選型（實測，不是憑感覺）

| 選項 | 體積 | 留一法 Top-1 | Top-3 | 註 |
|---|---|---|---|---|
| **DINOv2 ViT-S/14 + CLS + 336px ✔ 採用** | **87 MB** | **83.95%** | **95.06%** | 同棟 0.686 / 不同棟 0.475 |
| DINOv2 ViT-S/14 + CLS+GeM + 336px | 87 MB | 84.8% | 92.4% | 檢索沒更好，但相似度分布擠在一起、不好訂門檻 |
| DINOv2 ViT-S/14 + GeM + 336px | 87 MB | 81.0% | 89.5% | — |
| DINOv2 **ViT-B/14** + CLS + 336px | 340 MB | 85.7% | 91.4% | 只多 1.7 個百分點，體積 3.9 倍 → 不值得 |
| int8 動態量化（給前端用） | 23 MB | 83.95% | 92.59% | **瀏覽器跑不動**（見下） |

- 量測腳本：`ablation_pooling.py`（池化/TTA 消融）、`threshold_table.py`（門檻表）、`analyze_embeddings.py`（分布）。
- **為什麼不用 int8 給前端**：onnxruntime-web 1.23 的 wasm EP **沒有 `ConvInteger` 實作**，
  int8 模型（patch embedding 的 Conv 被量化）會直接 `Can't create a session`。
  Node 的原生 onnxruntime 可以跑，所以 Python 端的自評數字漂亮，但瀏覽器端會失敗 ——
  這種「只在瀏覽器壞掉」的差異只有真的開瀏覽器才驗得出來（見 `probe-ort-ops.mjs`）。
  要縮小前端體積的正確方向是「量化時排除 Conv」，不是整顆量化。
- **輸入輸出契約**：`pixel_values (B,3,336,336)`，**已做 ImageNet 正規化**；輸出 `cls (B,384)`，未正規化。
  正規化刻意放在圖外面（早期版本寫進 forward，導致 Python 端正規化兩次、ONNX 與 PyTorch 餘弦只有 0.06）。

## 二、相似度門檻（`src/recognize/labels.js` 的 `SIM_THRESHOLDS`）

庫：84 張參考照片 / 21 棟（`photos-src/cc` 的開放授權實拍，已套 `curation.json` 過濾）。

| 門檻 | 同棟認出率 | 不同棟誤判率 | 該門檻以上 Top-1 準確率 |
|---|---|---|---|
| 0.25 | 65.0% | 13.7% | 84.6% |
| **0.35（maybe）** | 56.7% | 5.9% | 85.5% |
| **0.50（hit）** | 47.1% | **1.5%** | **92.4%** |
| 0.70 | 29.9% | 0.2% | 94.0% |

`threshold_table.py` 可重算。**注意**：參考照片來自同一批 Wikimedia Commons 策展分類，
同棟可能同作者／同年代，因此比「陌生人隨手拍」樂觀；`tools/eval` 的 E1r（同棟不同攝影者）AUC 0.796 是較誠實的下界。

## 三、檔案

### 前端（網站會載入）
| 檔案 | 用途 |
|---|---|
| `recognize.html` | 獨立辨識頁（版面、上傳區、結果卡、診斷區塊、三維檢視器容器） |
| `src/recognize/main.js` | 頁面邏輯：載入模型、上傳/拖放/貼上、跑流程、結果卡與框線、錯誤顯示 |
| `src/recognize/yolo.worker.js` | YOLO 偵測 worker（設定走 URL query，自己啟動後回報 ready） |
| `src/recognize/dino.js` | DINOv2 編碼器（3 裁切 × 水平翻轉 TTA，平均後 L2 正規化） |
| `src/recognize/detector.js` | YOLO 解碼：letterbox 還原、信心篩選、類別感知 NMS |
| `src/recognize/preprocess.js` | 影像前處理（與 Python 端逐位對齊） |
| `src/recognize/compare.js` | 排序與「誠實結論」（分數太低就說可能不在庫裡） |
| `src/recognize/labels.js` | 類別中文對照、類別順序、相似度門檻 |
| `src/recognize/recognize.css` | 辨識頁樣式（沿用 `src/styles.css` 的變數與 `.viewer` 元件） |
| `src/recognize/ort/` | onnxruntime-web 的 JS glue（**必須放 src/**，public/ 的檔案不能 import） |
| `public/ort/` | onnxruntime-web 的 WASM（執行時 fetch，離線可用、不連 CDN） |

### 後端產線（Python）
| 檔案 | 用途 |
|---|---|
| `export_yolo_onnx.py` | 匯出 YOLO 權重 → `public/models/macau-buildings-yolo.onnx`（imgsz 768, opset 17） |
| `export_dino_onnx.py` | 匯出 DINOv2 → `public/models/dinov2-vits14-336.onnx`（+ int8 對照、真照片數值驗證、自動複製到 public/） |
| `build_embeddings.py` | 建立嵌入庫 → `public/data/memory-embeddings.json`（含留一法自評、ONNX 雜湊比對、curation 套用） |
| `audit_references.py` | 用 YOLO 稽核每張參考照片的「主體」對不對 → `out/ref-audit.json` |
| `make_audit_sheet.py` | 把可疑照片拼成聯絡表 → `out/ref-audit-sheet.jpg`（人工複核用） |
| `curation.json` | 人工複核後的排除清單（每筆寫「看到的內容」與理由） |
| `ablation_pooling.py` | 池化／TTA／backbone 消融實驗 |
| `threshold_table.py` | 由實測分布算門檻表 |
| `analyze_embeddings.py` | 嵌入庫品質診斷（同棟／不同棟分布、AUC、Top-1/3） |

### 驗證腳本
| 檔案 | 用途 | 需要什麼 |
|---|---|---|
| `verify_query_path.py` | **最重要的回歸測試**：模型雜湊一致 + 每張參考照片重新編碼自相似度 = 1 + 示範查詢 Top-1 | Python |
| `visualize_demo.py` | 三棟示範查詢的 Top-1 圖卡 → `docs/figs/recognize-demo.png` | Python |
| `browser-check.mjs` | **端到端驗收**：真的開瀏覽器載入模型、跑三次辨識、檢查主站、截圖 | dev server + `photo-server.mjs` |
| `browser-probe.mjs` | 只觀察頁面狀態（模型載入卡住時用） | dev server |
| `probe-detect.mjs` | 單獨測 YOLO 偵測並把框畫出來 | dev server + `photo-server.mjs` |
| `probe-ort-ops.mjs` | 檢查 ORT 在瀏覽器裡能不能載入某個 ONNX（int8 vs fp32） | dev server |
| `worker-eval-probe.mjs` / `worker-bisect.mjs` | 直接對 worker 求值／二分定位 worker 問題 | dev server |
| `check-deeplink.mjs` | `?spot=<id>` 深連結是否能在主站選中景點 | dev server |
| `photo-server.mjs` | 測試用的靜態伺服器（服務 `photos-src/`，因為它不在 public/ 底下） | — |
| `debug_detect.py` | Python 端的 YOLO 原始輸出（前端的對照基準） | Python |
| `debug_onnx_vs_torch.py` | ONNX 與 PyTorch 的逐位比對 | Python |
| `debug_library_consistency.py` | 庫內向量 vs 重新編碼的逐筆比對 | Python |

## 四、重建流程（改模型或參考照片後）

```powershell
python tools\recognize\export_dino_onnx.py                  # 匯出 DINOv2（會自動複製到 public/models/）
python tools\recognize\export_yolo_onnx.py                   # 匯出 YOLO
python tools\recognize\audit_references.py                   # 稽核參考照片（可選）
python tools\recognize\make_audit_sheet.py                   # 看圖複核（可選）
python tools\recognize\build_embeddings.py --eval            # 重建嵌入庫（預設寫 public/data/）
python tools\recognize\verify_query_path.py                  # ← 一定要跑，確認查詢路徑一致
python tools\recognize\threshold_table.py                    # 重算門檻（分布有變就更新 labels.js）
node  tools\recognize\photo-server.mjs                       # 另一個視窗
node  tools\recognize\browser-check.mjs                      # 端到端驗收
```

## 五、踩過的坑（都留了對應的檢查）

1. **`public/models` 與建庫用的 ONNX 不是同一個檔** → 自評 Top-1 83.8%，但真實查詢相似度只有 0.06、三棟示範全錯。
   現在 `build_embeddings.py` 會比對 sha256 並把雜湊寫進 JSON，`verify_query_path.py` 每次驗。
2. **ONNX 圖內做正規化、Python 端又做一次** → ONNX 與 PyTorch 餘弦 0.06。契約改成都由呼叫端正規化。
3. **`public/` 的 `.mjs` 不能 import** → Vite 直接讓整個模組 500、頁面白屏。ORT 的 JS glue 因此放 `src/recognize/ort/`。
4. **`new URL("./x.js", import.meta.url)` 建立 worker 會被 Vite 改寫成雙層路徑** → 404。改用 `new URL("src/recognize/…", document.baseURI)` + `@vite-ignore`。
5. **worker 還沒載入完就 `postMessage(init)`，訊息被靜默丟棄** → 主執行緒永遠看到「未載入」、零錯誤。
   改成設定走 URL query、worker 自己啟動並回報 ready（`page-manual-init.mjs` 有實測記錄）。
6. **`ImageBitmap` transfer 給 worker 後會被 detach** → 後續 DINOv2 裁切 `drawImage` 失敗。現在另外複製一份給 worker。
7. **int8 模型在瀏覽器建不起 session**（wasm EP 沒有 `ConvInteger`）→ 前端用 fp32。
8. **參考照片主體不是那棟建築**（麥當勞門面、雕像特寫、室內照）→ `audit_references.py` + 人工看圖 + `curation.json`。
9. **Vite dev server 對「啟動後才新增的大檔案」會回 SPA fallback（HTML）** → ONNX 下載到 HTML、protobuf 解析失敗。加檔後重啟 dev server。

## 六、已知限制（誠實說明）

- **沒有使用 GPS**：只用影像特徵。照片有定位的話，地理先驗（90 m 內）還能再排除大部分誤配。
- **21 棟、84 張參考**：涵蓋 `photos-src/cc` 的建築。使用者拍的路氹度假村、老街景若不在庫裡，會（正確地）回報「可能不在庫裡」。
- **參考照片偏少**：澳門旅遊塔只有 1 張合格實拍 + 1 張弱框，是庫裡最弱的一棟。
- **3D 模型截圖（白底）YOLO 偵測不到**：這類圖會退回「整張圖比對」，仍然認得出來，但沒有偵測框。
- **`public/photos/*.jpg`（photos.geojson 指的實拍大圖）目前不存在**，只有 `thumb/` 與 `demo/`；
  這是既有的資料缺口，不影響辨識（辨識用自己的嵌入庫），但會影響主站「實景照片」圖層的大圖顯示。
