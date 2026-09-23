# 阿獅（大三巴石獅寶寶）提示詞包

> 專案吉祥物：**阿獅** —— 大三巴牌坊石階旁的石獅寶寶，負責帶大家認識澳門的建築。
> 用途：展板角落、攤位立牌、貼紙、網站聊天頭像、（可選）3D 數位人。
> 設計目標：**一眼認出澳門**、縮到 3 公分還看得懂、可以做成貼紙與 3D。

---

## 〇、設計要點（生圖前先看，決定成敗）

| 要點 | 說明 |
|---|---|
| **必須可愛，不能兇** | 「石獅」在模型訓練資料裡常是廟前兇猛守門獅 → 提示詞一定要寫 `cute baby stone lion, friendly smile, big round eyes, not fierce` |
| **剪影要強** | 縮到貼紙大小仍要認得出：大頭、圓身、短腿、一個明顯特徵（帽子或相機） |
| **配色固定** | 花崗岩淺灰為主，配件用專案色系：深海軍藍 `#10243a`、金 `#c8a24a`、青 `#2a7f8f` → 才能跟展板一致 |
| **道具講故事** | 相機（拍照建檔）＋ `MM-0001` 編號吊牌（一棟一號的核心創新） |
| **比例** | 約 2.5 頭身（chibi），頭大身小；不要擬真人形 |
| **背景** | 純白背景（方便去背、做貼紙、3D 化）；不要場景 |

---

## 一、主提示詞（主視覺定稿用）

### 中文

```
一個可愛的 3D 卡通吉祥物：澳門大三巴牌坊石階旁的石獅寶寶「阿獅」。
淺灰花崗岩質感但圓潤討喜，大頭、圓身、短手短腳，兩顆大眼睛、親切的微笑（絕對不能兇），
鬃毛是簡化的巴洛克捲紋（呼應大三巴立面的雕刻），頭頂戴著一頂大三巴牌坊造型的小帽子（五層、有拱門窗）。
脖子上掛著一台金色背帶的迷你相機，腰間吊著一塊小木牌寫著「MM-0001」。
配色：石灰色為主，配件用深海軍藍與金色。
Q 版比例約 2.5 頭身，皮克斯風格 3D 渲染，柔和棚拍光，
乾淨純白背景、全身入鏡、正面、置中、留白充足、高細節、無文字、無浮水印。
```

### English

```
A cute 3D cartoon mascot: "Ashih", a baby stone lion from the stone steps of the
Ruins of Saint Paul in Macau.
Light grey granite texture but soft and rounded, big head, chubby body, stubby arms and legs,
two big friendly eyes, warm smile — absolutely NOT fierce, not a scary temple guardian lion.
Mane simplified into baroque scroll patterns echoing the facade carvings.
Wearing a tiny hat shaped like the Ruins of Saint Paul facade (five tiers with arched windows).
A miniature camera on a gold strap around its neck, and a small wooden tag on its belt reading "MM-0001".
Color scheme: stone grey body, accessories in deep navy and gold.
Chibi proportions (~2.5 heads tall), Pixar-style 3D render, soft studio lighting,
clean pure white background, full body, front view, centered, generous margin,
high detail, no text, no watermark.
```

**負面提示詞**
```
fierce, angry, scary, realistic stone texture, temple guardian lion, sharp teeth, claws,
human-like body, muscular, extra fingers, deformed hands, text, watermark, logo, signature,
cluttered background, multiple characters, dark, horror
```

**參數建議（Midjourney）**
```
--ar 1:1 --style raw --v 6 --q 2 --s 150 --no fierce, scary, realistic stone, text, watermark, extra fingers
```
其他平台：SD／即夢／可圖 → 直接貼中文提示詞，負面詞貼在 negative prompt；步數 30、CFG 6～7.5。
**第一張滿意後請立刻固定 seed**，之後所有圖都用同一 seed ＋ 同一段角色描述開頭。

---

## 二、三個變體（挑一個當主視覺）

