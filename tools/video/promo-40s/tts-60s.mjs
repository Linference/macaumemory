import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {callTencent} from '../../../server/tencent.js';
process.loadEnvFile('.env.local');
const dir=path.resolve('output/video/tujian-promo-60s/audio');fs.mkdirSync(dir,{recursive:true});
const script=JSON.parse(fs.readFileSync('tools/video/promo-40s/narration-60s.json','utf8'));
for(const s of script.scenes){
 const file=path.join(dir,s.id+'.wav');if(fs.existsSync(file))continue;
 const r=await callTencent('tts','TextToVoice','2019-08-23',{Text:s.mandarin,SessionId:randomUUID(),ModelType:1,VoiceType:502005,Codec:'wav',SampleRate:24000,Speed:0,EnableSubtitle:true});
 if(!r.Audio)throw Error('No audio '+s.id);
 fs.writeFileSync(file,Buffer.from(r.Audio,'base64'));
 fs.writeFileSync(path.join(dir,s.id+'.json'),JSON.stringify({text:s.mandarin,voice:502005,subtitles:r.Subtitles??[]},null,2));console.log(s.id+' saved');
}
