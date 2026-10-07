import fs from 'node:fs';
import path from 'node:path';
import { callTencent } from '../../server/tencent.js';
import { randomUUID, createHash } from 'node:crypto';

const root = path.resolve('output/video/macau-memory-2k-20261004');
try { process.loadEnvFile('.env.local'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const probe = process.argv.includes('--probe');
const jobs = probe ? [
  {lang:'mandarin',id:'probe',text:'澳门记忆，让每一栋建筑，都有被记住的机会。'},
  {lang:'cantonese',id:'probe',text:'澳門記憶，令每一棟建築，都有被記住嘅機會。'}
] : JSON.parse(fs.readFileSync(path.join(root,'data/script.json'),'utf8')).scenes.flatMap(s =>
  ['mandarin','cantonese'].flatMap(lang=>s[lang].map((text,i)=>({lang,id:`${s.id}-${i+1}`,text}))));
const voices = {mandarin:101001,cantonese:101019};
let next = 0, completed = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++], dir=path.join(root,'assets/audio',job.lang);
    fs.mkdirSync(dir,{recursive:true});
    const wav=path.join(dir,job.id+'.wav'), meta=path.join(dir,job.id+'.json');
    const fingerprint=createHash('sha256').update(JSON.stringify([job.text,voices[job.lang],0])).digest('hex');
    if(fs.existsSync(wav)&&fs.existsSync(meta)&&JSON.parse(fs.readFileSync(meta,'utf8')).fingerprint===fingerprint){completed++;continue;}
    if([...job.text].length>130) throw new Error('Narration line exceeds 130 characters: '+job.id);
    let result;
    for(let attempt=0;attempt<3;attempt++) {
      try {
        result=await callTencent('tts','TextToVoice','2019-08-23',{
          Text:job.text,SessionId:randomUUID(),ModelType:1,VoiceType:voices[job.lang],
          Codec:'wav',SampleRate:16000,Speed:0,EnableSubtitle:true
        }); break;
      }catch(e){if(attempt===2||/AuthFailure|Arrears|NotOpen|PkgExhausted|NoFreeAccount/.test(e.message))throw new Error(e.message);}
    }
    if(!result?.Audio)throw new Error('Tencent returned no audio: '+job.id);
    fs.writeFileSync(wav,Buffer.from(result.Audio,'base64'));
    fs.writeFileSync(meta,JSON.stringify({fingerprint,provider:'Tencent Cloud',voice:voices[job.lang],text:job.text,subtitles:result.Subtitles??[]},null,2));
    console.log(`${++completed}/${jobs.length} ${job.lang} ${job.id}`);
  }
}
await Promise.all([worker(),worker()]).catch(e=>{console.error(e.message);process.exitCode=1;});
