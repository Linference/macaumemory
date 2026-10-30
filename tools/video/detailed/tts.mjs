import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {callTencent} from '../../../server/tencent.js';
process.loadEnvFile('.env.local');
const dir=path.resolve('output/video/tujian-detailed/audio');fs.mkdirSync(dir,{recursive:true});
const scenes=JSON.parse(fs.readFileSync('tools/video/detailed/script.json','utf8')).scenes;
for(const s of scenes){
 const fp=createHash('sha256').update(s.text+'403007').digest('hex'),wav=path.join(dir,s.id+'.wav'),meta=path.join(dir,s.id+'.json');
 if(fs.existsSync(wav)&&fs.existsSync(meta)&&JSON.parse(fs.readFileSync(meta)).fingerprint===fp)continue;
 const r=await callTencent('tts','TextToVoice','2019-08-23',{Text:s.text,SessionId:randomUUID(),ModelType:1,VoiceType:403007,Codec:'wav',SampleRate:24000,Speed:0,EnableSubtitle:true});
 if(!r.Audio)throw Error('No audio '+s.id);fs.writeFileSync(wav,Buffer.from(r.Audio,'base64'));fs.writeFileSync(meta,JSON.stringify({text:s.text,voice:403007,speed:0,fingerprint:fp,subtitles:r.Subtitles??[]},null,2));console.log('Narration '+s.id+' saved');
}
