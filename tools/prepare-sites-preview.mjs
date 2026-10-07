import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),site=path.join(root,'sites/macau-memory'),snapshot=path.join(site,'dist'),out=path.join(snapshot,'client');
// Only regenerate this disposable static snapshot, preserving the Site's Git
// checkout, identity and source project. Validate the absolute target first.
if(path.resolve(snapshot)!==path.resolve(root,'sites/macau-memory/dist')||!path.resolve(snapshot).startsWith(path.resolve(root)+path.sep))throw new Error('Invalid snapshot path');
if(fs.existsSync(snapshot))fs.rmSync(snapshot,{recursive:true});
// The original 155 MB model is delivered from R2, byte-for-byte, not static assets.
fs.cpSync(path.join(root,'dist'),out,{recursive:true,filter:p=>!['ai-local.json','scene.ply','scene.compressed.ply'].includes(path.basename(p))});
fs.mkdirSync(path.join(snapshot,'server'),{recursive:true});
fs.copyFileSync(path.join(root,'server/gaussian-site-worker.mjs'),path.join(snapshot,'server/index.js'));
const hosting={project_id:'appgprj_6ac5d64f6aec8191890eb39e591860d3',d1:null,r2:'BUCKET'};
fs.writeFileSync(path.join(site,'.openai/hosting.json'),JSON.stringify(hosting,null,2));
fs.mkdirSync(path.join(snapshot,'.openai'),{recursive:true});
fs.writeFileSync(path.join(snapshot,'.openai/hosting.json'),JSON.stringify(hosting,null,2));
const split={};
// These legacy exports are unused by the current website; retain the original
// local files, but exclude them from this static deployment snapshot.
for(const relative of [
 'models/dinov2-vits14-336.int8.onnx',
 'models/parisian.detail.glb','models/galaxy-macau.detail.glb',
 'models/macau-science-center.detail.glb','models/londoner-macao.detail.glb',
 'ort/ort-wasm-simd-threaded.jsep.mjs','ort/ort-wasm-simd-threaded.jsep.wasm'
]){const file=path.join(out,relative);if(fs.existsSync(file))fs.unlinkSync(file);}
for(const name of ['dinov2-vits14-336.onnx','macau-buildings-yolo.onnx']){
 const file=path.join(out,'models',name),bytes=fs.readFileSync(file),parts=[];
 for(let offset=0,i=0;offset<bytes.length;offset+=20*1024*1024,i++){
  const part=`${name}.part${i}`;fs.writeFileSync(path.join(out,'models',part),bytes.subarray(offset,offset+20*1024*1024));parts.push(part);
 }
 split[name]={parts,size:bytes.length};fs.unlinkSync(file);
}
const hook=`(()=>{if(globalThis.__macauSplitFetch)return;globalThis.__macauSplitFetch=true;const files=${JSON.stringify(split)},native=globalThis.fetch.bind(globalThis);globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,globalThis.location.href),name=url.pathname.split('/').pop(),entry=files[name];if(url.origin!==globalThis.location.origin||!entry)return native(input,init);const arrays=await Promise.all(entry.parts.map(async name=>{const part=new URL(name,url),r=await native(part,init);if(!r.ok)throw new Error('模型下载失败：'+r.status);return new Uint8Array(await r.arrayBuffer())}));const combined=new Uint8Array(entry.size);let offset=0;for(const a of arrays){combined.set(a,offset);offset+=a.length}if(offset!==entry.size)throw new Error('模型文件不完整');return new Response(combined,{status:200,headers:{'Content-Type':'application/octet-stream','Content-Length':String(entry.size)}})}})();`;
fs.writeFileSync(path.join(out,'model-fetch.js'),hook);
for(const name of ['index.html','recognize.html','system.html','capture.html','gaussian.html']){
 const file=path.join(out,name);let html=fs.readFileSync(file,'utf8');html=html.replace('<head>','<head>\n    <script src="./model-fetch.js"></script>');fs.writeFileSync(file,html);
}
for(const name of fs.readdirSync(path.join(out,'assets')).filter(n=>n.startsWith('yolo.worker-')&&n.endsWith('.js'))){const file=path.join(out,'assets',name);fs.writeFileSync(file,hook+'\n'+fs.readFileSync(file,'utf8'));}
fs.writeFileSync(path.join(out,'_headers'),'/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: credentialless\n');
fs.writeFileSync(path.join(site,'.gitignore'),'.sites-runtime/\n*.tar.gz\n');
fs.writeFileSync(path.join(site,'README.md'),'# 澳门记忆在线预览\n\n现有澳门记忆项目的静态前端发布快照。包含三维地图、建筑识别、照片记忆、采集工作台。模型分片在浏览器重组，原模型精度保持。腾讯云密钥及本地 AI 凭据不包含在发布快照中。云端数字人语音后端尚未接入。\n');
let count=0,total=0,max=0;
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else{const len=fs.statSync(file).size;if(len>25*1024*1024)throw new Error('超过静态文件限制：'+file);count++;total+=len;max=Math.max(max,len);}}}
scan(out);console.log(JSON.stringify({files:count,totalMB:Math.round(total/1024/1024),largestMB:Math.round(max/1024/1024),routes:['/','/recognize.html','/system.html','/capture.html','/gaussian.html']}));
