const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function memoryApi(route,data){const r=await fetch('/api/memory'+route,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json','X-Memory-Client':'tujian'}:{},...(data?{body:JSON.stringify(data)}:{})});let out;try{out=await r.json();}catch{throw new Error('請先啟動本機記憶服務。');}if(!r.ok)throw new Error(out.error);return out;}
export async function setupSceneMemory(scene,{onSelect,onPose,getPose,onSaved}){
 const $=id=>document.getElementById('gs-'+id),placeId=scene.placeId??scene.id;
 $('memory-link').href='./memory.html?place='+encodeURIComponent(placeId);
 try{
  const account=await memoryApi('/bootstrap'),archive=await memoryApi('/place/'+encodeURIComponent(placeId));
  const versions=archive.scenes;
  $('version').innerHTML=versions.map(s=>`<option value="${esc(s.id)}">${esc(s.versionLabel||s.title)} · ${esc(s.capturedAt||'日期未登記')}</option>`).join('');
  const active=versions.find(s=>s.id===scene.id);$('version').value=active?.id??versions[0]?.id??'';
  $('version').onchange=async()=>{const s=versions.find(s=>s.id===$('version').value);if(s)await onSelect(s);};
  const current=active??scene;
  $('hotspots').innerHTML=(current.hotspots??[]).map(h=>`<article><button type="button" data-view="${esc(h.id)}">${esc(h.title)}</button>${h.storyId?`<a href="./memory.html?place=${encodeURIComponent(placeId)}#story-${encodeURIComponent(h.storyId)}">閱讀這段記憶</a>`:''}</article>`).join('')||'<p>先旋轉到你想介紹的角度，再保存故事視角。</p>';
  $('hotspots').onclick=e=>{const button=e.target.closest('[data-view]');if(!button)return;const h=(current.hotspots??[]).find(h=>h.id===button.dataset.view);if(h)onPose(h.camera);};
  $('hotspot-form').hidden=!(active&&(account.user.curator||active.owner===account.user.id));
  $('hotspot-story').innerHTML='<option value="">只保存觀察視角</option>'+archive.stories.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
  $('hotspot-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const updated=await memoryApi('/scene/'+current.id+'/hotspots',{title:$('hotspot-title').value,storyId:$('hotspot-story').value||null,camera:getPose(),version:current.version});onSaved(updated);$('hotspot-title').value='';await setupSceneMemory(updated,{onSelect,onPose,getPose,onSaved});$('memory-status').textContent='觀察視角已保存。';}catch(error){$('memory-status').textContent=error.message;}finally{button.disabled=false;}};
  $('memory-status').textContent='視角與故事使用同一地點編號。';
 }catch{ $('version').innerHTML=`<option>${esc(scene.title)}</option>`;$('hotspot-form').hidden=true;$('memory-status').textContent='啟動本機記憶服務後，可保存故事視角及管理採集版本。'; }
}
