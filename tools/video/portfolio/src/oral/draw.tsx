// 純程式繪製的場景零件（不用任何照片）：海、山、霧、船、船廠骨架、走廊、木樁、樹、爐火、
// 舢舨、帆船剪影、村屋、廟宇、人物剪影。全部 SVG／CSS，frame 的純函數、固定種子。
// 線條以 pathLength=1 + dashoffset 逐筆描出，金線＋柔光，與途見品牌同一套夜藍金色語言。
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { EASE, T, ramp, mix } from '../kit';

export const rnd = (i: number, k = 0) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };
const GOLD = T.gold, SOFT = T.goldSoft;
const glow = (c = 'rgba(216,180,90,0.7)', r = 6) => ({ filter: `drop-shadow(0 0 ${r}px ${c})` });

/** 逐筆描出的路徑 */
export const Draw: React.FC<{ d: string; at: number; dur?: number; stroke?: string; w?: number; fill?: string; fillAt?: number; opacity?: number; dash?: string; cap?: 'round' | 'butt' }> =
  ({ d, at, dur = 40, stroke = GOLD, w = 1.6, fill = 'none', fillAt, opacity = 1, dash, cap = 'round' }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, dur, EASE.smooth);
  const fo = fillAt == null ? 1 : ramp(f, fillAt, 24, EASE.out);
  if (p <= 0) return null;
  return <path d={d} pathLength={1} fill={fill} fillOpacity={fill === 'none' ? 0 : fo} stroke={stroke} strokeWidth={w} strokeLinecap={cap} strokeLinejoin="round"
    strokeDasharray={dash ?? 1} strokeDashoffset={dash ? 0 : 1 - p} opacity={opacity * (dash ? p : 1)} />;
};

