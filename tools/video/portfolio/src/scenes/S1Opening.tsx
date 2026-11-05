// S1 開場（330f）：澳門真實 DEM 等高線由低到高生長 → 地圖後退虛化 → 蓮花描出 → TUJIAN 字距結晶（letterspace-materialize）
// letterspace-materialize 命門沿用 demo：全字符同幀起筆、pathLength 歸一同幀齊收、DUR 52、strokeEase(0.5,0,0.3,1)、
// 收筆前 30% 蓄亮→畫完 14f 回落、背景極緩推近、字標本身不位移、終態 hold ≥1s
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import contours from '../data/contours.json';
import { EASE, FONT, Hud, LotusMark, NightStage, PREMIUM, SerifLine, T, bezier, ramp } from '../kit';

// 幾何單線大寫骨架（64 高視框：頂 y=5、基線 y=59），與 demo 小寫字形同一套筆畫規格
const GLYPHS: Record<string, { w: number; d: string }> = {
  T: { w: 52, d: 'M 4 5 L 48 5 M 26 5 L 26 59' },
  U: { w: 50, d: 'M 5 5 L 5 40 C 5 52, 13 59, 25 59 C 37 59, 45 52, 45 40 L 45 5' },
  J: { w: 40, d: 'M 34 5 L 34 43 C 34 54, 27 59, 19 59 C 11 59, 5 54, 4 46' },
  I: { w: 12, d: 'M 6 5 L 6 59' },
  A: { w: 56, d: 'M 4 59 L 28 5 L 52 59 M 13 40 L 43 40' },
  N: { w: 50, d: 'M 5 59 L 5 5 L 45 59 L 45 5' },
};
const WORD = 'TUJIAN';
const GLYPH_SCALE = 0.86;
const GLYPH_H = 64 * GLYPH_SCALE;
const TRACK = 34; // 大字距是本卡身份
const START = 196, DUR = 52; // 全字符同幀起筆、同幀齊收
const strokeEase = bezier(0.5, 0, 0.3, 1);
export const S1_DURATION = 330;

const Word: React.FC<{ e: number; glowAmt: number }> = ({ e, glowAmt }) => (
  <div style={{ display: 'flex', gap: TRACK, alignItems: 'center' }}>
    {WORD.split('').map((ch, i) => {
      const g = GLYPHS[ch];
      return (
        <svg key={i} width={g.w * GLYPH_SCALE} height={GLYPH_H} viewBox={`0 0 ${g.w} 64`} style={{ overflow: 'visible', display: 'block' }}>
          {e > 0 && <path d={g.d} fill="none" stroke={T.ink} strokeWidth={4.2 / GLYPH_SCALE} strokeLinecap="round" strokeLinejoin="round"
            pathLength={1} strokeDasharray={1} strokeDashoffset={1 - e}
            style={{ filter: `drop-shadow(0 0 ${(4 + glowAmt * 10) / GLYPH_SCALE}px rgba(216,180,90,${0.25 + glowAmt * 0.45}))` }} />}
        </svg>
      );
    })}
  </div>
);

export const S1Opening: React.FC = () => {
  const f = useCurrentFrame();
  const levels = contours.levels as { e: number; d: string }[];

  // 地圖層：極緩推近 + 微旋（2.5D 縱深），150f 起後退虛化讓位給字標
  const push = ramp(f, 0, 330, EASE.smooth);
  const recede = ramp(f, 138, 70, PREMIUM);
  const mapScale = 1.04 + 0.1 * push + 0.25 * recede;
  const mapRot = -3 + 3 * push;
  const outline = ramp(f, 4, 80, bezier(0.5, 0, 0.3, 1));

  // 字標：蓮花 150→206 描瓣、圓點 206→216；字距結晶 196→248；畫完蓄亮回落
  const petals = ramp(f, 150, 56, bezier(0.5, 0, 0.3, 1));
  const dot = ramp(f, 204, 12, EASE.overshoot);
  const e = ramp(f, START, DUR, strokeEase);
  const rise = ramp(f, START + DUR * 0.7, DUR * 0.3, EASE.swift);
  const fall = 1 - ramp(f, START + DUR, 14, EASE.out);
  const glowAmt = e >= 1 ? fall : rise;
  const markIn = ramp(f, 146, 30, EASE.out);

  return (
    <NightStage glow={{ x: 0.5, y: 0.42, a: 0.06 + 0.08 * markIn }}>
      {/* 等高線地圖 */}
      <AbsoluteFill style={{ transform: `scale(${mapScale}) rotate(${mapRot}deg)`, opacity: 1 - 0.8 * recede, filter: `blur(${recede * 5}px)` }}>
        <svg width={1920} height={1080} viewBox="0 0 1920 1080">
          {(contours.outline as string[]).map((d, i) => (
            <path key={`o${i}`} d={d} fill="none" stroke={T.gold} strokeWidth={1.6} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - outline}
              style={{ filter: 'drop-shadow(0 0 6px rgba(216,180,90,0.45))' }} />
          ))}
          {levels.map((lv, i) => {
            const p = ramp(f, 14 + i * 5, 90, bezier(0.45, 0, 0.35, 1));
            const k = i / (levels.length - 1);
            return <path key={lv.e} d={lv.d} fill="none" stroke={k > 0.55 ? T.goldSoft : T.gold} strokeWidth={0.7 + k * 0.6}
              opacity={(0.28 + 0.6 * k) * Math.min(1, p * 3)} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />;
          })}
        </svg>
      </AbsoluteFill>

      {/* 儀器讀數 */}
      <Hud text="22°11′N · 113°33′E" at={18} x={96} y={88} out={300} />
      <Hud text="MACAU SAR · 18 LEVELS · 10 M CONTOURS" at={34} x={96} y={980} out={300} />
      <Hud text="COPERNICUS DEM GLO-30" at={46} x={1824} y={88} align="right" out={300} />
      <Hud text="TUJIAN · PORTFOLIO 2026" at={58} x={1824} y={980} align="right" color={T.goldSoft} out={300} />

      {/* 字標鎖定 */}
      <AbsoluteFill style={{ alignItems: 'center' }}>
        <div style={{ position: 'absolute', top: 215, opacity: markIn, transform: `scale(${0.94 + 0.06 * markIn})`,
          filter: `drop-shadow(0 0 ${10 + glowAmt * 18}px rgba(216,180,90,${0.35 + glowAmt * 0.3}))` }}>
          <LotusMark size={180} petals={petals} dot={dot} stroke={1.5} />
        </div>
        <div style={{ position: 'absolute', top: 432 }}><SerifLine text="途 見" at={208} size={118} per={6} weight={600} letter="0.12em" /></div>
        <div style={{ position: 'absolute', top: 600 }}><Word e={e} glowAmt={glowAmt} /></div>
        <div style={{ position: 'absolute', top: 712 }}><SerifLine text="看見一座城，留下每一處記憶" at={262} size={36} per={2} weight={400} color={T.ink2} letter="0.24em" /></div>
      </AbsoluteFill>
    </NightStage>
  );
};
