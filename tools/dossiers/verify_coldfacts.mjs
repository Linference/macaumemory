// 逐條核對《澳門本地冷知識與特殊記憶資料集》59 則：抓取每則對應的原始網頁，
// 請查核模型把每一個具體說法和原文對照，給出「原文證據」與判定。
// 判定只會基於原文；原文沒有的一律標為未找到，不靠模型自己的知識補。
// 用法：node tools/dossiers/verify_coldfacts.mjs
// 說明：本檔由 AI 程式助手（Claude）協助撰寫；結果須由作者抽查。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.loadEnvFile(".env.local");
const CACHE = "tmp/sources/cold"; fs.mkdirSync(CACHE, { recursive: true });
const MM = (id, kind = "specialtopic") => `https://www.macaumemory.mo/${kind}_${id}`;
const WH = (n, lang = "cn") => `https://www.wh.mo/${lang}/site/detail/${n}`;
const S = {
  wh6: [WH(6), WH(6, "en")], wh5: [WH(5), WH(5, "en")], wh22: [WH(22), WH(22, "en")], wh8: [WH(8), WH(8, "en")], wh4: [WH(4), WH(4, "en")],
  wh2: [WH(2), WH(2, "en")], wh7: [WH(7), WH(7, "en")], wh25: [WH(25), WH(25, "en")], wh18: [WH(18), WH(18, "en")], wh16: [WH(16), WH(16, "en")],
  augustine: [MM("cbd0802d31094e789bfd989497c0b62a")], monte: [MM("22d08955200f4168915303d6c4b0d2a0")], monteImg: [MM("ee7484c7219841b4a489d266db68dea7", "entries")],
  stpaulImg: [MM("878786e7c50240fba71e730f41121dbe", "entries")], newRoad: [MM("f09eb338392547018e0dbcf1ca6cce06")], kiuChai: [MM("efe3fecadbb14a84bf431f45ee361c83", "entries")],
  fulongMag: ["https://www.macauzine.net/zh-hant/detail/M26JIBtEL7"], redMarket: [MM("71278b4c3223400781271ada4e892e1e")],
  senado: [MM("6be7c5cc6e5448a5908a4f1645360712"), MM("a7367524f4e04051b33014bed187bf1d")], senadoView: [MM("a7367524f4e04051b33014bed187bf1d")],
  redWindow: [MM("7bc2e3bdaee44b5eb62ac13d1a51f65a", "entries")], walls: [MM("c3df2429a9f54cb58f27159a924c52d8")], wallsDown: [MM("b995de913b834e3387a813badaf91d5d", "entries")],
  streetSign: [MM("b273d375730b43f48f66d9891a7135ce")], renamed: [MM("a73ab7accf63419184a870949530be21")], water: [MM("005b673ceecf47d2a80fef9e21b3c7ac")],
  waterJobs: [MM("c2b8714c4e4a4e2b97d7f8b06c28f73f")], springs: [MM("ac352d00df6e4075b67a66ab026c7d7f")], firePaper: [MM("97c36cdf2f3b4cd1a2bbceb246717a61", "entries")],
  fireInd: [MM("6dc77e20cb9943649fbeaff72e96a9c4", "entries")], coloanePier: [MM("e6499dd6149f492daa36c730f327b850", "entries")], pingMan: [MM("7abf544aeff049e7b756d0e850b56af1")],
  vegRoad: [MM("4799443b4d6149d2836d4fcf6502b01f", "entries")], ich: ["https://www.culturalheritage.mo/detail/102248"], chiLam: [MM("47c052fd4b6845319b6f4c6f4ed754a1", "entries")],
  um: ["https://e-bulletin.um.edu.mo/notice/28726/"], laichiPdf: ["https://edocs.icm.gov.mo/Survey/laichivun/bookC.pdf"], fisher: [MM("ad2f13d305f94859a260edcf22166d79")],
  villages: [MM("232151d8189b4761833ee519014afa07", "entries")], dsedt: ["https://www.dsedt.gov.mo/lcp/zh_MO/scenic_detail.jsp?id=209"],
  fulongArea: [MM("85abb971f6a642b3b1bc7721af923b4c", "entries")], fulongHist: [MM("db8df2d1277f47e0907200260abfd51a")], fulongWind: [MM("0ee3d68622df47b6aecc066ad6625c62")],
};
// 第 n 則 → 原始網頁
const MAP = { 1: "wh6", 2: "wh5", 3: "augustine", 4: "wh22", 5: "wh8", 6: "wh4", 7: "wh2", 8: "wh6", 9: "monte", 10: "monteImg", 11: "stpaulImg", 12: "wh7",
  13: "newRoad", 14: "kiuChai", 15: "fulongMag", 16: "fulongMag", 17: "fulongMag", 18: "fulongMag", 19: "redMarket", 20: "senado", 21: "senadoView", 22: "redWindow",
  23: "walls", 24: "wallsDown", 25: "walls", 26: "streetSign", 27: "renamed", 28: "water", 29: "waterJobs", 30: "waterJobs", 31: "waterJobs", 32: "springs", 33: "springs",
  34: "firePaper", 35: "fireInd", 36: "firePaper", 37: "coloanePier", 38: "pingMan", 39: "vegRoad", 40: "wh25", 41: "wh25", 42: "wh25", 43: "wh18", 44: "ich", 45: "wh16",
  46: "chiLam", 47: "um", 48: "laichiPdf", 49: "fisher", 50: "laichiPdf", 51: "fisher", 52: "villages", 53: "villages", 54: "dsedt", 55: "fulongArea", 56: "fulongHist",
  57: "fulongWind", 58: "redWindow", 59: "renamed" };

