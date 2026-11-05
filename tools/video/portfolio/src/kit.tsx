// 全片共用：途見 tokens、HUD 細字、章節卡、字幕條。所有動效只用 Polish 的 EASE / ramp（同一套動效嗓音）
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { EASE, FONT, Grain, Vignette, bezier, ramp, mix } from './demos/_fixtures/Polish';
import { LotusMark } from './demos/_fixtures/Brand';

export { EASE, FONT, Grain, Vignette, bezier, ramp, mix, LotusMark };

export const T = {
  bg: '#0a0e13', bg2: '#101b26', panel: '#101720', panel2: '#17212c',
  gold: '#d8b45a', goldSoft: '#e8d29a', ice: '#6fb2d2',
  ink: '#ece6da', ink2: '#a5afbb', ink3: '#5f6b77',
  line: 'rgba(216,180,90,0.22)',
};
// 精緻高端預設：主時長 ~42f、對稱緩動、幾乎不過冲（DESIGN.md §1）
export const PREMIUM = bezier(0.4, 0, 0.6, 1);
export const img = (p: string) => staticFile(p);

/** 景深金塵（確定性）：近大遠小、近快遠慢、遠處較糊；NightStage 預設帶一層，讓暗場有空氣感 */
const rnd = (i: number, k = 0) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };
export const StageDust: React.FC<{ n?: number; seed?: number; alpha?: number }> = ({ n = 46, seed = 2, alpha = 0.55 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const z = 0.25 + 0.75 * rnd(i, seed);
        const x = rnd(i, seed + 1) * 1960 - 20 + Math.sin(f / 90 + i) * 12 * z;
        const y = ((rnd(i, seed + 2) * 1160 - f * (0.2 + 0.7 * z)) % 1160 + 1160) % 1160 - 40;
        const sz = 1.4 + z * 4;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: sz, height: sz, borderRadius: '50%', background: '#ffe2a8',
          opacity: alpha * (0.12 + 0.55 * z) * (0.5 + 0.5 * Math.sin(f / (9 + rnd(i, seed + 3) * 12) + i)), filter: `blur(${(1 - z) * 2.2}px)`, boxShadow: `0 0 ${sz * 3}px rgba(255,210,140,0.7)` }} />;
      })}
    </AbsoluteFill>
  );
};

/** 夜藍舞台：上方一點金色體積光 + 景深金塵 + 顆粒 + 暗角 */
export const NightStage: React.FC<{ children?: React.ReactNode; glow?: { x: number; y: number; a?: number }; grain?: number; dust?: boolean }> = ({ children, glow = { x: 0.5, y: 0.32 }, grain = 0.07, dust = true }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at ${glow.x * 100}% ${glow.y * 100}%, rgba(216,180,90,${glow.a ?? 0.1}) 0%, rgba(16,27,38,0.9) 45%, ${T.bg} 100%)`, overflow: 'hidden' }}>
    {dust && <StageDust />}
    {children}
    <Vignette strength={0.5} inner={0.45} color="#030507" />
    <Grain opacity={grain} blend="soft-light" />
  </AbsoluteFill>
);

/** HUD 細字：等寬大字距、逐字打出（typewriter），用於座標、資料來源等「儀器讀數」 */
export const Hud: React.FC<{ text: string; at: number; x: number; y: number; align?: 'left' | 'right' | 'center'; size?: number; color?: string; cps?: number; out?: number }> = ({ text, at, x, y, align = 'left', size = 15, color = T.ink2, cps = 1.4, out }) => {
  const f = useCurrentFrame();
  const n = Math.floor(Math.max(0, f - at) * cps);
  const shown = text.slice(0, n);
  const o = out == null ? 1 : 1 - ramp(f, out, 14, EASE.exit);
  if (n <= 0 || o <= 0) return null;
  const caret = n < text.length && Math.floor(f / 4) % 2 === 0 ? '▍' : '';
  return (
    <div style={{ position: 'absolute', left: align === 'right' ? undefined : x, right: align === 'right' ? 1920 - x : undefined, top: y,
      transform: align === 'center' ? 'translateX(-50%)' : undefined, fontFamily: FONT.mono, fontSize: size, letterSpacing: '0.22em',
      color, opacity: o, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{shown}<span style={{ color: T.gold }}>{caret}</span></div>
  );
};

/** 襯線大標：逐字從模糊浮起（blur-slide 的三通道同步收斂：y、blur、opacity） */
export const SerifLine: React.FC<{ text: string; at: number; size?: number; color?: string; per?: number; weight?: number; out?: number; letter?: string; style?: React.CSSProperties }> = ({ text, at, size = 84, color = T.ink, per = 3, weight = 600, out, letter = '0.06em', style }) => {
  const f = useCurrentFrame();
  const o = out == null ? 1 : 1 - ramp(f, out, 16, EASE.exit);
  return (
    <div style={{ fontFamily: FONT.serif, fontSize: size, fontWeight: weight, color, letterSpacing: letter, lineHeight: 1.25, whiteSpace: 'nowrap', opacity: o, ...style }}>
      {[...text].map((ch, i) => {
        const p = ramp(f, at + i * per, 26, EASE.out);
        return <span key={i} style={{ display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * 0.38}em)`, filter: `blur(${(1 - p) * 14}px)` }}>{ch === ' ' ? ' ' : ch}</span>;
      })}
    </div>
  );
};

