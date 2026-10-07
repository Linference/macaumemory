import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'file:///C:/Users/LINKIT/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const root=path.resolve('output/video/macau-memory-film-v2-20261004');
const dir=path.join(root,'assets/captures');
const mode=process.argv[2]||'recognize';
const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu-sandbox','--autoplay-policy=no-user-gesture-required']});
const c=await b.newContext({viewport:{width:1920,height:1080},recordVideo:{dir,size:{width:1920,height:1080}}});
const p=await c.newPage();const start=Date.now();const events=[];
p.on('pageerror',e=>console.log('PAGE_ERROR',e.message));
p.on('requestfailed',r=>console.log('FETCH_ERROR',r.url().replace(/\?.*/,''),r.failure()?.errorText));
async function mark(name){events.push({name,time:(Date.now()-start)/1000});console.log(name,events.at(-1).time);await p.screenshot({path:path.join(dir,mode+'-'+name+'.png')});}
async function click(sel){const e=p.locator(sel).first();await e.scrollIntoViewIfNeeded();const r=await e.boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2,{steps:22});await p.waitForTimeout(500);await e.click();}
try{
await p.goto('http://127.0.0.1:4190/recognize.html',{waitUntil:'networkidle',timeout:90000});
await p.addStyleTag({content:'html{scroll-behavior:smooth}'});
await p.evaluate(()=>{const e=document.createElement('div');e.id='film-cursor';e.style.cssText='position:fixed;width:22px;height:22px;border:2px solid #eed398;border-radius:50%;pointer-events:none;z-index:99999;box-shadow:0 0 16px #d7b56399;transform:translate(-50%,-50%)';document.body.append(e);addEventListener('mousemove',v=>{e.style.left=v.clientX+'px';e.style.top=v.clientY+'px'});});
await p.waitForTimeout(1500);await mark('hero');
await p.locator('#workspace').scrollIntoViewIfNeeded();await p.waitForTimeout(1500);
await click('[data-demo]');await p.waitForTimeout(1600);await mark('photo');
await p.waitForFunction(()=>!document.querySelector('#rc-run').disabled,{timeout:180000});
await click('#rc-run');await mark('run');
await p.waitForFunction(()=>!document.querySelector('#rc-results').hidden||!document.querySelector('#rc-errors').hidden,{timeout:180000});
await p.waitForTimeout(2500);await mark('result');
fs.writeFileSync(path.join(dir,'actual-recognition-result.txt'),await p.locator('#rc-results').innerText());
if(mode==='extended'){
 await p.locator('#mv-same').check();await click('#mv-add');await p.waitForTimeout(1800);await mark('multiview-one');
 await p.locator('#rc-file').setInputFiles(path.resolve('output/pdf/assets/stpaul-2010.jpg'));await p.waitForTimeout(800);await click('#rc-run');
 await p.waitForFunction(()=>!document.querySelector('#rc-results').hidden&&!document.querySelector('#rc-run').disabled,{timeout:180000});
 await p.locator('#mv-same').check();await click('#mv-add');await p.waitForTimeout(2000);await mark('multiview-two');
 await p.locator('#rc-nd-name').scrollIntoViewIfNeeded();await p.locator('#rc-nd-name').pressSequentially('建築記憶 · 操作示範',{delay:90});
 await p.locator('#rc-nd-note').pressSequentially('記錄街區中的建築細節，保留影像與位置。',{delay:70});
 await p.locator('#rc-nd-manual > summary').click();
 await p.locator('#rc-nd-lat').fill('22.19745');await p.locator('#rc-nd-lng').fill('113.54084');await click('#rc-nd-apply');await mark('archive-form');
 await click('#rc-nd-save');await p.waitForTimeout(1600);await mark('archive-saved');
}
await p.mouse.wheel(0,490);await p.waitForTimeout(2200);await mark('details');
await p.locator('#rc-ledger').scrollIntoViewIfNeeded();await p.waitForTimeout(2200);await mark('ledger');
await p.mouse.wheel(0,-280);await p.waitForTimeout(1500);await mark('end');
}catch(e){console.error(e.message);await mark('error');fs.writeFileSync(path.join(dir,mode+'-error.txt'),e.message);process.exitCode=1;}
fs.writeFileSync(path.join(dir,mode+'-events.json'),JSON.stringify(events,null,2));
const v=p.video();await c.close();await v.saveAs(path.join(dir,mode+'-operation.webm'));await b.close();
