// 口述記憶短片的動態圖形零件。全部是 frame 的純函數、固定種子，確定性渲染。
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';
import { EASE, FONT, T, img, mix, ramp, clamp } from '../kit';
import MAP from './map.json';

export const rnd = (i: number, k = 0) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };
export const PH = (f: string) => `oral/photos/${f}`;

/** 照片底景：雙層視差慢推＋泛光＋分級（mood 決定色調） */
export type Mood = 'sepia' | 'cool' | 'mono' | 'warm' | 'dusk' | 'cold' | 'fest' | 'neutral';
const GRADE: Record<Mood, { filter: string; tint: string }> = {
  sepia: { filter: 'sepia(0.55) saturate(0.8) contrast(1.08) brightness(0.92)', tint: 'rgba(60,40,20,0.18)' },
  cool: { filter: 'saturate(0.72) contrast(1.06) brightness(0.86) hue-rotate(-6deg)', tint: 'rgba(20,40,60,0.28)' },
  mono: { filter: 'grayscale(1) contrast(1.18) brightness(0.86)', tint: 'rgba(10,12,16,0.3)' },
  warm: { filter: 'saturate(1.12) contrast(1.05) brightness(0.95) sepia(0.12)', tint: 'rgba(120,70,20,0.16)' },
  dusk: { filter: 'saturate(0.95) contrast(1.06) brightness(0.84) sepia(0.2)', tint: 'rgba(90,50,40,0.2)' },
  cold: { filter: 'grayscale(0.55) contrast(1.05) brightness(0.82) hue-rotate(-12deg)', tint: 'rgba(25,35,55,0.34)' },
  fest: { filter: 'saturate(1.2) contrast(1.06) brightness(0.94)', tint: 'rgba(120,30,20,0.12)' },
  neutral: { filter: 'saturate(0.95) contrast(1.04) brightness(0.9)', tint: 'rgba(10,14,19,0.2)' },
};
export const Photo: React.FC<{ src: string; dur: number; mood?: Mood; from?: [number, number, number]; to?: [number, number, number]; dim?: number; bloom?: number }> =
  ({ src, dur, mood = 'neutral', from = [0, 0, 1.1], to = [-30, -12, 1.2], dim = 0.28, bloom = 0.3 }) => {
  const f = useCurrentFrame();
  const t = ramp(f, 0, dur, EASE.smooth);
  const x = mix(from[0], to[0], t), y = mix(from[1], to[1], t), s = mix(from[2], to[2], t);
  const g = GRADE[mood];
  const layer = (tx: number, ty: number, sc: number, extra: React.CSSProperties = {}) => (
    <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${sc})`, ...extra }}>
      <Img src={img(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: g.filter }} />
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: T.bg }}>
      {layer(x, y, s)}
      {layer(x * 1.7, y * 1.7, s * 1.025 + (s - from[2]) * 0.5, { WebkitMaskImage: 'linear-gradient(0deg, #000 0%, #000 20%, transparent 46%)', maskImage: 'linear-gradient(0deg, #000 0%, #000 20%, transparent 46%)' })}
      {layer(x, y, s, { filter: 'blur(30px) brightness(1.45)', mixBlendMode: 'screen', opacity: bloom })}
      <AbsoluteFill style={{ background: g.tint, mixBlendMode: 'multiply' }} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(10,14,19,${dim + 0.25}) 0%, rgba(10,14,19,${dim}) 30%, rgba(10,14,19,${dim}) 62%, rgba(10,14,19,${dim + 0.45}) 100%)` }} />
    </AbsoluteFill>
  );
};

/** 兩張照片交叉溶接（在同一鏡頭內換景） */
export const Dissolve: React.FC<{ a: React.ReactNode; b: React.ReactNode; at: number; d?: number }> = ({ a, b, at, d = 24 }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, d, EASE.smooth);
  return <AbsoluteFill><AbsoluteFill style={{ opacity: 1 - p }}>{a}</AbsoluteFill><AbsoluteFill style={{ opacity: p }}>{b}</AbsoluteFill></AbsoluteFill>;
};

