// 真實錄屏片段 + 暖色漏光推入轉場（transition-hidden-cut「暖色漏光」：硬切藏在光峰的 1–3 幀裡）
// 進場：放大 1.06→1、模糊 10→0、亮度 1.7→1；出場反向；交界處金色漏光（screen）在切點達峰
import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame } from 'remotion';
import { EASE, ramp } from '../kit';

const leak = (k: number) => (
  <AbsoluteFill style={{ mixBlendMode: 'screen', opacity: k, pointerEvents: 'none',
    background: 'radial-gradient(ellipse 60% 70% at 78% 30%, rgba(255,214,140,0.95) 0%, rgba(216,150,70,0.55) 35%, rgba(0,0,0,0) 72%), radial-gradient(ellipse 50% 60% at 15% 80%, rgba(255,190,120,0.6) 0%, rgba(0,0,0,0) 65%)' }} />
);

export const Footage: React.FC<{ src: string; dur: number; startFrom?: number; still?: boolean; inT?: number; outT?: number; push?: [number, number]; origin?: string; children?: React.ReactNode }> = ({ src, dur, startFrom = 0, still = false, inT = 12, outT = 12, push = [1, 1], origin = '50% 50%', children }) => {
  const f = useCurrentFrame();
  const i = inT ? 1 - ramp(f, 0, inT, EASE.out) : 0; // 1→0
  const o = outT ? ramp(f, dur - outT, outT, EASE.exit) : 0; // 0→1
  const k = Math.max(i, o);
  const cam = push[0] + (push[1] - push[0]) * ramp(f, 0, dur, EASE.smooth);
  const scale = cam * (1 + 0.06 * k);
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#0a0e13' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: origin, filter: `blur(${10 * k}px) brightness(${1 + 0.7 * k}) saturate(${1 - 0.25 * k})` }}>
        {!src ? null : still ? <Img src={src} style={{ width: '100%', height: '100%' }} />
          : <OffthreadVideo src={src} startFrom={startFrom} muted style={{ width: '100%', height: '100%' }} />}
        {children}
      </AbsoluteFill>
      {/* 上下壓暗：HUD 細字與字幕在亮色屋頂上也讀得清楚 */}
      <AbsoluteFill style={{ pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(10,14,19,0.62) 0%, rgba(10,14,19,0) 22%, rgba(10,14,19,0) 74%, rgba(10,14,19,0.6) 100%)' }} />
      {leak(k * 0.9)}
    </AbsoluteFill>
  );
};
