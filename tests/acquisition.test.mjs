import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {selectFrames,readQualityReport,makeReviewedBundle,safeFrameName} from '../src/collection/selection.js';
import {compareViews} from '../src/recognize/multi-view.js';
import {prepareReferenceDraft} from '../tools/collection/import-reviewed.mjs';
import {evaluateSelection} from '../tools/collection/evaluate-selection.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const pool=[
  {id:'a.jpg',imageQuality:.9,viewBin:0,vector:[1,0,0]},
  {id:'b.jpg',imageQuality:.8,viewBin:0,vector:[1,.01,0]},
  {id:'c.jpg',imageQuality:.8,viewBin:1,vector:[0,1,0]},
  {id:'d.jpg',imageQuality:.7,viewBin:2,vector:[0,0,1]}
];
const thresholds={hit:.82,maybe:.57,low:.35};
const library={encoder:{dim:3,onnx_sha256:sha('encoder')},eval:{suggested:thresholds,top1:.99},buildings:[
  {id:'a',zh:'甲建築',files:['ref-a.jpg'],vectors:[[1,0,0]]},
  {id:'b',zh:'乙建築',files:['ref-b.jpg'],vectors:[[0,1,0]]}
]};
const shot=(id,vector)=>({name:id,sha256:sha(id),vector});

test('combined policy adds a different view before near-identical photos',()=>{
  const result=selectFrames(pool,{budget:2});assert.deepEqual(result.selected.map(f=>f.id),['a.jpg','c.jpg']);assert.equal(result.viewGroups,2);
  assert.match(result.selected[1].selectionReasons[0],/補充視角/);
});
test('all baselines share rejection, unavailable and exact-duplicate exclusion',()=>{
  const frames=[{...pool[0],sha256:sha('same')},{...pool[1],sha256:sha('same')},{...pool[2],grade:'reject'},{...pool[3],available:false}];
  for(const method of ['combined','uniform','random','visual','view']){
    const result=selectFrames(frames,{budget:5,method});assert.equal(result.eligible,1);assert.deepEqual(result.selected.map(f=>f.id),['a.jpg']);
  }
});
test('random baseline is reproducible and selections contain no duplicates',()=>{
  const a=selectFrames(pool,{budget:3,method:'random',seed:17}),b=selectFrames(pool,{budget:3,method:'random',seed:17});
  assert.deepEqual(a.selected.map(f=>f.id),b.selected.map(f=>f.id));assert.equal(new Set(a.selected.map(f=>f.id)).size,3);
});
test('missing geometric and visual information is reported explicitly',()=>{
  const result=selectFrames([{id:'a.jpg',imageQuality:.9},{id:'b.jpg',imageQuality:.2}],{budget:1});
  assert.equal(result.selected[0].id,'a.jpg');assert.equal(result.missingGeometry,1);assert.equal(result.missingVectors,1);
});
test('invalid vectors and mixed dimensions cannot be silently scored',()=>{
  assert.throws(()=>selectFrames([{id:'a',vector:[NaN,1]}]),/無效向量/);
  assert.throws(()=>selectFrames([{id:'a',vector:[1,0]},{id:'b',vector:[1,0,0]}]),/不同編碼器/);
});
const report={schemaVersion:1,sourceFingerprint:'scene-v1-1234567890abcdef',frames:[{frame:'frame_1.jpg',grade:'review',viewBin:2,projectedSupport:30,supportedCells:6,pointSpanRatio:.4,reasons:['待複核']}]};
test('report parser rejects duplicate frames, traversal and invalid pose groups',()=>{
  assert.equal(readQualityReport(report)[0].sourceFingerprint,report.sourceFingerprint);
  assert.throws(()=>readQualityReport({...report,frames:[...report.frames,...report.frames]}),/無效或重複/);
  assert.throws(()=>readQualityReport({...report,frames:[{...report.frames[0],frame:'../a.jpg'}]}),/無效或重複/);
  assert.throws(()=>readQualityReport({...report,frames:[{...report.frames[0],viewBin:25}]}),/無效或重複/);
  assert.equal(safeFrameName('folder\\frame.jpg'),false);
});
test('unreviewed photos never enter exported manifests',()=>{
  const selected=selectFrames(pool.map(f=>({...f,sha256:sha(f.id)})),{budget:2});
  const reviews=new Map([['a.jpg',{status:'approved',reviewedAt:'2026-10-03T12:00:00Z'}]]);
  const bundle=makeReviewedBundle({selection:selected,building:{id:'a',name:'甲'},reviews,encoder:{dim:3,onnx_sha256:sha('encoder')},captureGroup:'batch-1',source:'本人拍攝'});
  assert.equal(bundle.frames.length,1);assert.equal(bundle.frames[0].frame,'a.jpg');
  assert.throws(()=>makeReviewedBundle({selection:selected,building:{id:'a',name:'甲'},reviews:new Map(),captureGroup:'batch-1',source:'本人拍攝'}),/至少一張/);
});
test('two distinct, strongly supported views can agree without reporting a probability',()=>{
  const result=compareViews(library,[shot('1',[1,0,0]),shot('2',[.9,.15,0])],thresholds);
  assert.equal(result.state,'agreement');assert.equal(result.rows[0].id,'a');assert.equal(result.rows[0].perPhoto.length,2);assert.match(result.scope,/不是正確機率/);
});
test('conflicting, duplicate and almost-identical photos do not become agreement',()=>{
  assert.equal(compareViews(library,[shot('1',[1,0,0]),shot('2',[0,1,0])],thresholds).state,'conflict');
  assert.equal(compareViews(library,[shot('1',[1,0,0]),shot('2',[1,.01,0])],thresholds).state,'similar');
  assert.throws(()=>compareViews(library,[shot('1',[1,0,0]),shot('1',[1,0,0])],thresholds),/重複/);
});
test('one photo or low-score agreement still needs confirmation',()=>{
  assert.equal(compareViews(library,[shot('1',[1,0,0])],thresholds).state,'one');
  assert.notEqual(compareViews(library,[shot('1',[.2,0,1]),shot('2',[.4,0,1])],thresholds).state,'agreement');
});
const bytes=Buffer.from('photo bytes'),bundle={schemaVersion:1,kind:'macau-memory-capture',protocol:'full_image_three_crops_flip_tta',
  building:{id:'a'},captureGroup:'capture-1',source:'owner',encoder:library.encoder,
  frames:[{frame:'new.jpg',sha256:sha(bytes),buildingId:'a',captureGroup:'capture-1',vector:[1,0,0],review:{status:'approved',reviewedAt:'2026-10-03T12:00:00Z'}}]};
