import { compareViews } from './multi-view.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function createMultiViewPanel({ host, getLibrary, getThresholds, onNext }) {
  if (!host) return { setCurrent() {}, setBusy() {} };
  let current = null, shots = [], processing = false, busy = false, generation = 0, notice = '';
  host.innerHTML = `<div class="rc-panel-head"><div><span class="rc-section-kicker">MULTI-VIEW CHECK</span><h2>多拍一個角度，再確認一次</h2></div><span id="mv-count" class="rc-status-pill">0 / 3</span></div>
    <p class="hint">建議同一棟建築拍三個不同角度。消融實驗中，三張照片平均比單張的 Top-1 準確率由 81.9% 提升到 92.5%（94 組，McNemar p = 0.006）。</p>
    <div id="mv-list"></div><p id="mv-message" role="status">辨識完成後，可加入目前選取的建築區域。</p>
    <label class="mv-consent"><input id="mv-same" type="checkbox"> 我確認這張照片與本組其他照片拍攝同一棟建築</label>
    <div class="rc-actions"><button class="btn gold" id="mv-add" disabled>加入目前照片</button><button class="btn sec" id="mv-next" disabled>選擇另一個角度</button><button class="btn sec" id="mv-reset">開始另一棟建築</button></div>
    <div id="mv-result"></div><details class="rc-method"><summary>比對方式</summary><p>使用各張照片的影像分數平均，並檢查逐張首位候選是否一致。不使用位置加分，不自動改寫普查檔案。此多照片規則尚待獨立實拍校準，相似度不是正確機率。</p></details>`;
  const find = id => host.querySelector(`#mv-${id}`);
  function render() {
    find('count').textContent = `${shots.length} / 3`;
    find('add').disabled = busy || processing || !current || !find('same').checked || shots.length >= 3;
    find('next').disabled = busy || processing || !shots.length || shots.length >= 3;
    find('reset').disabled = processing;
    find('list').innerHTML = shots.map((s, i) => `<div class="mv-shot"><img src="${esc(s.url)}" alt="第 ${i+1} 張實拍照片"><span>${i+1}. ${esc(s.name)}</span><button class="btn sec sm" data-remove="${i}" aria-label="移除第 ${i+1} 張照片">移除</button></div>`).join('');
    find('result').innerHTML = '';
    if (shots.length) {
      try {
        const result = compareViews(getLibrary(), shots, getThresholds());
        find('message').textContent = notice || result.reason;
        find('result').innerHTML = `<div class="mv-summary" data-state="${result.state}">${result.rows.map((r, i) => `<div><b>${i+1}. ${esc(r.zh)}</b><span>平均相似度 ${r.sim.toFixed(3)}</span><small>${r.perPhoto.map((s, j) => `照片 ${j+1}：${s.toFixed(3)}`).join(' · ')}</small>${r.spot ? `<a class="btn sec sm" href="./?spot=${encodeURIComponent(r.spot)}">核對地圖位置 ↗</a>` : ''}</div>`).join('')}</div>`;
      } catch (error) { find('message').textContent = error.message; }
    }
  }
  find('same').addEventListener('change', render);
  find('next').addEventListener('click', onNext);
  find('reset').addEventListener('click', () => {
    shots.forEach(s => URL.revokeObjectURL(s.url)); shots = []; generation++; notice='';
    find('same').checked = false; find('message').textContent = '已清空本組照片。請辨識下一棟建築。'; render();
  });
  find('list').addEventListener('click', event => {
    const button = event.target.closest('[data-remove]');
    if (!button || processing) return;
    const [removed] = shots.splice(Number(button.dataset.remove), 1);
    URL.revokeObjectURL(removed.url); find('same').checked = false; notice='';
    if (!shots.length) find('message').textContent = '本組已沒有照片。'; render();
  });
  find('add').addEventListener('click', async () => {
    if (busy || processing || !current || !find('same').checked || shots.length >= 3) return;
    const captured = current, token = generation;
    processing = true; notice=''; render();
    try {
      if (!globalThis.crypto?.subtle) throw new Error('照片校驗需要 HTTPS 或本機 localhost。');
      const digest = await crypto.subtle.digest('SHA-256', await captured.file.arrayBuffer());
      if (generation !== token || current !== captured) return;
      const sha256 = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
      if (shots.some(s => s.sha256 === sha256)) throw new Error('這張照片已加入，請選擇另一張實拍照片。');
      const shot = { vector: Array.from(captured.vector), sha256, name: captured.file.name };
      compareViews(getLibrary(), [...shots, shot], getThresholds());
      shots.push({ ...shot, url: URL.createObjectURL(captured.file) }); find('same').checked = false;
    } catch (error) { notice=error.message; find('message').textContent = notice; }
    finally { processing = false; render(); }
  });
  render();
  return {
    setCurrent(value) {
      if (current?.file === value?.file && current?.region === value?.region && current?.vector === value?.vector) return;
      generation++; current = value; notice=''; find('same').checked = false; render();
    },
    setBusy(value) { busy = value; render(); }
  };
}