/** 旁白字幕：依標點分句，按字數比例在旁白時長內逐句出現；當前句高亮、前一句退淡 */
export const Narration: React.FC<{ text: string; at: number; frames: number; y?: number }> = ({ text, at, frames, y = 900 }) => {
  const f = useCurrentFrame();
  const parts = text.split(/(?<=[，。：、？！])/).filter((s) => s.trim());
  const total = parts.reduce((n, p) => n + p.length, 0);
  let acc = 0;
  const starts = parts.map((p) => { const s = at + (acc / total) * frames; acc += p.length; return s; });
  const idx = starts.reduce((k, s, i) => (f >= s ? i : k), -1);
  if (idx < 0) return null;
  const end = at + frames + 18;
  const o = 1 - ramp(f, end, 14, EASE.exit);
  const lineStart = Math.max(0, idx - 1);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: y, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: o }}>
      {parts.slice(lineStart, idx + 1).map((p, k) => {
        const i = lineStart + k, cur = i === idx;
        const pin = ramp(f, starts[i], 16, EASE.out);
        return (
          <div key={i} style={{ fontFamily: FONT.serif, fontSize: cur ? 40 : 30, fontWeight: 500, letterSpacing: '0.08em', color: cur ? T.ink : 'rgba(236,230,218,0.42)',
            textShadow: '0 2px 24px rgba(0,0,0,0.85)', transform: `translateY(${(1 - pin) * 14}px)`, filter: `blur(${(1 - pin) * 6}px)`, opacity: cur ? pin : 0.9 }}>
            {[...p].map((ch, j) => <span key={j} style={{ color: '，。：、'.includes(ch) ? T.gold : undefined }}>{ch}</span>)}
          </div>
        );
      })}
    </div>
  );
};

/** 巨型年份：描邊襯線數字逐位翻滾到定格，下方金線伸展 */
export const YearMark: React.FC<{ year: string; at: number; x?: number; y?: number; size?: number; out?: number; sub?: string }> = ({ year, at, x = 120, y = 120, size = 230, out, sub }) => {
  const f = useCurrentFrame();
  const o = out == null ? 1 : 1 - ramp(f, out, 16, EASE.exit);
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity: o }}>
      <div style={{ display: 'flex', fontFamily: FONT.serif, fontSize: size, fontWeight: 300, lineHeight: 1, height: size * 1.02, overflow: 'hidden' }}>
        {[...year].map((d, i) => {
          const p = ramp(f, at + i * 5, 34, EASE.snappy);
          const n = /\d/.test(d) ? Number(d) : null;
          const roll = n == null ? 0 : (1 - p) * (6 + i * 2);
          return (
            <span key={i} style={{ display: 'inline-block', color: 'transparent', WebkitTextStroke: `1.4px ${T.gold}`, transform: `translateY(${-roll * 18}%)`, filter: `blur(${(1 - p) * 4}px)`, opacity: Math.min(1, p * 2) }}>
              {n == null ? d : String((n + Math.round(roll)) % 10)}
            </span>
          );
        })}
      </div>
      <div style={{ width: 340 * ramp(f, at + 12, 30, EASE.out), height: 1.5, marginTop: 10, background: `linear-gradient(90deg, ${T.gold}, rgba(216,180,90,0))` }} />
      {sub && <div style={{ marginTop: 14, fontFamily: FONT.mono, fontSize: 18, letterSpacing: '0.34em', color: T.goldSoft, opacity: ramp(f, at + 20, 20, EASE.out) }}>{sub}</div>}
    </div>
  );
};

