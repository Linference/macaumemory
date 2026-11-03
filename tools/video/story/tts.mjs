import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {callTencent} from '../../../server/tencent.js';
process.loadEnvFile('.env.local');
const out=path.resolve('output/video/tujian-story/audio');fs.mkdirSync(out,{recursive:true});
const scenes=JSON.parse(fs.readFileSync('tools/video/story/script.json','utf8')).scenes;
scenes.push({id:'demo-memory',text:'這是一段操作示範。我把看到的陽台、店面與街道記錄下來，下次還能回到同一份檔案。'});
for(const s of scenes){const p=path.join(out,s.id+'.wav');if(fs.existsSync(p))continue;
 const r=await callTencent('tts','TextToVoice','2019-08-23',{Text:s.text,SessionId:randomUUID(),ModelType:1,VoiceType:403007,Codec:'wav',SampleRate:24000,Speed:0,EnableSubtitle:true});
 fs.writeFileSync(p,Buffer.from(r.Audio,'base64'));fs.writeFileSync(path.join(out,s.id+'-timing.json'),JSON.stringify(r.Subtitles??r.Subtitle??null));console.log(s.id+' ready');}
