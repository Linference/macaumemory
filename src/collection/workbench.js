import '../styles.css';
import './workbench.css';
import { selectFrames, readQualityReport, makeReviewedBundle, clamp, safeFrameName } from './selection.js';
import { rankCandidates, marginOf } from '../recognize/compare.js';
import { dedupThresholds } from '../recognize/dedup.js';
const $ = id => document.getElementById(`capture-${id}`);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let library = null, archive = null, frames = [], report = null, selection = null, encoder = null, encoderMeta = null;
let running = false, generation = 0, reviews = new Map(), reviewId = null, reviewStarted = 0, demonstration = false;
const message = value => { $('status').textContent = value; };
const yieldUi = () => new Promise(resolve => setTimeout(resolve, 0));
const hash = async file => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');

function setRunning(value) {
  running = value;
  for (const id of ['files','folder','report','demo','embed','budget','method','report-confirm']) $(id).disabled = value || id === 'embed' && !frames.length;
  $('cancel').hidden = !value;
  $('export').disabled = value || !selection?.selected.some(f => reviews.get(f.id)?.status === 'approved');
}
function imageDetail(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = Math.max(16, Math.round(160 * bitmap.height / bitmap.width));
  canvas.height = Math.min(240, canvas.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
  let difference = 0, count = 0;
  for (let y = 1; y < canvas.height; y++) for (let x = 1; x < canvas.width; x++) {
    const at = (y * canvas.width + x) * 4;
    const gray = offset => .299 * data[offset] + .587 * data[offset+1] + .114 * data[offset+2];
    const v = gray(at); difference += Math.abs(v-gray(at-4)) + Math.abs(v-gray(at-canvas.width*4)); count++;
  }
  return clamp(Math.log1p(difference / Math.max(1,count)) / Math.log(81));
}
async function readFiles(files, provenance = new Map()) {
  if (running) return;
  const images = Array.from(files).filter(f => safeFrameName(f.name));
  if (!images.length) { message('沒有可讀取的 JPG / PNG / WebP 照片。'); return; }
  if (images.length > 500 || images.reduce((s,f) => s+f.size, 0) > 800_000_000) { message('單批最多 500 張、合計 800 MB，請分批讀取。'); return; }
  if (new Set(images.map(f => f.name)).size !== images.length) { message('照片有重複檔名，請改名或選擇單一工程影格資料夾。'); return; }
  if (!crypto.subtle) { message('檔案校驗需要 HTTPS 或本機 localhost。'); return; }
  const token = ++generation, next = []; setRunning(true);
  try {
    for (let i=0; i<images.length; i++) {
      if (token !== generation) break;
      const file = images[i]; message(`正在讀取 ${i+1} / ${images.length}：${file.name}`); await yieldUi();
      let bitmap;
      try {
        bitmap = await createImageBitmap(file, {imageOrientation:'from-image'});
        const sha256 = await hash(file);
        if (token !== generation) break;
        next.push({ id:file.name, frame:file.name, file, sha256, imageQuality:imageDetail(bitmap), width:bitmap.width, height:bitmap.height,
          url:URL.createObjectURL(file), sourcePhoto:provenance.get(file.name) ?? null });
      } catch (error) { console.warn('Photo could not be decoded', file.name, error.message); }
      finally { bitmap?.close(); }
    }
    frames.forEach(f => URL.revokeObjectURL(f.url)); frames = next; reviews.clear();
    $('manifest').hidden=true;$('manifest-text').value='';
    $('report-confirm').checked = false; encoderMeta = null;
    message(`已讀取 ${frames.length} 張照片${frames.length < images.length ? '；部分照片未讀取或已取消' : ''}。可先選圖，或分析影像差異。`);
    render();
  } finally { setRunning(false); }
}
function effectiveFrames() {
  const byName = new Map(report?.map(f => [f.id,f]) ?? []);
  const useReport = $('report-confirm').checked;
  return frames.map(f => useReport && byName.has(f.id) ? {...f,...byName.get(f.id),available:true} : {...f,available:!useReport});
}
function render({ preserveStatus = false } = {}) {
  try {
    const method = $('method').value;
    selection = selectFrames(effectiveFrames(), {budget:Number($('budget').value),method});
    $('total').textContent = frames.length;
    $('selected').textContent = selection.selected.length;
    $('views').textContent = $('report-confirm').checked ? selection.viewGroups : '—';
    const approved = selection.selected.filter(f => reviews.get(f.id)?.status === 'approved').length;
    $('reviewed').textContent = approved;
    $('export').disabled = running || !approved;
    $('empty').hidden = frames.length !== 0;
    const skipped = selection.excluded;
    $('excluded').textContent = frames.length ? `可用 ${selection.eligible} 張 · 排除重複／不合格／無報告對應 ${skipped} 張` : '';
    $('cards').innerHTML = selection.selected.map((f,i) => `<article class="capture-card" data-approved="${reviews.get(f.id)?.status === 'approved'}"><img src="${esc(f.url)}" alt="${esc(f.id)}" loading="lazy" data-review="${esc(f.id)}"><div class="capture-card-content"><span class="capture-rank">SELECTED VIEW ${String(i+1).padStart(2,'0')}</span><h3>${esc(f.id)}</h3>${f.selectionReasons.map(r => `<p>${esc(r)}</p>`).join('')}${f.sourcePhoto?.credit ? `<p>${esc(f.sourcePhoto.credit)}</p>` : ''}<button class="button outline" data-review="${esc(f.id)}">${reviews.get(f.id)?.status === 'approved' ? '已確認 · 再次查看' : '打開照片並確認'} ↗</button></div></article>`).join('');
    const selectedViews = new Set(selection.selected.map(f => f.viewBin).filter(v=>v!=null));
    $('view-groups').innerHTML = $('report-confirm').checked ? `<p>三維視角組（8 個方位 × 3 個俯仰區間）；亮色為已選組別，並非表面完整率。</p>${Array.from({length:24},(_,i)=>`<span class="${selectedViews.has(i)?'selected':''}" aria-label="視角組 ${i+1}${selectedViews.has(i)?' 已選取':''}">${i+1}</span>`).join('')}` : '<p>加入同一工程的品質報告後，可以查看三維視角組分布。</p>';
    if (report) {
      const names = new Set(frames.map(f=>f.id)); const matched = report.filter(f=>names.has(f.id)).length;
      $('report-status').textContent = `品質報告共 ${report.length} 張，與已讀照片同名 ${matched} 張。${$('report-confirm').checked ? '已用於選圖。' : '請確認來自同一工程後啟用。'}`;
      $('report-confirm-label').hidden = false;
    }
    if (!preserveStatus && method === 'visual' && selection.missingVectors) message('影像差異尚未分析，目前只按影像細節排序；請點擊「分析影像差異」。');
    if (!preserveStatus && method === 'view' && selection.missingGeometry) message('沒有三維姿態，目前只按影像細節排序；請加入品質報告。');
  } catch (error) { message(error.message); selection = null; $('export').disabled = true; }
}
async function loadEncoder() {
  if (encoder) return encoder;
  const [{createEncoder,DEFAULT_DINO},ort] = await Promise.all([import('../recognize/dino.js'), import('../recognize/ort/ort.wasm.min.mjs')]);
  ort.env.wasm.numThreads=1; ort.env.wasm.simd=true; ort.env.wasm.wasmPaths=new URL('./ort/',document.baseURI).href;
  message('首次載入影像模型，正在核對模型檔案…');
  const candidate = await createEncoder(ort,new URL(DEFAULT_DINO,document.baseURI).href,{fingerprint:true});
  if (candidate.modelSha256 !== library.encoder.onnx_sha256) { await candidate.session.release(); throw new Error('影像模型與參考庫指紋不一致，請核對模型和參考庫版本。'); }
  encoder=candidate; return encoder;
}
$('embed').addEventListener('click', async()=>{
  if (running || !frames.length) return;
  const token=++generation; setRunning(true);
  try {
    const enc=await loadEncoder(), {multiCrops}=await import('../recognize/preprocess.js');
    encoderMeta={name:library.encoder.name,dim:library.encoder.dim,onnx_sha256:enc.modelSha256};
    for (let i=0;i<frames.length;i++) {
      if (token!==generation) break;
      const frame=frames[i]; if(frame.vector) continue;
      message(`分析影像差異 ${i+1} / ${frames.length}：${frame.id}`); await yieldUi();
      const bitmap=await createImageBitmap(frame.file,{imageOrientation:'from-image'});
      try {
        const vector=await enc.embed(bitmap,null,{crops:multiCrops(bitmap.width,bitmap.height,enc.size,3),tta:true});
        if(token!==generation) break;
        if(vector.length!==encoderMeta.dim) throw new Error('影像向量維度與參考庫不一致');
        frame.vector=Array.from(vector);
        // Exclude a same-named reference, including original demo filenames, from this priority signal.
        const original=frame.sourcePhoto?.orig ?? frame.id;
        const comparison={...library,buildings:library.buildings.map(b=>{
          const indexes=b.files.map((name,j)=>name===original?-1:j).filter(j=>j>=0);
          return {...b,files:indexes.map(j=>b.files[j]),vectors:indexes.map(j=>b.vectors[j])};
        })};
        const thresholds=dedupThresholds(library), ranked=rankCandidates(comparison,vector,{thresholds});
        frame.ambiguity=ranked.top[0]?.sim>=thresholds.maybe ? clamp(1-Math.max(0,marginOf(ranked.top))/.12) : 0;
      } finally {bitmap.close();}
    }
    message(token!==generation ? '分析已取消，保留已完成的影像特徵。' : '影像分析完成。選圖結果已更新，請逐張確認。');
    render();
  } catch(error){message(`影像分析未完成：${error.message}`);render({preserveStatus:true});}
  finally{setRunning(false);}
});
for(const id of ['files','folder']) $(id).addEventListener('change',event=>{demonstration=false;readFiles(event.target.files);});
$('cancel').addEventListener('click',()=>{generation++;message('正在停止，保留已完成的資料…');});
for(const id of ['budget','method','report-confirm']) $(id).addEventListener('change',render);
$('report').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>10_000_000)throw new Error('品質報告過大');report=readQualityReport(JSON.parse(await file.text()));$('report-confirm').checked=false;render();}
  catch(error){message(error.message);}
});
$('cards').addEventListener('click',event=>{
  const button=event.target.closest('[data-review]');if(!button||running)return;
  const frame=selection?.selected.find(f=>f.id===button.dataset.review);if(!frame)return;
  reviewId=frame.id;reviewStarted=performance.now();$('review-image').src=frame.url;$('review-name').textContent=frame.id;$('review-dialog').showModal();
});
$('approve').addEventListener('click',()=>{
  if(!reviewId||running)return;
  reviews.set(reviewId,{status:'approved',reviewedAt:new Date().toISOString(),activeSeconds:Math.round((performance.now()-reviewStarted)/1000)});
  $('review-dialog').close();reviewId=null;render();
});
$('export').addEventListener('click',()=>{
  try{
    const chosen=library.buildings.find(b=>b.id===$('building').value);
    const bundle=makeReviewedBundle({selection,building:chosen?{id:chosen.id,name:chosen.zh,spot:chosen.spot}:null,reviews,encoder:encoderMeta,captureGroup:$('group').value,source:$('source').value});
    bundle.demonstration=demonstration;
    const json=JSON.stringify(bundle,null,2);$('manifest-text').value=json;$('manifest').hidden=false;
    const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='reviewed-capture.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    $('export-status').textContent=`已產生 ${bundle.frames.length} 張確認照片的清單。若瀏覽器未下載，可展開下方清單複製儲存。保留原圖供整合工具核對。`;
  }catch(error){$('export-status').textContent=error.message;}
});
$('demo').addEventListener('click',async()=>{
  if(running||!archive)return;
  const token=++generation;setRunning(true);
  try{
    message('正在讀取媽閣廟的真實照片…');
    const place=archive.places.find(p=>p.nearId==='a-ma-temple');const provenance=new Map();
    const photos=await Promise.all(place.photos.slice(0,13).map(async photo=>{
      const response=await fetch(photo.file);if(!response.ok)throw new Error(`示範照片讀取失敗：${photo.file}`);
      const file=new File([await response.blob()],photo.file.split('/').pop(),{type:'image/webp'});provenance.set(file.name,photo);return file;
    }));
    if(token!==generation){message('示範照片讀取已取消。');return;}
    demonstration=true;report=null;$('report-confirm').checked=false;$('report-confirm-label').hidden=true;$('report-status').textContent='示範照片未附三維姿態，可分析影像差異；此示範不是獨立實拍評測。';
    setRunning(false);
    await readFiles(photos,provenance);$('building').value='a-ma-temple';$('group').value='demo-archive-a-ma-temple';$('source').value='既有媽閣廟實拍檔案；逐張來源與授權隨資料清單保留';
  }catch(error){message(error.message);}finally{setRunning(false);}
});
try{
  const responses=await Promise.all([fetch('./data/memory-embeddings.json'),fetch('./data/photo-archive.json')]);
  if(responses.some(r=>!r.ok))throw new Error('建築參考資料讀取失敗');
  [library,archive]=await Promise.all(responses.map(r=>r.json()));
  $('building').innerHTML='<option value="">請選擇建築</option>'+library.buildings.map(b=>`<option value="${esc(b.id)}">${esc(b.zh)}</option>`).join('');
  const place=archive.places.find(p=>p.nearId==='a-ma-temple');$('cover').src=place.cover;$('cover-credit').textContent=place.photos.find(p=>p.file===place.cover)?.credit ?? '媽閣廟 · 建築實拍';
  render();
}catch(error){message(error.message);$('demo').disabled=true;}