/** 澳門真實行政區輪廓（自家邊界資料）：金線逐條描出；可加地點脈衝與航線 */
type Pt = 'laichivun' | 'kaho' | 'coloane' | 'taipa' | 'peninsula';
export const MacauMap: React.FC<{ at: number; pins?: { p: Pt; label: string; at: number }[]; route?: { from: Pt; to: Pt; at: number; d?: number; dashed?: boolean; boat?: boolean };
  scale?: number; focus?: Pt; x?: number; y?: number; opacity?: number; draw?: number }> =
  ({ at, pins = [], route, scale = 1, focus, x = 0, y = 0, opacity = 1, draw = 50 }) => {
  const f = useCurrentFrame();
  const pts = MAP.pts as Record<Pt, [number, number]>;
  const c = focus ? pts[focus] : [960, 540];
  const tf = `translate(${x}px, ${y}px) translate(960px, 540px) scale(${scale}) translate(${-c[0]}px, ${-c[1]}px)`;
  const r = route ? ramp(f, route.at, route.d ?? 50, EASE.smooth) : 0;
  const A = route ? pts[route.from] : [0, 0], B = route ? pts[route.to] : [0, 0];
  const ctrl = route ? [(A[0] + B[0]) / 2 + (B[1] - A[1]) * 0.25, (A[1] + B[1]) / 2 - (B[0] - A[0]) * 0.25] : [0, 0];
  const bez = (t: number) => [(1 - t) ** 2 * A[0] + 2 * (1 - t) * t * ctrl[0] + t * t * B[0], (1 - t) ** 2 * A[1] + 2 * (1 - t) * t * ctrl[1] + t * t * B[1]];
  const head = bez(r);
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: 'none' }}>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <g style={{ transform: tf, transformOrigin: '0 0' }}>
          {(MAP.paths as string[]).map((d, i) => {
            const p = ramp(f, at + i * 4, draw, EASE.smooth);
            return <path key={i} d={d} pathLength={1} fill={`rgba(216,180,90,${0.05 * p})`} stroke={T.gold} strokeOpacity={0.75} strokeWidth={1.4 / scale}
              strokeDasharray={1} strokeDashoffset={1 - p} vectorEffect="non-scaling-stroke" />;
          })}
          {route && r > 0 && (() => {
            const N = 60, pts2 = Array.from({ length: N + 1 }, (_, i) => bez((i / N) * r));
            const d = 'M' + pts2.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L');
            return (
              <>
                <path d={d} fill="none" stroke={T.goldSoft} strokeWidth={2.2} vectorEffect="non-scaling-stroke" strokeDasharray={route.dashed ? '10 9' : undefined} strokeLinecap="round" />
                <circle cx={head[0]} cy={head[1]} r={6 / scale} fill="#ffe2a8" style={{ filter: 'drop-shadow(0 0 8px rgba(255,210,140,0.9))' }} />
              </>
            );
          })()}
          {pins.map((pn, i) => {
            const p = ramp(f, pn.at, 24, EASE.snappy); if (p <= 0) return null;
            const [px, py] = pts[pn.p]; const pulse = ((f - pn.at) % 40) / 40;
            return (
              <g key={i}>
                <circle cx={px} cy={py} r={(10 + pulse * 40) / scale} fill="none" stroke={T.gold} strokeWidth={1.2 / scale} opacity={(1 - pulse) * p} />
                <circle cx={px} cy={py} r={5 / scale * p} fill={T.gold} />
                <text x={px + 16 / scale} y={py - 12 / scale} fontFamily={FONT.serif} fontSize={26 / scale} fill={T.ink} opacity={p} letterSpacing={2 / scale}>{pn.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

/** 經緯度 HUD 讀數 */
export const Coords: React.FC<{ text: string; at: number; x?: number; y?: number }> = ({ text, at, x = 120, y = 1000 }) => {
  const f = useCurrentFrame();
  const n = Math.floor(Math.max(0, f - at) * 1.6);
  return <div style={{ position: 'absolute', left: x, top: y, fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.24em', color: 'rgba(236,230,218,0.55)' }}>{text.slice(0, n)}</div>;
};

/** 五毫：三枚硬幣依次落下並發出漣漪，旁邊是日薪讀數 */
export const Coins: React.FC<{ at: number; x?: number; y?: number }> = ({ at, x = 1380, y = 300 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: x, top: y }}>
      {[0, 1, 2].map((i) => {
        const p = ramp(f, at + i * 9, 22, EASE.snappy); const rip = ramp(f, at + i * 9 + 16, 34, EASE.out);
        return (
          <div key={i} style={{ position: 'absolute', left: i * 64, top: 0 }}>
            <div style={{ position: 'absolute', left: 30 - 60 * rip, top: 30 - 60 * rip, width: 120 * rip, height: 120 * rip, borderRadius: '50%', border: `1px solid rgba(216,180,90,${0.6 * (1 - rip)})` }} />
            <div style={{ width: 60, height: 60, borderRadius: '50%', transform: `translateY(${(1 - p) * -160}px) rotateX(${(1 - p) * 70}deg)`, opacity: p,
              background: 'radial-gradient(circle at 35% 30%, #f3dc9a 0%, #c9a24c 45%, #7d6127 100%)', boxShadow: '0 8px 30px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,240,200,0.35)',
              display: 'grid', placeItems: 'center', fontFamily: FONT.serif, fontSize: 20, color: '#4a3612' }}>毫</div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 0, top: 96, whiteSpace: 'nowrap', opacity: ramp(f, at + 34, 20, EASE.out) }}>
        <span style={{ fontFamily: FONT.serif, fontSize: 64, color: T.ink }}>五毫</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: '0.3em', color: T.goldSoft, marginLeft: 16 }}>/ 日 · 學徒</span>
      </div>
    </div>
  );
};

/** 斷裂：一道白光橫向劃過，畫面上下錯位，環境暗下 */
export const Slice: React.FC<{ at: number; y?: number }> = ({ at, y = 520 }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, 10, EASE.snappy), fade = 1 - ramp(f, at + 10, 30, EASE.out);
  if (f < at) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, top: y - 1, width: 1920 * p, height: 2, background: '#fff', boxShadow: '0 0 30px 6px rgba(255,255,255,0.8)', opacity: fade }} />
      <AbsoluteFill style={{ background: '#fff', opacity: 0.35 * (1 - ramp(f, at, 8, EASE.out)) }} />
    </AbsoluteFill>
  );
};

/** 木樁節奏：每拍一次同心圓擴散，計數刻痕逐日增加 */
export const Pulse: React.FC<{ at: number; every?: number; x?: number; y?: number; count?: number }> = ({ at, every = 22, x = 960, y = 470, count = 10 }) => {
  const f = useCurrentFrame();
  const beats = Math.max(0, Math.floor((f - at) / every) + 1);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: Math.min(beats, 6) }, (_, k) => {
        const b = beats - 1 - k; const t = (f - at - b * every) / 60; if (t < 0 || t > 1) return null;
        return <div key={b} style={{ position: 'absolute', left: x - 400 * t, top: y - 400 * t, width: 800 * t, height: 800 * t, borderRadius: '50%', border: `1.5px solid rgba(216,180,90,${0.55 * (1 - t)})` }} />;
      })}
      <div style={{ position: 'absolute', right: 140, top: 150, display: 'flex', gap: 12 }}>
        {Array.from({ length: count }, (_, i) => <div key={i} style={{ width: 3, height: 54, background: T.gold, opacity: i < beats ? 0.9 : 0.12, transform: `scaleY(${i < beats ? 1 : 0.4})`, transformOrigin: 'bottom' }} />)}
      </div>
      <div style={{ position: 'absolute', right: 140, top: 220, fontFamily: FONT.mono, fontSize: 16, letterSpacing: '0.32em', color: T.goldSoft }}>日 復 一 日</div>
    </AbsoluteFill>
  );
};

