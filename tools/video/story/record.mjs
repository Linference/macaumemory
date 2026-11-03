import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'file:///C:/Users/LINKIT/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const out=path.resolve('output/video/tujian-story/captures');fs.mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:4202';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu-sandbox','--autoplay-policy=no-user-gesture-required']});
const ctx=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:out,size:{width:1600,height:900}}});
const p=await ctx.newPage();const events=[];const start=Date.now();const evidence={};
async function mark(name,hold=1600){await p.waitForTimeout(hold);events.push({name,time:(Date.now()-start)/1000});await p.screenshot({path:path.join(out,name+'.png')});console.log(name);}
async function click(loc){const box=await loc.boundingBox();if(box)await p.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:12});await p.waitForTimeout(250);await loc.click();}
await ctx.addInitScript(()=>{window.addEventListener('DOMContentLoaded',()=>{
 const cursor=document.createElement('div');cursor.id='film-cursor';cursor.style.cssText='position:fixed;left:-80px;top:-80px;z-index:2147483647;pointer-events:none;width:25px;height:25px;border:2px solid #d7ae55;background:#d7ae5530;border-radius:50%;box-shadow:0 0 0 4px #ffffff99;transition:transform .1s';document.body.append(cursor);
 document.addEventListener('mousemove',e=>{cursor.style.left=(e.clientX-12)+'px';cursor.style.top=(e.clientY-12)+'px';});
 document.addEventListener('mousedown',()=>{cursor.style.transform='scale(1.7)';});document.addEventListener('mouseup',()=>{cursor.style.transform='scale(1)';});
});});
try{
 await p.goto(base+'/recognize.html',{waitUntil:'networkidle',timeout:90000});
 await p.locator('#workspace').scrollIntoViewIfNeeded();
 await p.waitForTimeout(800);
 await p.locator('#rc-file').setInputFiles(path.resolve('output/pdf/assets/stpaul-2010.jpg'));await mark('photo-selected');
 await p.waitForFunction(()=>!document.querySelector('#rc-run').disabled,{timeout:180000});
 await mark('recognition-ready',300);await click(p.locator('#rc-run'));await mark('recognition-start',350);
 await p.waitForFunction(()=>!document.querySelector('#rc-results').hidden||!document.querySelector('#rc-errors').hidden,{timeout:180000});
 if(!await p.locator('#rc-errors').isHidden())throw Error(await p.locator('#rc-errors').innerText());
 evidence.recognition=await p.locator('#rc-results').innerText();
 if(!evidence.recognition.includes('首位候選「大三巴牌坊」'))throw Error('Recognition did not return St Paul as first candidate');
 await p.locator('#rc-results').scrollIntoViewIfNeeded();await mark('recognition-result',3500);
 await click(p.getByRole('link',{name:'確認後查看地點記憶'}));
 await p.waitForSelector('#place-heading h2');await mark('archive-open',2600);
 await click(p.locator('[data-tab="photos"]'));await mark('album-open',3400);
 await click(p.locator('[data-tab="scenes"]'));await mark('versions-open',2400);
 await click(p.locator('#scene-list .button-link').first());
 await p.waitForFunction(()=>!document.querySelector('#gs-orbit').disabled,{timeout:180000});await mark('gaussian-ready',2000);
 await click(p.locator('#gs-orbit'));await mark('gaussian-orbit',6000);
 await click(p.locator('#gs-orbit'));await p.mouse.move(930,430);await p.mouse.down();await p.mouse.move(1050,450,{steps:40});await p.mouse.up();await p.mouse.wheel(0,-180);await mark('gaussian-closeup',5000);
 await p.goto(base+'/memory.html?place=ruins-st-paul',{waitUntil:'networkidle'});await p.waitForSelector('#place-heading h2');
 await click(p.locator('#new-place'));await mark('new-place-open',1200);
 await p.locator('#place-form [name="name"]').pressSequentially('街角唐樓（操作示範）',{delay:90});
 await p.locator('#place-form [name="summary"]').fill('以真實街巷照片示範建立記憶檔案；建築位置待實地確認。');await mark('new-place-filled',1600);
 await click(p.locator('#place-form button').filter({hasText:'建立永久編號'}));
 await p.waitForFunction(()=>document.querySelector('#place-heading')?.textContent.includes('街角唐樓（操作示範）'));
 evidence.placeUrl=p.url();await mark('new-place-saved',4200);
 await click(p.locator('#write-story'));await mark('story-open',800);
 await p.locator('#story-form [name="title"]').pressSequentially('街巷裡的建築觀察（示範）',{delay:65});
 await p.locator('#story-form [name="author"]').fill('途見操作示範');
 await p.locator('#story-form [name="era"]').fill('照片日期待核對');
 await p.locator('#story-form [name="text"]').fill('操作示範：照片中可以觀察到陽台、地面店舖與街道。我把影像和觀察保存於這份檔案，日後再補充實地記錄與建築來源。');await mark('story-written',1600);
 await p.locator('#story-files').setInputFiles([path.resolve('output/pdf/assets/tonglau-real.jpg'),path.resolve('output/video/tujian-story/audio/demo-memory.wav')]);await mark('story-media-added',1800);
 await click(p.locator('#story-form button[type="submit"]'));await p.waitForSelector('#story-list audio');await mark('story-saved',2200);
 await p.locator('#story-list audio').scrollIntoViewIfNeeded();await mark('story-attachments-visible',1300);
 await p.locator('#story-list audio').evaluate(a=>a.play());await mark('story-audio-playing',3500);
 await p.reload({waitUntil:'networkidle'});await p.waitForSelector('#story-list audio');await p.locator('#story-list audio').scrollIntoViewIfNeeded();await mark('story-reopened',2600);
 await click(p.locator('#story-list [data-story-card]').first());await p.locator('#puzzle-title').fill('從街巷觀察開始探索澳門（示範）');await mark('story-in-puzzle',1600);
 await p.locator('#clue-query').fill('澳門歷史城區 街巷 建築 文化');await click(p.locator('#find-clues'));await p.waitForSelector('[data-clue]');await mark('clues-found',2300);
 await click(p.locator('[data-clue]').first());await mark('clue-added',1800);
 await p.locator('#puzzle-cards [data-card-note="0"]').fill('從真實照片提出對街巷生活的觀察問題。');
 await p.locator('#puzzle-cards [data-card-note="1"]').fill('作為城市文化背景資料，建築本身的年代與關係仍待查核。');
 await p.locator('#puzzle-interpretation').fill('照片留下建築的外觀與生活線索；有來源的城市資料協助提出探索問題。透過實地訪問和資料核對，可以持續補充這份記憶。');await mark('puzzle-interpretation',2200);
 await click(p.locator('#save-puzzle'));await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('拼圖已保存'));await mark('puzzle-saved',3000);
 const puzzleId=await p.locator('#puzzle-select').inputValue();await p.reload({waitUntil:'networkidle'});await p.waitForSelector('#place-heading h2');await click(p.locator('[data-tab="puzzle"]'));await p.locator('#puzzle-select').selectOption(puzzleId);await mark('puzzle-reopened',2500);
 const data=await p.evaluate(async()=>{const r=await fetch('/api/memory'+new URL(location.href).searchParams.get('place').replace(/^/,'/place/'));return r.json();});
 evidence.savedPlace=data.place;evidence.storyCount=data.stories.length;evidence.storyMedia=data.stories[0].media.map(m=>({mime:m.mime,sha256:m.sha256}));evidence.puzzleCount=data.puzzles.length;
 if(evidence.storyCount!==1||evidence.puzzleCount!==1)throw Error('Persistence verification failed');
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));await ctx.storageState({path:path.join(out,'browser-state.json')});
}catch(e){console.error(e.message);await p.screenshot({path:path.join(out,'error.png')});fs.writeFileSync(path.join(out,'error.txt'),e.stack);process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'events.json'),JSON.stringify(events,null,2));const v=p.video();await ctx.close();await v.saveAs(path.join(out,'journey.webm'));await browser.close();}
