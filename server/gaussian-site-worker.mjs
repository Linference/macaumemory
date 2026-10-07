// Only this supplied original reconstruction is served; no generic file access.
export const MODEL_KEY='gaussian/stpaul/scene.ply';
export const MODEL_SIZE=155169663;
export const MODEL_SHA='d5955f72eaa5072f50fb71348a2cda47319defb0e27e732996fd8fa99b971f09';
const PART_SIZE=20*1024*1024;
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function parseRange(value,size){
 if(!value)return null;
 const m=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!m||(!m[1]&&!m[2]))throw new Error('Invalid range');
 let start,end;
 if(!m[1]){const n=Number(m[2]);if(n<=0)throw new Error('Invalid range');start=Math.max(0,size-n);end=size-1;}
 else{start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)throw new Error('Invalid range');
 return {offset:start,length:end-start+1};
}
async function serveModel(request,bucket){
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
 const head=await bucket.head(MODEL_KEY);
 if(!head)return new Response('模型正在準備，請稍後重試。',{status:503,headers:{'Retry-After':'30','Cache-Control':'no-store'}});
 const headers=new Headers({'Content-Type':'application/octet-stream','Content-Length':String(head.size),'Accept-Ranges':'bytes','Cache-Control':'public, max-age=86400','ETag':head.httpEtag,'X-Model-SHA256':MODEL_SHA});
 if(request.headers.get('If-None-Match')===head.httpEtag)return new Response(null,{status:304,headers});
 let range;
 try{range=parseRange(request.headers.get('Range'),head.size);}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${head.size}`}});}
 if(range){headers.set('Content-Length',String(range.length));headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${head.size}`);}
 if(request.method==='HEAD')return new Response(null,{status:range?206:200,headers});
 const result=await bucket.get(MODEL_KEY,range?{range}:undefined);
 if(!result?.body)return new Response('模型暫時不可用。',{status:503});
 return new Response(result.body,{status:range?206:200,headers});
}
async function seed(request,env,url){
 // Temporary, owner-held publication credential. Expiry and write-once enforced.
 const expires=Number(env.GAUSSIAN_SEED_UNTIL);
 if(!env.GAUSSIAN_SEED_TOKEN||!Number.isFinite(expires)||Date.now()>expires||request.headers.get('Authorization')!==`Bearer ${env.GAUSSIAN_SEED_TOKEN}`)return json({error:'Forbidden'},403);
 if(await env.BUCKET.head(MODEL_KEY))return json({error:'Original model already published'},409);
 const action=url.searchParams.get('action');
 if(action==='create'&&request.method==='POST'){
  const upload=await env.BUCKET.createMultipartUpload(MODEL_KEY,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:MODEL_SHA}});
  return json({uploadId:upload.uploadId});
 }
 const uploadId=url.searchParams.get('uploadId');if(!uploadId||uploadId.length>1000)return json({error:'Invalid upload'},400);
 const upload=env.BUCKET.resumeMultipartUpload(MODEL_KEY,uploadId);
 if(action==='abort'&&request.method==='POST'){await upload.abort();return json({aborted:true});}
 if(action==='part'&&request.method==='PUT'){
  const n=Number(url.searchParams.get('partNumber')),count=Math.ceil(MODEL_SIZE/PART_SIZE);
  if(!Number.isInteger(n)||n<1||n>count)return json({error:'Invalid part'},400);
  const expected=n===count?MODEL_SIZE-(n-1)*PART_SIZE:PART_SIZE;
  if(Number(request.headers.get('Content-Length'))!==expected)return json({error:'Invalid length'},400);
  const bytes=await request.arrayBuffer();if(bytes.byteLength!==expected)return json({error:'Incomplete part'},400);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==request.headers.get('X-Part-SHA256'))return json({error:'Checksum mismatch'},400);
  return json(await upload.uploadPart(n,bytes));
 }
 if(action==='complete'&&request.method==='POST'){
  const {parts}=await request.json(),count=Math.ceil(MODEL_SIZE/PART_SIZE);
  if(!Array.isArray(parts)||parts.length!==count||parts.some((p,i)=>p.partNumber!==i+1||typeof p.etag!=='string'))return json({error:'Invalid parts'},400);
  const result=await upload.complete(parts);
  if(result.size!==MODEL_SIZE)return json({error:'Model length mismatch'},500);
  return json({size:result.size,sha256:MODEL_SHA});
 }
 return json({error:'Method not allowed'},405);
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 try{
  if(url.pathname==='/api/gaussian-seed')return await seed(request,env,url);
  if(url.pathname==='/'+MODEL_KEY)return await serveModel(request,env.BUCKET);
  return await env.ASSETS.fetch(request);
 }catch(error){console.error('Gaussian resource unavailable:',error.message);return new Response('資源暫時不可用，請稍後重試。',{status:503,headers:{'Cache-Control':'no-store'}});}
}};
