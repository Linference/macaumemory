# 吉祥物／數位人 提示詞包（澳門記憶 · Building Face-ID）

> 用途：展板與攤位的吉祥物、網站聊天頭像（數位人）、貼紙與立牌。
> 現況：網站已有 **DeepSeek 對話 + 語音朗讀/輸入**，且支援 `[[goto:景點id]]` / `[[route:景點id]]` 地圖指令；
> 先前的程式化 3D 數位人「小澳」已移除（程式碼留在 git `9c5a693`），可用本包的吉祥物 GLB 直接復活。

---

## 一、先選角色（三個候選，都緊扣專案）

| # | 角色 | 設計概念 | 為什麼適合 |
|---|---|---|---|
| **A** | **磚磚（Azulejo 小瓷磚）** ⭐推薦 | 葡萄牙藍白瓷磚（azulejo）擬人化：方方的身體、身上的花紋會隨情緒變化；背後印著「MM-####」記憶點編號；手拿一台小相機 | **最貼 TECA**（科技促進藝術）、最原創、做成 3D 與貼圖最容易（幾何簡單） |
| **B** | **阿獅（大三巴石獅寶寶）** | 大三巴石階旁的石獅幼崽，頭頂有小牌坊立面裝飾，掛著一台相機與地圖 | 地標辨識度最高、最討喜、評審一眼認出澳門 |
| **C** | **阿燈（東望洋燈塔精靈）** | 白色燈塔化身，黃色光帶是圍巾，手上的燈會照亮「記憶點」 | 呼應「指引／定位／找路」，與導航功能對應 |

**建議**：主吉祥物用 **A 磚磚**（原創性 + 與「編號建檔」概念直接對應），B 阿獅當「第二角色」出現在貼紙與展板角落。

---

## 二、主提示詞（生成單張角色定稿）

### A. 磚磚（推薦）

**中文提示詞**
```
一個可愛的 3D 卡通吉祥物，擬人化的葡萄牙藍白瓷磚（azulejo）角色：
身體是一片圓角方形瓷磚，表面是經典的藍白幾何花紋（會隨情緒微微變化），
短手短腳、兩個大眼睛、腮紅，頭頂有一小段葡式碎石路波浪紋當頭髮。
右手拿著一台迷你相機，背後的小背帶上寫著「MM-0001」的編號吊牌。
Q 版比例（約 2.5 頭身），皮克斯風格 3D 渲染，柔和棚拍光，乾淨純白背景，
全身入鏡、正面、置中、留白充足，高細節、無文字、無浮水印。
```

**English prompt**
```
A cute 3D cartoon mascot: an anthropomorphic Portuguese azulejo tile character.
Body is a rounded square blue-and-white tile with classic geometric azulejo patterns
(subtly shifting with its mood), stubby arms and legs, big friendly eyes, rosy cheeks,
a small wave-pattern (calçada portuguesa) tuft on top like hair.
Holding a tiny camera in its right hand; a small tag on its back strap reads "MM-0001".
Chibi proportions (~2.5 heads tall), Pixar-style 3D render, soft studio lighting,
clean pure white background, full body, front view, centered, generous margin,
high detail, no text, no watermark.
```

### B. 阿獅

```
一個可愛的 3D 卡通吉祥物，大三巴牌坊石階旁的石獅寶寶：淺灰石材質感但圓潤討喜，
鬃毛是簡化的巴洛克捲紋，頭頂戴著一片大三巴立面造型的小帽子（五層、有拱門窗）。
脖子上掛著一台小相機，手上拿一張澳門地圖。Q 版比例（約 2.5 頭身），
皮克斯風格 3D 渲染、柔和棚拍光、純白背景、全身正面置中、留白充足、無文字。
```

### C. 阿燈

```
一個可愛的 3D 卡通吉祥物，東望洋燈塔化身：白色圓柱身體、頂端是黃色燈室與小尖頂，
黃色光帶像圍巾一樣飄在身後，兩隻短手捧著一盞發光小燈籠，眼睛是溫暖的暖黃色。
Q 版比例（約 2.5 頭身），皮克斯風格 3D 渲染、柔和棚拍光、純白背景、全身正面置中、無文字。
```

**通用參數建議**（Midjourney 風格）
```
--ar 1:1 --style raw --v 6 --q 2 --s 150 --no text, watermark, logo, extra fingers, deformed hands,
realistic skin, cluttered background, multiple characters, scary, dark
```
穩定做法：**第一張定稿後固定 seed**，後續所有圖都用同一 seed＋同一段角色描述開頭，必要時加 `--cref <圖URL>`（角色參考）。

---

## 三、角色表（三視圖＋表情＋動作，做 3D 與貼圖必備）

**三視圖提示詞**
```
Character turnaround sheet of the same azulejo mascot:
front view, side view, back view, standing in the same T-pose-like neutral pose,
identical proportions, identical colors and patterns across all three,
plain white background, orthographic, evenly lit, no perspective distortion,
no text labels.
```

