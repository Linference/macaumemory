// Import the four user-provided originals without mesh simplification.
// Usage: node scripts/import-landmark-models.mjs --source-dir D:/path/to/models
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

const input = process.argv.indexOf("--source-dir");
if (input < 0 || !process.argv[input + 1]) throw new Error("Provide --source-dir containing 巴黎人.glb, 科学馆.glb, 银河酒店.glb, 伦敦人.glb");
const sourceDir = path.resolve(process.argv[input + 1]);
const output = path.resolve("public/models");
const manifestPath = path.join(output, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const inputs = [["parisian", "巴黎人"], ["macau-science-center", "科学馆"], ["galaxy-macau", "银河酒店"], ["londoner-macao", "伦敦人"]];
const provenance = { generated: new Date().toISOString(), processing: "No mesh simplification; meshopt compression; texture resize to 4096px WebP quality 92", models: [] };
const stats = (doc) => {
  let triangles = 0, vertices = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const n = p.getAttribute("POSITION")?.getCount() ?? 0; vertices += n; triangles += (p.getIndices()?.getCount() ?? n) / 3;
  }
  const bounds = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  return { triangles, vertices, bounds, dims: bounds.min.map((n, i) => bounds.max[i] - n) };
};
for (const [id, name] of inputs) {
  const source = path.join(sourceDir, `${name}.glb`);
  const doc = await io.read(source), before = stats(doc);
  await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [4096, 4096], quality: 92 }), meshopt({ encoder: MeshoptEncoder, level: "high" }), prune({ keepAttributes: true }));
  const file = `${id}.detail.glb`, target = path.join(output, file);
  await io.write(target, doc);
  // Read the encoded result, checking the actual published mesh rather than the mutable input.
  const after = stats(await io.read(target));
  if (after.triangles !== before.triangles) throw new Error(`${id}: unexpected triangle loss`);
  const bytes = fs.statSync(target).size;
  if (bytes >= 100 * 1024 * 1024) throw new Error(`${id}: exceeds GitHub per-file limit`);
  manifest.models[id].full = { ...after, file, bytes, sourceTriangles: before.triangles };
  manifest.models[id].dimensionsMeters = after.dims;
  manifest.models[id].realWorldScale = false;
  manifest.models[id].source = "使用者提供的原始高面數 AI 三維模型（非測量模型）";
  provenance.models.push({ id, originalFilename: `${name}.glb`, sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"), sourceBytes: fs.statSync(source).size, original: before, published: { ...after, file, bytes }, realWorldScale: false });
  console.log(`${id}: ${before.triangles.toLocaleString()} triangles retained; ${(bytes / 1048576).toFixed(1)} MB`);
}
manifest.generated = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(output, "landmark-sources.json"), JSON.stringify(provenance, null, 2) + "\n");
