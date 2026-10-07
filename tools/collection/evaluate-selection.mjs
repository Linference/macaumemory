import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {selectFrames,unitVector} from '../../src/collection/selection.js';
import {rankCandidates,marginOf,verdict} from '../../src/recognize/compare.js';

export function validateDataset(dataset) {
  if(dataset?.schemaVersion!==1 || dataset.protocol!=='full_image_three_crops_flip_tta'
    || !/^[a-f0-9]{64}$/.test(dataset.encoder?.onnx_sha256??'') || !Number.isInteger(dataset.encoder.dim)
    || !Array.isArray(dataset.candidates) || !dataset.candidates.length || !Array.isArray(dataset.queries) || !dataset.queries.length
    || !Number.isFinite(dataset.thresholds?.hit) || !Number.isFinite(dataset.thresholds?.maybe)
    || dataset.thresholds.hit<dataset.thresholds.maybe || dataset.thresholds.hit>1 || dataset.thresholds.maybe<0)throw new Error('評測資料格式／固定門檻無效');
  const ids=new Set(), hashes=new Set(), candidateGroups=new Set(dataset.candidates.map(c=>c.captureGroup));
  for(const [type,items] of [['pool',dataset.candidates],['test',dataset.queries]])for(const item of items){
    const vector=unitVector(item.vector);
    if(!item.id || ids.has(item.id) || !/^[a-f0-9]{64}$/.test(item.sha256??'') || hashes.has(item.sha256)
      || !item.captureGroup?.trim() || !vector || vector.length!==dataset.encoder.dim)throw new Error('資料重複、來源批次缺失或向量無效');
    if(typeof item.buildingId!=='string'||!item.buildingId.trim())throw new Error('照片需要人工建築編號；庫外照片也要標記其實際編號');
    if(type==='pool'&&item.viewBin!=null&&(!Number.isInteger(item.viewBin)||item.viewBin<0||item.viewBin>23))throw new Error('三維視角組必須介於 0 與 23');
    if(type==='test'&&candidateGroups.has(item.captureGroup))throw new Error('拍攝批次跨越候選池與測試集，存在資料洩漏');
    ids.add(item.id);hashes.add(item.sha256);
  }
}
function gallery(frames){
  const ids=[...new Set(frames.map(f=>f.buildingId))];
  return {buildings:ids.map(id=>({id,zh:id,files:frames.filter(f=>f.buildingId===id).map(f=>f.id),vectors:frames.filter(f=>f.buildingId===id).map(f=>unitVector(f.vector))}))};
}
export function evaluateSelection(dataset,{budgets=[3,5,10],seeds=[17,42,73]}={}) {
  validateDataset(dataset);
  const methods=['uniform','random','visual','view','combined'], ids=[...new Set(dataset.candidates.map(c=>c.buildingId))];
  const prepared=dataset.candidates.map(candidate=>{
    // Only acquisition-pool images are used here. Held-out queries never inform priority scores.
    const peers=dataset.candidates.filter(c=>c.captureGroup!==candidate.captureGroup);
    const refs=gallery(peers);
    let ambiguity=null;
    if(refs.buildings.some(b=>b.id===candidate.buildingId)){
      const ranked=rankCandidates(refs,unitVector(candidate.vector),{thresholds:dataset.thresholds});
      if(ranked.top[0]?.sim>=dataset.thresholds.maybe)ambiguity=Math.max(0,1-Math.max(0,marginOf(ranked.top))/.12);
    }
    return {...candidate,ambiguity};
  });
  const runs=[];
  for(const budget of budgets)for(const method of methods)for(const seed of method==='random'?seeds:[42]){
    if(method==='view'&&prepared.some(c=>!Number.isInteger(c.viewBin))){runs.push({budget,method,skipped:'候選池缺少三維視角組'});break;}
    const selections=ids.map(id=>selectFrames(prepared.filter(f=>f.buildingId===id),{budget,method,seed}));
    const references=selections.flatMap(s=>s.selected),lib=gallery(references),counts={known:0,unknown:0,top1:0,accepted:0,correctAccepted:0,unknownAccepted:0};
    for(const q of dataset.queries){
      const ranked=rankCandidates(lib,unitVector(q.vector),{thresholds:dataset.thresholds}),decision=verdict(ranked.top,marginOf(ranked.top),dataset.thresholds);
      const known=ids.includes(q.buildingId),correct=ranked.top[0]?.id===q.buildingId,accepted=decision.key==='confident';
      counts[known?'known':'unknown']++;if(known&&correct)counts.top1++;if(accepted){counts.accepted++;if(known&&correct)counts.correctAccepted++;if(!known)counts.unknownAccepted++;}
    }
    const rate=(a,b)=>b?a/b:null;
    runs.push({budget,method,seed,referenceCount:references.length,selectedIds:references.map(f=>f.id),counts,
      top1:rate(counts.top1,counts.known),unknownFalseAcceptance:rate(counts.unknownAccepted,counts.unknown),
      acceptedPrecision:rate(counts.correctAccepted,counts.accepted),reviewRate:1-rate(counts.accepted,dataset.queries.length),
      partialBudgetBuildings:selections.filter(s=>s.selected.length<budget).length});
  }
  return {schemaVersion:1,encoder:dataset.encoder,thresholds:dataset.thresholds,generated:new Date().toISOString(),
    scope:'獨立影像向量检索對照；不測 YOLO 框位、手機耗時或三維重建品質；分組依採集者提供記錄',
    runs,notes:['候選池與測試集的檔案雜湊、編號及拍攝批次不可重複；近重複與拍攝者隔離仍需核查','所有選圖方式共用同一可用照片過濾規則','策略權重固定，測試集不參與選圖；隨機策略按不同種子重複','啟發式修正成本不是實測人工時間，需另行計時','結果按照片統計；同建築／批次相關性需在正式分析中處理']};
}
export function main(argv=process.argv.slice(2)){
  if(argv.length!==2)throw new Error('用法：node tools/collection/evaluate-selection.mjs <dataset.json> <report.json>');
  const report=evaluateSelection(JSON.parse(fs.readFileSync(argv[0])));
  fs.mkdirSync(path.dirname(path.resolve(argv[1])),{recursive:true});fs.writeFileSync(argv[1],JSON.stringify(report,null,2));
  console.log(`Wrote ${report.runs.length} selection comparisons.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
