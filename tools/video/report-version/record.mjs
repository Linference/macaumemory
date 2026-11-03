import fs from 'node:fs';import path from 'node:path';import {chromium} from 'file:///C:/Users/LINKIT/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const out=path.resolve('output/video/tujian-report-version/captures');fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu-sandbox']});
for(const name of ['recognition','memory','puzzle','ordinary']){
 const c=await b.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1.5,recordVideo:{dir:out,size:{width:1280,height:720}}});const p=await c.newPage();
 async function hold(label,ms=4500){await p.waitForTimeout(ms);await p.screenshot({path:path.join(out,name+'-'+label+'.png')});console.log(name+' '+label);}
 try{
  if(name==='recognition'){
   await p.goto('http://127.0.0.1:4202/recognize.html',{waitUntil:'networkidle'});await p.waitForFunction(()=>!document.querySelector('#rc-run').disabled||document.querySelector('#rc-stage').textContent.includes('完成'),{timeout:8000}).catch(()=>{});
   await p.locator('#workspace').scrollIntoViewIfNeeded();await p.locator('#rc-file').setInputFiles(path.resolve('output/pdf/assets/stpaul-2010.jpg'));await hold('upload',2500);await p.waitForFunction(()=>!document.querySelector('#rc-run').disabled,{timeout:180000});await p.locator('#rc-run').click();await hold('run',2000);await p.waitForFunction(()=>!document.querySelector('#rc-results').hidden,{timeout:180000});
   await p.locator('#workspace').evaluate(e=>window.scrollTo(0,e.getBoundingClientRect().top+scrollY-35));await hold('result',6500);
   await p.locator('#mv-same').check();await p.locator('#mv-add').click();await p.locator('#rc-multi').scrollIntoViewIfNeeded();await hold('multiview',5000);
  }else{
   await p.goto('http://127.0.0.1:4202/memory.html',{waitUntil:'networkidle'});await p.waitForTimeout(1500);
   if(name==='memory'){
    await p.locator('[data-tab="photos"]').click();await hold('photos',6500);await p.mouse.wheel(0,300);await hold('sources',4500);await p.mouse.wheel(0,-600);await p.locator('[data-tab="stories"]').click();await p.locator('#write-story').click();await hold('story-form',6500);
   }else if(name==='puzzle'){
    await p.locator('[data-tab="puzzle"]').click();await p.locator('#puzzle-title').fill('街巷中的澳門記憶');await p.locator('#clue-query').fill('大三巴與澳門歷史城區');await p.locator('#find-clues').click();await hold('clues',5000);if(await p.locator('[data-clue]').count())await p.locator('[data-clue]').first().click();await hold('card',5000);await p.locator('#puzzle-interpretation').fill('核對照片與來源線索，理解建築和街區生活的關係。');await hold('interpretation',6000);
   }else{
    await p.locator('#new-place').click();await p.locator('#place-form [name="name"]').fill('街角建築（表單示範）');await p.locator('#place-form [name="lon"]').fill('113.54084');await p.locator('#place-form [name="lat"]').fill('22.19745');await hold('form',10000);
   }
  }
 }catch(e){console.error(name,e.message);await p.screenshot({path:path.join(out,name+'-error.png')});process.exitCode=1;}
 finally{const v=p.video();await c.close();await v.saveAs(path.join(out,name+'.webm'));}
}
await b.close();
