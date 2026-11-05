// S5 GMVR（840f）：章節卡 02 → ①偵測（scan-bracket-sweep）→ ②特徵（value-stagger-gradient，真實 DINOv2 向量）
// → ③比對（Top-3 行用 row-embed 的落位物理，真實留一法相似度）→ ④位置 → ⑤多照片 → ⑥建檔 → 準確率
// 所有數字取自專案資料（src/data/query.json 由 public/data/memory-embeddings.json 算出）；照片為 Wikimedia CC BY-SA 4.0（Ank Kumar）
import React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, useCurrentFrame } from 'remotion';
import Q from '../data/query.json';
import { ChapterCard, Count, EASE, FONT, Hud, NightStage, SerifLine, T, img, ramp } from '../kit';
import { mix } from '../demos/_fixtures/Polish';

export const S5_DURATION = 840;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (t: number, a: number, b: number, e: (x: number) => number = (x) => x) => e(clamp01((t - a) / (b - a)));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const inOutSin = (x: number) => 0.5 - Math.cos(Math.PI * clamp01(x)) / 2;
const clampI = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

/** 步驟標頭：序號 + 標題 + 說明（左上，全段一致的版式） */
const StepHead: React.FC<{ n: string; title: string; sub: string; dur: number }> = ({ n, title, sub, dur }) => {
  const f = useCurrentFrame();
  const out = ramp(f, dur - 12, 12, EASE.exit);
  return (
    <div style={{ position: 'absolute', left: 96, top: 82, opacity: 1 - out }}>
      <Hud text={`STEP ${n} · GMVR`} at={2} x={0} y={0} color={T.goldSoft} size={15} />
      <div style={{ marginTop: 34 }}><SerifLine text={title} at={6} size={52} per={2} /></div>
      <div style={{ marginTop: 10, fontFamily: FONT.sans, fontSize: 24, color: T.ink2, letterSpacing: '0.04em', opacity: ramp(f, 16, 14, EASE.out) }}>{sub}</div>
    </div>
  );
};

