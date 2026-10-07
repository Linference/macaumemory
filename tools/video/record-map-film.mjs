import fs from 'node:fs';import path from 'node:path';
import {chromium} from 'file:///C:/Users/LINKIT/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const dir=path.resolve('output/video/macau-memory-film-v2-20261004/assets/captures');
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu-sandbox']});
const c=await b.newContext({viewport:{width:1920,height:1080},recordVideo:{dir,size:{width:1920,height:1080}}});const p=await c.newPage();const v=p.video();const events=[];const t=Date.now();
async function mark(name){events.push({name,time:(Date.now()-t)/1000});await p.screenshot({path:path.join(dir,'map-'+name+'.png')});console.log(name,events.at(-1).time);}
try{await p.goto('http://127.0.0.1:4190/#14.1/22.175/113.545',{waitUntil:'networkidle',timeout:90000});await p.waitForFunction(()=>window.__map?.isStyleLoaded(),{timeout:90000});await p.waitForTimeout(1800);await mark('city');
await p.mouse.move(1000,530);await p.mouse.wheel(0,-600);await p.waitForTimeout(2500);await mark('approach');
if(await p.locator('#sidebar').evaluate(e=>e.getBoundingClientRect().right<100))await p.locator('#btn-list').click();await p.waitForTimeout(1000);await mark('list');
const links=await p.locator('button').allTextContents();fs.writeFileSync(path.join(dir,'map-buttons.txt'),links.join('\n'));
const stpaul=p.locator('#list [data-id="ruins-st-paul"]');if(await stpaul.count()){await stpaul.click();await p.waitForTimeout(3500);await mark('stpaul');}
await p.mouse.move(1250,490);await p.mouse.down({button:'right'});await p.mouse.move(1000,550,{steps:80});await p.mouse.up({button:'right'});await p.waitForTimeout(2500);await mark('orbit');
}catch(e){console.error(e.message);fs.writeFileSync(path.join(dir,'map-error.txt'),e.message);}
fs.writeFileSync(path.join(dir,'map-events.json'),JSON.stringify(events,null,2));await c.close();await v.saveAs(path.join(dir,'map-operation.webm'));await b.close();
