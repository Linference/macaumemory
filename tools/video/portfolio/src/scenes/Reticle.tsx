// reticle-lock-on（fui-hud-moves）改為可重用元件：時間常數、超調曲線、咬合「咔」、聚焦壓暗、標籤彈出全照 demo，
// 只換皮：角標金色＋深色襯底（在米色城市上也清楚），標籤用途見深色膠囊。at = 本元件第 0 幀（對應 demo f0）
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { EASE, FONT, SpeedBlur, mix, ramp } from '../demos/_fixtures/Polish';
import { T } from '../kit';

const FLY_IN = 14, FLY_END = 24, SHRINK0 = 20, UNDER = 40, LOCK_END = 46;
const LABEL0 = LOCK_END + 2, LABEL_END = LOCK_END + 12;
const ARM = 46, THICK = 4.5;
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

export const Reticle: React.FC<{ at: number; box: { x: number; y: number; w: number; h: number }; label: string; tag: string; pad?: number }> = ({ at, box, label, tag, pad = 14 }) => {
  const frame = useCurrentFrame() - at;
  if (frame < 0) return null;
  const TCX = box.x + box.w / 2, TCY = box.y + box.h / 2;
  const flyAt = (f: number) => { const t = interpolate(f, [FLY_IN, FLY_END], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp }); return { x: (1 - t) * 900, y: (1 - t) * 520 }; };
  const shrink = frame < UNDER ? mix(2.2, 0.94, ramp(frame, SHRINK0, UNDER - SHRINK0, EASE.swift)) : mix(0.94, 1, ramp(frame, UNDER, LOCK_END - UNDER, EASE.out));
  const fly = flyAt(frame), fly0 = flyAt(frame - 0.5), fly1 = flyAt(frame + 0.5);
  const bite = interpolate(frame, [LOCK_END, LOCK_END + 1, LOCK_END + 5], [0, 1, 0], clamp);
  const hw = (box.w / 2 + pad) * shrink - 5 * bite, hh = (box.h / 2 + pad) * shrink - 5 * bite;
  const glow = interpolate(frame, [LOCK_END, LOCK_END + 3, LOCK_END + 10], [0, 0.55, 0.28], clamp);
  const focus = interpolate(frame, [LOCK_END - 2, LOCK_END + 10], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const labelT = interpolate(frame, [LABEL0, LABEL_END], [0, 1], { easing: Easing.out(Easing.back(1.8)), ...clamp });
  const reticleOp = interpolate(frame, [FLY_IN, FLY_IN + 3], [0, 1], clamp);
  const corners = [{ x: TCX - hw, y: TCY - hh, sx: 1, sy: 1 }, { x: TCX + hw, y: TCY - hh, sx: -1, sy: 1 }, { x: TCX - hw, y: TCY + hh, sx: 1, sy: -1 }, { x: TCX + hw, y: TCY + hh, sx: -1, sy: -1 }];
  const stroke = (w: number, h: number, under: boolean): React.CSSProperties => ({
    position: 'absolute', left: under ? -2 : 0, top: under ? -2 : 0, width: w + (under ? 4 : 0), height: h + (under ? 4 : 0), borderRadius: 4,
    background: under ? 'rgba(10,14,19,0.88)' : T.gold, boxShadow: under ? '0 2px 8px rgba(0,0,0,0.35)' : '0 0 8px rgba(216,180,90,0.6)',
  });
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {focus > 0 && <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 12, boxShadow: `0 0 0 3000px rgba(5,8,12,${(0.38 * focus).toFixed(3)})` }} />}
      {frame >= LOCK_END && (
        <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 12, overflow: 'hidden', boxShadow: `0 0 0 1.5px rgba(216,180,90,${(0.7 * focus).toFixed(3)})` }}>
          <div style={{ position: 'absolute', inset: 0, opacity: glow, background: 'linear-gradient(180deg, rgba(255,236,190,0.75) 0%, rgba(255,236,190,0.2) 100%)', mixBlendMode: 'screen' }} />
        </div>
      )}
      {frame >= FLY_IN && (
        <SpeedBlur vx={fly1.x - fly0.x} vy={fly1.y - fly0.y} amount={0.3} max={22}>
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${fly.x}px, ${fly.y}px)`, opacity: reticleOp }}>
            {corners.map((c, i) => (
              <div key={i} style={{ position: 'absolute', left: c.x, top: c.y, transform: `scale(${c.sx}, ${c.sy})`, transformOrigin: '0 0' }}>
                <div style={stroke(ARM, THICK, true)} /><div style={stroke(THICK, ARM, true)} />
                <div style={stroke(ARM, THICK, false)} /><div style={stroke(THICK, ARM, false)} />
              </div>
            ))}
            {[0, 1].map((k) => (
              <div key={k} style={{ position: 'absolute', left: TCX - (k ? 1.5 : 13), top: TCY - (k ? 13 : 1.5), width: k ? 3 : 26, height: k ? 26 : 3, borderRadius: 2, background: T.gold, opacity: 0.85 * (1 - focus), boxShadow: '0 0 0 2px rgba(10,14,19,0.85)' }} />
            ))}
          </div>
        </SpeedBlur>
      )}
      {frame >= LABEL0 && (
        <div style={{ position: 'absolute', left: TCX - hw + 2, top: TCY - hh - 66, transform: `scale(${labelT})`, transformOrigin: '0 100%', opacity: Math.min(1, labelT * 1.5),
          display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap', background: 'linear-gradient(180deg, #1b2733 0%, #111a23 100%)', color: T.ink, fontFamily: FONT.sans,
          padding: '9px 15px 9px 13px', borderRadius: 12, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px ${T.line}, 0 16px 32px -10px rgba(0,0,0,0.6)` }}>
          <div style={{ width: 11, height: 11, borderRadius: 6, background: T.gold, boxShadow: '0 0 0 4px rgba(216,180,90,0.22)' }} />
          <span style={{ fontSize: 28, fontWeight: 600 }}>{label}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 16, letterSpacing: '0.1em', color: T.goldSoft, padding: '4px 8px', borderRadius: 6, background: 'rgba(216,180,90,0.1)' }}>{tag}</span>
        </div>
      )}
    </div>
  );
};