/** 天空：上下兩色漸層＋一團光 */
export const Sky: React.FC<{ top: string; bottom: string; glow?: { x: number; y: number; c: string; r?: number } }> = ({ top, bottom, glow: g }) => (
  <AbsoluteFill style={{ background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)` }}>
    {g && <AbsoluteFill style={{ background: `radial-gradient(circle at ${g.x}% ${g.y}%, ${g.c} 0%, rgba(0,0,0,0) ${g.r ?? 45}%)` }} />}
  </AbsoluteFill>
);

/** 海：多條起伏的細線，近處振幅大、遠處細密；可加月光／晨光倒影 */
export const Sea: React.FC<{ y?: number; lines?: number; color?: string; speed?: number; reflect?: { x: number; c: string } }> = ({ y = 690, lines = 16, color = 'rgba(216,180,90,', speed = 1, reflect }) => {
  const f = useCurrentFrame();
  const rows = Array.from({ length: lines }, (_, i) => {
    const t = i / (lines - 1), yy = y + Math.pow(t, 1.7) * (1080 - y + 40), amp = 1.5 + t * 9, k = 0.012 - t * 0.006;
    const pts = Array.from({ length: 49 }, (_, j) => { const x = j * 40; return `${x},${(yy + Math.sin(x * k + f * 0.05 * speed + i * 1.7) * amp + Math.sin(x * k * 2.3 - f * 0.03 * speed + i) * amp * 0.4).toFixed(1)}`; });
    return <polyline key={i} points={pts.join(' ')} fill="none" stroke={`${color}${0.12 + t * 0.4})`} strokeWidth={0.8 + t * 1.2} />;
  });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ top: y, background: 'linear-gradient(180deg, rgba(6,12,18,0.4) 0%, rgba(4,8,12,0.85) 100%)' }} />
      {reflect && <AbsoluteFill style={{ top: y, background: `radial-gradient(ellipse 12% 60% at ${reflect.x}% 0%, ${reflect.c} 0%, rgba(0,0,0,0) 70%)`, opacity: 0.8 + 0.2 * Math.sin(f / 9) }} />}
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>{rows}</svg>
    </AbsoluteFill>
  );
};

/** 山的剪影：多個正弦疊加生成，金線描邊＋深色填充 */
export const Hills: React.FC<{ y?: number; h?: number; seed?: number; at?: number; fill?: string; stroke?: string; x0?: number; x1?: number }> = ({ y = 690, h = 160, seed = 1, at = 0, fill = '#0b141c', stroke = GOLD, x0 = 0, x1 = 1920 }) => {
  const pts: string[] = [];
  for (let x = x0; x <= x1; x += 24) {
    const t = (x - x0) / (x1 - x0), env = Math.sin(Math.PI * t);
    const v = env * (0.55 + 0.25 * Math.sin(x * 0.004 + seed) + 0.12 * Math.sin(x * 0.013 + seed * 3) + 0.06 * Math.sin(x * 0.041 + seed * 7));
    pts.push(`${x},${(y - v * h).toFixed(1)}`);
  }
  const d = `M${x0},${y} L${pts.join(' L')} L${x1},${y}`;
  return <Draw d={d} at={at} dur={60} stroke={stroke} w={1.4} fill={fill} fillAt={at + 20} opacity={0.95} />;
};

/** 霧：數條模糊的淺色帶緩慢橫移 */
export const Fog: React.FC<{ y?: number; opacity?: number; color?: string }> = ({ y = 620, opacity = 0.35, color = '210,225,230' }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {[0, 1, 2].map((i) => <div key={i} style={{ position: 'absolute', left: -400 + ((f * (0.4 + i * 0.25) + i * 500) % 2600) - 400, top: y + i * 50, width: 1400, height: 120,
        borderRadius: '50%', background: `rgba(${color},${opacity * (0.7 - i * 0.15)})`, filter: 'blur(40px)' }} />)}
    </AbsoluteFill>
  );
};

/** 人物剪影（看不清臉）：standing / sitting / crouch / small */
export const Figure: React.FC<{ x: number; y: number; s?: number; pose?: 'stand' | 'sit' | 'crouch'; color?: string; arm?: number; bandage?: boolean }> = ({ x, y, s = 1, pose = 'stand', color = '#05090d', arm = 0, bandage }) => {
  const body = pose === 'stand' ? 'M-14,0 C-16,-40 -14,-70 -10,-92 L10,-92 C14,-70 16,-40 14,0 Z' : pose === 'sit' ? 'M-16,0 C-18,-24 -16,-46 -11,-62 L11,-62 C16,-46 18,-24 16,0 Z' : 'M-18,0 C-20,-14 -12,-36 -6,-48 L12,-46 C18,-30 20,-14 18,0 Z';
  const headY = pose === 'stand' ? -106 : pose === 'sit' ? -76 : -60;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d={body} fill={color} stroke="rgba(216,180,90,0.55)" strokeWidth={1 / s} />
      <circle cy={headY} r={13} fill={color} stroke="rgba(216,180,90,0.55)" strokeWidth={1 / s} />
      {arm !== 0 && <path d={`M10,${headY + 28} L${30 + arm * 26},${headY + 30}`} stroke={color} strokeWidth={9} strokeLinecap="round" />}
      {bandage && <path d={`M10,${headY + 26} Q26,${headY + 40} 22,${headY + 56}`} stroke="#e8e6e0" strokeWidth={9} strokeLinecap="round" fill="none" style={glow('rgba(255,255,255,0.6)', 8)} />}
    </g>
  );
};

/** 小木船：船身＋父子兩個背影，隨浪輕擺 */
export const Boat: React.FC<{ x: number; y: number; s?: number }> = ({ x, y, s = 1 }) => {
  const f = useCurrentFrame();
  const rock = Math.sin(f / 14) * 1.6, bob = Math.sin(f / 11) * 4;
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <g transform={`translate(${x} ${y + bob}) rotate(${rock}) scale(${s})`} style={glow('rgba(216,180,90,0.5)', 5)}>
        <Figure x={-26} y={-6} s={0.9} pose="sit" />
        <Figure x={18} y={-6} s={0.62} pose="sit" />
        <path d="M-120,-6 Q-110,22 -70,28 L80,28 Q118,20 132,-10 Z" fill="#0a1218" stroke={GOLD} strokeWidth={1.6} />
        <path d="M-112,2 L124,2" stroke={SOFT} strokeWidth={0.8} opacity={0.6} />
        <path d="M60,-4 L150,34" stroke={GOLD} strokeWidth={2} />
      </g>
    </svg>
  );
};

/** 船廠：一艘木船的骨架（龍骨＋肋骨），一根根描出，地上有滑道 */
export const Ribs: React.FC<{ at: number; cx?: number; cy?: number }> = ({ at, cx = 900, cy = 690 }) => {
  const ribs = Array.from({ length: 13 }, (_, i) => {
    const t = i / 12, x = cx - 520 + t * 1040, h = 250 * Math.sin(Math.PI * (0.12 + t * 0.76)), w = 46 + 30 * Math.sin(Math.PI * t);
    return `M${x - w},${cy - h * 0.92} Q${x - w * 0.9},${cy + 6} ${x},${cy + 14} Q${x + w * 0.9},${cy + 6} ${x + w},${cy - h * 0.92}`;
  });
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <g style={glow()}>
        <Draw d={`M${cx - 600},${cy + 120} L${cx + 640},${cy + 120} M${cx - 560},${cy + 150} L${cx + 600},${cy + 150}`} at={at} dur={30} stroke="rgba(216,180,90,0.45)" w={1.2} />
        <Draw d={`M${cx - 560},${cy - 120} Q${cx},${cy + 40} ${cx + 560},${cy - 150}`} at={at + 8} dur={40} w={3} />
        {ribs.map((d, i) => <Draw key={i} d={d} at={at + 16 + i * 4} dur={26} w={2} stroke={i % 2 ? SOFT : GOLD} />)}
        <Draw d={`M${cx - 520},${cy - 200} L${cx + 520},${cy - 210}`} at={at + 70} dur={36} w={1} stroke="rgba(216,180,90,0.6)" dash="6 8" />
        {[0, 1, 2, 3, 4].map((i) => <Draw key={i} d={`M${cx - 480 + i * 240},${cy + 120} L${cx - 470 + i * 240},${cy - 40}`} at={at + 40 + i * 5} dur={20} w={1.6} stroke="rgba(216,180,90,0.55)" />)}
      </g>
    </svg>
  );
};

/** 醫院走廊：一點透視，地磚線、遠處窗、長椅 */
export const Corridor: React.FC<{ at: number }> = ({ at }) => {
  const vx = 960, vy = 470;
  const lines = [[0, 0], [1920, 0], [0, 1080], [1920, 1080], [480, 1080], [1440, 1080], [0, 760], [1920, 760]];
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      {lines.map(([x, y], i) => <Draw key={i} d={`M${x},${y} L${mix(x, vx, 0.86)},${mix(y, vy, 0.86)}`} at={at + i * 3} dur={30} stroke="rgba(230,230,225,0.35)" w={1} />)}
      {[0.2, 0.38, 0.52, 0.63, 0.72, 0.79].map((t, i) => { const yy = mix(1080, vy, t), xl = mix(0, vx, t), xr = mix(1920, vx, t);
        return <Draw key={i} d={`M${xl},${yy} L${xr},${yy}`} at={at + 20 + i * 4} dur={24} stroke="rgba(230,230,225,0.22)" w={1} />; })}
      <Draw d={`M${vx - 90},${vy - 120} L${vx + 90},${vy - 120} L${vx + 90},${vy + 40} L${vx - 90},${vy + 40} Z M${vx},${vy - 120} L${vx},${vy + 40} M${vx - 90},${vy - 40} L${vx + 90},${vy - 40}`} at={at + 30} dur={30} stroke="rgba(240,240,235,0.7)" w={1.2} fill="rgba(220,225,230,0.12)" fillAt={at + 50} />
      <Draw d="M560,800 L1000,800 M580,800 L580,860 M980,800 L980,860 M560,770 L1000,770" at={at + 40} dur={26} stroke="rgba(240,240,235,0.6)" w={2} />
      <Figure x={760} y={798} s={1.5} pose="sit" color="#0b0d10" bandage />
    </svg>
  );
};

/** 斷裂的手勢：一條白線一分為二並錯開 */
export const Rift: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, 14, EASE.snappy), sep = ramp(f, at + 10, 30, EASE.out);
  if (f < at) return null;
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <line x1={0} y1={540 - sep * 6} x2={1920 * p} y2={540 - sep * 6} stroke="#fff" strokeWidth={2} style={glow('rgba(255,255,255,0.9)', 12)} />
      <line x1={1920 - 1920 * p} y1={540 + sep * 6} x2={1920} y2={540 + sep * 6} stroke="#fff" strokeWidth={2} opacity={0.6} />
    </svg>
  );
};

/** 木樁與窗：每一拍手臂推出，木樁微震；窗外天色由白日轉黃昏 */
export const PostRoom: React.FC<{ at: number; every: number; dur: number }> = ({ at, every, dur }) => {
  const f = useCurrentFrame();
  const ph = ((f - at) % every) / every, push = f < at ? 0 : Math.max(0, Math.sin(Math.PI * Math.min(1, ph * 2.2)));
  const day = ramp(f, at, dur * 0.8, EASE.smooth);
  const sky = `linear-gradient(180deg, rgb(${mix(150, 255, day)},${mix(185, 150, day)},${mix(210, 90, day)}) 0%, rgb(${mix(90, 200, day)},${mix(120, 80, day)},${mix(150, 60, day)}) 100%)`;
  return (
    <>
      <div style={{ position: 'absolute', left: 1180, top: 210, width: 520, height: 400, background: sky, boxShadow: `0 0 120px rgba(255,160,80,${0.25 * day})` }} />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <g style={glow()}>
          <Draw d="M1180,210 L1700,210 L1700,610 L1180,610 Z M1440,210 L1440,610 M1180,410 L1700,410" at={at} dur={30} w={2} />
          <Draw d="M1160,612 L1720,612" at={at + 20} dur={30} stroke={SOFT} w={3} />
          <Draw d="M0,860 L1920,860" at={at} dur={30} stroke="rgba(216,180,90,0.4)" w={1.2} />
        </g>
        <g transform={`translate(${760 + push * 3} 0)`}>
          <rect x={-34} y={330} width={68} height={530} fill="#2a1d12" stroke={GOLD} strokeWidth={1.6} />
          {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${-24 + (i % 3) * 18},${360 + i * 52} q10,22 0,44`} stroke="rgba(216,180,90,0.35)" fill="none" strokeWidth={1} />)}
          <rect x={-34} y={520} width={68} height={60} fill="rgba(255,220,160,0.18)" />
        </g>
        <Figure x={560} y={860} s={2.1} pose="stand" arm={0.4 + push * 0.6} />
      </svg>
    </>
  );
};

