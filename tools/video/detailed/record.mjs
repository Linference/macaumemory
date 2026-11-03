import fs from 'node:fs';import path from 'node:path';
import {chromium} from 'file:///C:/Users/LINKIT/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const out=path.resolve('output/video/tujian-detailed/captures');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu-sandbox','--autoplay-policy=no-user-gesture-required']});
const base='http://127.0.0.1:4202';
for(const kind of (process.argv.slice(2).length?process.argv.slice(2):['system','ordinary','memory','puzzle','learning','guide'])){
 const ctx=await browser.newContext({viewport:{width:2560,height:1440},recordVideo:{dir:out,size:{width:2560,height:1440}},permissions:kind==='guide'?['geolocation']:[],geolocation:kind==='guide'?{longitude:113.5315,latitude:22.1482,accuracy:10}:undefined});
 const p=await ctx.newPage();const t=Date.now();const events=[];
 async function mark(label){events.push({name:label,time:(Date.now()-t)/1000});await p.screenshot({path:path.join(out,kind+'-'+label+'.png')});console.log(kind+' '+label);}
 async function pause(ms=3500){await p.waitForTimeout(ms);}
 try{
  if(kind==='system'){
   await p.goto(base+'/system.html',{waitUntil:'networkidle'});await pause();await mark('hero');await p.locator('#archive').scrollIntoViewIfNeeded();await pause();await mark('archive');await p.locator('#research').scrollIntoViewIfNeeded();await pause(6000);await mark('workflow');
  }else if(kind==='guide'){
   const attractions=JSON.parse(fs.readFileSync('public/data/attractions.json','utf8')).attractions;const site=attractions.find(x=>x.id==='a-ma-temple');
   await ctx.setGeolocation({longitude:site.coords[0],latitude:site.coords[1],accuracy:10});await p.goto(base+'/',{waitUntil:'networkidle',timeout:90000});
   await p.waitForFunction(()=>getComputedStyle(document.querySelector('#boot')).visibility==='hidden',{timeout:90000});await pause();await mark('map');
   await p.locator('#btn-locate').click();await pause(1800);await ctx.setGeolocation({longitude:site.coords[0]+.00001,latitude:site.coords[1],accuracy:10});
   await p.waitForFunction(()=>!document.querySelector('#digital-guide').hidden,{timeout:15000});await pause(12000);await mark('arrival');
  }else{
   await p.goto(base+'/memory.html',{waitUntil:'networkidle',timeout:60000});await pause(1800);
   if(await p.locator('#service-error').isVisible())throw Error('Memory service unavailable');
   if(kind==='ordinary'){
    await p.locator('#new-place').click();await pause(2500);await mark('form');
    await p.locator('#place-form [name="name"]').fill('街角建築（操作示範）');await p.locator('#place-form [name="lat"]').fill('22.19745');await p.locator('#place-form [name="lon"]').fill('113.54084');await pause(8000);await mark('location');
   }else if(kind==='memory'){
    await p.locator('[data-tab="photos"]').click();await pause(5500);await mark('photos');await p.mouse.wheel(0,380);await pause(3500);await p.mouse.wheel(0,-380);
    await p.locator('[data-tab="stories"]').click();await p.locator('#write-story').click();await pause(3000);await mark('story');
    await p.locator('#story-form [name="title"]').fill('街巷生活的記憶（表單示範）');await p.locator('#story-form [name="text"]').fill('在這裡記錄你與這個地方的故事，並附上照片或原聲。');await pause(7000);await mark('story-form');
   }else if(kind==='puzzle'){
    await p.locator('[data-tab="puzzle"]').click();await p.locator('#puzzle-title').fill('澳門街巷的文化記憶');await p.locator('#clue-query').pressSequentially('大三巴與澳門歷史城區',{delay:90});await p.locator('#find-clues').click();await pause(4000);await mark('clues');
    const cards=p.locator('[data-clue]');if(await cards.count()){await cards.first().click();await pause(3500);await mark('card');}
    await p.locator('#puzzle-interpretation').fill('結合照片與來源資料，整理這個地方如何連接澳門的歷史與日常生活。');await pause(7000);await mark('interpretation');
   }else if(kind==='learning'){
    await p.locator('[data-tab="learn"]').click();await pause(7000);await mark('tasks');await p.locator('#create-class [name="question"]').fill('普通建築如何承載澳門的生活與文化記憶？');await pause(9000);await mark('question');
   }
  }
 }catch(e){console.error(kind+': '+e.message);await mark('error');fs.writeFileSync(path.join(out,kind+'-error.txt'),e.message);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,kind+'-events.json'),JSON.stringify(events,null,2));const video=p.video();await ctx.close();await video.saveAs(path.join(out,kind+'.webm'));}
}
await browser.close();