// ---- 解析資料集 ----
const lines = fs.readFileSync("tmp/coldfacts.txt", "utf8").split(/\r?\n/);
const items = [];
for (const l of lines) {
  const m = l.match(/^(\d{2})\s+(.*)$/);
  if (m) { items.push({ n: Number(m[1]), title: m[2].trim(), body: "", quote: "", cited: "" }); continue; }
  const it = items.at(-1); if (!it) continue;
  if (l.startsWith("原文短摘")) it.quote = l.replace(/^原文短摘\s*/, "");
  else if (l.startsWith("出处")) it.cited = l.replace(/^出处\s*/, "");
  else if (!it.body) it.body = l.trim();
}
if (items.length !== 59) throw new Error("解析到 " + items.length + " 則");

// ---- 抓原文 ----
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d)).replace(/&[a-z]+;/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
async function text(url) {
  const f = path.join(CACHE, url.replace(/[^a-z0-9]+/gi, "_").slice(-90) + ".txt");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  let t;
  if (url.endsWith(".pdf")) {
    const pdf = f.replace(/\.txt$/, ".pdf"); fs.writeFileSync(pdf, Buffer.from(await r.arrayBuffer()));
    t = execFileSync("python", ["-I", "-c", "import sys\nfrom pypdf import PdfReader\nsys.stdout.buffer.write('\\n'.join((p.extract_text() or '') for p in PdfReader(sys.argv[1]).pages).encode('utf-8'))", pdf], { maxBuffer: 1 << 26, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }).toString();
  } else t = strip(await r.text());
  fs.writeFileSync(f, t); return t;
}
// 長文只取與本則有關的段落（以本則中的關鍵詞定位），避免超出模型上下文
function relevant(src, it) {
  if (src.length < 16000) return src;
  const keys = [...new Set((it.title + it.body + it.quote).match(/[一-鿿]{2,4}|\d{3,4}/g) ?? [])];
  const paras = src.split(/\n|。/).filter((p) => p.trim());
  const scored = paras.map((p, i) => ({ i, s: keys.filter((k) => p.includes(k)).length })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.i).sort((a, b) => a - b);
  return scored.map((i) => paras[i]).join("。\n").slice(0, 16000);
}

async function judge(it, srcText, urls) {
  const sys = "你是嚴謹的史料查核員。只根據「原文」判斷「資料條目」中每一個具體說法（年份、數字、名稱、地點、因果、程度詞如唯一／最）。原文是繁體或英文、條目是簡體，請自行對應。不得使用你自己的知識。只輸出 JSON：{\"claims\":[{\"claim\":\"條目中的一個具體說法\",\"status\":\"supported|contradicted|not_found\",\"evidence\":\"原文中支持或矛盾的句子，40字內，照抄原文；not_found 時留空\"}],\"verdict\":\"verified|partly|contradicted|unverifiable\",\"note\":\"一句話說明主要問題\",\"corrected\":\"只用原文內容改寫後的條目（繁體中文，120字內）；完全找不到原文支持時留空\"}";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, signal: AbortSignal.timeout(150000),
        body: JSON.stringify({ model: "deepseek-v4-pro", temperature: 0, max_tokens: 2500, thinking: { type: "disabled" }, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys },
          { role: "user", content: `資料條目 #${it.n}：${it.title}\n${it.body}\n條目引用的原文短摘：${it.quote || "（無）"}\n條目聲稱的出處：${it.cited}\n\n原文（${urls.join(" ; ")}）：\n${srcText}` }] }) });
      if (!r.ok) throw new Error(String(r.status));
      const t = (await r.json()).choices[0].message.content; return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    } catch (e) { if (i === 2) return { verdict: "error", note: String(e), claims: [] }; await new Promise((s) => setTimeout(s, 4000)); }
  }
}

const OUT = "tmp/sources/coldfacts-verify.json";
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
let next = 0;
await Promise.all(Array.from({ length: 5 }, async () => {
  while (next < items.length) {
    const it = items[next++];
    if (prev[it.n]?.verdict && !["error", "source_error"].includes(prev[it.n].verdict)) continue;
    const urls = S[MAP[it.n]];
    let src = "";
    try { src = (await Promise.all(urls.map(text))).map((t, i) => `【${urls[i]}】\n${t}`).join("\n\n"); } catch (e) { prev[it.n] = { ...it, urls, verdict: "source_error", note: String(e) }; continue; }
    const j = await judge(it, relevant(src, it), urls);
    prev[it.n] = { ...it, urls, ...j };
    console.log(`#${it.n} ${j.verdict} ${j.note ?? ""}`);
    fs.writeFileSync(OUT, JSON.stringify(prev, null, 1));
  }
}));
const tally = {}; for (const v of Object.values(prev)) tally[v.verdict] = (tally[v.verdict] ?? 0) + 1;
console.log("\n統計", JSON.stringify(tally));