// ───────── ① 偵測：scan-bracket-sweep（括號交錯過冲落位、5 趟往復掃描、拖尾隨速度伸縮）＋ YOLO 框 ─────────
const SCAN_D = 130, PASSES = 5;
const PW = 480, PH = 720, PX = 740, PY = 210; // 照片卡（直幅 1067×1600 → 480×720）
const scanAt = (t: number) => {
  const sp = seg(t, 0.17, 0.95);
  const raw = sp * PASSES;
  const pi = Math.min(PASSES - 1, Math.floor(raw));
  const local = clamp01((raw - pi) / 0.88);
  const dir = pi % 2 === 0 ? 1 : -1;
  const prog = inOutSin(local);
  return { y: dir > 0 ? prog * PH : PH - prog * PH, dir };
};
const ScanShot: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / (SCAN_D - 1), dt = 1 / (SCAN_D - 1);
  const dp = seg(t, 0, 0.11, EASE.snappy);
  const { y, dir } = scanAt(t);
  const speed = Math.abs(scanAt(t + dt / 2).y - scanAt(t - dt / 2).y);
  const PEAK = (PH * Math.PI) / 2 / (((0.78 * SCAN_D) / PASSES) * 0.88);
  const tail = 150 * Math.pow(clamp01(speed / PEAK), 0.75);
  const clipOp = seg(t, 0.16, 0.2) * (1 - seg(t, 0.93, 0.99));
  // YOLO 框：掃描結束後描出（130→148），類別標籤彈出
  const box = { x: 128, y: 58, w: 214, h: 178 };
  const draw = ramp(f, 128, 20, EASE.snappy);
  const tag = interpolate(f, [144, 154], [0, 1], { easing: Easing.out(Easing.back(1.8)), ...clampI });
  const CS = 58;
  const corners = [
    { left: -13, top: -13, d: `M1 ${CS - 1}V1h${CS - 2}`, dx: 1, dy: 1 }, { left: PW + 13 - CS, top: -13, d: `M1 1h${CS - 2}v${CS - 2}`, dx: -1, dy: 1 },
    { left: PW + 13 - CS, top: PH + 13 - CS, d: `M${CS - 1} 1v${CS - 2}H1`, dx: -1, dy: -1 }, { left: -13, top: PH + 13 - CS, d: `M${CS - 1} ${CS - 1}H1V1`, dx: 1, dy: -1 },
  ];
  return (
    <NightStage glow={{ x: 0.36, y: 0.5, a: 0.1 }}>
      <StepHead n="01" title="找出建築區域" sub="YOLO11s · 11 類澳門建築 · 瀏覽器內推理" dur={160} />
      <div style={{ position: 'absolute', left: PX, top: PY, width: PW, height: PH, transform: `scale(${mix(0.9, 1, dp)})`, opacity: Math.min(1, dp * 3) }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 14, overflow: 'hidden', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.8)' }}>
          <Img src={img('photos/q-stpaul-01.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {/* 掃描光帶：金色細芯 + 柔輝 + 朝來向的拖尾（screen 疊在照片上） */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 0, transform: `translateY(${y}px)`, opacity: clipOp }}>
            <div style={{ position: 'absolute', left: 0, right: 0, height: tail, top: dir > 0 ? -tail : 0, mixBlendMode: 'screen',
              background: `linear-gradient(${dir > 0 ? 180 : 0}deg, rgba(216,180,90,0) 0%, rgba(216,180,90,0.10) 55%, rgba(232,200,120,0.32) 100%)` }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: -8, height: 16, background: 'linear-gradient(180deg, rgba(255,214,140,0) 0%, rgba(255,214,140,0.4) 50%, rgba(255,214,140,0) 100%)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 2, background: 'linear-gradient(90deg, rgba(216,180,90,0.5), #fff1cf 50%, rgba(216,180,90,0.5))', boxShadow: '0 0 6px rgba(255,214,140,0.9)' }} />
          </div>
          {/* YOLO 偵測框 */}
          {draw > 0 && (
            <svg width={PW} height={PH} style={{ position: 'absolute', inset: 0 }}>
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} fill="rgba(216,180,90,0.08)" stroke={T.gold} strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
            </svg>
          )}
        </div>
        {tag > 0 && (
          <div style={{ position: 'absolute', left: box.x, top: box.y - 52, transform: `scale(${tag})`, transformOrigin: '0 100%', display: 'flex', gap: 10, alignItems: 'center',
            padding: '7px 13px', borderRadius: 9, background: T.gold, color: T.bg, fontFamily: FONT.sans, fontSize: 22, fontWeight: 700, whiteSpace: 'nowrap' }}>
            牌坊與紀念物<span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 600, opacity: 0.7 }}>YOLO11s</span>
          </div>
        )}
        {corners.map((c, i) => {
          const t0 = 0.08 + i * 0.022;
          const a = seg(t, t0, t0 + 0.03);
          const p = EASE.overshoot(clamp01((t - t0) / 0.055));
          const off = (1 - p) * 13;
          return (
            <svg key={i} width={CS} height={CS} style={{ position: 'absolute', left: c.left, top: c.top, overflow: 'visible', opacity: a, transform: `translate(${-off * c.dx}px,${-off * c.dy}px)` }}>
              <path d={c.d} fill="none" stroke={T.goldSoft} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 1300, top: 470, width: 560, fontFamily: FONT.sans, fontSize: 26, lineHeight: 1.7, color: T.ink2, opacity: ramp(f, 40, 16, EASE.out) }}>
        先判斷照片裡<span style={{ color: T.ink }}>哪裡是建築</span>、屬於哪一類，<br />再把這個區域交給下一步比對。
      </div>
      <Hud text="Ruins of Saint Paul's · Ank Kumar · CC BY-SA 4.0" at={30} x={PX} y={PY + PH + 24} size={12} color={T.ink3} cps={3} />
    </NightStage>
  );
};

// ───────── ② 特徵：value-stagger-gradient（時間錯峰 × 數值梯度；第二拍以中心為原點脈衝）＋ 真實向量前 64 維 ─────────
const FEAT_D = 140, NB = 64, BASE = 600, BX0 = 560, BX1 = 1800;
const FeatureShot: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / (FEAT_D - 1);
  const sv = (i: number, a: number, b: number) => a + (b - a) * (i / (NB - 1));
  const C = (NB - 1) / 2;
  const sw = seg(t, 0.52 - 0.018, 0.52 + 0.022, EASE.smooth);
  const capIn = seg(t, 0.03, 0.12, EASE.out);
  const step = (BX1 - BX0) / NB;
  return (
    <NightStage glow={{ x: 0.62, y: 0.6, a: 0.12 }}>
      <StepHead n="02" title="把照片變成 384 維特徵" sub="DINOv2 ViT-S/14 · 336 px · L2 正規化" dur={FEAT_D} />
      <div style={{ position: 'absolute', left: 120, top: 400, width: 300, height: 250, borderRadius: 12, overflow: 'hidden', border: `1.5px solid ${T.gold}`, opacity: ramp(f, 0, 14, EASE.out) }}>
        <Img src={img('photos/q-stpaul-01.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 12%' }} />
      </div>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <path d={`M 430 525 C 480 525, 500 ${BASE}, ${BX0 - 14} ${BASE}`} fill="none" stroke={T.gold} strokeWidth={1.5} strokeDasharray="4 6" opacity={ramp(f, 6, 20, EASE.out) * 0.7} />
        <line x1={BX0 - 10} x2={BX1} y1={BASE} y2={BASE} stroke="rgba(236,230,218,0.15)" />
      </svg>
      {Q.vec.map((v: number, i: number) => {
        const d = i * 0.0055;
        const e = seg(t, 0.06 + d, 0.28 + d, outCubic);
        const distC = Math.abs(i - C) / C;
        const w = seg(t, 0.56 + distC * 0.13, 0.74 + distC * 0.13);
        const pulse = Math.sin(w * Math.PI);
        const amp = mix(0.42, 0.06, distC);
        const h = Math.abs(v) * 2600 * e * (1 + pulse * amp);
        const hue = sv(i, 42, 196); // 金 → 冰藍
        const blur = (1 - e) * sv(i, 12, 3);
        const y0 = sv(i, 70, 22);
        const up = v >= 0;
        return (
          <div key={i} style={{ position: 'absolute', left: BX0 + i * step, width: step * 0.62, top: up ? BASE - h : BASE, height: h, borderRadius: 3, opacity: e,
            background: `linear-gradient(${up ? 180 : 0}deg, hsl(${hue},70%,72%) 0%, hsl(${hue},62%,52%) 100%)`,
            boxShadow: `0 0 10px hsla(${hue},80%,60%,${(0.15 + pulse * 0.25).toFixed(3)})`,
            filter: `${blur > 0.05 ? `blur(${blur.toFixed(2)}px) ` : ''}brightness(${(1 + pulse * 0.5).toFixed(3)})`,
            transform: `translateY(${((1 - e) * y0 * (up ? 1 : -1)).toFixed(2)}px)` }} />
        );
      })}
      {/* 代碼條：兩拍之間上下交叉換句 */}
      <div style={{ position: 'absolute', left: BX0, width: BX1 - BX0, top: 860, height: 64, borderRadius: 14, overflow: 'hidden', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', opacity: capIn, fontFamily: FONT.mono, fontSize: 26 }}>
        {[['dino(photo)', '  →  ', 'float32[384]', '   ‖v‖ = 1'], ['cosine(query, 335 refs)', '  →  ', '每棟取最高分', '']].map((toks, k) => (
          <div key={k} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'pre',
            opacity: k ? sw : 1 - sw, transform: `translateY(${(k ? 1 - sw : -sw) * 22}px)` }}>
            <span style={{ color: '#e8d29a' }}>{toks[0]}</span><span style={{ color: T.ink3 }}>{toks[1]}</span><span style={{ color: '#9fd3ea' }}>{toks[2]}</span><span style={{ color: T.ink3 }}>{toks[3]}</span>
          </div>
        ))}
      </div>
      <Hud text={`SHOWING DIMS 0–63 OF ${Q.dim}`} at={20} x={BX1} y={310} align="right" size={13} color={T.ink3} cps={3} />
    </NightStage>
  );
};

// ───────── ③ 比對：Top-3 行（row-embed 落位物理：perspective 下降 + rotateX 收平 + 嵌入瞬間金縫）─────────
const CUES = [10, 20, 29], FLY = 12;
const FLY_EASE = Easing.bezier(0.5, 0, 0.8, 0.75);
const SX0 = 760, SW = 900; // 相似度刻度 0→1
const Top3Shot: React.FC = () => {
  const f = useCurrentFrame();
  const verdict = interpolate(f, [62, 74], [0, 1], { easing: Easing.out(Easing.back(1.6)), ...clampI });
  const th = ramp(f, 40, 20, EASE.out);
  const margin = (Q.top3[0].sim - Q.top3[1].sim).toFixed(3);
  return (
    <NightStage glow={{ x: 0.55, y: 0.5, a: 0.08 }}>
      <StepHead n="03" title="與參考照片比對" sub={`${Q.loo.b} 棟 · ${Q.loo.n} 張參考照片 · 每棟取最高相似度`} dur={130} />
      {[{ v: Q.thresholds.maybe, zh: '需人工確認' }, { v: Q.thresholds.hit, zh: '高度相似' }].map((m) => (
        <div key={m.v} style={{ position: 'absolute', left: SX0 + SW * m.v, top: 360, height: 430, borderLeft: `1.5px dashed ${m.v > 0.7 ? T.gold : T.ink3}`, opacity: th }}>
          <div style={{ position: 'absolute', top: -34, left: -110, width: 220, textAlign: 'center', whiteSpace: 'nowrap', fontFamily: FONT.mono, fontSize: 14, letterSpacing: '0.1em', color: m.v > 0.7 ? T.goldSoft : T.ink2 }}>{m.v.toFixed(2)} {m.zh}</div>
        </div>
      ))}
      {Q.top3.map((r: { zh: string; sim: number }, i: number) => {
        const cue = CUES[i], land = cue + FLY;
        const air = 1 - interpolate(f, [cue, land], [0, 1], { easing: FLY_EASE, ...clampI });
        const press = interpolate(f, [land, land + 3, land + 9], [1, 0.985, 1], clampI);
        const seamW = interpolate(f, [land, land + 6], [0, 1], { easing: Easing.out(Easing.cubic), ...clampI });
        const seamO = interpolate(f, [land, land + 2, land + 8], [1, 1, 0], clampI);
        const bar = ramp(f, land, 26, EASE.snappy);
        const y = 380 + i * 130;
        const top1 = i === 0;
        if (f < cue) return null;
        return (
          <div key={r.zh} style={{ position: 'absolute', left: 160, top: y, width: 1600, height: 104, borderRadius: 16, background: top1 ? 'rgba(216,180,90,0.10)' : 'rgba(23,33,44,0.85)',
            border: `1px solid ${top1 ? T.gold : 'rgba(255,255,255,0.08)'}`, transform: `perspective(900px) translateY(${-120 * air}px) rotateX(${16 * air}deg) scale(${press})`, opacity: Math.min(1, (1 - air) * 3) }}>
            <div style={{ position: 'absolute', left: 30, top: 0, height: 104, display: 'flex', alignItems: 'center', gap: 20 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 22, color: top1 ? T.gold : T.ink3 }}>0{i + 1}</span>
              <span style={{ fontFamily: FONT.serif, fontSize: 38, fontWeight: 600, color: top1 ? T.ink : T.ink2 }}>{r.zh}</span>
            </div>
            <div style={{ position: 'absolute', left: SX0 - 160, top: 46, width: SW, height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.06)' }}>
              <div style={{ width: `${r.sim * 100 * bar}%`, height: '100%', borderRadius: 6, background: top1 ? `linear-gradient(90deg, ${T.gold}, #f3dc9c)` : 'rgba(165,175,187,0.55)' }} />
            </div>
            <div style={{ position: 'absolute', right: 30, top: 0, height: 104, display: 'flex', alignItems: 'center', fontFamily: FONT.serif, fontSize: 40, color: top1 ? T.goldSoft : T.ink2, fontVariantNumeric: 'tabular-nums' }}>{(r.sim * bar).toFixed(3)}</div>
            <div style={{ position: 'absolute', left: (1600 - 1600 * seamW) / 2, width: 1600 * seamW, bottom: -1, height: 2, borderRadius: 1, background: T.gold, opacity: seamO, boxShadow: '0 0 10px rgba(216,180,90,0.9)' }} />
          </div>
        );
      })}
      {verdict > 0 && (
        <div style={{ position: 'absolute', left: 160, top: 790, transform: `scale(${verdict})`, transformOrigin: '0 50%', display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderRadius: 14, background: T.gold, color: T.bg, fontFamily: FONT.sans, fontSize: 30, fontWeight: 700 }}>
          很可能就是這一棟<span style={{ fontFamily: FONT.mono, fontSize: 20, fontWeight: 600 }}>領先第二名 {margin}</span>
        </div>
      )}
      <Hud text="LEAVE-ONE-OUT QUERY · REAL SCORES FROM THE LIBRARY" at={30} x={1760} y={800} align="right" size={12} color={T.ink3} cps={3} />
    </NightStage>
  );
};

// ───────── ④ 位置：雷達圈（GPS 精度圈）＋ 規則膠囊逐顆彈出 ─────────
const GeoShot: React.FC = () => {
  const f = useCurrentFrame();
  const cx = 700, cy = 610;
  const rules = ['定位精度 ≤ 100 m', '讀數在 5 分鐘內', '距離只降權，最多 0.08', '不會把有歧義的結果升級'];
  const pins = [{ zh: '大三巴牌坊', d: 0.28, a: -40, gold: true }, { zh: '玫瑰堂', d: 1.55, a: 200, gold: false }, { zh: '聖若瑟修院', d: 1.85, a: 120, gold: false }];
  return (
    <NightStage glow={{ x: 0.36, y: 0.56, a: 0.1 }}>
      <StepHead n="04" title="位置只作輔助" sub="使用者確認照片位置後才啟用；不能取代影像判斷" dur={110} />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {[1, 2, 3].map((k) => {
          const p = ramp(f, 4 + k * 5, 30, EASE.snappy);
          return <circle key={k} cx={cx} cy={cy} r={k * 120 * p} fill="none" stroke={k === 1 ? T.gold : 'rgba(236,230,218,0.14)'} strokeWidth={k === 1 ? 2 : 1} strokeDasharray={k === 1 ? '0' : '3 7'} />;
        })}
        {[0, 1].map((k) => { const w = ((f + k * 30) % 60) / 60; return <circle key={`w${k}`} cx={cx} cy={cy} r={20 + w * 110} fill="none" stroke={T.gold} opacity={(1 - w) * 0.5 * ramp(f, 10, 10, EASE.out)} />; })}
        <circle cx={cx} cy={cy} r={9} fill={T.ice} stroke="#fff" strokeWidth={2} opacity={ramp(f, 2, 8, EASE.out)} />
      </svg>
      <div style={{ position: 'absolute', left: cx + 18, top: cy + 14, fontFamily: FONT.mono, fontSize: 15, color: T.ice, letterSpacing: '0.1em', opacity: ramp(f, 14, 10, EASE.out) }}>GPS ±8 m</div>
      <div style={{ position: 'absolute', left: cx - 60, top: cy - 152, fontFamily: FONT.mono, fontSize: 14, color: T.goldSoft, letterSpacing: '0.14em', opacity: ramp(f, 24, 10, EASE.out) }}>≤ 100 m</div>
      {pins.map((p, i) => {
        const o = ramp(f, 22 + i * 6, 14, EASE.overshoot);
        const x = cx + Math.cos((p.a * Math.PI) / 180) * p.d * 120, y = cy + Math.sin((p.a * Math.PI) / 180) * p.d * 120;
        return (
          <div key={p.zh} style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, -100%) scale(${o})`, opacity: p.gold ? 1 : 0.55, textAlign: 'center' }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 20, fontWeight: 600, color: p.gold ? T.bg : T.ink, background: p.gold ? T.gold : 'rgba(23,33,44,0.9)', padding: '4px 10px', borderRadius: 8, whiteSpace: 'nowrap' }}>{p.zh}</div>
            <div style={{ width: 2, height: 16, margin: '0 auto', background: p.gold ? T.gold : T.ink3 }} />
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 1180, top: 400, display: 'grid', gap: 18 }}>
        {rules.map((r, i) => {
          const p = interpolate(f, [30 + i * 9, 42 + i * 9], [0, 1], { easing: Easing.out(Easing.back(1.5)), ...clampI });
          return (
            <div key={r} style={{ transform: `translateX(${(1 - p) * 40}px) scale(${0.9 + 0.1 * p})`, transformOrigin: '0 50%', opacity: Math.min(1, p * 2), display: 'flex', alignItems: 'center', gap: 14,
              padding: '16px 24px', borderRadius: 999, border: `1px solid ${i === 3 ? T.gold : T.line}`, background: i === 3 ? 'rgba(216,180,90,0.12)' : 'rgba(23,33,44,0.7)', fontFamily: FONT.sans, fontSize: 28, color: T.ink }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: i === 3 ? T.gold : T.ice }} />{r}
            </div>
          );
        })}
      </div>
    </NightStage>
  );
};

// ───────── ⑤ 多照片：三個角度依序彈起，金線串起首位候選 → 「一致」 ─────────
const MultiShot: React.FC = () => {
  const f = useCurrentFrame();
  const shots = [{ k: '01', pos: '50% 18%' }, { k: '08', pos: '50% 40%' }, { k: '10', pos: '50% 60%' }];
  const sims = [Q.multi['01'].sim, Q.multi['08'].sim, Q.multi['10'].sim];
  const avg = (sims.reduce((a, b) => a + b, 0) / 3).toFixed(3);
  const line = ramp(f, 62, 22, EASE.smooth);
  const badge = interpolate(f, [80, 92], [0, 1], { easing: Easing.out(Easing.back(1.7)), ...clampI });
  return (
    <NightStage glow={{ x: 0.5, y: 0.55, a: 0.1 }}>
      <StepHead n="05" title="多個角度，同一個答案" sub="最多三張照片；每張都高信心且首位一致，才判為一致" dur={90} />
      {shots.map((s, i) => {
        const p = ramp(f, 6 + i * 9, 26, EASE.overshoot);
        const x = 250 + i * 490;
        return (
          <div key={s.k} style={{ position: 'absolute', left: x, top: 390, width: 440, opacity: Math.min(1, p * 2), transform: `translateY(${(1 - p) * 120}px) rotate(${(1 - p) * (i - 1) * 6}deg)` }}>
            <div style={{ height: 300, borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 60px -18px rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Img src={img(`photos/q-stpaul-${s.k}.jpg`)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: s.pos }} />
            </div>
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderRadius: 12, background: 'rgba(216,180,90,0.12)', border: `1px solid ${T.gold}`, opacity: ramp(f, 30 + i * 8, 12, EASE.out) }}>
              <span style={{ fontFamily: FONT.sans, fontSize: 26, fontWeight: 600, color: T.ink }}>✓ 大三巴牌坊</span>
              <span style={{ fontFamily: FONT.serif, fontSize: 30, color: T.goldSoft }}>{sims[i].toFixed(3)}</span>
            </div>
          </div>
        );
      })}
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <path d="M 470 790 C 470 860, 960 860, 960 870 C 960 860, 1450 860, 1450 790 M 960 790 L 960 870" fill="none" stroke={T.gold} strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - line} />
      </svg>
      {badge > 0 && (
        <div style={{ position: 'absolute', left: 960, top: 900, transform: `translate(-50%, 0) scale(${badge})`, display: 'flex', alignItems: 'center', gap: 16, padding: '12px 26px', borderRadius: 999, background: T.gold, color: T.bg, fontFamily: FONT.sans, fontSize: 30, fontWeight: 800, whiteSpace: 'nowrap' }}>
          一致 AGREEMENT<span style={{ fontFamily: FONT.mono, fontSize: 18, fontWeight: 600 }}>平均 {avg}</span>
        </div>
      )}
      <Hud text="PHOTOS · ANK KUMAR · CC BY-SA 4.0" at={20} x={1700} y={330} align="right" size={12} color={T.ink3} cps={3} />
    </NightStage>
  );
};

// ───────── ⑥ 建檔：新紀錄沿 row-embed 物理落入普查檔案表 ─────────
export const EmbedShot: React.FC = () => {
  const f = useCurrentFrame();
  const cue = 14, land = cue + FLY;
  const air = 1 - interpolate(f, [cue, land], [0, 1], { easing: FLY_EASE, ...clampI });
  const press = interpolate(f, [land, land + 3, land + 9], [1, 0.985, 1], clampI);
  const seamW = interpolate(f, [land, land + 6], [0, 1], { easing: Easing.out(Easing.cubic), ...clampI });
  const seamO = interpolate(f, [land, land + 2, land + 8], [1, 1, 0], clampI);
  const cols = [['編號', 260], ['建築', 300], ['類型', 280], ['座標', 420], ['狀態', 200]] as const;
  const row = ['MM-2026-0001', '大三巴牌坊', '牌坊與紀念物', '22.19746, 113.54084', '已確認'];
  return (
    <NightStage glow={{ x: 0.5, y: 0.5, a: 0.08 }}>
      <StepHead n="06" title="確認後建檔" sub="永久編號 · 本機 SQLite（R-Tree 空間查重）· 可匯出" dur={70} />
      <div style={{ position: 'absolute', left: 260, top: 420, width: 1460, borderRadius: 18, background: 'rgba(16,23,32,0.9)', border: `1px solid ${T.line}`, padding: '24px 30px', opacity: ramp(f, 0, 10, EASE.out) }}>
        <div style={{ display: 'flex', fontFamily: FONT.mono, fontSize: 16, letterSpacing: '0.14em', color: T.ink3, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {cols.map(([c, w]) => <div key={c} style={{ width: w }}>{c}</div>)}
        </div>
        {/* 空槽：虛線框在等這一行 */}
        <div style={{ position: 'relative', height: 92, marginTop: 14 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 12, border: '1.5px dashed rgba(216,180,90,0.35)', opacity: 1 - ramp(f, land, 3, EASE.linear) }} />
          {f >= cue && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 12, background: 'rgba(216,180,90,0.1)',
              transform: `perspective(900px) translateY(${-120 * air}px) rotateX(${16 * air}deg) scale(${press})`, opacity: Math.min(1, (1 - air) * 3), fontFamily: FONT.sans, fontSize: 28, color: T.ink }}>
              {row.map((c, i) => <div key={i} style={{ width: cols[i][1] - (i === 0 ? 14 : 0), fontFamily: i === 0 || i === 3 ? FONT.mono : FONT.sans, color: i === 0 ? T.gold : i === 4 ? T.goldSoft : T.ink, fontSize: i === 3 ? 22 : 28 }}>{c}</div>)}
              <div style={{ position: 'absolute', left: (1400 - 1400 * seamW) / 2, width: 1400 * seamW, bottom: -1, height: 2, background: T.gold, opacity: seamO, boxShadow: '0 0 10px rgba(216,180,90,0.9)' }} />
            </div>
          )}
        </div>
      </div>
    </NightStage>
  );
};

// ───────── 準確率（留一法口徑，標明不是獨立實拍）─────────
const LooShot: React.FC = () => (
  <NightStage glow={{ x: 0.5, y: 0.45, a: 0.12 }}>
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <div style={{ display: 'flex', gap: 120 }}>
        <div style={{ textAlign: 'center' }}><Count to={Q.loo.top1 * 100} at={2} dur={28} decimals={2} suffix="%" size={130} /><div style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: '0.2em', color: T.goldSoft, marginTop: 6 }}>TOP-1</div></div>
        <div style={{ textAlign: 'center' }}><Count to={Q.loo.top3 * 100} at={6} dur={28} decimals={2} suffix="%" size={130} /><div style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: '0.2em', color: T.goldSoft, marginTop: 6 }}>TOP-3</div></div>
      </div>
      <div style={{ fontFamily: FONT.sans, fontSize: 24, color: T.ink2, marginTop: 24, opacity: ramp(useCurrentFrame(), 10, 12, EASE.out) }}>留一法 · {Q.loo.b} 棟／{Q.loo.n} 張參考照片（獨立實拍評測進行中）</div>
    </AbsoluteFill>
  </NightStage>
);

export const S5Gmvr: React.FC = () => (
  <AbsoluteFill style={{ background: T.bg }}>
    <Sequence from={0} durationInFrames={66}><ChapterCard no="02" title="GMVR 建築識別" en="GEO-AWARE MULTI-VIEW RECOGNITION" dur={66} plate="gen/plate-why.png" /></Sequence>
    <Sequence from={60} durationInFrames={160}><ScanShot /></Sequence>
    <Sequence from={220} durationInFrames={FEAT_D}><FeatureShot /></Sequence>
    <Sequence from={360} durationInFrames={130}><Top3Shot /></Sequence>
    <Sequence from={490} durationInFrames={110}><GeoShot /></Sequence>
    <Sequence from={600} durationInFrames={90}><MultiShot /></Sequence>
    <Sequence from={690} durationInFrames={50}><LooShot /></Sequence>
  </AbsoluteFill>
);
