import fs from "node:fs";
// index.html：圖層開關 + 大圖檢視器
let h = fs.readFileSync("index.html", "utf8");
if (!h.includes("tg-photos")) {
  h = h.replace(
    `      <label class="sw"><input type="checkbox" id="tg-bus" /><span>巴士站（OSM）</span></label>`,
    `      <label class="sw"><input type="checkbox" id="tg-bus" /><span>巴士站（OSM）</span></label>
      <label class="sw"><input type="checkbox" id="tg-photos" /><span id="lb-photos">實景照片</span></label>
      <div class="poi-chips" id="photo-chips"></div>`
  );
  h = h.replace(
    `    <div class="toast" id="toast"></div>`,
    `    <!-- 照片大圖檢視 -->
    <div class="lightbox" id="lightbox" aria-hidden="true">
      <div class="lb-panel">
        <button class="lb-close" id="lb-close" title="關閉">✕</button>
        <div class="lb-img"><img id="lb-img" alt="" /></div>
        <div class="lb-info" id="lb-info"></div>
      </div>
    </div>
    <div class="toast" id="toast"></div>`
  );
  fs.writeFileSync("index.html", h);
  console.log("index.html：已加入照片圖層開關與大圖檢視");
}
let c = fs.readFileSync("src/styles.css", "utf8");
if (!c.includes(".photo-pop")) {
  c += `
/* ---------------- 實景照片 ---------------- */
.photo-pop img { width: 100%; border-radius: 8px; display: block; }
.photo-pop-body { margin-top: 8px; }
.photo-pop-cls { font-size: 11.5px; color: var(--c, var(--gold)); letter-spacing: .04em; }
.photo-pop p { font-size: 12px; line-height: 1.65; color: #c9d3dd; margin: 5px 0 0; white-space: pre-line; }
.photo-pop p.dim { color: var(--ink-dim); }
.photo-meta { font-size: 10.5px; color: #7f8b98; margin-top: 6px; }
.photo-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.photo-tags span { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid var(--line-soft); color: var(--ink-dim); }
.photo-more { margin-top: 8px; padding: 6px 10px; font-size: 11.5px; width: 100%; }
.d-photos { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.d-photos img { width: 96px; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line-soft); cursor: pointer; flex: none; transition: border-color .2s, transform .2s; }
.d-photos img:hover { border-color: var(--gold); transform: translateY(-2px); }
.lightbox { position: fixed; inset: 0; z-index: 70; display: none; place-items: center; background: rgba(4,6,9,.86); backdrop-filter: blur(6px); }
.lightbox.on { display: grid; }
.lb-panel { width: min(1000px, calc(100vw - 40px)); max-height: calc(100vh - 60px); display: flex; background: linear-gradient(180deg,#10161d,#0a0e13); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.7); }
.lb-img { flex: 1; min-width: 0; display: grid; place-items: center; background: #07090c; }
.lb-img img { max-width: 100%; max-height: calc(100vh - 60px); display: block; }
.lb-info { width: 320px; flex: none; padding: 18px; overflow-y: auto; border-left: 1px solid var(--line-soft); }
.lb-info h3 { font-family: var(--serif); font-size: 17px; margin: 0 0 4px; }
.lb-info .lb-cls { font-size: 12px; color: var(--gold); margin-bottom: 10px; }
.lb-info p { font-size: 12.5px; line-height: 1.8; color: #c3ccd6; white-space: pre-line; }
.lb-info dl { font-size: 11.5px; color: var(--ink-dim); line-height: 1.8; margin: 12px 0 0; }
.lb-info dt { color: #7f8b98; float: left; clear: left; width: 74px; }
.lb-info dd { margin: 0 0 3px 80px; color: #dbe4ec; }
.lb-close { position: absolute; top: 14px; right: 14px; z-index: 3; width: 32px; height: 32px; border-radius: 50%; background: rgba(0,0,0,.5); border: 1px solid var(--line-soft); color: var(--ink); cursor: pointer; }
.lb-close:hover { color: var(--gold); }
@media (max-width: 800px) { .lb-panel { flex-direction: column; } .lb-info { width: auto; border-left: none; border-top: 1px solid var(--line-soft); max-height: 40%; } }
`;
  fs.writeFileSync("src/styles.css", c);
  console.log("styles.css：已加入照片樣式");
}
