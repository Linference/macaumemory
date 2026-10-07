import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {safeFrameName, unitVector} from '../../src/collection/selection.js';

export function prepareReferenceDraft(base, bundle, readPhoto, lookupArchivePhoto = () => null) {
  if (bundle?.schemaVersion !== 1 || bundle.kind !== 'macau-memory-capture' || bundle.protocol !== 'full_image_three_crops_flip_tta'
    || !Array.isArray(bundle.frames) || !bundle.frames.length || bundle.frames.length > 100
    || !bundle.captureGroup?.trim() || !bundle.source?.trim()) throw new Error('已確認資料清單格式無效');
  const building = base.buildings.find(b=>b.id===bundle.building?.id);
  if (!building) throw new Error('建築編號不在參考庫，請先建立對應建築資料');
  if (bundle.encoder?.onnx_sha256 !== base.encoder.onnx_sha256 || bundle.encoder?.dim !== base.encoder.dim) throw new Error('編碼器版本或維度不一致，請在選圖頁重新分析影像差異');
  const names=new Set(), hashes=new Set(), verified=[], known=[];
  for (const frame of bundle.frames) {
    if (!safeFrameName(frame.frame) || names.has(frame.frame) || !/^[a-f0-9]{64}$/.test(frame.sha256 ?? '') || hashes.has(frame.sha256)
      || frame.buildingId !== building.id || frame.captureGroup !== bundle.captureGroup
      || frame.review?.status !== 'approved' || !Number.isFinite(Date.parse(frame.review.reviewedAt))) throw new Error('照片來源、確認狀態或批次不一致');
    names.add(frame.frame);hashes.add(frame.sha256);
    const vector=unitVector(frame.vector);
    if (!vector || vector.length!==base.encoder.dim) throw new Error(`向量無效：${frame.frame}`);
    const bytes=readPhoto(frame.frame);
    if (crypto.createHash('sha256').update(bytes).digest('hex')!==frame.sha256) throw new Error(`照片已改變或與清單不符：${frame.frame}`);
    const filename=`capture_${frame.sha256}${path.extname(frame.frame).toLowerCase()}`;
    const archived=lookupArchivePhoto(frame.frame);
    const sameArchived=archived?.buildingId===building.id && archived.sha256===frame.sha256 && building.files.includes(archived.orig);
    if (sameArchived || building.files.includes(frame.frame) || building.files.includes(filename) || frame.sourcePhoto?.orig && building.files.includes(frame.sourcePhoto.orig)) { known.push(frame.frame);continue; }
    verified.push({...frame,filename,vector,bytes});
  }
  const draft=structuredClone(base);
  const target=draft.buildings.find(b=>b.id===building.id);
  for (const frame of verified) {target.files.push(frame.filename);target.vectors.push(frame.vector);}
  // Cached prototypes and leave-one-out suggestions no longer describe this gallery.
  delete target.prototype;
  draft.eval={suggested:{...(base.eval?.suggested ?? {hit:.82,maybe:.57})},source:'frozen_previous_policy',status:'recalibration_required'};
  draft.generated=new Date().toISOString();
  draft.importHistory=[...(draft.importHistory??[]),{buildingId:building.id,captureGroup:bundle.captureGroup,added:verified.length,source:bundle.source}];
  return {draft,verified,known};
}
export function main(argv=process.argv.slice(2)) {
  const args=Object.fromEntries(Array.from({length:argv.length/2},(_,i)=>[argv[i*2],argv[i*2+1]]));
  if (!args['--bundle'] || !args['--photos'] || !args['--out']) throw new Error('用法：node tools/collection/import-reviewed.mjs --bundle reviewed-capture.json --photos <原圖資料夾> --out <草稿輸出資料夾>');
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const base=JSON.parse(fs.readFileSync(new URL('../../public/data/memory-embeddings.json',import.meta.url)));
  const bundle=JSON.parse(fs.readFileSync(args['--bundle']));
  const photoDir=path.resolve(args['--photos']),out=path.resolve(args['--out']);
  const publicDir=path.resolve(root,'public');
  const publicRelative=path.relative(publicDir,out);
  if (!publicRelative || !publicRelative.startsWith('..'+path.sep) && publicRelative!=='..' && !path.isAbsolute(publicRelative)) throw new Error('請輸出到草稿資料夾；審查後再決定公開內容');
  const archive=JSON.parse(fs.readFileSync(path.join(publicDir,'data/photo-archive.json')));
  const archivedFiles=new Map(archive.places.flatMap(place=>place.photos.map(photo=>[path.basename(photo.file),{...photo,buildingId:place.nearId}])));
  const result=prepareReferenceDraft(base,bundle,name=>fs.readFileSync(path.join(photoDir,name)),name=>{
    const photo=archivedFiles.get(name);if(!photo)return null;
    const sourcePath=path.resolve(publicDir,photo.file),relative=path.relative(publicDir,sourcePath);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('照片檔案來源超出公開資料夾');
    return {...photo,sha256:crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')};
  });
  if(fs.existsSync(path.join(out,'memory-embeddings.draft.json')))throw new Error('草稿已存在，請使用新的輸出資料夾');
  fs.mkdirSync(path.join(out,'photos',bundle.building.id),{recursive:true});
  for(const frame of result.verified)fs.writeFileSync(path.join(out,'photos',bundle.building.id,frame.filename),frame.bytes);
  fs.writeFileSync(path.join(out,'memory-embeddings.draft.json'),JSON.stringify(result.draft));
  fs.writeFileSync(path.join(out,'reviewed-capture.json'),JSON.stringify(bundle,null,2));
  fs.writeFileSync(path.join(out,'import-summary.json'),JSON.stringify({added:result.verified.length,alreadyKnown:result.known,buildingId:bundle.building.id,scope:'參考庫草稿；未發布，需重新校準門檻及獨立評測'},null,2));
  console.log(`Created reference draft: ${result.verified.length} added, ${result.known.length} already known.`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
