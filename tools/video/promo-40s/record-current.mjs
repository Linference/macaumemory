import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'file:///C:/Users/LINKIT/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const out=path.resolve('output/video/tujian-promo-60s/captures');
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu-sandbox','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:2560,height:1440},recordVideo:{dir:out,size:{width:2560,height:1440}}});
const page=await context.newPage();
const events=[];const started=Date.now();
async function mark(name){events.push({name,time:(Date.now()-started)/1000});await page.screenshot({path:path.join(out,name+'.png')});console.log(name);}
try{
 await page.goto('http://127.0.0.1:4202/recognize.html',{waitUntil:'networkidle',timeout:90000});
 await page.waitForTimeout(1800);await mark('recognition-hero');
 await page.locator('#workspace').scrollIntoViewIfNeeded();
 await page.locator('#rc-file').setInputFiles(path.resolve('output/pdf/assets/stpaul-2010.jpg'));
 await page.waitForTimeout(1400);await mark('photo-uploaded');
 await page.waitForFunction(()=>!document.querySelector('#rc-run').disabled,{timeout:180000});
 await page.locator('#rc-run').click();await mark('recognition-running');
 await page.waitForFunction(()=>!document.querySelector('#rc-results').hidden||!document.querySelector('#rc-errors').hidden,{timeout:180000});
 if(!await page.locator('#rc-errors').isHidden())throw Error(await page.locator('#rc-errors').innerText());
 await page.waitForTimeout(3500);await mark('recognition-result');
 fs.writeFileSync(path.join(out,'actual-result.txt'),await page.locator('#rc-results').innerText());
 if(await page.locator('#mv-same').count()){await page.locator('#mv-same').check();await page.locator('#mv-add').click();await page.waitForTimeout(2500);await mark('multiview');}
 await page.locator('#rc-ledger').scrollIntoViewIfNeeded();await page.waitForTimeout(2500);await mark('building-archive');
}catch(e){console.error(e.message);await mark('capture-error');fs.writeFileSync(path.join(out,'error.txt'),e.message);process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'events.json'),JSON.stringify(events,null,2));const video=page.video();await context.close();await video.saveAs(path.join(out,'recognition-2k.webm'));await browser.close();}
