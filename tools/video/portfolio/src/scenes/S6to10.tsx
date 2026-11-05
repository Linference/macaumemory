// S6 3DGS · S7 建築檔案 · S8 創新點 · S9 為澳門 · S10 收尾
// 政策引句只用官方原文（DESIGN.md §3），措辭為「呼應」，不暗示官方背書
import React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { PageCam2D } from '../demos/_fixtures/PageCam2D';
import { mix } from '../demos/_fixtures/Polish';
import layout from '../../public/pages/layout.json';
import { Caption, ChapterCard, Count, EASE, FONT, Hud, LotusMark, NightStage, PREMIUM, SerifLine, T, img, ramp } from '../kit';
import { Footage } from './Footage';

const clampI = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const v = (n: string) => staticFile(`footage/${n}`);
const pop = (f: number, a: number, d = 12, k = 1.7) => interpolate(f, [a, a + d], [0, 1], { easing: Easing.out(Easing.back(k)), ...clampI });

/** 引句卡：左側金色豎線 + 襯線逐字 + 下方來源；右側「途見的回應」膠囊 */
const Quote: React.FC<{ at: number; q: string; reply: string; y: number }> = ({ at, q, reply, y }) => {
  const f = useCurrentFrame();
  const bar = ramp(f, at, 18, EASE.snappy);
  return (
    <div style={{ position: 'absolute', left: 150, top: y, width: 1620, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ width: 4, height: 78 * bar, background: T.gold, boxShadow: '0 0 12px rgba(216,180,90,0.7)' }} />
        <SerifLine text={`「${q}」`} at={at + 4} size={50} per={2} weight={500} letter="0.04em" />
      </div>
      <div style={{ transform: `translateX(${(1 - ramp(f, at + 24, 18, EASE.snappy)) * 50}px)`, opacity: ramp(f, at + 24, 14, EASE.out), display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 26px', borderRadius: 999, border: `1px solid ${T.gold}`, background: 'rgba(216,180,90,0.12)', fontFamily: FONT.sans, fontSize: 28, color: T.ink, whiteSpace: 'nowrap' }}>
        <LotusMark size={26} />{reply}
      </div>
    </div>
  );
};

// ═════════ S6 3DGS（600f）═════════
export const S6Splat: React.FC = () => (
  <AbsoluteFill style={{ background: T.bg }}>
    <Sequence from={0} durationInFrames={66}><ChapterCard no="03" title="3DGS 高斯實景" en="3D GAUSSIAN SPLATTING · PLAYCANVAS" dur={66} plate="gen/plate-splat.png" /></Sequence>
    <Sequence from={60} durationInFrames={360}>
      {/* 推近 1.14→1.2：把網頁的操作提示與邊緣浮點推出畫外 */}
      <Footage src={v('splat-orbit.mp4')} dur={360} inT={14} outT={16} push={[1.14, 1.22]} />
      <SplatHud />
    </Sequence>
  </AbsoluteFill>
);
const SplatHud: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <>
      <Hud text="RUINS OF ST. PAUL'S · LIVE 3D GAUSSIAN SPLATTING" at={20} x={96} y={88} color={T.goldSoft} out={290} />
      <div style={{ position: 'absolute', left: 96, top: 760, padding: '22px 30px', borderRadius: 18, background: 'rgba(10,14,19,0.7)', border: `1px solid ${T.line}`, backdropFilter: 'blur(10px)', opacity: ramp(f, 30, 16, EASE.out) * (1 - ramp(f, 286, 16, EASE.exit)) }}>
        <Count to={657492} at={34} dur={60} size={84} suffix="個高斯點" />
        <div style={{ fontFamily: FONT.sans, fontSize: 24, color: T.ink2, marginTop: 8 }}>完整 3 階球諧 · 155 MB 原始 PLY · 瀏覽器即時渲染</div>
      </div>
    </>
  );
};
const PolicySplat: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 150, top: 700 }}>
      <Hud text="呼應 · 澳門特區「三五」規劃（2026–2030）" at={6} x={0} y={0} size={18} color={T.goldSoft} cps={2.2} />
      <div style={{ marginTop: 40 }}><SerifLine text="「推進對大三巴一帶進行保護性更新活化」" at={14} size={58} per={2} weight={500} /></div>
      <div style={{ marginTop: 18, fontFamily: FONT.sans, fontSize: 28, color: T.ink2, opacity: ramp(f, 60, 16, EASE.out) }}>以三維實景為大三巴留下可反覆查看的數字紀錄</div>
      <div style={{ marginTop: 14, fontFamily: FONT.mono, fontSize: 14, letterSpacing: '0.12em', color: T.ink3, opacity: ramp(f, 70, 16, EASE.out) }}>資料：澳門特區政府新聞局，2026-08-18</div>
    </div>
  );
};