| 變體 | 差異 | 建議 |
|---|---|---|
| **A 招牌版** | 戴大三巴小帽 ＋ 相機 ＋ MM 吊牌 | 資訊量最大，適合**展板主視覺** |
| **B 簡潔版** | 不戴帽，改圍一條金色小圍巾 ＋ 拿地圖 | 縮小後辨識度最高，適合**聊天頭像、貼紙** |
| **C 動作版** | 招牌版 ＋ 雙手捧相機做拍照姿勢 | 適合**攤位立牌／示範拍照歸戶** |

**B 簡潔版提示詞（置換主提示詞中「頭頂戴著…」那句）**
```
脖子上圍著一條金色的短圍巾（尾端有葡式碎石路波浪紋），雙手拿著一張捲起來的澳門地圖。
```

---

## 三、角色三視圖（做 3D 與貼圖必備）

```
Character turnaround sheet of the same cute baby stone lion mascot "Ashih":
front view, side view, back view, standing in a neutral A-pose with arms slightly away from the body,
identical proportions, identical colours and accessories in all three views
(tiny Saint Paul facade hat, gold-strapped camera, "MM-0001" tag on the back),
plain pure white background, orthographic projection, evenly lit, no perspective distortion,
no text labels, no watermark.
```
> 重點：`A-pose`＋`arms away from body`（3D 化時不會把手臂黏在身上）、`orthographic`（不要透視）、`identical across views`。

---

## 四、表情集（6 格，做貼紙與對話用）

```
A 2x3 grid of the same baby stone lion mascot showing six expressions:
happy, surprised, thinking (paw on chin), proud, confused/lost, taking a photo.
Same character design, same colours, same camera and hat, same scale and lighting,
pure white background, no text.
```

## 五、動作集（4 格）

```
Four poses of the same baby stone lion mascot: pressing a camera shutter,
pointing at an unfolded map, walking and gesturing "follow me", waving hello.
Same character design and colours, pure white background, no text.
```

## 六、貼紙／2D 平面版（展板與攤位用）

```
Flat vector sticker version of the same baby stone lion mascot:
bold clean outlines, flat colours with one soft shadow layer, thick white sticker border,
minimal detail, friendly expression, standing pose with camera,
pure white background, high contrast, readable at small size, no text.
```

---

## 七、3D 化（Tripo / Meshy / Rodin → GLB）

**上傳**：用「三視圖」那張，或單張正面、白底、全身、A-pose 的圖（不要有道具遮住身體）。
**文字提示詞（若平台支援）**
```
cute chibi baby stone lion mascot, rounded granite body, baroque scroll mane,
tiny five-tier facade hat, gold-strap camera around neck, A-pose,
clean silhouette, game-ready stylised character
```
**設定**：Texture 1024–2048、對稱開、Face count 先高後簡化。
**下來之後**（沿用專案既有管線 `scripts/optimize-models.mjs`：weld → simplify → quantize → meshopt）：
```powershell
copy 你的模型.glb .cache\models-src\ashih-mascot.glb
# 在 scripts\optimize-models.mjs 的來源清單加一筆，然後：
npm run models
```
產出 `public/models/ashih-mascot.lod.glb` 後，網站就能像景點模型一樣載入（DRACO/meshopt 已支援）。

---

## 八、常見崩壞與修法

| 問題 | 修法 |
|---|---|
| 變成一隻兇猛守門獅 | 加強 `cute baby, friendly smile, big round eyes, chubby, not fierce`，並在負面詞寫 `fierce, angry, realistic stone` |
| 看起來像真石頭雕像 | 加 `stylised, smooth surfaces, soft shading, Pixar style`，負面詞加 `rough stone, granite texture detail` |
| 帽子不像大三巴 | 改成 `a tiny five-tier facade with arched windows and a triangular pediment`，或直接不戴帽用變體 B |
| 三視圖比例不一致 | 一次生 `turnaround sheet`，不要分三次生；或同 seed 生三張再拼 |
| 手指／相機變形 | 負面詞加 `extra fingers, deformed hands`；或改成「雙手捧著相機」 |
| 背景不乾淨 | 加 `pure white background, isolated, no shadow on background` |
| 縮小後看不清 | 用變體 B（簡潔版），並要求 `bold silhouette, high contrast` |
