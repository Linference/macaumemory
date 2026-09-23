import fs from "node:fs";
let m = fs.readFileSync("src/main.js", "utf8");
m = m.replace(
  `    for (const a of attractions) a.photoCount = photoLayer.near(a.coords, 250).length;`,
  `    // 只把照片掛到「它最近的那個景點」，避免附近景點都長出徽章
    const byNear = new Map();
    for (const f of photoLayer.photos) {
      const nid = f.properties?.nearId;
      if (nid) byNear.set(nid, (byNear.get(nid) ?? 0) + 1);
    }
    for (const a of attractions) a.photoCount = byNear.get(a.id) ?? 0;`
);
fs.writeFileSync("src/main.js", m);
console.log("已修正徽章歸屬");
