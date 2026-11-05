// 電影感疊層：Plate（單張圖的多層視差 + 泛光）、Beams（體積光）、Dust（景深金塵）、Flare（變形寬銀幕光條）、
// Letterbox（2.39:1 黑邊）、BigType（巨型逐字遮罩升起）。全部是 frame 的純函數，確定性渲染（固定種子）
import React from 'react';
import { AbsoluteFill, Freeze, Img, OffthreadVideo, useCurrentFrame } from 'remotion';
import { EASE, FONT, Grain, T, Vignette, img, mix, ramp } from './kit';
import CLIPS from './data/clips.json';

const rnd = (i: number, k = 0) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };

/** 底景有對應的即夢圖生視頻（clips.json：底圖路徑 → { src, frames }）時改播動態片段：
 *  慢放不低於 0.5×（再慢 AI 片段會頓），播完凍結末幀，CSS 推鏡照舊疊在上面 */
const PlateClip: React.FC<{ clip: { src: string; frames: number }; dur: number; style: React.CSSProperties }> = ({ clip, dur, style }) => {
  const f = useCurrentFrame();
  const rate = Math.max(0.5, Math.min(1, clip.frames / dur));
  const last = Math.floor((clip.frames - 2) / rate);
  return (
    <Freeze frame={last} active={f >= last}>
      <OffthreadVideo src={img(clip.src)} muted playbackRate={rate} style={style} />
    </Freeze>
  );
};

/** 單張底景做出縱深：底層慢推、前景（下方遮罩）快推＝視差；上方再疊一層模糊提亮做泛光 */
export const Plate: React.FC<{ src: string; dur: number; from?: [number, number, number]; to?: [number, number, number]; bloom?: number; dim?: number; label?: boolean; children?: React.ReactNode }> =
  ({ src, dur, from = [0, 0, 1.12], to = [-40, -10, 1.22], bloom = 0.35, dim = 0.35, label = true, children }) => {
  const f = useCurrentFrame();
  const t = ramp(f, 0, dur, EASE.smooth);
  const x = mix(from[0], to[0], t), y = mix(from[1], to[1], t), s = mix(from[2], to[2], t);
  const clip = (CLIPS as Record<string, { src: string; frames: number }>)[src];
  if (clip) {
    const fill: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
    return (
      <AbsoluteFill style={{ overflow: 'hidden', background: T.bg }}>
        <AbsoluteFill style={{ transform: `translate(${x * 0.5}px, ${y * 0.5}px) scale(${1 + (s - from[2]) * 0.6 + 0.02})`, filter: `saturate(1.08) contrast(1.04)` }}>
          <PlateClip clip={clip} dur={dur} style={fill} />
        </AbsoluteFill>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at 50% 40%, rgba(255,214,150,${bloom * 0.18}) 0%, rgba(0,0,0,0) 70%)`, mixBlendMode: 'screen' }} />
        <AbsoluteFill style={{ background: `rgba(10,14,19,${dim})` }} />
        {children}
        {label && <div style={{ position: 'absolute', right: 40, bottom: 26, fontFamily: FONT.mono, fontSize: 12, letterSpacing: '0.2em', color: 'rgba(236,230,218,0.45)' }}>AI 意象 · 即夢生成</div>}
      </AbsoluteFill>
    );
  }
  const fx = x * 1.8, fy = y * 1.8, fs = s * 1.03 + (s - from[2]) * 0.6; // 前景移動更快
  const layer = (tx: number, ty: number, sc: number, extra: React.CSSProperties = {}) => (
    <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${sc})`, ...extra }}>
      <Img src={img(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: T.bg }}>
      {layer(x, y, s)}
      {layer(fx, fy, fs, { WebkitMaskImage: 'linear-gradient(0deg, #000 0%, #000 22%, transparent 48%)', maskImage: 'linear-gradient(0deg, #000 0%, #000 22%, transparent 48%)' })}
      {layer(x, y, s, { filter: 'blur(28px) brightness(1.5) saturate(1.2)', mixBlendMode: 'screen', opacity: bloom })}
      <AbsoluteFill style={{ background: `rgba(10,14,19,${dim})` }} />
      {children}
      {label && <div style={{ position: 'absolute', right: 40, bottom: 26, fontFamily: FONT.mono, fontSize: 12, letterSpacing: '0.2em', color: 'rgba(236,230,218,0.45)' }}>AI 意象 · 即夢生成</div>}
    </AbsoluteFill>
  );
};

