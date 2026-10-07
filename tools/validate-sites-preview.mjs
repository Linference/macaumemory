import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const site='sites/macau-memory/dist/client/';
const c={fetch:async u=>new Response(fs.readFileSync(site+new URL(u).pathname.slice(1))),location:{href:'https://preview.local/',origin:'https://preview.local'},URL,Response,Uint8Array};
vm.createContext(c);vm.runInContext(fs.readFileSync(site+'model-fetch.js','utf8'),c);
for(const name of ['dinov2-vits14-336.onnx','macau-buildings-yolo.onnx']){
 const bytes=Buffer.from(await(await c.fetch('https://preview.local/models/'+name)).arrayBuffer());
 const expected=fs.readFileSync('public/models/'+name),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 if(hash(bytes)!==hash(expected))throw Error('model mismatch');console.log(name+': identical model bytes');
}
for(const name of ['index.html','recognize.html','system.html','capture.html','gaussian.html']){
 const html=fs.readFileSync(site+name,'utf8');
 for(const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)){
  const relative=m[1].split(/[?#]/)[0]||'index.html';
  if(!fs.existsSync(site+relative))throw Error('missing '+relative);
 }
 console.log(name+': references present');
}