/** 章節卡：大號序號描邊 + 金色細線伸展 + 標題 + 英文副題，整段 ~66f，結尾淡出交棒 */
export const ChapterCard: React.FC<{ no: string; title: string; en: string; dur: number; plate?: string }> = ({ no, title, en, dur, plate }) => {
  const f = useCurrentFrame();
  const line = ramp(f, 6, 30, PREMIUM);
  const out = ramp(f, dur - 14, 14, EASE.exit);
  return (
    <NightStage glow={{ x: 0.3, y: 0.5, a: 0.08 }}>
      {/* 即夢 AI 意象底景：右側半透明慢推，左側壓暗留給序號與標題 */}
      {plate && <AbsoluteFill style={{ opacity: 0.6 * ramp(f, 0, 20, EASE.out) * (1 - out), transform: `scale(${1.06 + 0.08 * f / dur})`,
        WebkitMaskImage: 'linear-gradient(90deg, transparent 18%, #000 62%)', maskImage: 'linear-gradient(90deg, transparent 18%, #000 62%)' }}>
        <Img src={staticFile(plate)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>}
      {plate && <div style={{ position: 'absolute', right: 40, bottom: 26, fontFamily: FONT.mono, fontSize: 12, letterSpacing: '0.2em', color: 'rgba(236,230,218,0.45)', opacity: 1 - out }}>AI 意象 · 即夢生成</div>}
      <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 + out * 0.04})` }}>
        <div style={{ position: 'absolute', left: 260, top: 330, fontFamily: FONT.serif, fontSize: 300, fontWeight: 300, lineHeight: 1,
          color: 'transparent', WebkitTextStroke: `1.5px ${T.gold}`, opacity: 0.85 * ramp(f, 0, 30, EASE.out), transform: `translateX(${(1 - ramp(f, 0, 40, EASE.snappy)) * -60}px)` }}>{no}</div>
        <div style={{ position: 'absolute', left: 640, top: 520, width: 1000 * line, height: 1.5, background: `linear-gradient(90deg, ${T.gold}, rgba(216,180,90,0))` }} />
        <div style={{ position: 'absolute', left: 640, top: 400 }}><SerifLine text={title} at={10} size={92} per={2} /></div>
        <div style={{ position: 'absolute', left: 644, top: 552 }}><Hud text={en} at={18} x={0} y={0} size={18} color={T.goldSoft} cps={1.8} /></div>
      </AbsoluteFill>
    </NightStage>
  );
};

/** 字幕條：畫面底部的解說句（不留啞巴段落），淡入淡出 */
export const Caption: React.FC<{ text: string; from: number; to: number; y?: number }> = ({ text, from, to, y = 960 }) => {
  const f = useCurrentFrame();
  const o = Math.min(ramp(f, from, 12, EASE.out), 1 - ramp(f, to - 12, 12, EASE.exit));
  if (o <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: y, display: 'flex', justifyContent: 'center', opacity: o }}>
      <div style={{ fontFamily: FONT.sans, fontSize: 30, fontWeight: 500, color: T.ink, letterSpacing: '0.06em', padding: '10px 26px',
        background: 'rgba(10,14,19,0.62)', borderRadius: 10, border: `1px solid ${T.line}`, backdropFilter: 'blur(8px)' }}>{text}</div>
    </div>
  );
};

/** 數字讀數（等寬、千分位），從 0 補間到目標；decimals 控制小數位 */
export const Count: React.FC<{ to: number; at: number; dur?: number; decimals?: number; suffix?: string; size?: number; color?: string }> = ({ to, at, dur = 40, decimals = 0, suffix = '', size = 96, color = T.ink }) => {
  const f = useCurrentFrame();
  const v = to * ramp(f, at, dur, EASE.out);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span style={{ fontFamily: FONT.serif, fontSize: size, fontWeight: 500, color, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}>{s}<span style={{ fontSize: size * 0.42, color: T.gold, marginLeft: 6 }}>{suffix}</span></span>;
};

export const fade = (f: number, inAt: number, outAt: number, d = 14) => Math.min(ramp(f, inAt, d, EASE.out), 1 - ramp(f, outAt - d, d, EASE.exit));
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export { interpolate };
