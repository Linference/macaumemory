import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const site='sites/macau-memory/dist/client';
const manifestPath=path.join(site,'models/manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
for(const model of Object.values(manifest.models)){
 if(!model.lod?.file||!model.full?.file||model.lod.file===model.full.file)continue;
 const old=path.join(site,'models',model.full.file);
 model.full={...model.lod};
 if(fs.existsSync(old))fs.unlinkSync(old);
}
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
const usedModels=new Set(Object.values(manifest.models).flatMap(m=>[m.full?.file,m.lod?.file]).filter(Boolean));
for(const name of fs.readdirSync(path.join(site,'models'))){
 if(name.endsWith('.glb')&&!usedModels.has(name))fs.unlinkSync(path.join(site,'models',name));
}
const photoDir=path.join(site,'photos/real');
for(const name of fs.readdirSync(photoDir).filter(n=>n.endsWith('.webp'))){
 const file=path.join(photoDir,name),before=fs.readFileSync(file);
 const result=await sharp(before).resize({width:720,height:720,fit:'inside',withoutEnlargement:true}).webp({quality:62}).toBuffer();
 if(result.length<before.length)fs.writeFileSync(file,result);
}
let bytes=0,count=0;
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else{bytes+=fs.statSync(file).size;count++;}}}
scan(site);if(bytes>250*1024*1024)throw new Error('Still too large: '+bytes);
console.log(JSON.stringify({files:count,expandedMiB:(bytes/1048576).toFixed(1),recognitionModels:'unchanged',displayModels:'existing LOD',photoMaxDimension:720}));
