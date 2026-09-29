// 把 meshopt 壓縮的 GLB 還原成未壓縮 GLB，供 VTK／trimesh 等不支援 meshopt 的工具讀取。
// 用途：量測「優化後的模型」相對「原始模型」的幾何誤差（三角面偏差），驗證壓縮是否傷到精度。
//
// 用法：node tools/qa/decompress-glb.mjs <輸入.glb> <輸出.glb>
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error("用法：node tools/qa/decompress-glb.mjs <輸入.glb> <輸出.glb>");
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const doc = await io.read(src);
const before = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
// 移除 meshopt 擴充宣告：資料已在讀取時解碼完成，寫出時就不再重新壓縮
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName === "EXT_meshopt_compression") ext.dispose();
}
for (const ext of doc.getRoot().listExtensionsRequired()) {
  if (ext.extensionName === "EXT_meshopt_compression") ext.dispose();
}
await io.write(dst, doc);
console.log(`  ${path.basename(src)} → ${path.basename(dst)}  ${(fs.statSync(dst).size / 1048576).toFixed(1)} MB  （原擴充：${before.join(",") || "無"}）`);
