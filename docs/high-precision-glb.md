# 高精度 GLB 放入三維地圖

地圖現在支持把已測量的建築 GLB 直接放在對應位置。這提升局部外觀細節，並不自動提高其餘白膜輪廓、推估高度或 30 m DEM 的精度。不要把示意模型調大後稱作測量成果。

1. 將 GLB 放到 `public/models/`。模型須帶齊貼圖或使用相對路徑，支援 Draco／Meshopt 壓縮。
2. 編輯 `public/models/landmarks.json`。目前已配置巴黎人、科學館、銀河及倫敦人四個高面數模型；其比例、朝向與錨點是暫定視覺配置，均非實測尺度。
3. 填實測單位、地面錨點、座標和旋轉。確認位置與高度後，才填要替換的白膜 feature IDs。
4. `npm run build` 後在地圖放大檢查輪廓對齊、朝向、地形開關、縮放和圖層開關。

格式示例（需換成自己的模型與測量值，示例預設停用）：

```json
{
  "version": 1,
  "placements": [{
    "id": "surveyed-landmark",
    "enabled": false,
    "file": "models/your-surveyed-landmark.glb",
    "spot": "st-dominic",
    "coords": [113.5403, 22.1946],
    "metersPerUnit": 1,
    "anchor": [0, 0, 0],
    "rotationDeg": [0, 0, 0],
    "altitudeM": 0,
    "minZoom": 15.5,
    "buildingIds": []
  }]
}
```

| 欄位 | 定義 |
|---|---|
| `coords` | `[經度,緯度]`；對應模型 `anchor` 的地面測量點。省略時使用 `spot` 對應景點座標，仍需核對 |
| `metersPerUnit` | 一個 GLB 單位是多少公尺；公尺模型填 1、毫米填 0.001。必填；不根據包圍盒猜測 |
| `anchor` | GLB 原座標中的地面錨點；先減錨點，再按 `rotationDeg` 旋轉與換算單位 |
| `rotationDeg` | 模型座標 XYZ Euler 角度；標準 GLTF 為 Y-up，零旋轉下 X 指東、Z 指南；正 Y 旋轉使 Z 從南轉向東。多軸調整按 Three.js 的 XYZ 慣例 |
| `altitudeM` | 相對目前地形的公尺偏移；DEM 未就緒時地形高度暫按 0，載入後更新。地形誇張會影響地面位置，最終對齊應以誇張 1.0 檢查 |
| `minZoom` | 小於此縮放級別時不畫精細模型，恢復原白膜；預設 15.5 |
| `lodFile`／`detailZoom` | 可選快速預覽 GLB；放大到 detailZoom 且地標在視野中時才下載 file 的完整細節。四個現有地標分別從 14／16.5 級顯示預覽／下載細節 |
| `buildingIds` | `public/data/macau-buildings.geojson` 中精確 feature.id 清單。空清單不隱藏白膜；不按附近半徑隱藏鄰棟 |

GLB 讀取失敗時保留白膜。模型讀取成功並且符合縮放級別時才套排除篩選；關閉「三維建築」同時關閉精細模型。移除自訂圖層會還原原篩選，不會銷毀地圖的共享 WebGL context。

同一地標的預覽會在完整模型載入成功後被替換；完整模型失敗則保留預覽。已下載完整模型不會因縮小就重新下載或退回預覽。尚無分塊串流；大場景需進一步做效能驗收。

## 本次四個原始檔

四份原始檔每份約 190 萬三角面，其 SHA-256 與原網站預覽模型所用來源一致，是相同內容的高面數原檔。它們的節點包含 Tripo 生成標記且沒有真實單位；高網格密度不代表測量準確率。

此次新輸出不做網格簡化：巴黎人 1,903,015 面／約 13.9 MiB；科學館 1,896,820 面／11.4 MiB；銀河 1,890,535 面／12.8 MiB；倫敦人 1,902,916 面／11.3 MiB。僅做 Meshopt 壓縮與最大 4096px WebP 貼圖（quality 92），所以幾何面數保持不變、貼圖有損。`landmark-sources.json` 保存來源雜湊、原始與發布規格；原始 Downloads 檔案保持原樣。

```sh
node scripts/import-landmark-models.mjs --source-dir D:/path/to/originals
```

配置的 `placementQuality:"provisional"` 與 `scaleSource` 明確標出待校準；`metersPerUnit` 是人工暫定的展示換算比例。模型幾何與 OSM 輪廓未必完全一致，下一步應以地面控制點、正射影像或實測尺寸校準，不能把這次接入稱為全城測繪精度提升。

可參考 [MapLibre 的 Three.js 地形模型範例](https://maplibre.org/maplibre-gl-js/docs/examples/adding-3d-models-using-threejs-on-terrain/)。現有博物館模型檢視器繼續用 `models/manifest.json`；地圖地理放置使用獨立的 `landmarks.json`。
