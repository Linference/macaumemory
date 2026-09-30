# 澳門記憶：成果與證據口徑

更新：2026-09-30。報告、簡報與影片應區分受控渲染、公開照片配對、參考庫留一法和獨立實拍；不同任務的 AUC、Top-1、mAP 不能互換。

| 成果 | 可核對的結果 | 範圍與限制 | 證據 |
|---|---|---|---|
| 網頁 DINOv2 檢索 | 38 棟／335 張；LOO Top-1 88.96%、Top-3 94.93% | 查詢從參考庫留出一張，其餘同棟照片保留；未隔離攝影者與拍攝批次，不是獨立遊客準確率 | `public/data/memory-embeddings.json` 的 `eval`；`tools/recognize/build_embeddings.py` |
| 歷史 DINOv2-base 受控配對 | E1 AUC 0.998；E2 AUC 0.993 | E2 是 GLB 改變光照／角度／距離的渲染；不是跨日期實拍。編碼器為 base@336，与網頁 small ONNX 不同 | `tools/eval/out/metrics-dino-336cls.json`、`report-dino-336cls.md` |
| 歷史公開實拍配對 | E1r AUC 約 0.803 | 配對分類指標；未按本次獨立實拍協定凍結參考庫。不可替代網頁端到端辨識率 | 同上 E1r |
| 離線 SIFT + RANSAC | 98 對：81 同棟、17 異棟；接受 26 個正例、0 個負例；正例接受率 26/81=32.1% | 接受精確率 26/26 是這組有限樣本的觀測值；Wilson 95% 約 87.1%–100%。不是「永不誤判」。沒有接入網頁辨識流程 | `tools/eval/out/geo-verify-sift.json` |
| 位置輔助排序 | 已接入；每張照片預設關閉；GPS ≤100 m、≤5 分鐘；距離降權最多 0.08 | 不提高原始影像相似度、不硬性排除遠景、不把接近候選自動升為高信心；改善幅度待獨立資料測量 | `src/recognize/geo-ranking.js`、`tests/recognize.test.mjs` |
| 地圖精細模型替換 | 已接入巴黎人、科學館、銀河及倫敦人四個約 190 萬面模型；14 級預覽、16.5 級按視野載入原始網格細節；成功載入才隱藏指定 feature IDs | 原檔與現有預覽來源一致，AI 生成且非實測尺度；展示尺寸／朝向／定位暫定，沒有測繪精度結論。另 2 件模型為文物掃描 | `public/models/landmarks.json`、`landmark-sources.json`、`docs/high-precision-glb.md` |
| 獨立實拍驗收 | 工具與防洩漏檢查已完成；指標待採集 | 必須填來源、攝影者、批次與拍攝日期，攝影者／批次隔離，SHA-256 查重；近重複仍需人工複核。此次工具只測全圖檢索，不测 YOLO、人工流程或瀏覽器速度 | `tools/recognize/independent_queries.py`、`independent-eval.mjs` |
| 位姿投影標註／上軸推估 | 研究與整合方向 | 本倉庫的預標註入口是 YOLO-World。舊報告中的外部桌面重建模組、8 個專案與 327 項測試尚缺可核對的程式、資料清單、日誌；不得列為本網站已驗證成果 | `tools/yolo-dataset/prelabel.py`；舊報告相關內容應視為待補證據 |

## 創新主張

現階段適合主張「面向澳門建築普查的工程與應用整合」：端側偵測／檢索、可拒絕自動判定的位置輔助、人工複核、穩定建檔編號、空間查重與地理三維展示形成可使用的流程。

DINO 場所辨識與三維標註投影已有相關工作。参照 [AnyLoc](https://anyloc.github.io/) 的場所辨識，以及 [ScanNet](https://github.com/ScanNet/ScanNet) 將三維聚合標註按相機軌跡投影到 RGB-D 影格。不能主張「首次使用 DINO」或「首次將三維資訊轉成二維標註」。

若要支持方法創新，還需要：位姿與重建程式可復現；與人工標註／YOLO-World比較標註時間、人工修正量、漏標率、IoU；按拍攝專案隔離後比較同一偵測器的 mAP；檢索的純影像／位置輔助消融結果。未採集的項目保持待驗證。

## 獨立實拍操作

```sh
python tools/recognize/independent_queries.py --init
# 編輯 tools/recognize/out/independent/manifest.template.json，保留有完整來源的參考照片。
python tools/recognize/independent_queries.py --manifest tools/recognize/out/independent/manifest.template.json --audit-only
python tools/recognize/independent_queries.py --manifest tools/recognize/out/independent/manifest.template.json
node tools/recognize/independent-eval.mjs tools/recognize/out/independent/queries.json
```

每個 query 包含：`id`、`path`（相對專案根目錄或本機絕對路徑）、`buildingId`、`split`、`independentCapture:true`、`captureGroup`、`photographer`、`capturedAt`（ISO 日期）、`source`。庫外建築用 `unknown:<獨立名稱>`；庫內名稱必須在選定參考集內。`calibration` 和 `test` 的攝影者及批次亦須隔離，報告僅計 test，門檻保持凍結版本而非按測試集尋優。

有照片對應的位置才填 `location:{lng,lat,accuracyM,capturedAt,source}` 與 `confirmedPhotoLocation:true`；歷史照片不填評測電腦的目前 GPS。手動建築座標填 `source:"manual"`，GPS 填讀數精度與採樣時間。報告比較純影像與位置輔助，附 Top-1/3、接受精確率、庫內正確接受率、庫外誤接受率、人工確認比例與 Wilson 區間。

缺照片、來源或隔離紀錄時，審核退出碼為 2，不產生准确率。建議分夜景、遮挡、相似酒店、远距离拍摄及库外建筑采集；报告建筑与拍摄批次数，并检查同组照片的统计相关性。

原有 PDF／影片若未重新生成，屬歷史展示素材，不能用其舊宣稱代替本表。兩份 LaTeX 源文檔已加版本與證據邊界說明。
