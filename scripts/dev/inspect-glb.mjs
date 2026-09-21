import fs from "node:fs";
const path = process.argv[2];
const buf = fs.readFileSync(path);
const magic = buf.readUInt32LE(0), version = buf.readUInt32LE(4), length = buf.readUInt32LE(8);
console.log("=".repeat(70));
console.log("FILE:", path);
console.log("size:", (buf.length/1048576).toFixed(1), "MB", "magic:", magic.toString(16), "ver:", version, "declared:", length);
let off = 12, json = null, binLen = 0;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const chunk = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk));
  if (type === 0x004E4942) binLen = len;
  off += 8 + len + ((4 - (len % 4)) % 4);
}
const g = json;
console.log("generator:", g.asset?.generator, "| version:", g.asset?.version);
console.log("extensionsUsed:", g.extensionsUsed);
console.log("extensionsRequired:", g.extensionsRequired);
console.log("scenes:", g.scenes?.length, "nodes:", g.nodes?.length, "meshes:", g.meshes?.length, "skins:", g.skins?.length ?? 0, "animations:", g.animations?.length ?? 0);
console.log("materials:", g.materials?.length, "textures:", g.textures?.length, "images:", g.images?.length, "samplers:", g.samplers?.length);
console.log("cameras:", g.cameras?.length ?? 0, "bin chunk:", (binLen/1048576).toFixed(1), "MB");
let verts = 0, tris = 0, prims = 0;
for (const m of g.meshes ?? []) for (const p of m.primitives ?? []) {
  prims++;
  const posAcc = g.accessors[p.attributes.POSITION];
  verts += posAcc.count;
  if (p.indices != null) tris += g.accessors[p.indices].count / 3;
  else tris += posAcc.count / 3;
}
console.log("primitives:", prims, "vertices:", verts.toLocaleString(), "triangles:", Math.round(tris).toLocaleString());
const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const m of g.meshes ?? []) for (const p of m.primitives ?? []) {
  const a = g.accessors[p.attributes.POSITION];
  for (let i = 0; i < 3; i++) { bb.min[i] = Math.min(bb.min[i], a.min?.[i] ?? 0); bb.max[i] = Math.max(bb.max[i], a.max?.[i] ?? 0); }
}
console.log("bbox min:", bb.min.map(v => +v.toFixed(3)), "\nbbox max:", bb.max.map(v => +v.toFixed(3)),
  "\nsize:", bb.max.map((v, i) => +(v - bb.min[i]).toFixed(3)));
const imageSizes = (g.images ?? []).map((im, i) => {
  if (im.bufferView == null) return `#${i} ${im.uri ?? "?"}`;
  const bv = g.bufferViews[im.bufferView];
  return `#${i} ${im.mimeType} ${(bv.byteLength/1024/1024).toFixed(2)}MB`;
});
console.log("images:\n  " + imageSizes.join("\n  "));
const matInfo = (g.materials ?? []).slice(0, 20).map(m => {
  const p = m.pbrMetallicRoughness ?? {};
  return `${m.name ?? "?"} base=${p.baseColorFactor} tex=${p.baseColorTexture?.index ?? "-"} mr=${p.metallicRoughnessTexture?.index ?? "-"} n=${m.normalTexture?.index ?? "-"}`;
});
console.log("materials:\n  " + matInfo.join("\n  "));