/** 遞迴生成的大樹：枝幹一層層長出，葉子成團亮起 */
type Seg = { x1: number; y1: number; x2: number; y2: number; d: number; w: number };
const TREE: Seg[] = (() => {
  const out: Seg[] = [];
  const grow = (x: number, y: number, len: number, ang: number, d: number, seed: number) => {
    if (d > 6 || len < 14) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    out.push({ x1: x, y1: y, x2, y2, d, w: Math.max(1, 14 - d * 2.2) });
    const n = d < 2 ? 3 : 2;
    for (let i = 0; i < n; i++) grow(x2, y2, len * (0.68 + rnd(seed + i, d) * 0.12), ang + (i - (n - 1) / 2) * (0.55 + rnd(seed, i) * 0.25), d + 1, seed * 3 + i + 1);
  };
  grow(560, 900, 190, -Math.PI / 2, 0, 1);
  return out;
})();
export const Tree: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const leaves = TREE.filter((s) => s.d >= 5);
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <g style={glow('rgba(216,180,90,0.4)', 4)}>
        {TREE.map((s, i) => <Draw key={i} d={`M${s.x1},${s.y1} L${s.x2},${s.y2}`} at={at + s.d * 7} dur={18} w={s.w} stroke={s.d < 2 ? '#6b4a26' : GOLD} />)}
      </g>
      {leaves.map((s, i) => { const p = ramp(f, at + 46 + (i % 20), 20, EASE.out), sw = Math.sin(f / 20 + i) * 3;
        return <circle key={i} cx={s.x2 + sw} cy={s.y2} r={(18 + rnd(i, 3) * 26) * p} fill={`rgba(${230 + rnd(i, 4) * 25},${170 + rnd(i, 5) * 50},${90 + rnd(i, 6) * 40},${0.1 + rnd(i, 6) * 0.12})`} style={{ filter: 'blur(2px)' }} />; })}
    </svg>
  );
};

