import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{parseRange,MODEL_KEY,MODEL_SIZE} from '../server/gaussian-site-worker.mjs';
test('original model ranges support start/end, suffix, and reject unsatisfiable ranges',()=>{
 assert.deepEqual(parseRange('bytes=0-15',100),{offset:0,length:16});
 assert.deepEqual(parseRange('bytes=90-',100),{offset:90,length:10});
 assert.deepEqual(parseRange('bytes=-10',100),{offset:90,length:10});
 for(const invalid of ['bytes=100-','bytes=10-9','bytes=-0','bytes=0-1,5-7'])assert.throws(()=>parseRange(invalid,100));
});
test('original model supports HEAD and streams requested bytes without transforming them',async()=>{
 let accessed=false,options;
 const env={BUCKET:{head:async()=>({size:MODEL_SIZE,httpEtag:'"original"'}),get:async(key,o)=>{assert.equal(key,MODEL_KEY);accessed=true;options=o;return{body:new Uint8Array([1,2,3,4])};}}};
 const head=await worker.fetch(new Request('https://site.local/'+MODEL_KEY,{method:'HEAD'}),env);
 assert.equal(head.headers.get('Content-Length'),String(MODEL_SIZE));assert.equal(accessed,false);
 const response=await worker.fetch(new Request('https://site.local/'+MODEL_KEY,{headers:{Range:'bytes=0-3'}}),env);
 assert.equal(response.status,206);assert.deepEqual(options,{range:{offset:0,length:4}});
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3,4]));
 assert.equal(response.headers.get('Content-Range'),`bytes 0-3/${MODEL_SIZE}`);
});
test('seed endpoint rejects missing, expired, or incorrect publication credentials',async()=>{
 for(const env of [{},{GAUSSIAN_SEED_TOKEN:'owner',GAUSSIAN_SEED_UNTIL:'0'},{GAUSSIAN_SEED_TOKEN:'owner',GAUSSIAN_SEED_UNTIL:String(Date.now()+10000)}]){
  const r=await worker.fetch(new Request('https://site.local/api/gaussian-seed?action=create',{method:'POST'}),env);assert.equal(r.status,403);
 }
});
test('existing website assets are delegated to asset binding',async()=>{
 const response=await worker.fetch(new Request('https://site.local/recognize.html'),{ASSETS:{fetch:async r=>new Response(new URL(r.url).pathname)}});
 assert.equal(await response.text(),'/recognize.html');
});