/** 柴火：暖色火星與熱氣上升 */
export const Embers: React.FC<{ n?: number; x?: number; y?: number; spread?: number; seed?: number }> = ({ n = 60, x = 960, y = 760, spread = 520, seed = 4 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen' }}>
      {Array.from({ length: n }, (_, i) => {
        const life = 90 + rnd(i, seed) * 80; const t = ((f + rnd(i, seed + 1) * life) % life) / life;
        const px = x + (rnd(i, seed + 2) - 0.5) * spread + Math.sin(f / 18 + i) * 22 * t; const py = y - t * (360 + rnd(i, seed + 3) * 260);
        const sz = 2 + rnd(i, seed + 4) * 4;
        return <div key={i} style={{ position: 'absolute', left: px, top: py, width: sz, height: sz, borderRadius: '50%', background: i % 3 ? '#ffb45c' : '#ffe2a8',
          opacity: Math.sin(Math.PI * t) * 0.85, boxShadow: `0 0 ${sz * 4}px rgba(255,150,60,0.9)` }} />;
      })}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 40% 32% at ${x / 19.2}% ${y / 10.8}%, rgba(255,150,60,${0.22 + 0.06 * Math.sin(f / 5)}) 0%, rgba(0,0,0,0) 70%)` }} />
    </AbsoluteFill>
  );
};

/** 今昔對照：一道金線從左掃到右，左邊是舊，右邊是今 */
export const SplitWipe: React.FC<{ before: React.ReactNode; after: React.ReactNode; at: number; d?: number; labels?: [string, string] }> = ({ before, after, at, d = 60, labels = ['昔', '今'] }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, d, EASE.smooth); const xw = 1920 * p;
  return (
    <AbsoluteFill>
      {before}
      <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${1920 - xw}px)` }}>{after}</AbsoluteFill>
      {p > 0 && p < 1 && <div style={{ position: 'absolute', left: 1920 - xw - 1, top: 0, width: 2, height: 1080, background: T.gold, boxShadow: '0 0 24px rgba(216,180,90,0.9)' }} />}
      <div style={{ position: 'absolute', left: 120, top: 120, fontFamily: FONT.serif, fontSize: 40, color: T.goldSoft, opacity: 1 - p }}>{labels[0]}</div>
      <div style={{ position: 'absolute', right: 120, top: 120, fontFamily: FONT.serif, fontSize: 40, color: T.goldSoft, opacity: p }}>{labels[1]}</div>
    </AbsoluteFill>
  );
};

