// 將兩個高精度掃描 GLB（各 150 萬面）優化成適合網頁即時瀏覽的版本
//  - 簡化網格 (meshoptimizer)、量化、EXT_meshopt_compression 壓縮
//  - 貼圖轉 WebP 並縮圖
//  - 同時產生低解析度 LOD，先顯示 LOD 再換上高精度模型
import fs from "node:fs";
import path from "node:path";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, weld, simplify, quantize, textureCompress, prune, meshopt, joinPrimitives } from "@gltf-transform/functions";
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { CACHE, PUBLIC, ensureDir, writeJson } from "./lib.mjs";

const OUT_DIR = path.join(PUBLIC, "models");
const SRC_DIR = path.join(CACHE, "models-src");
ensureDir(OUT_DIR);
ensureDir(SRC_DIR);

const MODELS = [
  {
    id: "tang-sancai-camel",
    src: "C:\\Users\\LINKIT\\.dsh\\attachments\\v1\\files\\ed\\ed553a6e23978104580599c765fb021af4f672e06e4f19ded83d5986d2728498\\唐三彩.glb",
    base: "tang-sancai-camel",
    titleZh: "唐三彩雙峰駱駝俑",
    titleEn: "Sancai-glazed Bactrian Camel",
  },
  {
    id: "yongle-blue-white-flask",
    src: "C:\\Users\\LINKIT\\.dsh\\attachments\\v1\\files\\f6\\f6684eb630f8f5286cf3fdca3b099d11793f9cadab3d75dad8138df30ec2e224\\青花雙耳瓶.glb",
    base: "yongle-blue-white-flask",
    titleZh: "明永樂 青花輪花紋綬帶耳葫蘆扁瓶",
    titleEn: "Yongle Blue-and-White Gourd Flask",
  },
  {
    id: "parisian",
    src: "C:\\Users\\LINKIT\\.dsh\\attachments\\v1\\files\\bf\\bfe35ed1bb9b389b3b3403fcbe2efb68fe324ece2ef80593e5caf832865ee4e5\\巴黎人.glb",
    base: "parisian",
    titleZh: "澳門巴黎人（巴黎鐵塔）",
    titleEn: "The Parisian Macao",
    kind: "building",
  },
  {
    id: "macau-science-center",
    src: "C:\\Users\\LINKIT\\.dsh\\attachments\\v1\\files\\e4\\e431dafe5e300c9584c805db4486c4442c21decbc44f8c01fa804bebbb97c3b9\\科学馆.glb",
    base: "macau-science-center",
    titleZh: "澳門科學館",
    titleEn: "Macao Science Center",
    kind: "building",
  },
  {
    id: "macau-tower",
    src: "C:\\Users\\LINKIT\\.dsh\\attachments\\v1\\files\\2a\\2aa0b03336d2cae3675e955c3c0141f4fbf3ef29d9b5ad7305e6b071a82ccf43\\旅游塔.glb",
    base: "macau-tower",
    titleZh: "澳門旅遊塔",
    titleEn: "Macau Tower",
    kind: "building",
  },
  {
    id: "galaxy-macau",
    src: "C:\\Users\\LINKIT\\.dsh\\attachments\\v1\\files\\0a\\0a66358cc1a59c0e2d1a95fe9779a29a5a7e943986e98891e990b5c5a506630e\\银河酒店.glb",
    base: "galaxy-macau",
    titleZh: "澳門銀河",
    titleEn: "Galaxy Macao",
    kind: "building",
  },
  {
    id: "londoner-macao",
    src: "C:\\Users\\LINKIT\\.dsh\\attachments\\v1\\files\\05\\05740346c91b3592676e17948d9819991c2969bbd4f73c016cdeacfda0813497\\伦敦人.glb",
    base: "londoner-macao",
    titleZh: "澳門倫敦人",
    titleEn: "The Londoner Macao",
    kind: "building",
  },

];

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

async function localSrc(m) {
  const local = path.join(SRC_DIR, m.base + ".glb");
  if (!fs.existsSync(local) || process.env.REFRESH) {
    if (!fs.existsSync(m.src)) throw new Error(`找不到來源檔：${m.src}`);
    console.log(`  複製來源 → ${path.relative(process.cwd(), local)}`);
    fs.copyFileSync(m.src, local);
  }
  return local;
}

