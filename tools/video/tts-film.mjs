import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {callTencent} from '../../server/tencent.js';
try {process.loadEnvFile('.env.local');} catch(e) {if(e.code!=='ENOENT')throw e;}
const root=path.resolve('output/video/macau-memory-film-v2-20261004');
const probe=process.argv.includes('--probe');
const jobs=probe?[{lang:'mandarin',id:'probe',text:'澳门的记忆，藏在大三巴的石刻里，也藏在每天经过的街巷中。我们从一段影像开始，把照片、位置和三维空间连接起来，让每一栋建筑，都有被记住的机会。'}]:JSON.parse(fs.readFileSync(path.join(root,'data/script.json'),'utf8')).scenes.flatMap(s=>['mandarin','cantonese'].map(lang=>({lang,id:s.id,text:s[lang]})));
let next=0;
async function worker(){while(next<jobs.length){const j=jobs[next++];const voice=j.lang==='mandarin'?403007:101019;const sampleRate=j.lang==='mandarin'?24000:16000;const dir=path.join(root,'assets/audio',j.lang);fs.mkdirSync(dir,{recursive:true});const wav=path.join(dir,j.id+'.wav'),meta=path.join(dir,j.id+'.json');const fingerprint=createHash('sha256').update(JSON.stringify([j.text,voice,0])).digest('hex');if(fs.existsSync(wav)&&fs.existsSync(meta)&&JSON.parse(fs.readFileSync(meta,'utf8')).fingerprint===fingerprint)continue;
 const r=await callTencent('tts','TextToVoice','2019-08-23',{Text:j.text,SessionId:randomUUID(),ModelType:1,VoiceType:voice,Codec:'wav',SampleRate:sampleRate,Speed:0,EnableSubtitle:true});if(!r.Audio)throw Error('No audio: '+j.id);fs.writeFileSync(wav,Buffer.from(r.Audio,'base64'));fs.writeFileSync(meta,JSON.stringify({fingerprint,text:j.text,voice,sampleRate,speed:0,subtitles:r.Subtitles??[]},null,2));console.log(j.lang+' '+j.id+' '+voice+' saved');}}
await Promise.all([worker(),worker()]).catch(e=>{console.error(e.message);process.exitCode=1;});
