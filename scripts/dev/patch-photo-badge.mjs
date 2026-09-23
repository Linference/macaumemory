import fs from "node:fs";
// 1) 景點標記加上照片數量徽章
let k = fs.readFileSync("src/markers.js", "utf8");
k = k.replace(
  `        \${(a.modelCount ?? a.artifactCount) ? \`<span class="marker-badge">3D</span>\` : ""}\`;`,
  `        \${(a.modelCount ?? a.artifactCount) ? \`<span class="marker-badge">3D</span>\` : ""}
        \${a.photoCount ? \`<span class="marker-photo">📷\${a.photoCount}</span>\` : ""}\`;`
);
fs.writeFileSync("src/markers.js", k);
console.log("markers.js：已加入照片徽章");

// 2) 樣式
let c = fs.readFileSync("src/styles.css", "utf8");
if (!c.includes(".marker-photo")) {
  c += `
.marker-photo { position: absolute; top: -7px; left: -8px; min-width: 20px; height: 16px; padding: 0 4px; border-radius: 999px;
  background: #6fb2d2; color: #06121f; font-size: 9.5px; font-weight: 700; display: grid; place-items: center;
  border: 1.5px solid rgba(8,11,15,.75); box-shadow: 0 2px 6px rgba(0,0,0,.5); }
`;
  fs.writeFileSync("src/styles.css", c);
  console.log("styles.css：已加入照片徽章樣式");
}

// 3) main.js：載入照片後回填每個景點的 photoCount 並重建標記
let m = fs.readFileSync("src/main.js", "utf8");
m = m.replace(
  `    $("#lb-photos").textContent = \`實景照片 (\${photoLayer.count})\`;
    renderPhotoChips();`,
  `    $("#lb-photos").textContent = \`實景照片 (\${photoLayer.count})\`;
    renderPhotoChips();
    // 把照片數量標到對應景點標記上（照片被 DOM 標記遮住時，這是主要入口）
    for (const a of attractions) a.photoCount = photoLayer.near(a.coords, 250).length;
    markerLayer.setData(attractions);
    markerLayer.setActive(state.selected?.id ?? null);`
);
fs.writeFileSync("src/main.js", m);
console.log("main.js：已回填 photoCount");
