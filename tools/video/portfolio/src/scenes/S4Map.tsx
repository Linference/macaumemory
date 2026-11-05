// S4 三維地圖（720f）：章節卡 01 → 全景（資料層 HUD）→ 俯衝歷史城區 → 停格鎖定市政署大樓（reticle-lock-on）→ 大三巴環繞
// 畫面全部是 GPU 逐幀錄製的網站真實地圖（capture/record.mjs）
import React from 'react';
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Caption, ChapterCard, Count, EASE, FONT, Hud, SerifLine, T, ramp } from '../kit';
import { Footage } from './Footage';
import { Reticle } from './Reticle';

export const S4_DURATION = 720;
const v = (n: string) => staticFile(`footage/${n}`);

// 資料層讀數：一層一行，金點 + 名稱 + 數字（逐行錯峰 snappy 入場）
const LAYERS = [
  { k: 'OVERTURE MAPS', zh: '3D 建築', n: 24904, unit: '棟' },
  { k: 'OPENSTREETMAP', zh: '道路網', n: 20972, unit: '段' },
  { k: 'COPERNICUS DEM', zh: '地形 ×1.5', n: 30, unit: 'm 網格' },
  { k: 'LOCAL GLYPHS', zh: '沿街路名', n: 7572, unit: '段' },
];
const LayerStack: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 96, top: 250, display: 'grid', gap: 18 }}>
      {LAYERS.map((l, i) => {
        const p = ramp(f, 20 + i * 12, 22, EASE.snappy);
        const out = ramp(f, 158, 14, EASE.exit);
        return (
          <div key={l.k} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 22px', minWidth: 470, borderRadius: 14,
            background: 'rgba(10,14,19,0.72)', border: `1px solid ${T.line}`, backdropFilter: 'blur(10px)',
            opacity: p * (1 - out), transform: `translateX(${(1 - p) * -60 - out * 40}px)` }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: T.gold, boxShadow: '0 0 0 5px rgba(216,180,90,0.18)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: '0.22em', color: T.ink2 }}>{l.k}</div>
              <div style={{ fontFamily: FONT.sans, fontSize: 26, fontWeight: 600, color: T.ink, marginTop: 2 }}>{l.zh}</div>
            </div>
            <Count to={l.n} at={26 + i * 12} dur={36} size={40} suffix={l.unit} />
          </div>
        );
      })}
    </div>
  );
};

// 停格段右下讀數（有底板，壓在繁忙的城市上也讀得清楚）
const LockReadout: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', right: 96, top: 736, textAlign: 'right', padding: '26px 34px', borderRadius: 18, background: 'rgba(10,14,19,0.78)',
      border: `1px solid ${T.line}`, backdropFilter: 'blur(12px)', opacity: ramp(f, 50, 14, EASE.out), transform: `translateY(${(1 - ramp(f, 50, 20, EASE.snappy)) * 24}px)` }}>
      <SerifLine text="景點綁定建築輪廓" at={56} size={46} per={2} />
      <div style={{ marginTop: 8 }}><Count to={43} at={60} dur={20} size={84} suffix="/ 43 落在建築上" color={T.goldSoft} /></div>
    </div>
  );
};

export const S4Map: React.FC = () => (
  <AbsoluteFill style={{ background: T.bg }}>
    <Sequence from={0} durationInFrames={66}><ChapterCard no="01" title="三維城市底圖" en="3D CITY ATLAS · MAPLIBRE GL" dur={66} plate="gen/plate-city.png" /></Sequence>

    <Sequence from={60} durationInFrames={186}>
      <Footage src={v('map-establish.mp4')} dur={186} startFrom={10} inT={14} outT={12}>
        <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(10,14,19,0.55) 0%, rgba(10,14,19,0) 45%)' }} />
      </Footage>
      <LayerStack />
      <Hud text="MACAU · 3D CITY · LIVE RENDER" at={8} x={96} y={150} color={T.goldSoft} out={170} />
    </Sequence>

    <Sequence from={246} durationInFrames={234}>
      <Footage src={v('map-dive.mp4')} dur={234} startFrom={6} inT={12} outT={0} />
      <Hud text="HISTORIC CENTRE · Z 14 → 17" at={20} x={96} y={88} color={T.goldSoft} out={230} />
      <Caption text="街名沿著道路排列、彼此避讓，用本機字型繪製，離線也能用" from={70} to={236} />
    </Sequence>

    {/* 停格：俯衝最後一幀，相機續推（demo 的 1→1.035 極緩推近），準星咬合市政署大樓 */}
    <Sequence from={480} durationInFrames={96}>
      <Footage src={v('dive-last.jpg')} still dur={96} inT={0} outT={12} push={[1, 1.035]} origin="903px 545px" />
      <Reticle at={0} box={{ x: 838, y: 500, w: 132, h: 86 }} label="市政署大樓" tag="ON FOOTPRINT" />
      <LockReadout />
    </Sequence>

    <Sequence from={576} durationInFrames={144}>
      <Footage src={v('map-orbit-stpaul.mp4')} dur={144} startFrom={30} inT={12} outT={14} />
      <Hud text="RUINS OF ST. PAUL'S · ORBIT" at={10} x={96} y={88} color={T.goldSoft} out={128} />
      <Caption text="24,904 棟建築：7,158 棟實測高度，其餘依樓層或面積推估" from={14} to={134} />
    </Sequence>
  </AbsoluteFill>
);
