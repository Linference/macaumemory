// Screenshot the three frontend-slides style previews at 1920x1080.
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DIR = 'D:/Users/LINKIT/Desktop/澳门记忆/.frontend-slides/slide-previews';
const names = ['style-a', 'style-b', 'style-c'];

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  puppeteer = (await import('puppeteer-core')).default;
}

// puppeteer-core ships no browser — locate an installed Chrome/Edge.
const CANDIDATES = [
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const exe = CANDIDATES.find(p => p && existsSync(p));
if (!exe) { console.error('no Chrome/Edge found'); process.exit(2); }
console.log('browser:', exe);

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--allow-file-access-from-files', '--font-render-hinting=none', '--force-color-profile=srgb'],
});

for (const n of names) {
  const file = path.join(DIR, n + '.html');
  if (!existsSync(file)) { console.log('MISSING', file); continue; }
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 4200)); // let load animations settle

  // overflow / clipping audit inside the fixed stage
  const audit = await page.evaluate(() => {
    const stage = document.querySelector('.deck-stage');
    const slide = document.querySelector('.slide');
    const sRect = slide.getBoundingClientRect();
    const out = [];
    slide.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.left < sRect.left - 1 || r.right > sRect.right + 1 ||
          r.top < sRect.top - 1 || r.bottom > sRect.bottom + 1) {
        out.push((el.className || el.tagName) + ' → ' +
          [r.left - sRect.left, r.top - sRect.top, r.right - sRect.right, r.bottom - sRect.bottom]
            .map(v => Math.round(v)).join(','));
      }
    });
    return {
      stageTransform: stage.style.transform,
      slideCount: document.querySelectorAll('.slide').length,
      overflowCount: out.length,
      overflowSample: out.slice(0, 8),
    };
  });

  const png = path.join(DIR, n + '.png');
  await page.screenshot({ path: png });
  console.log(n, JSON.stringify(audit));
  await page.close();
}

await browser.close();
console.log('done');