/** 柴火爐、鐵壺與上升的熱氣，旁邊手工木桌椅 */
export const Stove: React.FC<{ at: number; x?: number; y?: number }> = ({ at, x = 1240, y = 860 }) => {
  const f = useCurrentFrame();
  const fl = 0.75 + 0.25 * Math.sin(f / 3) * Math.sin(f / 5.3);
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <g style={glow()}>
        <Draw d={`M${x - 70},${y} L${x - 60},${y - 90} L${x + 60},${y - 90} L${x + 70},${y} Z`} at={at} dur={26} w={2} fill="#1a120c" fillAt={at + 10} />
        <Draw d={`M${x - 50},${y - 90} Q${x - 50},${y - 150} ${x},${y - 152} Q${x + 50},${y - 150} ${x + 50},${y - 90} M${x + 48},${y - 128} L${x + 96},${y - 150}`} at={at + 14} dur={26} w={2.2} fill="#141c22" fillAt={at + 24} />
        <Draw d={`M${x + 160},${y} L${x + 160},${y - 80} L${x + 330},${y - 80} L${x + 330},${y} M${x + 150},${y - 80} L${x + 340},${y - 80} M${x + 380},${y} L${x + 380},${y - 50} L${x + 440},${y - 50} L${x + 440},${y}`} at={at + 24} dur={30} w={1.6} stroke={SOFT} />
      </g>
      <ellipse cx={x} cy={y - 30} rx={46} ry={26} fill={`rgba(255,140,50,${0.75 * fl})`} style={glow('rgba(255,130,40,0.95)', 26)} />
      {Array.from({ length: 5 }, (_, i) => { const t = ((f - at + i * 14) % 70) / 70; if (f < at + 20) return null;
        const yy = y - 160 - t * 260, xx = x + 96 + Math.sin(t * 6 + i) * 30 + t * 20;
        return <path key={i} d={`M${xx},${yy + 40} q20,-20 0,-40 q-20,-20 0,-40`} stroke={`rgba(240,240,235,${0.45 * Math.sin(Math.PI * t)})`} strokeWidth={3} fill="none" style={{ filter: 'blur(1.5px)' }} />; })}
    </svg>
  );
};

