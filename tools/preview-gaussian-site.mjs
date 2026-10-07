// Local verification of the exact packaged Worker, static assets, and full PLY.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import worker from '../sites/macau-memory/dist/server/index.js';
const client=path.resolve('sites/macau-memory/dist/client'),original=path.resolve('public/gaussian/stpaul/scene.ply');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.wasm':'application/wasm','.svg':'image/svg+xml'};
const env={BUCKET:{
 head:async()=>({size:fs.statSync(original).size,httpEtag:'"original-local"'}),
 get:async(_key,options)=>({body:Readable.toWeb(fs.createReadStream(original,options?.range?{start:options.range.offset,end:options.range.offset+options.range.length-1}:{}))})
},ASSETS:{fetch:async request=>{
 const url=new URL(request.url),relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html',file=path.resolve(client,relative);
 if(!file.startsWith(client+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('Not found',{status:404});
 const headers={'Content-Type':mime[path.extname(file)]??'application/octet-stream','Content-Length':String(fs.statSync(file).size),'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'};
 return new Response(request.method==='HEAD'?null:Readable.toWeb(fs.createReadStream(file)),{headers});
}}};
http.createServer(async(req,res)=>{
 try{
  const request=new Request('http://127.0.0.1:4203'+req.url,{method:req.method,headers:req.headers});
  const response=await worker.fetch(request,env);
  res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
 }catch{res.writeHead(500);res.end('Preview unavailable');}
}).listen(4203,'127.0.0.1',()=>console.log('Packaged original-quality preview: http://127.0.0.1:4203/gaussian.html?scene=ruins-st-paul'));
