import fs from 'node:fs';import path from 'node:path';
import {chromium} from 'file:///C:/Users/LINKIT/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const dir=path.resolve('output/video/tujian-promo-60s/captures');fs.mkdirSync(dir,{recursive:true});
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu-sandbox']});
for(const kind of ['memory','splat']){
 const c=await b.newContext({viewport:{width:2560,height:1440},recordVideo:{dir,size:{width:2560,height:1440}}});const p=await c.newPage();const events=[];const t=Date.now();
 async function mark(name){events.push({name,time:(Date.now()-t)/1000});await p.screenshot({path:path.join(dir,name+'.png')});console.log(name);}
 try{
  if(kind==='memory'){
   await p.goto('http://127.0.0.1:4202/memory.html',{waitUntil:'networkidle',timeout:90000});await p.waitForTimeout(2000);
   if(await p.locator('#service-error').isVisible())throw Error('Memory service unavailable');
   await mark('memory-stories');
   await p.locator('[data-tab="photos"]').click();await p.waitForTimeout(2400);await mark('memory-photos');
   await p.locator('[data-tab="puzzle"]').click();await p.locator('#clue-query').pressSequentially('澳門街巷的生活記憶',{delay:110});await p.locator('#find-clues').click();await p.waitForTimeout(2800);await mark('memory-clues');
   await p.locator('[data-tab="learn"]').click();await p.waitForTimeout(2800);await mark('memory-learning');
  }else{
   await p.goto('http://127.0.0.1:4202/output/video/macau-memory-film-v2-20261004/assets/splat-viewer.html',{waitUntil:'networkidle',timeout:90000});
   await p.waitForFunction(()=>window.__ready,{timeout:120000});await p.waitForTimeout(1200);await mark('splat-ready');
   await p.locator('#view-orbit').click();await p.waitForTimeout(15000);await mark('splat-orbit');
  }
 }catch(e){console.error(kind+': '+e.message);await mark(kind+'-error');process.exitCode=1;}
 finally{fs.writeFileSync(path.join(dir,kind+'-events.json'),JSON.stringify(events,null,2));const v=p.video();await c.close();await v.saveAs(path.join(dir,kind+'-2k.webm'));}
}
await b.close();
