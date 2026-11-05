// 口述記憶短片旁白：騰訊雲粵語語音合成（101019），每句一個 mp3，並記錄時長供 Remotion 排時間軸。
// 內容全部取自澳門口述歷史協會〈荔枝碗，熱奶茶〉〈溫馨九澳情〉訪談；受訪者不具名。
// 用法（專案根目錄）：node tools/video/portfolio/capture/oral-vo.mjs
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { callTencent } from "../../../../server/tencent.js";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
process.loadEnvFile(path.join(ROOT, ".env.local"));
const OUT = path.join(import.meta.dirname, "../public/oral/vo");
fs.mkdirSync(OUT, { recursive: true });

export const LINES = [
  ["open1", "有些記憶，不在教科書裏。"],
  ["open2", "它們只活在一個人的身上。"],
  ["a1", "一九七二年，他和父親坐船出海，在一個不起眼的小碼頭上了岸。這個小島，叫路環。"],
  ["a2", "他在荔枝碗的船廠當學徒。一天工資大約五毫，連一支鉛筆都買不起，常常要餓到中午，等廠裏開飯。"],
  ["a3", "那時候，沒有工傷保險。一九八六年，電鋸切斷了他的手肘。醫生勸他截肢。他不肯。"],
  ["a4", "他在家裏立了一根木樁，每天練。後來，那隻手奇蹟般地好了。他說：奇蹟，源於堅信，見於努力。"],
  ["a5", "他又造了一年船，然後在大樹下，開了一間咖啡檔。桌椅自己做，帳篷自己搭，爐子燒的是柴。"],
  ["a6", "他說，柴火煮出來的水，帶著一股木柴的味道。船廠的聲音沒有了，這股味道，還留在荔枝碗。"],
  ["bridge", "沿著海岸往東走，是另一條村。"],
  ["b1", "九澳，是一條客家村。祖輩靠打魚、種田過活。沒有車，也沒有橋，去澳門，要自己撐艇。"],
  ["b2", "一九一零年前後，沿海常有海盜。村民和派來的士兵，一起守著村子。"],
  ["b3", "五十年代，村裏有了九澳學校。大家白天幹活，晚上讀書。"],
  ["b4", "村裏的人，都以兄弟相稱。你的孫子，也會叫我做爺爺。"],
  ["b5", "後來，村民一個個搬到氹仔、搬到澳門。他自己，一九九三年也搬走了。"],
  ["b6", "可是每年三聖廟賀誕，住在香港、住在外國的村民，都會回來。擺三四十席，一起吃盆菜。"],
  ["coda1", "每一段記憶，都來自一個真實的人。"],
  ["coda2", "途見把它們逐句核實、標明出處，讓城市的記憶，可以一直長下去。"],
];

const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim());
const meta = {};
for (const [id, text] of LINES) {
  const file = path.join(OUT, `${id}.mp3`);
  if (!fs.existsSync(file)) {
    const o = await callTencent("tts", "TextToVoice", "2019-08-23", { Text: text, SessionId: randomUUID(), ModelType: 1, VoiceType: 101019, Codec: "mp3", SampleRate: 16000, Speed: -1 });
    fs.writeFileSync(file, Buffer.from(o.Audio, "base64"));
  }
  meta[id] = { text, src: `oral/vo/${id}.mp3`, seconds: +dur(file).toFixed(2) };
  console.log(id, meta[id].seconds, "s");
}
fs.writeFileSync(path.join(import.meta.dirname, "../src/oral/vo.json"), JSON.stringify(meta, null, 1));
console.log("total voice", Object.values(meta).reduce((s, m) => s + m.seconds, 0).toFixed(1), "s");
