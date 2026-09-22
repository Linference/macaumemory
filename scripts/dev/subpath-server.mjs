import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const ROOT = process.argv[2];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json", ".png": "image/png", ".glb": "model/gltf-binary", ".wasm": "application/wasm", ".mjs": "text/javascript", ".jpg": "image/jpeg" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(ROOT, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(4321, "127.0.0.1", () => console.log("subpath server on 4321"));

