import fs from "node:fs";
let c = fs.readFileSync("src/styles.css", "utf8");
if (!c.includes(".place-pop")) {
  c += `
/* ---------------- 記憶點 ---------------- */
.place-pop img { width: 100%; border-radius: 8px; display: block; }
.place-pop-body { margin-top: 8px; }
.place-pop-id { font-size: 10.5px; color: var(--gold); letter-spacing: .12em; }
.place-pop-name { font-family: var(--serif); font-size: 14.5px; margin: 2px 0 3px; }
.place-pop-cls { font-size: 11px; color: var(--c, var(--ink-dim)); }
.place-pop p { font-size: 11.5px; line-height: 1.65; color: #c2ccd6; margin: 6px 0 0; }
.place-more { margin-top: 8px; padding: 6px 10px; font-size: 11.5px; width: 100%; }
.place-warn { font-size: 9.5px; padding: 1px 6px; border-radius: 999px; background: rgba(217,112,122,.18); border: 1px solid rgba(217,112,122,.5); color: #e79aa2; }
.lb-id { font-size: 11px; letter-spacing: .16em; color: var(--gold); margin-bottom: 4px; }
.lb-strip img { width: 80px; height: 60px; }
.lb-strip img.on { border-color: var(--gold); box-shadow: 0 0 0 2px rgba(216,180,90,.4); }
`;
  fs.writeFileSync("src/styles.css", c);
  console.log("styles.css：已加入記憶點樣式");
}