/** 守望：雷達般的金色扇形掃過海面 */
export const Sweep: React.FC<{ at: number; x?: number; y?: number }> = ({ at, x = 960, y = 980 }) => {
  const f = useCurrentFrame();
  const a = -150 + ((f - at) * 1.2) % 120;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: ramp(f, at, 20, EASE.out), mixBlendMode: 'screen' }}>
      <div style={{ position: 'absolute', left: x - 1100, top: y - 1100, width: 2200, height: 2200, borderRadius: '50%',
        background: `conic-gradient(from ${a}deg at 50% 50%, rgba(255,214,150,0.28) 0deg, rgba(255,214,150,0) 22deg, rgba(0,0,0,0) 360deg)` }} />
      {[0.25, 0.5, 0.75].map((k) => <div key={k} style={{ position: 'absolute', left: x - 1100 * k, top: y - 1100 * k, width: 2200 * k, height: 2200 * k, borderRadius: '50%', border: '1px solid rgba(216,180,90,0.14)' }} />)}
    </AbsoluteFill>
  );
};

/** 油燈：中心暖光呼吸，四周壓暗 */
export const Lamp: React.FC<{ x?: number; y?: number }> = ({ x = 960, y = 560 }) => {
  const f = useCurrentFrame();
  const fl = 0.85 + 0.15 * Math.sin(f / 3.1) * Math.sin(f / 7.3);
  return <AbsoluteFill style={{ pointerEvents: 'none', background: `radial-gradient(circle at ${x / 19.2}% ${y / 10.8}%, rgba(255,200,120,${0.3 * fl}) 0%, rgba(255,170,80,${0.1 * fl}) 18%, rgba(4,6,8,0.78) 52%, rgba(2,3,4,0.92) 100%)` }} />;
};

