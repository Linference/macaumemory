const fs = require("fs");
const lines = fs.readFileSync("index.html", "utf8").split("\n");
let found = 0;
lines.forEach((l, i) => {
  const n = (l.match(/"/g) || []).length;
  if (n % 2 === 1) { console.log("奇數引號 行", i + 1, ":", l.trim().slice(0, 130)); found++; }
});
console.log("可疑行數:", found);
