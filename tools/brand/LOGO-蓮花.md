# 蓮花標誌提示詞包（澳門立體誌 · 3D Macau Atlas）

> 為什麼是蓮花：**蓮花是澳門區旗與區徽的主體**（三瓣白蓮＋嘉樂庇總督大橋＋水紋），
> 用它等於「一眼澳門」。同時蓮花在東方文化裡有「記憶、清淨、層疊」的意涵，與「為建築累積記憶」的專案主軸相合。

---

## 〇、先講三個決定成敗的規格

| 規格 | 說明 |
|---|---|
| **只要圖標，不要文字** | 網站上的「澳門立體誌」用網頁字體排（現在的宋體＋字距很好看）。AI 生成中文必亂碼。 |
| **要能縮到 22 px** | 這是它在網站左上角的實際顯示尺寸。**花瓣不要超過 5 瓣、不要細線描邊、不要漸層陰影**，否則縮小就糊。 |
| **單色為主** | 網站的圖標用 `currentColor` 上色（金色 `#C8A24A`）。所以生成「單色剪影」最好用；深藍底＋金的版本留給展板。 |

生成後建議尺寸：`512×512` 或 `1024×1024`，正方形、置中、留白充足、**純白背景**（方便去背）。

---

## 一、三個設計概念（挑一個，或三個都生來比）

### 概念 A｜蓮花記憶點（推薦用於網站小圖標）
**設計邏輯**：五瓣蓮花，**中心是一個實心圓點＝記憶點（Memory Point）**；花瓣用幾何直線構成，不是寫實花瓣。

**中文提示詞**
```
極簡向量標誌圖標：一朵幾何化的五瓣蓮花，花瓣由簡潔的直線與圓弧構成，
正中央有一個實心圓點（象徵地圖上的記憶點）。單色金色，扁平設計，無漸層、無陰影、無描邊細節。
正方形構圖、置中、四周留白充足、純白背景、邊緣銳利、可縮到極小仍清晰。
不要任何文字、不要任何字母。
```

**English**
```
Minimal vector logo icon: a geometric five-petal lotus flower, petals built from clean straight
lines and arcs, with a single solid dot at the very center (symbolizing a map memory point).
Monochrome gold, flat design, no gradients, no shadows, no fine detail strokes.
Square composition, centered, generous margin, pure white background, crisp edges,
readable when scaled down to 22 pixels. No text, no letters, no words.
```

---

### 概念 B｜等高線蓮花（最獨特，適合展板主視覺）
**設計邏輯**：花瓣由**地形等高線**構成——呼應專案裡的 DEM 地形與等高線圖層，把「蓮花」與「3D 地表」合成一個符號。

**中文提示詞**
```
極簡向量標誌圖標：一朵由地形等高線構成的蓮花，花瓣是一圈圈同心且閉合的等高線輪廓，
線條粗細一致、間距均勻，整體像俯視的蓮花也像地形圖。單色金色線稿，扁平設計，無陰影。
正方形構圖、置中、留白充足、純白背景、線條乾淨銳利。
不要文字、不要數字、不要座標標註。
```

**English**
```
Minimal vector logo icon: a lotus flower formed by topographic contour lines — each petal is a set of
concentric closed contour rings, uniform stroke width and even spacing, reading as both a lotus seen
from above and a terrain map. Monochrome gold line art, flat, no shadows.
Square, centered, generous margin, pure white background, clean crisp lines.
No text, no numbers, no map labels.
```

---

### 概念 C｜等角立體蓮花（最有「3D」感）
**設計邏輯**：低多邊形（low-poly）等角視角的立體蓮花，像一個剛從 3D 地圖裡長出來的小模型，呼應專案的「立體」與 GLB 模型。

**中文提示詞**
```
極簡 3D 標誌圖標：低多邊形（low-poly）等角視角（isometric）的蓮花，
花瓣由平整的幾何切面構成，金屬金色與深海軍藍雙色，柔和單一方向光，
乾淨的硬邊陰影，不要寫實紋理。正方形構圖、置中、純白背景、極簡風格。
不要文字、不要底座、不要多餘裝飾。
```

**English**
```
Minimal 3D logo icon: a low-poly isometric lotus flower, petals made of flat geometric facets,
two-tone metallic gold and deep navy, soft single-direction light, clean hard-edged shading,
no photorealistic texture. Square, centered, pure white background, minimal.
No text, no pedestal, no extra decoration.
```

---

## 二、其他變體（要出印刷品或 favicon 時用）

| 變體 | 提示詞結尾加上 |
|---|---|
| **單色反白**（深底用） | `白色單色剪影版，適合放在深海軍藍背景上，無漸層` |
| **純黑線稿**（印刷、蓋章） | `純黑色單線線稿，無填色，線寬一致，白底` |
| **favicon 方框版** | `圖標放在深海軍藍的圓角方形底板上，金色蓮花置中，四周留白 15%，app icon 風格` |
| **橫式鎖定**（展板／立牌，但文字請事後用排版軟體加） | `圖標置於左側，右側保留大片空白，供後製加上文字` |

**負面提示詞（很重要）**
```
文字, 字母, 中文字, 書法, 水印, 浮水印, 寫實花瓣, 漸層陰影, 立體投影,
複雜背景, 多朵花, 花蕊細節, 昆蟲, 荷葉, 照片感, 3D 渲染寫實材質, 邊框, 圓形外框
```

**參數建議**
- 即夢／可圖／Midjourney：`--ar 1:1`（Midjourney 再加 `--style raw --v 6 --s 100 --no text, letters, watermark, gradient`）
- 生成 4 張挑 1 張；**滿意就固定 seed**，之後所有變體沿用同一 seed 保持造型一致。
- 若平台支援「向量／SVG 風格」，務必勾選。

---

## 三、拿到圖之後怎麼落地（我可以直接幫你改）

| 用途 | 匯出 | 我這邊要改的地方 |
|---|---|---|
| 網站左上角徽章 | `256×256` PNG（或 SVG） | `index.html` 的 `.brand-mark` 那個 inline SVG 換成你的圖；`styles.css` 的 `.brand-mark` 尺寸 22px |
| 瀏覽器分頁圖示 | `32×32` + `180×180` PNG | `index.html` 加 `<link rel="icon">` 與 `apple-touch-icon` |
| A0 展板 / 攤位立牌 | `1024×1024` PNG 或 SVG | `tools/poster/build_poster.py` 標題帶左側換成蓮花圖標 |
| 說明書 PDF | 同上 | `docs/macaumemory-report.tex` 封面加圖標 |

> 文字的處理原則：**「澳門立體誌」與「3D MACAU ATLAS」永遠用字體排**（現在是宋體＋大字距，很好看），
> 不要讓 AI 生成文字，也不要用圖片文字——列印與縮放都會糊。

---

## 四、配色（沿用網站既有的品牌色，標誌不要另創顏色）

| 名稱 | HEX | 用途 |
|---|---|---|
| 深海軍藍 ink | `#10243A` | 底色／深色版蓮花 |
| 金 gold | `#C8A24A` | 蓮花主色（網站圖標用色） |
| 青 teal | `#2A7F8F` | 輔助點綴（例如中心記憶點） |
| 米白 paper | `#F7F5F0` | 淺色底 |
