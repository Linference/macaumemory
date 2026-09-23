/**
 * 示範頁冒煙測試（沙箱內沒有瀏覽器，用最小 DOM 樁在 Node 裡真的把腳本跑一遍）。
 *
 * 檢查：
 *   1. 內嵌 JSON 可解析、筆數正確
 *   2. 頁面引用的照片檔真的存在（相對路徑正確）
 *   3. 整段 UI 腳本能執行完不拋錯
 *   4. 走完 5 幕腳本後，手機面板出現預期的關鍵字（併入／新建／相似度／記憶點編號）
 *
 * 用法：node tools/demo/smoke_test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML_PATH = path.join(ROOT, 'tools', 'demo', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

// ---------- 1. 內嵌資料 ----------
console.log('[1] 內嵌資料');
const m = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html);
ok(!!m, '找到 JSON 資料區塊');
const data = JSON.parse(m[1]);
ok(data.all_places.length === 4, `記憶點 4 筆`, `實際 ${data.all_places.length}`);
ok(data.boundary.length > 0, `邊界環 ${data.boundary.length} 個`);
ok(data.script.length === 5, `腳本 ${data.script.length} 幕`);

// ---------- 2. 照片路徑 ----------
console.log('[2] 照片相對路徑');
const refs = new Set();
for (const p of data.all_places) for (const ph of p.photos) refs.add(ph.file.replace('photos/', ''));
for (const r of refs) {
  const f = path.join(ROOT, 'public', 'photos', r);
  ok(fs.existsSync(f), r, fs.existsSync(f) ? `${(fs.statSync(f).size / 1024).toFixed(0)} KB` : '缺少檔案');
}

// ---------- 3. 執行 UI 腳本 ----------
console.log('[3] 執行 UI 腳本（最小 DOM 樁）');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
ok(scripts.length === 1, '找到 1 段 UI 腳本');
let code = scripts[0];

const elements = new Map();
function el(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id, innerHTML: '', textContent: '', dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, setAttribute() {}, insertAdjacentHTML(_, h) { this.innerHTML += h; },
      appendChild() {}, querySelector: () => null, style: {},
    });
  }
  return elements.get(id);
}
el('data').textContent = m[1];   // 模擬瀏覽器讀取 <script type="application/json"> 的內容
const documentStub = {
  getElementById: (id) => el(id),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  body: { classList: { toggle() {}, add() {}, remove() {} } },
  documentElement: { requestFullscreen() {} },
  fullscreenElement: null,
};
const sandbox = {
  document: documentStub,
  window: { addEventListener() {} },
  console,
  setTimeout: (fn) => { try { fn(); } catch (e) { throw e; } return 0; },  // 立即執行，跳過動畫等待
  clearInterval() {}, setInterval: () => 0, requestAnimationFrame: (fn) => { fn(); return 0; },
  JSON, Object, Array, Math, Set, Map, Number, String, Boolean, Error,
};
code += '\n;globalThis.__api = { reset, nextStep, runStep, state, DATA, PLACES, drawMap };';
try {
  const fn = new Function('document', 'window', 'console', 'setTimeout', 'clearInterval', 'setInterval',
    'requestAnimationFrame', 'JSON', 'Object', 'Array', 'Math', 'Set', 'Map', 'Number', 'String', 'Boolean', 'Error',
    code + '\nreturn globalThis.__api;');
  const api = fn(sandbox.document, sandbox.window, console, sandbox.setTimeout, sandbox.clearInterval,
    sandbox.setInterval, sandbox.requestAnimationFrame, JSON, Object, Array, Math, Set, Map, Number, String, Boolean, Error);
  ok(!!api && !!api.runStep, '腳本載入並初始化完成');

  // ---------- 4. 走完 5 幕 ----------
  console.log('[4] 逐步執行示範腳本');
  api.reset();
  // DOM 樁不會解析 HTML，所以把 addRow() 寫進去的 #rows 內容手動併回手機面板
  const phoneText = () => {
    let h = el('phone').innerHTML;
    const rows = el('rows').innerHTML;
    h = h.replace(/<div id="rows">\s*<\/div>/, rows).replace(/(<div id="rows">)/, `$1${rows}`);
    return h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  };
  let seen = '';
  for (let i = 0; i < data.script.length; i++) {
    api.runStep(i);
    const t = phoneText();
    seen += ' ' + t;
    console.log(`  第 ${i + 1} 幕「${data.script[i].title}」→ 手機面板 ${t.length} 字`);
  }
  const finalText = seen;
  ok(finalText.includes('MM-0001'), '出現記憶點編號 MM-0001');
  ok(finalText.includes('科學館') || finalText.includes('MM-0004'), '第二張照片處理到科學館');
  ok(/相似度|餘弦|0\.9/.test(finalText), '出現相似度判定文字');
  ok(finalText.includes('併入') && finalText.includes('建立新記憶點'), '同時演示「併入」與「新建」兩種情況');
  const allHtml = [...elements.values()].map((e) => e.innerHTML).join(' ');
  ok(allHtml.includes('90 m') || allHtml.includes('90 公尺') || allHtml.includes('地理先驗'), '出現地理先驗說明');
  ok(el('steps').innerHTML.includes('建檔') || el('steps').innerHTML.includes('歸戶'), '流程清單有渲染');
  ok(el('map').innerHTML.length > 500, '地圖 SVG 有內容', `${el('map').innerHTML.length} 字元`);
} catch (e) {
  ok(false, '腳本執行時拋錯', e.message);
  console.error(e);
}

console.log(failures === 0 ? '\n[smoke] 全部通過 ✅' : `\n[smoke] ${failures} 項失敗 ❌`);
process.exit(failures === 0 ? 0 : 1);