test('draft import verifies image bytes, encoder and human review before extending gallery',()=>{
  const result=prepareReferenceDraft(library,bundle,()=>bytes);
  assert.equal(result.verified.length,1);assert.equal(result.draft.buildings[0].vectors.length,2);assert.equal(library.buildings[0].vectors.length,1);
  assert.equal(result.draft.eval.top1,undefined);assert.equal(result.draft.eval.status,'recalibration_required');assert.equal(result.draft.eval.suggested.hit,.82);
  assert.throws(()=>prepareReferenceDraft(library,bundle,()=>Buffer.from('changed')),/照片已改變/);
  assert.throws(()=>prepareReferenceDraft(library,{...bundle,encoder:{...library.encoder,onnx_sha256:sha('wrong')}},()=>bytes),/編碼器/);
  assert.throws(()=>prepareReferenceDraft(library,{...bundle,frames:[{...bundle.frames[0],review:{status:'pending'}}]},()=>bytes),/確認狀態/);
});
test('an existing original photo is not counted as a newly added reference',()=>{
  const result=prepareReferenceDraft(library,{...bundle,frames:[{...bundle.frames[0],sourcePhoto:{orig:'ref-a.jpg'}}]},()=>bytes);
  assert.equal(result.verified.length,0);assert.deepEqual(result.known,['new.jpg']);
});
test('manually selected archive photos are recognised by verified bytes, not only filenames',()=>{
  const archived={buildingId:'a',orig:'ref-a.jpg',sha256:sha(bytes)};
  const result=prepareReferenceDraft(library,bundle,()=>bytes,()=>archived);
  assert.equal(result.verified.length,0);assert.deepEqual(result.known,['new.jpg']);
  assert.equal(prepareReferenceDraft(library,bundle,()=>bytes,()=>({...archived,sha256:sha('different')})).verified.length,1);
  assert.equal(prepareReferenceDraft(library,bundle,()=>bytes,()=>({...archived,buildingId:'b'})).verified.length,1);
});
function dataset(){
  return {schemaVersion:1,encoder:library.encoder,protocol:bundle.protocol,thresholds,
    candidates:[...pool.map((f,i)=>({...f,buildingId:'a',sha256:sha(`pool-a-${i}`),captureGroup:`a-${i%2}`})),
      ...pool.map((f,i)=>({...f,id:`z${i}.jpg`,buildingId:'b',sha256:sha(`pool-b-${i}`),captureGroup:`b-${i%2}`,vector:[0,1,.1*i]}))],
    queries:[{id:'test-a',buildingId:'a',sha256:sha('test-a'),captureGroup:'test-day',vector:[1,0,0]},
      {id:'test-unknown',buildingId:'outside',sha256:sha('test-unknown'),captureGroup:'outside-day',vector:[0,0,1]}]};
}
test('changing held-out query values cannot affect reference selection',()=>{
  const original=dataset(),changed=structuredClone(original);changed.queries[0].vector=[0,1,0];
  const a=evaluateSelection(original,{budgets:[2]}),b=evaluateSelection(changed,{budgets:[2]});
  assert.deepEqual(a.runs.map(r=>r.selectedIds),b.runs.map(r=>r.selectedIds));assert.equal(a.runs.length,7);
});
test('benchmark blocks capture-group and file-hash leakage',()=>{
  const a=dataset();a.queries[0].captureGroup=a.candidates[0].captureGroup;assert.throws(()=>evaluateSelection(a),/資料洩漏/);
  const b=dataset();b.queries[0].sha256=b.candidates[0].sha256;assert.throws(()=>evaluateSelection(b),/資料重複/);
});
test('three-dimensional baseline is skipped when candidate poses are missing',()=>{
  const data=dataset();data.candidates.forEach(f=>delete f.viewBin);
  const result=evaluateSelection(data,{budgets:[2]});assert.match(result.runs.find(r=>r.method==='view').skipped,/缺少三維/);
  const invalid=dataset();invalid.candidates[0].viewBin=24;assert.throws(()=>evaluateSelection(invalid),/三維視角组|三維視角組/);
  const unlabelled=dataset();delete unlabelled.queries[0].buildingId;assert.throws(()=>evaluateSelection(unlabelled),/人工建築編號/);
});