function stats(doc) {
  const root = doc.getRoot();
  let tris = 0, verts = 0, prims = 0;
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    prims++;
    const pos = prim.getAttribute("POSITION");
    verts += pos.getCount();
    const idx = prim.getIndices();
    tris += (idx ? idx.getCount() : pos.getCount()) / 3;
  }
  let bounds = null;
  for (const node of root.listNodes()) {
    const b = getBounds(node);
    if (!bounds) bounds = { min: b.min.slice(), max: b.max.slice() };
    else for (let i = 0; i < 3; i++) { bounds.min[i] = Math.min(bounds.min[i], b.min[i]); bounds.max[i] = Math.max(bounds.max[i], b.max[i]); }
  }
  const dims = bounds ? [0, 1, 2].map((i) => +(bounds.max[i] - bounds.min[i]).toFixed(3)) : null;
  return { triangles: Math.round(tris), vertices: verts, primitives: prims, bounds, dims };
}

async function buildOne(m, { suffix, ratio, error, texSize, quality, label }) {
  const outPath = path.join(OUT_DIR, `${m.base}${suffix}.glb`);
  const key = process.env.REFRESH ? true : !fs.existsSync(outPath);
  if (!key) {
    // 已存在：直接讀回檔案統計（避免 manifest 遺失資訊）
    console.log(`  ↳ 已有 ${m.base}${suffix}.glb，讀取既有檔案資訊`);
    const doc = await io.read(outPath);
    const st = stats(doc);
    return { triangles: st.triangles, vertices: st.vertices, primitives: st.primitives, bounds: st.bounds, dims: st.dims, bytes: fs.statSync(outPath).size, file: path.basename(outPath), sourceTriangles: null };
  }
  const src = await localSrc(m);
  console.log(`\n▶ ${m.titleZh} → ${m.base}${suffix}.glb  [${label}]`);
  let doc = await io.read(src);
  const before = stats(doc);
  console.log(`  原始：${before.triangles.toLocaleString()} 面 / ${before.vertices.toLocaleString()} 頂點 / 貼圖 ${doc.getRoot().listTextures().length} 張`);

  const t0 = Date.now();
  doc = await doc.transform(
    dedup(),
    weld({ tolerance: 0.00005 }),
    simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: true }),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [texSize, texSize], quality }),
    quantize({ pattern: /^(POSITION|NORMAL|TANGENT|TEXCOORD)/ }),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
    prune({ keepAttributes: true })
  );
  const out = path.join(OUT_DIR, `${m.base}${suffix}.glb`);
  await io.write(out, doc);
  const after = stats(doc);
  const mb = fs.statSync(out).size / 1048576;
  console.log(`  ✅ ${after.triangles.toLocaleString()} 面 (${((after.triangles / before.triangles) * 100).toFixed(1)}%)  ${mb.toFixed(2)} MB  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  尺寸：${after.dims.map((d) => (d * 100).toFixed(0) + "cm").join(" × ")}`);
  return { ...after, bytes: fs.statSync(out).size, file: `${m.base}${suffix}.glb`, sourceTriangles: before.triangles, dims: after.dims };
}

const existingFile = path.join(OUT_DIR, "manifest.json");
const existing = fs.existsSync(existingFile) ? JSON.parse(fs.readFileSync(existingFile, "utf8")) : { models: {} };
const manifest = { generated: new Date().toISOString(), pipeline: "gltf-transform: weld → simplify(meshoptimizer) → textureCompress(webp) → quantize → meshopt", models: {} };
for (const m of MODELS) {
  const isBuilding = m.kind === "building";
  const full = await buildOne(m, { suffix: "", ratio: isBuilding ? 0.14 : 0.22, error: isBuilding ? 0.002 : 0.0015, texSize: 2048, quality: 88, label: "高精度" });
  const lod = await buildOne(m, { suffix: ".lod", ratio: isBuilding ? 0.03 : 0.035, error: 0.005, texSize: 1024, quality: 80, label: "快速預覽 LOD" });
  const prev = existing.models?.[m.id] ?? manifest.models[m.id];
  manifest.models[m.id] = {
    id: m.id,
    titleZh: m.titleZh,
    titleEn: m.titleEn,
    full: full ?? prev?.full ?? null,
    lod: lod ?? prev?.lod ?? null,
    source: prev?.source ?? (m.kind === "building" ? "AI 三維生成（使用者提供）" : "高精度掃描（使用者提供）"),
    dimensionsMeters: (full ?? lod ?? prev?.full)?.dims ?? null,
    kind: m.kind ?? "artifact",
    realWorldScale: (m.kind ?? "artifact") !== "building",
  };
}
writeJson(`${OUT_DIR}/manifest.json`, manifest, { pretty: true });
console.log("\n✅ 模型優化完成");