/** 船廠棚架：一排桁架，old=只有骨架線、new=填色亮起（今昔對照用） */
export const Sheds: React.FC<{ at: number; mode: 'old' | 'new' }> = ({ at, mode }) => {
  const f = useCurrentFrame();
  const units = Array.from({ length: 7 }, (_, i) => { const k = 0.55 + i * 0.09, x = 120 + i * 250 * (0.9 + i * 0.03), w = 220 * k, base = 760 + i * 12; return { x, w, base, h: 230 * k }; });
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <g style={glow(mode === 'new' ? 'rgba(255,210,140,0.7)' : 'rgba(216,180,90,0.5)', mode === 'new' ? 9 : 5)}>
        {units.map((u, i) => {
          const d = `M${u.x},${u.base} L${u.x},${u.base - u.h} L${u.x + u.w / 2},${u.base - u.h - u.h * 0.35} L${u.x + u.w},${u.base - u.h} L${u.x + u.w},${u.base} M${u.x},${u.base - u.h} L${u.x + u.w},${u.base - u.h} M${u.x + u.w / 2},${u.base - u.h - u.h * 0.35} L${u.x + u.w / 2},${u.base - u.h}`;
          return <Draw key={i} d={d} at={at + i * 6} dur={34} w={mode === 'new' ? 2 : 1.4} stroke={mode === 'new' ? '#ffe2a8' : 'rgba(216,180,90,0.75)'}
            fill={mode === 'new' ? `rgba(255,200,120,${0.06 + 0.03 * Math.sin(f / 12 + i)})` : 'none'} fillAt={at + 20} />;
        })}
        <Draw d="M60,780 L1880,780" at={at} dur={40} w={1.2} stroke="rgba(216,180,90,0.5)" />
      </g>
    </svg>
  );
};

/** 舢舨：一個站著撐篙的人，船上有雞籠與菜筐，沿海面緩緩前行 */
export const Sampan: React.FC<{ x: number; y: number; s?: number }> = ({ x, y, s = 1 }) => {
  const f = useCurrentFrame();
  const bob = Math.sin(f / 12) * 4, pole = Math.sin(f / 18) * 5;
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <g transform={`translate(${x} ${y + bob}) scale(${s})`} style={glow('rgba(216,180,90,0.5)', 5)}>
        <path d={`M30,-110 L${120 + pole},70`} stroke={GOLD} strokeWidth={2.4} />
        <Figure x={20} y={-6} s={0.95} pose="stand" arm={0.3} />
        <rect x={-90} y={-30} width={44} height={26} rx={4} fill="none" stroke={SOFT} strokeWidth={1.4} />
        <path d="M-86,-30 L-86,-4 M-76,-30 L-76,-4 M-66,-30 L-66,-4 M-56,-30 L-56,-4" stroke={SOFT} strokeWidth={0.8} />
        <ellipse cx={-120} cy={-14} rx={20} ry={12} fill="none" stroke={SOFT} strokeWidth={1.4} />
        <path d="M-150,-6 Q-140,18 -100,22 L90,22 Q130,16 146,-10 Z" fill="#0a1218" stroke={GOLD} strokeWidth={1.6} />
      </g>
    </svg>
  );
};

