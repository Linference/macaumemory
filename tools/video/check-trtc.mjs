import fs from 'node:fs';import {callTencent} from '../../server/tencent.js';
try{process.loadEnvFile('.env.local')}catch(e){if(e.code!=='ENOENT')throw e;}
try{const r=await callTencent('trtc','DescribeAppStatList','2019-07-22',{});
 const ids=[];function walk(v){if(!v||typeof v!=='object')return;for(const [k,a] of Object.entries(v)){if(/sdkappid/i.test(k)&&(/^\d+$/.test(String(a))))ids.push(Number(a));else if(typeof a==='object')walk(a)}}walk(r);console.log('Response fields: '+Object.keys(r).join(', '));
 fs.writeFileSync('output/video/macau-memory-film-v2-20261004/data/trtc-available-apps.json',JSON.stringify({sdkAppIds:[...new Set(ids)]},null,2));console.log('TRTC app IDs found: '+ids.length);
}catch(e){console.error(e.message);process.exitCode=1;}