// ═════════ S7 建築檔案一鍵直達（420f）：首頁底部入口點擊 → 檔案頁巡航（cursor-flyover 語法）═════════
const Cursor: React.FC<{ x: number; y: number; press?: number }> = ({ x, y, press = 0 }) => (
  <svg width={34} height={40} viewBox="0 0 34 40" style={{ position: 'absolute', left: x, top: y, transform: `scale(${1 - 0.12 * press})`, transformOrigin: '0 0', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }}>
    <path d="M2 2 L2 32 L10 25 L16 38 L22 35 L16 22 L27 22 Z" fill={T.ink} stroke={T.bg} strokeWidth={2} strokeLinejoin="round" />
  </svg>
);
export const S7Archive: React.FC = () => {
  const L = layout.home.archiveLink, A = layout.archive;
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Sequence from={0} durationInFrames={156}><HomeClick L={L} /></Sequence>
      <Sequence from={150} durationInFrames={270}>
        <Footage src="" still dur={270} inT={14} outT={14}>
          <PageCam2D src="pages/archive-full.png" pageH={A.pageH} bg={T.bg} keys={[
            { frame: 0, cx: 960, cy: 540, zoom: 1.0 },
            { frame: 90, cx: 900, cy: 600, zoom: 1.28 },
            { frame: 170, cx: 960, cy: A.ledger.y + 260, zoom: 1.12 },
            { frame: 270, cx: 960, cy: A.ledger.y + 300, zoom: 1.16 },
          ]}>
            <ArchiveCursor A={A} />
          </PageCam2D>
        </Footage>
        <Caption text="32 個記憶點檔案 ＋ 本機普查檔案 · 打開就能看，不必先載入辨識模型" from={30} to={256} y={70} />
      </Sequence>
    </AbsoluteFill>
  );
};
const HomeClick: React.FC<{ L: { x: number; y: number; w: number; h: number } }> = ({ L }) => {
  const f = useCurrentFrame();
  const tx = L.x + L.w / 2, ty = L.y + L.h / 2;
  const fly = ramp(f, 30, 50, Easing.bezier(0.25, 0.1, 0.25, 1));
  const cx = mix(1500, tx, fly), cy = mix(720, ty, fly) - Math.sin(Math.PI * fly) * 120;
  const press = interpolate(f, [86, 89, 96], [0, 1, 0], clampI);
  const ripple = ramp(f, 88, 26, EASE.out);
  const cam = mix(1, 1.18, ramp(f, 40, 110, PREMIUM));
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${cam})`, transformOrigin: `${tx}px ${ty}px` }}>
        <Img src={img('pages/home.png')} style={{ width: 1920, height: 1080 }} />
        <div style={{ position: 'absolute', left: L.x - 6, top: L.y - 4, width: L.w + 12, height: L.h + 8, borderRadius: 999, border: `2px solid ${T.gold}`, opacity: ramp(f, 70, 12, EASE.out), boxShadow: '0 0 18px rgba(216,180,90,0.6)' }} />
        {f >= 88 && <div style={{ position: 'absolute', left: tx - 70 * ripple, top: ty - 70 * ripple, width: 140 * ripple, height: 140 * ripple, borderRadius: '50%', border: `2px solid ${T.gold}`, opacity: 1 - ripple }} />}
        {f >= 30 && <Cursor x={cx - 4} y={cy - 4} press={press} />}
      </AbsoluteFill>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, rgba(10,14,19,0.85) 0%, rgba(10,14,19,0.35) 32%, rgba(10,14,19,0) 55%)' }} />
      <div style={{ position: 'absolute', left: 96, top: 82 }}>
        <Hud text="CHAPTER 04 · ONE CLICK" at={4} x={0} y={0} color={T.goldSoft} />
        <div style={{ marginTop: 34 }}><SerifLine text="建築檔案，一鍵直達" at={8} size={60} per={2} /></div>
        <div style={{ marginTop: 10, fontFamily: FONT.sans, fontSize: 26, color: T.ink2, opacity: ramp(f, 20, 14, EASE.out) }}>全站統一導覽 · 蓮花標誌 · 七個頁面一致</div>
      </div>
    </AbsoluteFill>
  );
};
const ArchiveCursor: React.FC<{ A: typeof layout.archive }> = ({ A }) => {
  const f = useCurrentFrame();
  const c0 = A.cards[1];
  const p1 = ramp(f, 20, 50, EASE.smooth), p2 = ramp(f, 120, 50, EASE.smooth);
  const x = mix(mix(A.tabs.x + 60, c0.x + c0.w / 2, p1), A.ledger.x + 220, p2);
  const y = mix(mix(A.tabs.y + 20, c0.y + 120, p1), A.ledger.y + 220, p2);
  const ring = ramp(f, 76, 22, EASE.out);
  return (
    <>
      <div style={{ position: 'absolute', left: c0.x - 4, top: c0.y - 4, width: c0.w + 8, height: c0.h + 8, borderRadius: 18, border: `2px solid ${T.gold}`, opacity: ramp(f, 70, 10, EASE.out) * (1 - ramp(f, 118, 12, EASE.exit)), boxShadow: '0 0 24px rgba(216,180,90,0.5)' }} />
      {f >= 76 && f < 110 && <div style={{ position: 'absolute', left: x - 50 * ring, top: y - 50 * ring, width: 100 * ring, height: 100 * ring, borderRadius: '50%', border: `2px solid ${T.gold}`, opacity: 1 - ring }} />}
      <Cursor x={x} y={y} />
    </>
  );
};

// ═════════ S8 創新點（540f）：技術詞穿越（flying-words）→ 三項創新 ═════════
const WORDS = ['MapLibre GL', 'three.js', 'PlayCanvas', '3D Gaussian Splatting', 'DINOv2', 'YOLO11', 'ONNX Runtime Web', 'WebAssembly', 'SQLite WASM', 'R-Tree',
  'OPFS', 'Web Worker', 'Overture Maps', 'OpenStreetMap', 'Copernicus DEM', '本機字型繪製', 'Vite', 'node:test', 'Wilson 區間', 'McNemar', 'Geolocation', 'TinySDF'];
const FlyingWords: React.FC = () => {
  const f = useCurrentFrame();
  const N = WORDS.length, CYCLE = 100, GOLD = Math.PI * (3 - Math.sqrt(5));
  const life = (u: number) => interpolate(u, [0, 0.15, 0.7, 0.88, 1], [0, 1, 0.5, 0.2, 0], clampI);
  const items = WORDS.map((w, i) => {
    const phase = (i / N) * CYCLE;
    const u = (((f + phase) % CYCLE) + CYCLE) % CYCLE / CYCLE; // 0 遠 → 1 擦過鏡頭
    const z = mix(-2600, 520, u);
    const a = i * GOLD, r = 260 + (i % 5) * 70;
    return { w, x: Math.cos(a) * r * 1.6, y: Math.sin(a) * r * 0.8, z, o: life(u) * ramp(f, 0, 20, EASE.out) * (1 - ramp(f, 124, 22, EASE.exit)), gold: i % 4 === 0 };
  }).sort((p, q) => p.z - q.z);
  return (
    <AbsoluteFill style={{ perspective: 900, perspectiveOrigin: '50% 50%', overflow: 'hidden' }}>
      {items.map((it) => (
        <div key={it.w} style={{ position: 'absolute', left: 960, top: 540, transform: `translate3d(${it.x}px, ${it.y}px, ${it.z}px) translate(-50%, -50%)`, opacity: it.o,
          fontFamily: it.gold ? FONT.serif : FONT.sans, fontSize: 64, fontWeight: it.gold ? 600 : 500, color: it.gold ? T.goldSoft : T.ink, whiteSpace: 'nowrap', textShadow: '0 0 30px rgba(0,0,0,0.6)' }}>{it.w}</div>
      ))}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: ramp(f, 20, 20, EASE.out) * (1 - ramp(f, 126, 20, EASE.exit)) }}>
        <div style={{ padding: '18px 40px', borderRadius: 999, background: 'rgba(10,14,19,0.75)', border: `1px solid ${T.gold}`, fontFamily: FONT.serif, fontSize: 52, color: T.ink, letterSpacing: '0.12em' }}>全部在瀏覽器裡運行</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
const INNOV = [
  { n: '01', t: '地理感知多視角識別', en: 'GMVR', d: ['照片、位置、多個角度共同確認', '位置只降權，不把歧義升級', '不確定就交給人工'] },
  { n: '02', t: '從景點到普通建築', en: 'EVERYDAY ARCHIVE', d: ['人工定位、永久編號', '空間查重，避免重複建檔', '景點綁定建築輪廓'] },
  { n: '03', t: '端側運行、離線可用', en: 'ON-DEVICE', d: ['AI 推理在瀏覽器完成', '照片不必上傳', '三維地圖與 3DGS 實景'] },
];
const Innovations: React.FC = () => {
  const f = useCurrentFrame();
  const active = f < 120 ? 0 : f < 210 ? 1 : 2;
  return (
    <NightStage glow={{ x: 0.5, y: 0.35, a: 0.1 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 96, display: 'flex', justifyContent: 'center' }}><SerifLine text="三項創新" at={4} size={72} per={6} letter="0.3em" /></div>
      <div style={{ position: 'absolute', left: 150, right: 150, top: 290, display: 'flex', gap: 40 }}>
        {INNOV.map((c, i) => {
          const p = ramp(f, 14 + i * 10, 30, EASE.overshoot);
          const on = f >= 40 + i * 90 ? 1 : 0;
          const lit = ramp(f, 40 + i * 90, 16, EASE.out) * (active === i || f > 300 ? 1 : 0.35);
          return (
            <div key={c.n} style={{ flex: 1, height: 560, borderRadius: 24, padding: '44px 40px', background: 'linear-gradient(180deg, #17212c 0%, #101720 100%)',
              border: `1.5px solid ${on && (active === i || f > 300) ? T.gold : 'rgba(255,255,255,0.08)'}`, transform: `translateY(${(1 - p) * 80}px) scale(${1 + 0.03 * (active === i && f <= 300 ? 1 : 0)})`, opacity: Math.min(1, p * 2),
              boxShadow: active === i && f <= 300 ? '0 30px 80px -20px rgba(216,180,90,0.35)' : '0 20px 50px -20px rgba(0,0,0,0.7)' }}>
              <div style={{ fontFamily: FONT.serif, fontSize: 96, fontWeight: 300, color: 'transparent', WebkitTextStroke: `1.5px ${T.gold}`, lineHeight: 1 }}>{c.n}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.22em', color: T.goldSoft, marginTop: 26 }}>{c.en}</div>
              <div style={{ fontFamily: FONT.serif, fontSize: 44, fontWeight: 600, color: T.ink, marginTop: 12 }}>{c.t}</div>
              <div style={{ marginTop: 30, display: 'grid', gap: 16 }}>
                {c.d.map((d, k) => (
                  <div key={d} style={{ display: 'flex', gap: 14, alignItems: 'center', fontFamily: FONT.sans, fontSize: 27, color: T.ink2, opacity: ramp(f, 44 + i * 90 + k * 8, 14, EASE.out) * (0.4 + 0.6 * lit) }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: T.gold, flex: 'none' }} />{d}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </NightStage>
  );
};
export const S8Innovation: React.FC = () => (
  <AbsoluteFill style={{ background: T.bg }}>
    <Sequence from={0} durationInFrames={150}><NightStage glow={{ x: 0.5, y: 0.5, a: 0.12 }}><FlyingWords /></NightStage></Sequence>
    <Sequence from={140} durationInFrames={310}><Innovations /></Sequence>
  </AbsoluteFill>
);

// ═════════ S9 為澳門（720f）：「1+4」→ 三五規劃原文引句 → 我們的意義 ═════════
const OnePlusFour: React.FC = () => {
  const f = useCurrentFrame();
  const C = { x: 620, y: 600 };
  const sats = [
    { zh: '大健康', a: -150, on: false }, { zh: '現代金融', a: -30, on: false },
    { zh: '高新技術', a: 150, on: true }, { zh: '會展商貿和文化體育', a: 30, on: true },
  ];
  const R = 330;
  return (
    <NightStage glow={{ x: 0.32, y: 0.55, a: 0.12 }}>
      <div style={{ position: 'absolute', left: 96, top: 82 }}>
        <Hud text="ECONOMIC DIVERSIFICATION · 2024–2028" at={2} x={0} y={0} color={T.goldSoft} />
        <div style={{ marginTop: 34 }}><SerifLine text="對接「1+4」適度多元發展" at={6} size={58} per={2} /></div>
      </div>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {sats.map((s, i) => {
          const x = C.x + Math.cos((s.a * Math.PI) / 180) * R, y = C.y + Math.sin((s.a * Math.PI) / 180) * R * 0.72;
          const d = ramp(f, 30 + i * 8, 24, EASE.snappy);
          return <line key={s.zh} x1={C.x} y1={C.y} x2={mix(C.x, x, d)} y2={mix(C.y, y, d)} stroke={s.on ? T.gold : 'rgba(165,175,187,0.3)'} strokeWidth={s.on ? 2.5 : 1.5} strokeDasharray={s.on ? '0' : '4 6'} />;
        })}
      </svg>
      <div style={{ position: 'absolute', left: C.x - 130, top: C.y - 130, width: 260, height: 260, borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(circle, rgba(216,180,90,0.3) 0%, rgba(216,180,90,0.08) 70%)', border: `2px solid ${T.gold}`, transform: `scale(${pop(f, 10, 16)})`, boxShadow: '0 0 60px rgba(216,180,90,0.35)' }}>
        <div style={{ fontFamily: FONT.serif, fontSize: 96, color: T.goldSoft, lineHeight: 1 }}>1</div>
        <div style={{ fontFamily: FONT.sans, fontSize: 26, color: T.ink, marginTop: 8 }}>綜合旅遊休閒</div>
      </div>
      {sats.map((s, i) => {
        const x = C.x + Math.cos((s.a * Math.PI) / 180) * R, y = C.y + Math.sin((s.a * Math.PI) / 180) * R * 0.72;
        return (
          <div key={s.zh} style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${pop(f, 44 + i * 8)})`, padding: '14px 22px', borderRadius: 999, whiteSpace: 'nowrap',
            border: `1.5px solid ${s.on ? T.gold : 'rgba(165,175,187,0.3)'}`, background: s.on ? 'rgba(216,180,90,0.14)' : 'rgba(23,33,44,0.8)', fontFamily: FONT.sans, fontSize: 26, color: s.on ? T.ink : T.ink3 }}>{s.zh}</div>
        );
      })}
      <div style={{ position: 'absolute', left: 1160, top: 380, width: 660, display: 'grid', gap: 30 }}>
        {[['綜合旅遊休閒', '帶遊客從景點走進街巷，看見普通建築的故事'], ['文化體育', '記錄唐樓、騎樓、街市與在地聲音'], ['高新技術', '瀏覽器端 AI 識別、三維地圖與 3DGS 實景']].map(([k, d], i) => (
          <div key={k} style={{ opacity: ramp(f, 90 + i * 22, 16, EASE.out), transform: `translateX(${(1 - ramp(f, 90 + i * 22, 20, EASE.snappy)) * 40}px)` }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.2em', color: T.goldSoft }}>{k}</div>
            <div style={{ fontFamily: FONT.serif, fontSize: 36, color: T.ink, marginTop: 6, lineHeight: 1.4 }}>{d}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 96, top: 990, fontFamily: FONT.mono, fontSize: 14, letterSpacing: '0.12em', color: T.ink3, opacity: ramp(f, 60, 16, EASE.out) }}>資料：《澳門特別行政區經濟適度多元發展規劃（2024–2028年）》</div>
    </NightStage>
  );
};
const FivePlan: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: T.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${1.1 - 0.06 * ramp(f, 0, 240, EASE.smooth)})`, opacity: 0.32 }}>
        <Img src={img('gen/calcada-2.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(10,14,19,0.8) 0%, rgba(10,14,19,0.55) 50%, rgba(10,14,19,0.9) 100%)' }} />
      <div style={{ position: 'absolute', left: 150, top: 96 }}>
        <Hud text="MACAO SAR · THIRD FIVE-YEAR PLAN · 2026–2030" at={2} x={0} y={0} color={T.goldSoft} />
        <div style={{ marginTop: 34 }}><SerifLine text="呼應澳門「三五」規劃" at={6} size={58} per={2} /></div>
      </div>
      <Quote at={30} q="文化澳門" reply="為普通建築建立記憶檔案" y={360} />
      <Quote at={84} q="建設美麗智慧澳門" reply="三維地圖 · 端側 AI 識別" y={520} />
      <Quote at={138} q="打造中西文明交流互鑒的重要窗口" reply="中葡建築的實拍與故事" y={680} />
      <div style={{ position: 'absolute', left: 150, top: 990, fontFamily: FONT.mono, fontSize: 14, letterSpacing: '0.12em', color: T.ink3, opacity: ramp(f, 40, 16, EASE.out) }}>資料：《澳門特別行政區經濟和社會發展第三個五年規劃（2026–2030年）》，政府新聞局 2026-08-18 公布</div>
    </AbsoluteFill>
  );
};
const Meaning: React.FC = () => {
  const f = useCurrentFrame();
  const lines = ['為城市留下可查證的記憶', '帶遊客從景點走進街巷', '讓每一棟普通建築，都有自己的檔案'];
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Footage src={v('map-cotai.mp4')} dur={180} inT={16} outT={16} push={[1.05, 1.1]}>
        <AbsoluteFill style={{ background: 'rgba(10,14,19,0.72)' }} />
      </Footage>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34 }}>
        <Hud text="WHY IT MATTERS" at={4} x={960} y={250} align="center" color={T.goldSoft} />
        {lines.map((l, i) => <SerifLine key={l} text={l} at={16 + i * 30} size={i === 2 ? 64 : 56} per={2} color={i === 2 ? T.goldSoft : T.ink} />)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
export const S9Macau: React.FC = () => (
  <AbsoluteFill style={{ background: T.bg }}>
    <Sequence from={0} durationInFrames={66}><ChapterCard no="05" title="為澳門" en="FOR MACAU · 1+4 · THIRD FIVE-YEAR PLAN" dur={66} /></Sequence>
    <Sequence from={60} durationInFrames={250}><OnePlusFour /></Sequence>
    <Sequence from={300} durationInFrames={250}><FivePlan /></Sequence>
    <Sequence from={540} durationInFrames={180}><Meaning /></Sequence>
  </AbsoluteFill>
);

// ═════════ S10 收尾（690f）：元素從四面飛來圍住字標（outro launch 語法）→ 字標 hold → 授權字幕 → 淡出 ═════════
const ORBIT = [
  { s: 'photos/ruins-st-paul-249559aa87d9.webp', x: -620, y: -250, r: -8 }, { s: 'photos/red-market-f1bf06a963c7.webp', x: 640, y: -260, r: 7 },
  { s: 'photos/a-ma-temple-33849fa41382.webp', x: -700, y: 160, r: 6 }, { s: 'photos/lai-chi-vun-b9d94b3eaa4e.webp', x: 700, y: 170, r: -6 },
  { s: 'footage/dive-last.jpg', x: -330, y: -330, r: -4 }, { s: 'footage/splat-last.jpg', x: 330, y: -330, r: 4 },
  { s: 'pages/home.png', x: -360, y: 330, r: 3 }, { s: 'photos/taipa-houses-363353f7c75e.webp', x: 360, y: 330, r: -3 },
];
export const S10Finale: React.FC = () => {
  const f = useCurrentFrame();
  const away = ramp(f, 210, 46, EASE.exit);
  const crane = mix(60, 0, ramp(f, 0, 140, PREMIUM));
  const markP = ramp(f, 120, 60, Easing.bezier(0.5, 0, 0.3, 1));
  const out = ramp(f, 482, 28, EASE.smooth);
  const credit = ramp(f, 300, 20, EASE.out);
  return (
    <NightStage glow={{ x: 0.5, y: 0.45, a: 0.14 + 0.1 * markP }}>
      <AbsoluteFill style={{ transform: `translateY(${crane}px)` }}>
        {ORBIT.map((o, i) => {
          const p = ramp(f, 8 + i * 6, 46, EASE.overshoot);
          const from = { x: o.x * 2.4, y: o.y * 2.4 };
          const fl = Math.sin((f + i * 20) / 30) * 6;
          const x = mix(from.x, o.x, p) * (1 + away * 1.6), y = mix(from.y, o.y, p) * (1 + away * 1.6) + fl;
          return (
            <div key={o.s} style={{ position: 'absolute', left: 960 + x - 160, top: 540 + y - 100, width: 320, height: 200, borderRadius: 14, overflow: 'hidden', opacity: Math.min(1, p * 2) * (1 - away),
              transform: `rotate(${o.r * (1 - 0.4 * p)}deg) scale(${0.9 + 0.1 * p})`, boxShadow: '0 30px 60px -20px rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.12)', filter: `blur(${away * 6}px)` }}>
              <Img src={img(o.s)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', opacity: 1 - out }}>
        <div style={{ position: 'absolute', top: 300, filter: `drop-shadow(0 0 ${14 + 16 * markP}px rgba(216,180,90,0.5))` }}><LotusMark size={150} petals={markP} dot={ramp(f, 176, 12, EASE.overshoot)} /></div>
        <div style={{ position: 'absolute', top: 480 }}><SerifLine text="途 見" at={170} size={110} per={6} letter="0.14em" /></div>
        <div style={{ position: 'absolute', top: 630 }}><Hud text="T U J I A N" at={190} x={0} y={0} align="center" size={30} color={T.ink} cps={0.9} /></div>
        <div style={{ position: 'absolute', top: 700 }}><SerifLine text="看見一座城，留下每一處記憶" at={230} size={36} per={2} weight={400} color={T.ink2} letter="0.24em" /></div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 64, textAlign: 'center', fontFamily: FONT.sans, fontSize: 17, lineHeight: 1.9, color: T.ink3, opacity: credit * (1 - out) }}>
        照片：Wikimedia Commons 貢獻者（Ank Kumar、Abasaa、yeowatzup、Kounosu、WiNG、Jssfrk 等；CC BY / BY-SA / CC0 / 公有領域）<br />
        地圖：OpenStreetMap 貢獻者 · Overture Maps · Copernicus DEM GLO-30　｜　碎石紋質感底景：即夢 AI 生成　｜　音樂與音效：Mixkit（免費授權）
      </div>
    </NightStage>
  );
};