/** 帆船剪影（中式硬帆，帆骨橫條），停在海平線上 */
export const Junks: React.FC<{ at: number; y?: number }> = ({ at, y = 690 }) => {
  const f = useCurrentFrame();
  const list = [{ x: 820, s: 0.7 }, { x: 1120, s: 1 }, { x: 1450, s: 0.8 }, { x: 1720, s: 0.55 }];
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      {list.map((b, i) => { const p = ramp(f, at + i * 8, 30, EASE.out), bob = Math.sin(f / 16 + i) * 3;
        return (
          <g key={i} transform={`translate(${b.x + Math.sin(f / 60 + i) * 8} ${y + bob}) scale(${b.s})`} opacity={p} style={glow('rgba(216,180,90,0.35)', 4)}>
            <path d="M-110,0 Q-100,22 -60,26 L70,26 Q104,20 116,-6 Z" fill="#05090d" stroke="rgba(216,180,90,0.6)" strokeWidth={1.2} />
            <path d="M-20,-6 L-20,-210 M-20,-200 Q30,-190 60,-170 L50,-30 L-20,-30 Z" fill="rgba(5,9,13,0.9)" stroke="rgba(216,180,90,0.6)" strokeWidth={1.2} />
            {[0, 1, 2, 3, 4].map((k) => <path key={k} d={`M-20,${-180 + k * 32} L${56 - k * 1.5},${-168 + k * 30}`} stroke="rgba(216,180,90,0.45)" strokeWidth={1} />)}
            <path d="M-70,-6 L-70,-110 M-70,-104 Q-50,-96 -36,-84 L-40,-28 L-70,-28 Z" fill="rgba(5,9,13,0.9)" stroke="rgba(216,180,90,0.5)" strokeWidth={1} />
          </g>
        ); })}
    </svg>
  );
};

/** 村屋：一排客家硬山頂小屋（人字屋頂），可整體褪色 */
export const Houses: React.FC<{ at: number; y?: number; fade?: number; lit?: boolean }> = ({ at, y = 820, fade = 0, lit = true }) => {
  const f = useCurrentFrame();
  const hs = [{ x: 180, w: 220, h: 150 }, { x: 440, w: 260, h: 180 }, { x: 740, w: 200, h: 140 }, { x: 980, w: 280, h: 190 }, { x: 1300, w: 230, h: 160 }, { x: 1570, w: 200, h: 130 }];
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, opacity: 1 - fade * 0.7 }}>
      <g style={glow('rgba(216,180,90,0.45)', 5)}>
        {hs.map((h, i) => {
          const d = `M${h.x},${y} L${h.x},${y - h.h} L${h.x + h.w / 2},${y - h.h - 70} L${h.x + h.w},${y - h.h} L${h.x + h.w},${y} Z M${h.x - 14},${y - h.h + 8} L${h.x + h.w / 2},${y - h.h - 76} L${h.x + h.w + 14},${y - h.h + 8} M${h.x + h.w * 0.42},${y} L${h.x + h.w * 0.42},${y - 70} L${h.x + h.w * 0.58},${y - 70} L${h.x + h.w * 0.58},${y}`;
          const win = lit && (0.5 + 0.5 * Math.sin(f / 13 + i)) * (1 - fade);
          return (
            <g key={i}>
              <Draw d={d} at={at + i * 6} dur={36} w={1.6} fill="#0c1319" fillAt={at + 16 + i * 6} />
              <rect x={h.x + h.w * 0.16} y={y - h.h * 0.62} width={h.w * 0.16} height={h.h * 0.22} fill={`rgba(255,200,120,${0.12 + 0.4 * (win || 0)})`} opacity={ramp(f, at + 40 + i * 6, 20, EASE.out)} />
            </g>
          );
        })}
        <Draw d={`M60,${y} L1860,${y}`} at={at} dur={40} w={1.2} stroke="rgba(216,180,90,0.5)" />
      </g>
    </svg>
  );
};