/** 手寫：大字以描邊逐筆出現，再填色 */
export const Handwrite: React.FC<{ text: string; at: number; x?: number; y?: number; size?: number }> = ({ text, at, x = 960, y = 470, size = 110 }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, 70, EASE.smooth), fill = ramp(f, at + 50, 30, EASE.out);
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <text x={x} y={y} textAnchor="middle" fontFamily={FONT.serif} fontSize={size} letterSpacing={size * 0.12} fill={`rgba(236,230,218,${0.92 * fill})`} stroke={T.gold} strokeWidth={1.2}
        strokeDasharray={1400} strokeDashoffset={1400 * (1 - p)} style={{ filter: 'drop-shadow(0 4px 24px rgba(0,0,0,0.7))' }}>{text}</text>
    </svg>
  );
};

/** 兄弟相稱：人名節點與連線，像一張會長出來的族譜 */
export const Kin: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const nodes = [{ t: '我', x: 960, y: 330 }, { t: '哥哥', x: 700, y: 470 }, { t: '兄弟', x: 1220, y: 470 }, { t: '你的孫子', x: 860, y: 640 }, { t: '爺爺', x: 1100, y: 640 }];
  const links = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [1, 2]];
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      {links.map(([a, b], i) => {
        const p = ramp(f, at + 10 + i * 7, 26, EASE.smooth); const A = nodes[a], B = nodes[b];
        return <line key={i} x1={A.x} y1={A.y} x2={mix(A.x, B.x, p)} y2={mix(A.y, B.y, p)} stroke={T.gold} strokeWidth={1.2} opacity={0.7} />;
      })}
      {nodes.map((n, i) => {
        const p = ramp(f, at + i * 8, 22, EASE.snappy);
        return (
          <g key={i} opacity={p} transform={`translate(${n.x} ${n.y}) scale(${0.6 + 0.4 * p})`}>
            <circle r={44} fill="rgba(10,14,19,0.72)" stroke={T.gold} strokeWidth={1.2} />
            <text textAnchor="middle" dy={9} fontFamily={FONT.serif} fontSize={n.t.length > 2 ? 20 : 26} fill={T.ink}>{n.t}</text>
          </g>
        );
      })}
    </svg>
  );
};

/** 三四十席：圓桌由中心向外依次亮起，計數升到四十 */
export const Banquet: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  const cols = 10, rows = 4, list: { x: number; y: number; d: number }[] = [];
  // 透視排列：後排小而密、前排大而疏，像庭前鋪開的一片宴席
  const list2: { x: number; y: number; d: number; k: number }[] = [];
  for (let r = 0; r < rows; r++) { const k = 0.55 + r * 0.17, gap = 150 * k; for (let c = 0; c < cols; c++) { const x = 960 + (c - (cols - 1) / 2) * gap + (r % 2) * gap * 0.5, y = 640 + r * (70 + r * 16); list2.push({ x, y, d: Math.hypot(x - 960, y - 900), k }); } }
  list.push(...list2);
  list.sort((a, b) => a.d - b.d);
  const lit = list.filter((_, i) => f >= at + i * 2.2).length;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(10,14,19,0) 45%, rgba(10,14,19,0.75) 75%, rgba(10,14,19,0.9) 100%)', opacity: ramp(f, at - 10, 30, EASE.out) }} />
      {list.map((t, i) => {
        const p = ramp(f, at + i * 2.2, 18, EASE.snappy); const glow = 0.5 + 0.5 * Math.sin(f / 9 + i);
        const k = (t as { k?: number }).k ?? 1;
        return <div key={i} style={{ position: 'absolute', left: t.x - 34, top: t.y - 34, width: 68, height: 68, borderRadius: '50%', transform: `scale(${p * k}, ${p * k * 0.55})`,
          background: `radial-gradient(circle, rgba(255,200,120,${0.55 + 0.2 * glow}) 0%, rgba(200,60,30,0.35) 55%, rgba(0,0,0,0) 72%)`, border: '1px solid rgba(255,214,150,0.5)' }} />;
      })}
      <div style={{ position: 'absolute', right: 140, top: 140, textAlign: 'right' }}>
        <div style={{ fontFamily: FONT.serif, fontSize: 120, color: T.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{lit}<span style={{ fontSize: 40, color: T.gold, marginLeft: 8 }}>席</span></div>
        <div style={{ fontFamily: FONT.mono, fontSize: 16, letterSpacing: '0.3em', color: T.goldSoft, marginTop: 8 }}>三四十席 · 一起吃盆菜</div>
      </div>
    </AbsoluteFill>
  );
};

