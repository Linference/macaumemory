// S2 主張（270f）：即夢生成的葡式碎石波浪紋底景（質感底景，不標示為真實地點）2.5D 慢推 + 單次金色 sheen 沿波紋掠過
// 字：「澳門的記憶，」「不只在景點。」→ 換句「也在每一條街巷、每一棟普通建築。」（一句一個主動作，換句時舊句上浮淡出）
import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';
import { EASE, FONT, Grain, Hud, PREMIUM, SerifLine, T, Vignette, img, ramp } from '../kit';

export const S2_DURATION = 270;

export const S2Claim: React.FC = () => {
  const f = useCurrentFrame();
  const enter = ramp(f, 0, 36, PREMIUM);
  const push = ramp(f, 0, 270, EASE.smooth);
  const sheen = ramp(f, 40, 120, EASE.smooth); // 單點高質量光效，只掃一次
  const swap = ramp(f, 138, 22, EASE.exit);
  const exitAll = ramp(f, 252, 18, EASE.exit);

  return (
    <AbsoluteFill style={{ background: T.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ opacity: enter * (1 - exitAll), transform: `scale(${1.16 - 0.1 * push}) translate(${-30 + 50 * push}px, ${12 - 20 * push}px) rotate(${1.2 - 1.2 * push}deg)` }}>
        <Img src={img('gen/calcada-1.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.9) brightness(0.82)' }} />
        {/* 金色 sheen：斜向光帶沿波紋方向掠過，只疊加在亮石上（screen 混合） */}
        <AbsoluteFill style={{ mixBlendMode: 'screen', opacity: 0.55 * Math.sin(Math.PI * sheen),
          background: `linear-gradient(115deg, rgba(0,0,0,0) ${-30 + sheen * 130}%, rgba(232,190,110,0.55) ${-15 + sheen * 130}%, rgba(0,0,0,0) ${0 + sheen * 130}%)` }} />
      </AbsoluteFill>
      {/* 讀字區壓暗：右側留白給標題 */}
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(10,14,19,0.15) 0%, rgba(10,14,19,0.55) 48%, rgba(10,14,19,0.85) 100%)' }} />

      <div style={{ position: 'absolute', right: 150, top: 330, textAlign: 'right', opacity: 1 - exitAll }}>
        <div style={{ opacity: 1 - swap, transform: `translateY(${-swap * 40}px)`, filter: `blur(${swap * 8}px)` }}>
          <SerifLine text="澳門的記憶，" at={22} size={104} per={4} />
          <SerifLine text="不只在景點。" at={52} size={104} per={4} color={T.goldSoft} />
        </div>
      </div>
      <div style={{ position: 'absolute', right: 150, top: 400, textAlign: 'right', opacity: 1 - exitAll }}>
        <SerifLine text="也在每一條街巷、" at={156} size={72} per={3} />
        <SerifLine text="每一棟普通建築。" at={176} size={72} per={3} color={T.goldSoft} />
        <div style={{ marginTop: 26, marginLeft: 'auto', height: 2, width: 420 * ramp(f, 206, 26, EASE.snappy), background: `linear-gradient(90deg, rgba(216,180,90,0), ${T.gold})` }} />
      </div>
      <Hud text="CALÇADA · WAVE PATTERN" at={30} x={96} y={980} out={250} />
      <Hud text="CHAPTER 00 · WHY" at={40} x={1824} y={88} align="right" color={T.goldSoft} out={250} />
      <Vignette strength={0.55} inner={0.4} color="#030507" />
      <Grain opacity={0.08} blend="soft-light" />
      <div style={{ position: 'absolute', inset: 0, fontFamily: FONT.sans }} />
    </AbsoluteFill>
  );
};