/** 走遠的人：背影提著行李，沿小路由近而遠變小 */
export const Walker: React.FC<{ at: number; dur: number }> = ({ at, dur }) => {
  const f = useCurrentFrame();
  const t = ramp(f, at, dur, EASE.smooth), x = mix(820, 1500, t), y = mix(980, 790, t), s = mix(1.6, 0.45, t), step = Math.sin(f / 4) * 2 * (1 - t);
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <Draw d="M700,1080 Q1100,900 1560,780" at={0} dur={40} w={1} stroke="rgba(216,180,90,0.35)" dash="8 10" />
      <g transform={`translate(${x} ${y + step})`}>
        <Figure x={0} y={0} s={s} pose="stand" />
        <rect x={16 * s} y={-46 * s} width={24 * s} height={30 * s} rx={3 * s} fill="#05090d" stroke="rgba(216,180,90,0.55)" strokeWidth={1} />
      </g>
    </svg>
  );
};

/** 三聖廟：硬山頂、正脊兩端翹起、廟門與兩根門柱，逐筆描出後亮燈 */
export const Temple: React.FC<{ at: number; cx?: number; base?: number }> = ({ at, cx = 960, base = 640 }) => {
  const f = useCurrentFrame();
  const w = 560, h = 260;
  const d = [
    `M${cx - w / 2},${base} L${cx - w / 2},${base - h} L${cx + w / 2},${base - h} L${cx + w / 2},${base}`,
    `M${cx - w / 2 - 60},${base - h + 10} Q${cx - w / 2 - 20},${base - h - 40} ${cx - w / 2 + 40},${base - h - 70} L${cx + w / 2 - 40},${base - h - 70} Q${cx + w / 2 + 20},${base - h - 40} ${cx + w / 2 + 60},${base - h + 10}`,
    `M${cx - w / 2 + 20},${base - h - 70} L${cx - w / 2 + 10},${base - h - 110} M${cx + w / 2 - 20},${base - h - 70} L${cx + w / 2 - 10},${base - h - 110} M${cx - w / 2 + 10},${base - h - 110} Q${cx},${base - h - 96} ${cx + w / 2 - 10},${base - h - 110}`,
    `M${cx - 80},${base} L${cx - 80},${base - 170} L${cx + 80},${base - 170} L${cx + 80},${base}`,
    `M${cx - 150},${base} L${cx - 150},${base - h} M${cx + 150},${base} L${cx + 150},${base - h}`,
    `M${cx - 110},${base - h + 30} L${cx + 110},${base - h + 30} L${cx + 110},${base - h + 80} L${cx - 110},${base - h + 80} Z`,
  ];
  const lit = ramp(f, at + 60, 30, EASE.out);
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <g style={glow('rgba(216,180,90,0.6)', 7)}>
        {d.map((p, i) => <Draw key={i} d={p} at={at + i * 7} dur={36} w={i === 1 ? 2.6 : 1.8} fill={i === 0 ? '#0c1319' : 'none'} fillAt={at + 20} />)}
      </g>
      <rect x={cx - 78} y={base - 168} width={156} height={168} fill={`rgba(255,170,80,${0.35 * lit})`} style={glow('rgba(255,150,60,0.8)', 30)} />
      <text x={cx} y={base - h + 66} textAnchor="middle" fontFamily='"Noto Serif TC", "Songti TC", serif' fontSize={34} fill={`rgba(255,226,168,${lit})`} letterSpacing={18}>三聖廟</text>
    </svg>
  );
};

/** 書桌與油燈：桌面、攤開的書、燈罩，燈光呼吸 */
export const Desk: React.FC<{ at: number }> = ({ at }) => (
  <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
    <g style={glow()}>
      <Draw d="M380,760 L1540,760 M440,760 L440,980 M1480,760 L1480,980" at={at} dur={30} w={2} />
      <Draw d="M760,752 Q860,720 960,748 Q1060,720 1160,752 L1160,742 Q1060,710 960,738 Q860,710 760,742 Z" at={at + 14} dur={30} w={1.6} fill="rgba(236,230,218,0.12)" fillAt={at + 26} />
      <Draw d="M1290,752 L1290,690 M1250,690 L1330,690 L1310,610 L1270,610 Z" at={at + 24} dur={28} w={1.8} />
    </g>
    <Figure x={620} y={760} s={1.6} pose="sit" />
    <Figure x={1500} y={760} s={1.3} pose="sit" />
  </svg>
);
