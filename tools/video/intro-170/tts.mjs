import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {callTencent} from '../../../server/tencent.js';

process.loadEnvFile('.env.local');
const dir=path.resolve('output/video/tujian-intro-170s/audio');
fs.mkdirSync(dir,{recursive:true});
const scenes=JSON.parse(fs.readFileSync('tools/video/intro-170/script.json','utf8')).scenes;
for(const s of scenes){
  const p=path.join(dir,`${s.id}.wav`);
  if(fs.existsSync(p))continue;
  const r=await callTencent('tts','TextToVoice','2019-08-23',{
    Text:s.text,SessionId:randomUUID(),ModelType:1,VoiceType:403007,
    Codec:'wav',SampleRate:24000,Speed:0,EnableSubtitle:true
  });
  fs.writeFileSync(p,Buffer.from(r.Audio,'base64'));
  console.log(`${s.id} ready`);
}
