// 掃描版控中的檔案是否含疑似金鑰，避免再次把 API key 提交進公開倉庫。
//
// 背景：本倉庫曾經把 OpenTopography 的 API key 硬編在 scripts/fetch-opentopography.mjs 並提交，
//       違反該服務「不得公開金鑰」的使用條款。這支腳本用來防止同樣的事再發生。
//
// 用法：
//   node scripts/check-secrets.mjs          # 掃描所有版控檔案（git ls-files）
//   node scripts/check-secrets.mjs --all    # 連未追蹤的檔案也掃（排除 node_modules/.cache）
//
// 當作 pre-commit 鉤子：把下面一行存成 .git/hooks/pre-commit（並 chmod +x）
//   #!/bin/sh
//   exec node scripts/check-secrets.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 注意：import.meta.url 對中文路徑是 URL 編碼的，必須用 fileURLToPath 轉回真實路徑
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALL = process.argv.includes("--all");
const SKIP_DIR = /(^|[\\/])(node_modules|\.git|\.cache|dist|datasets|photos-src|public[\\/]dem)([\\/]|$)/;
const TEXT_EXT = /\.(mjs|js|cjs|ts|tsx|jsx|json|ya?ml|toml|py|rb|go|rs|java|php|html|css|md|txt|tex|sh|ps1|env|example|cfg|ini)$/i;

// 每條規則：名稱 + 正則 + 允許出現的例外（例如文件中的範例佔位字串）
const RULES = [
  { name: "OpenAI/DeepSeek 金鑰", re: /\bsk-[A-Za-z0-9_-]{20,}/g, allow: /sk-xxx|sk-\.\.\.|sk-YOUR|<.*>/i },
  { name: "OpenTopography API_Key", re: /API_Key["'\s:=]+([A-Za-z0-9]{24,})/g, allow: /\$\{|process\.env|YOUR|xxx|<.*>/i },
  { name: "OpenTopography 32 位十六進位金鑰", re: /\b[0-9a-f]{32}\b/g, allow: /^[0-9a-f]{32}$/ },
  { name: "Google API 金鑰", re: /\bAIza[0-9A-Za-z_-]{30,}/g, allow: null },
  { name: "GitHub Token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, allow: null },
  { name: "AWS Access Key", re: /\bAKIA[0-9A-Z]{16}\b/g, allow: null },
  { name: "Slack Token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, allow: null },
  { name: "私鑰檔案內容", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, allow: null },
];

function walkTree() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (SKIP_DIR.test(p)) continue;
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(ROOT);
  return out;
}

function listFiles() {
  if (ALL) return walkTree();
  // 優先用 git 取得「版控中的檔案」；Node 在部分環境找不到 git 可執行檔，此時回退為遍歷目錄
  for (const bin of ["git", "git.exe"]) {
    try {
      return execFileSync(bin, ["ls-files"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\n").filter(Boolean).map((f) => path.join(ROOT, f));
    } catch { /* 換下一個方式 */ }
  }
  console.warn("[secrets] ⚠ 找不到 git，改為遍歷目錄（結果等價，只是會多掃未追蹤檔案）");
  return walkTree();
}

const files = listFiles().filter((f) => TEXT_EXT.test(f) && fs.existsSync(f));
console.log(`[secrets] 掃描 ${files.length} 個檔案（${ALL ? "含未追蹤" : "僅版控檔案"}）`);

const hits = [];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  const lines = text.split("\n");
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(rule.re);
      if (!m) continue;
      if (rule.allow && m.every((x) => rule.allow.test(x))) continue;
      // 排除 32 位十六進位規則對「雜湊值」的誤判：比對整行是否只是雜湊或出現在 sha256 等欄位
      if (rule.name.includes("十六進位") && /sha256|hash|integrity|checksum|etag|md5/i.test(line)) continue;
      hits.push({ file: path.relative(ROOT, f), line: i + 1, rule: rule.name, sample: m[0] });
    }
  }
}

if (!hits.length) {
  console.log("[secrets] ✓ 未發現疑似金鑰");
  process.exit(0);
}
console.error(`\n[secrets] ✗ 發現 ${hits.length} 處疑似金鑰：`);
for (const h of hits.slice(0, 40)) {
  const masked = h.sample.length > 12 ? `${h.sample.slice(0, 6)}…${h.sample.slice(-4)}` : h.sample;
  console.error(`  ${h.file}:${h.line}  [${h.rule}]  ${masked}`);
}
console.error("\n請改用環境變數或 .env（已列入 .gitignore），並作廢已洩漏的金鑰。");
process.exit(1);
