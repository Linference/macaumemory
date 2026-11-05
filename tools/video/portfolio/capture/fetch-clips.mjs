// 取回即夢畫布上已生成的圖生視頻片段，寫入 public/gen/clip-<key>.mp4，並更新 src/data/clips.json（底圖 → 片段）
// 用法：node capture/fetch-clips.mjs   （只下載狀態為 success 的節點；未生成的節點略過，片中照用靜態底景）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = readFileSync(join(root, 'capture/canvas-project.txt'), 'utf8').trim();
const PLATE = { why: 'gen/plate-why.png', city: 'gen/plate-city.png', meaning: 'gen/plate-meaning.png', culture: 'gen/plate-culture.png', splat: 'gen/plate-splat.png', lotus: 'gen/plate-lotus.png' };
const cli = (...args) => JSON.parse(execFileSync('dreamina-canvas', [...args, '--project-id', PROJECT, '--format', 'json', '--non-interactive'], { encoding: 'utf8' }));
const ffprobe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());

const manifestPath = join(root, 'src/data/clips.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
for (const line of readFileSync(join(root, 'capture/upload/vnodes.txt'), 'utf8').split(/\r?\n/).filter(Boolean)) {
  const [key, nodeId] = line.split(' ');
  const node = cli('node', 'show', '--node-id', nodeId).data.nodes[0].node;
  const res = (node.resources ?? []).find((r) => r.type === 'video' && r.status === 'success');
  if (!res) { console.log(`${key}: ${node.status ?? 'no video yet'} — skip`); continue; }
  const out = join(root, `public/gen/clip-${key}.mp4`);
  if (!existsSync(out)) execFileSync('dreamina-canvas', ['resource', 'download', res.resourceId, '-o', out, '--project-id', PROJECT, '--non-interactive'], { stdio: 'inherit' });
  manifest[PLATE[key]] = { src: `gen/clip-${key}.mp4`, frames: Math.floor(ffprobe(out) * 30) };
  console.log(`${key}: ${res.resourceId} → clip-${key}.mp4 (${manifest[PLATE[key]].frames}f)`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
