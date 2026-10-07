// Receive temporary credentials through stdin only; never persist or log them.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {MODEL_KEY,MODEL_SIZE,MODEL_SHA} from '../server/gaussian-site-worker.mjs';
const input=await new Promise((resolve,reject)=>{
 let value='';const terminal=process.stdin.isTTY;
 const finish=error=>{process.stdin.removeListener('data',onData);process.stdin.removeListener('end',onEnd);if(terminal)process.stdin.setRawMode(false);process.stdin.pause();error?reject(error):resolve(value);};
 const onData=chunk=>{value+=chunk;if(value.includes('\u0003'))finish(Error('Publication cancelled'));else if(value.length>65536)finish(Error('Input too large'));else if(value.includes('\n')||value.includes('\r'))finish();};
 const onEnd=()=>finish();
 if(terminal)process.stdin.setRawMode(true);
 console.log('Ready for original model publication JSON on stdin (input is hidden).');
 process.stdin.setEncoding('utf8');process.stdin.on('data',onData);process.stdin.once('end',onEnd);process.stdin.resume();
});
const {baseUrl,token}=JSON.parse(input),url=new URL('/api/gaussian-seed',baseUrl),file='public/'+MODEL_KEY;
const bytes=fs.readFileSync(file),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(bytes.length!==MODEL_SIZE||sha(bytes)!==MODEL_SHA)throw Error('Original model mismatch');
async function call(action,method,body,params={},headers={}){
 const endpoint=new URL(url);endpoint.searchParams.set('action',action);for(const [key,value]of Object.entries(params))endpoint.searchParams.set(key,value);
 const res=await fetch(endpoint,{method,headers:{Authorization:`Bearer ${token}`,...headers},body});
 if(!res.ok)throw Error(`Model publication failed (${res.status}): ${await res.text()}`);return res.json();
}
const {uploadId}=await call('create','POST'),parts=[];
console.log('Original model upload initialized.');
try{
 for(let offset=0,n=1;offset<bytes.length;offset+=20*1024*1024,n++){
  const part=bytes.subarray(offset,offset+20*1024*1024);
  parts.push(await call('part','PUT',part,{uploadId,partNumber:String(n)},{'X-Part-SHA256':sha(part),'Content-Length':String(part.length)}));
  console.log(`Original model: part ${n}/${Math.ceil(bytes.length/(20*1024*1024))} stored and checked`);
 }
 console.log(JSON.stringify(await call('complete','POST',JSON.stringify({parts}),{uploadId},{'Content-Type':'application/json'})));
 const response=await fetch(new URL('/'+MODEL_KEY,baseUrl));if(!response.ok)throw Error('Published model unavailable');
 const hash=crypto.createHash('sha256');let size=0;
 for await(const chunk of response.body){hash.update(chunk);size+=chunk.length;}
 if(size!==MODEL_SIZE||hash.digest('hex')!==MODEL_SHA)throw Error('Published bytes differ from original');
 console.log('Verified: published model is byte-for-byte identical to original PLY.');
}catch(error){await call('abort','POST',null,{uploadId}).catch(()=>{});throw error;}