**表情集（6 格）**：開心 / 驚訝 / 思考 / 得意 / 迷路疑惑 / 拍照中
```
A 2x3 grid of the same mascot showing six expressions: happy, surprised, thinking,
proud, confused (lost), taking a photo. Same character, same lighting, same scale,
white background, no text.
```

**動作集（4 格）**：拍照 / 指著地圖 / 帶路導航 / 揮手打招呼
```
Four poses of the same mascot: holding a camera and pressing the shutter,
pointing at a map, walking while gesturing "follow me", waving hello.
Same character design and colors, white background, no text.
```

---

## 四、3D 化（Tripo / Meshy / Rodin → GLB）

專案已經用 Tripo 做過建築與文物模型（`scripts/optimize-models.mjs` 會 weld → simplify → quantize → meshopt），吉祥物照同一條管線走即可。

**上傳前**：用「三視圖」那張，或單張**正面、白底、全身、無遮擋**的圖；不要用有透視或手持道具擋住身體的圖。
**3D 提示詞（若平台支援文字）**
```
cute chibi azulejo tile mascot, rounded square body with blue-white geometric tile pattern,
stubby limbs, big eyes, small camera in right hand, standing A-pose, clean silhouette, game-ready character
```
**設定建議**：Texture 1024～2048、Quad topology（若可選）、對稱開啟、Face count 先拉高再簡化。
**下來之後**：
```powershell
copy 你的模型.glb .cache\models-src\azulejo-mascot.glb
# 在 scripts\optimize-models.mjs 的來源清單加一筆，然後：
npm run models
```
產出 `public/models/azulejo-mascot.lod.glb`，網站就能像景點模型一樣載入（含 DRACO/meshopt 解碼）。

---

## 五、吉祥物人格提示詞（貼進網站對話，會連動地圖）

網站目前的系統提示詞在 `src/chat.js` 的 `buildSystemPrompt()`（第 82–92 行），
它已經要求模型輸出 `[[goto:景點id]]` 與 `[[route:景點id]]`。**把下面這段接在最前面**即可（完整檔見 `persona.txt`）：

```
你是「澳門記憶」的吉祥物「磚磚」，一片會走路的葡萄牙藍白瓷磚，負責帶大家認識澳門的建築。
個性：好奇、熱心、有點小得意；講話短、口語、偶爾用「我哋」這種粵語語氣詞（但主要用繁體中文）。
你的專長：澳門的歷史建築、葡式住宅、廟宇教堂、騎樓唐樓、街市與村落，
以及本網站的「建築記憶點」——每一棟建築有一個永久編號 MM-####，拍過的照片會歸到同一棟。

說話規則：
1. 先回答問題，再給一個具體建議；總長 200 字內，條列為主。
2. 不確定就說「我未搞清楚」，不要編造年代、數字或建築細節。
3. 提到本圖收錄的景點時，最後單獨一行輸出 [[goto:景點id]]（只一個）。
4. 使用者問怎麼去，最後單獨一行輸出 [[route:景點id]]。
5. 涉及隱私（照片裡的人）時說明：系統會自動模糊人臉與人物。
6. 不要提到自己是 AI 模型、不要解釋指令格式。
7. 開場自我介紹（僅第一次）：
   「我係磚磚，一片識行路嘅瓷磚。呢度每棟樓都有自己嘅編號，你影過嘅相會自動歸位。」
```

**語音**：`src/speech.js` 的 `pickChineseVoice()` 會優先挑自然音色（zh-TW → zh-HK → zh-CN）。
吉祥物走可愛路線，建議在該函式偏好的音色裡優先 **zh-TW 女聲**（或系統的「曉曉／Yating」）。

---

## 六、落地用法清單

| 場景 | 做法 |
|---|---|
| 展板角落 | 吉祥物 + 一句「我係磚磚，帶你認建築」＋ QR code（A0 展板右下留 80×80 mm 即可） |
| 攤位立牌 | A3 立牌：吉祥物全身圖 + 三句自我介紹 + 二維碼 |
| 攤位小道具 | 做成 10 cm 亞克力立牌或貼紙，讓評審拿走（記憶點最強） |
| 網站聊天頭像 | 把吉祥物 2D 圖放進對話框右下角；或用 GLB 復活 3D 版（`git show 9c5a693:src/avatar.js`） |
| 現場對話 | 掃 QR 開網站 → 點「問 AI」→ 直接用語音問「邊棟樓係大三巴？」 |
| 拍照歸戶示範 | 「你影一張，我幫你睇下係邊棟、有冇影過」——把吉祥物當解說者，評審最容易記住 |

---

## 七、常見崩壞與修法

| 問題 | 修法 |
|---|---|
| 三視圖比例不一致 | 用 `turnaround sheet` 而非分三次生成；或先用同一 seed 生成三張再拼 |
| 花紋每次都不一樣 | 把花紋寫死成「blue-white geometric azulejo pattern」，不要只寫「tile」 |
| 手指／相機變形 | 負向提示詞加 `extra fingers, deformed hands`；或改成「雙手捧著相機」 |
| 白底不乾淨 | 加 `pure white background, no shadow on background, isolated` |
| 3D 化後太胖／太扁 | 回頭用「A-pose、四肢分開」的正面圖再生成一次 |