/** 體積光：數道從右上斜射的光束，緩慢擺動，screen 疊加 */
export const Beams: React.FC<{ strength?: number; origin?: [number, number] }> = ({ strength = 0.5, origin = [78, -10] }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen', opacity: strength, pointerEvents: 'none' }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = 18 + i * 9 + Math.sin(f / 70 + i) * 2.5;
        return <div key={i} style={{ position: 'absolute', left: `${origin[0]}%`, top: `${origin[1]}%`, width: 160 + i * 60, height: 2200, transformOrigin: '50% 0',
          transform: `translateX(-50%) rotate(${a}deg)`, background: `linear-gradient(180deg, rgba(255,214,150,${0.22 - i * 0.03}) 0%, rgba(255,214,150,0) 75%)`, filter: 'blur(18px)' }} />;
      })}
    </AbsoluteFill>
  );
};

/** 景深金塵：近大遠小、近快遠慢、遠處較糊；向上緩飄並閃爍 */
export const Dust: React.FC<{ n?: number; drift?: number; seed?: number; alpha?: number }> = ({ n = 70, drift = 0, seed = 1, alpha = 1 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const z = 0.25 + 0.75 * rnd(i, seed);
        const x = ((rnd(i, seed + 1) * 2100 - 90 + drift * z * f * 0.6) % 2100 + 2100) % 2100 - 90;
        const y = ((rnd(i, seed + 2) * 1200 - f * (0.25 + 0.9 * z)) % 1200 + 1200) % 1200 - 60;
        const sz = 1.5 + z * 5;
        const tw = 0.45 + 0.55 * Math.sin(f / (8 + rnd(i, seed + 3) * 14) + i);
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: sz, height: sz, borderRadius: '50%', background: '#ffe2a8',
          opacity: alpha * (0.15 + 0.6 * z) * tw, filter: `blur(${(1 - z) * 2.5}px)`, boxShadow: `0 0 ${sz * 3}px rgba(255,210,140,0.8)` }} />;
      })}
    </AbsoluteFill>
  );
};

/** 變形寬銀幕光條：at 幀橫向掃過的一道細長藍金光（單點高質量光效，不群發） */
export const Flare: React.FC<{ at: number; y?: number; dur?: number }> = ({ at, y = 540, dur = 34 }) => {
  const f = useCurrentFrame();
  const p = ramp(f, at, dur, EASE.smooth);
  if (p <= 0 || p >= 1) return null;
  const o = Math.sin(Math.PI * p);
  return (
    <AbsoluteFill style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: mix(-900, 1900, p), top: y - 3, width: 1400, height: 6, borderRadius: 3, opacity: o,
        background: 'linear-gradient(90deg, rgba(111,178,210,0) 0%, rgba(150,200,255,0.7) 30%, rgba(255,240,210,1) 50%, rgba(255,200,120,0.7) 70%, rgba(255,200,120,0) 100%)', filter: 'blur(1.5px)' }} />
      <div style={{ position: 'absolute', left: mix(-900, 1900, p) + 560, top: y - 90, width: 280, height: 180, borderRadius: '50%', opacity: o * 0.5,
        background: 'radial-gradient(ellipse, rgba(255,230,180,0.9) 0%, rgba(255,200,120,0) 70%)' }} />
    </AbsoluteFill>
  );
};