/** 燈籠：上方垂下的暖光燈籠，輕微擺動 */
export const Lanterns: React.FC<{ at: number; n?: number }> = ({ at, n = 9 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const p = ramp(f, at + i * 4, 26, EASE.out); const x = 140 + i * (1640 / (n - 1)); const sw = Math.sin(f / 22 + i) * 4;
        return (
          <div key={i} style={{ position: 'absolute', left: x - 22, top: -10, transformOrigin: '50% 0', transform: `rotate(${sw}deg) translateY(${(1 - p) * -120}px)`, opacity: p }}>
            <div style={{ width: 1, height: 60 + (i % 3) * 30, background: 'rgba(216,180,90,0.5)', margin: '0 auto' }} />
            <div style={{ width: 44, height: 58, borderRadius: '45%', background: 'radial-gradient(circle at 50% 45%, #ffcf7a 0%, #e0442a 55%, #8c1a10 100%)', boxShadow: '0 0 40px rgba(255,120,60,0.8)' }} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** 字距收攏的章節大字（含英文副題與序號） */
export const Title: React.FC<{ zh: string; en: string; no?: string; at: number; out: number }> = ({ zh, en, no, at, out }) => {
  const f = useCurrentFrame();
  const o = 1 - ramp(f, out, 18, EASE.exit);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: o, filter: `blur(${(1 - o) * 10}px)` }}>
      {no && <div style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: '0.5em', color: T.gold, opacity: ramp(f, at, 20, EASE.out), marginBottom: 30 }}>{no}</div>}
      <div style={{ display: 'flex', gap: 4 }}>
        {[...zh].map((ch, i) => {
          const p = ramp(f, at + 6 + i * 4, 36, EASE.snappy);
          return <span key={i} style={{ fontFamily: FONT.serif, fontSize: 120, fontWeight: 500, color: T.ink, letterSpacing: `${0.4 - 0.32 * p}em`, opacity: p,
            transform: `translateY(${(1 - p) * 40}px)`, filter: `blur(${(1 - p) * 14}px)`, textShadow: '0 0 60px rgba(216,180,90,0.25)' }}>{ch}</span>;
        })}
      </div>
      <div style={{ width: 520 * ramp(f, at + 20, 40, EASE.smooth), height: 1.5, margin: '34px 0 22px', background: `linear-gradient(90deg, rgba(216,180,90,0), ${T.gold}, rgba(216,180,90,0))` }} />
      <div style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: '0.42em', color: T.goldSoft, opacity: ramp(f, at + 30, 24, EASE.out) }}>{en}</div>
    </AbsoluteFill>
  );
};

/** 出處章：每段記憶的來源標記 */
export const SourceTag: React.FC<{ text: string; at: number; x?: number; y?: number }> = ({ text, at, x = 120, y = 60 }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, 20, EASE.out);
  return <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 12, opacity: p * 0.9, fontFamily: FONT.mono, fontSize: 14, letterSpacing: '0.26em', color: 'rgba(236,230,218,0.6)' }}>
    <span style={{ width: 28 * p, height: 1, background: T.gold }} />{text}</div>;
};

export { clamp };