/** 2.39:1 黑邊：開場滑入、結束滑出 */
export const Letterbox: React.FC<{ dur: number; inAt?: number }> = ({ dur, inAt = 0 }) => {
  const f = useCurrentFrame();
  const h = 138 * ramp(f, inAt, 24, EASE.snappy) * (1 - ramp(f, dur - 18, 18, EASE.exit));
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: h, background: '#000' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: h, background: '#000' }} />
    </>
  );
};

/** 巨型標題：每字從遮罩下方升起（y 110%→0、模糊→清晰、字距收攏），退場時字距擴張＋模糊淡出 */
export const BigType: React.FC<{ text: string; at: number; out?: number; size?: number; color?: string; per?: number; weight?: number; serif?: boolean; track?: number; glow?: boolean }> =
  ({ text, at, out, size = 150, color = T.ink, per = 3, weight = 600, serif = true, track = 0.06, glow = false }) => {
  const f = useCurrentFrame();
  const ex = out == null ? 0 : ramp(f, out, 18, EASE.exit);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', whiteSpace: 'nowrap', fontFamily: serif ? FONT.serif : FONT.sans, fontSize: size, fontWeight: weight, lineHeight: 1.18, color,
      letterSpacing: `${track + ex * 0.25}em`, opacity: 1 - ex, filter: `blur(${ex * 12}px)`, textShadow: glow ? '0 0 40px rgba(216,180,90,0.45)' : '0 6px 40px rgba(0,0,0,0.55)' }}>
      {[...text].map((ch, i) => {
        const p = ramp(f, at + i * per, 30, EASE.snappy);
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: '0.08em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 110}%)`, filter: `blur(${(1 - p) * 10}px)`, opacity: Math.min(1, p * 1.6) }}>{ch === ' ' ? ' ' : ch}</span>
          </span>
        );
      })}
    </div>
  );
};

/** 眉標：金色短線 + 大字距英文／章節名 */
export const Eyebrow: React.FC<{ text: string; at: number; out?: number }> = ({ text, at, out }) => {
  const f = useCurrentFrame();
  const o = ramp(f, at, 16, EASE.out) * (out == null ? 1 : 1 - ramp(f, out, 14, EASE.exit));
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, opacity: o, fontFamily: FONT.mono, fontSize: 20, letterSpacing: '0.36em', color: T.goldSoft }}>
      <span style={{ width: 70 * ramp(f, at, 24, EASE.snappy), height: 1.5, background: T.gold }} />{text}<span style={{ width: 70 * ramp(f, at, 24, EASE.snappy), height: 1.5, background: T.gold }} />
    </div>
  );
};

/** 衝鏡轉場：入場從 1.14 倍＋動態模糊＋過曝收回，出場推近 1.06 倍並泛白；
 *  相鄰兩屏首尾各重疊幾幀，看起來是鏡頭「穿過」上一屏，而不是淡入淡出 */
export const PunchCut: React.FC<{ dur: number; inT?: number; outT?: number; children: React.ReactNode }> = ({ dur, inT = 12, outT = 10, children }) => {
  const f = useCurrentFrame();
  const i = inT ? 1 - ramp(f, 0, inT, EASE.out) : 0;
  const o = outT ? ramp(f, dur - outT, outT, EASE.exit) : 0;
  const k = Math.max(i, o);
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + 0.14 * i + 0.06 * o})`, filter: `blur(${14 * k}px) brightness(${1 + 0.9 * k})`, opacity: 1 - 0.6 * o }}>
      {children}
      <AbsoluteFill style={{ mixBlendMode: 'screen', opacity: k * 0.8, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 65% 70% at 50% 45%, rgba(255,226,170,0.9) 0%, rgba(216,150,70,0.4) 40%, rgba(0,0,0,0) 75%)' }} />
    </AbsoluteFill>
  );
};

export const Finish: React.FC = () => (<><Vignette strength={0.55} inner={0.42} color="#020305" /><Grain opacity={0.07} blend="soft-light" /></>);
