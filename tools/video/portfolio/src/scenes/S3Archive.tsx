// mosaic-reframe — 12 张瓦片在三种排版间连续变形：规则网格 → feature mosaic → 对角瀑布串。
// 位置 / 宽高 / 旋转各自独立插值（不走 transform 整体缩放），逐片错峰，段间留 hold。
//
// 第二轮重设计（暖沙 · 胶片分镜板）：
// - look = sand（米色 · 赤陶）。主体是 video-shotcraft 的一块分镜板（12 个镜头的定帧）：12 张程序绘制的
//   "胶片照片"（落日海面 / 沙丘 / 拱门 / 雾山 / 泳池 / 柑橘静物 / 棕榈影 / 麦田八式，暖调统一），
//   1920 原生坐标直接排版（不再从 480 设计坐标放大）。
// - 因果：右上角分段控件 Grid / Mosaic / Cascade 是"布局的开关"——赤陶色指示胶囊先滑到下一档
//   （父先动），瓦片晚 4f 开始重排（子跟随），让观众看见"一次切换 → 整版重新思考"。
// - 三态三种语气：A 规则网格（档案）→ B feature mosaic（首图占 3×2，压上衬线大字图注 = 策展）
//   → C 对角瀑布（每张变成带白边的相纸，-15° 起每张 +3° 递增旋转，像一手牌被摊开 = 态度），
//   C 态左下留白处升起衬线大标题「Every shot, in sequence.」，尾帧是一张完整的分镜海报。
// - 运动：每片 x/y 用强 in-out（0.75,0,0.15,1）果断换位，w/h 晚 2f、旋转晚 4f 收敛（位置先到）；
//   换位途中按段进度 sin 包络"抬起"（放大 3.5% + 阴影变大变虚），落位贴回；B→C 旋转带一次轻过冲。
// - 错峰：A→B 自左上主图起按序号波浪扫过（先密后疏）；B→C 像发牌一样按序号依次摊开。
//
// 时间表（30fps，共 214f）：
//   0–22    预备：舞台、页眉与控件在场；12 张照片自左上沿对角线错峰升起（第 0 帧已有首张起始态）
//   22–52   hold A：读网格（全程相机极缓推近 1→1.025）
//   52–64   控件胶囊 Grid→Mosaic（snappy 12f）
//   56–92   A→B 重排：每片 26f，错峰 10f；84–104 主图图注逐词升起
//   92–128  hold B：读 mosaic
//   128–140 控件胶囊 Mosaic→Cascade；图注 128 起退场
//   132–176 B→C 摊牌：每片 30f，等间隔错峰 14f；相纸白边 0→14px；158–186 大标题逐词升起、副行淡入
//   180–214 hold C：海报落定
import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { EASE, FONT, Grain, bezier, mix, ramp, softShadow } from '../demos/_fixtures/Polish';
import { LOOKS, SERIF, Stage, TextReveal, alpha, stagger, type } from '../demos/_fixtures/Look';
import { BRAND, ShotcraftMark } from '../demos/_fixtures/Brand';
import { Count } from '../kit';

export const S3_DURATION = 270; // demo 214f 時間表不變，C 態後再 hold 56f 給數字讀數

const L = LOOKS.tujian;
const N = 12;

// ───────────── 时间常量 ─────────────
const T_AB = 52; // 控件切到 Mosaic
const T_BC = 128; // 控件切到 Cascade
const LAG = 4; // 瓦片晚于控件起跳的帧数（父先动、子跟随）
const D_AB = 26;
const D_BC = 30;
const MOVE = bezier(0.75, 0, 0.15, 1); // 果断换位：慢起 → 急走 → 长尾软落
const ROT_SETTLE = bezier(0.45, 0, 0.3, 1.22); // 旋转晚到并轻过冲一次

// ───────────── 三套布局（1920×1080 原生像素）─────────────
type Box = { x: number; y: number; w: number; h: number; rot: number };
const X0 = 96, X1 = 1824, Y0 = 212, Y1 = 984; // 内容区：安全边距 96，页眉下方

// A：4×3 规则网格
const AG = 24;
const AW = (X1 - X0 - 3 * AG) / 4, AH = (Y1 - Y0 - 2 * AG) / 3;
const A: Box[] = Array.from({ length: N }, (_, i) => ({
  x: X0 + (i % 4) * (AW + AG), y: Y0 + Math.floor(i / 4) * (AH + AG), w: AW, h: AH, rot: 0,
}));

// B：6×4 单元格 feature mosaic，首片占 3×2
const BG = 16;
const UW = (X1 - X0 - 5 * BG) / 6, UH = (Y1 - Y0 - 3 * BG) / 4;
const SLOTS: [number, number, number, number][] = [
  [0, 0, 3, 2], [3, 0, 1, 1], [4, 0, 1, 1], [5, 0, 1, 1], [3, 1, 2, 1], [5, 1, 1, 1],
  [0, 2, 1, 1], [1, 2, 2, 1], [3, 2, 1, 2], [4, 2, 2, 1], [0, 3, 3, 1], [4, 3, 2, 1],
];
const B: Box[] = SLOTS.map(([c, r, cw, rh]) => ({
  x: X0 + c * (UW + BG), y: Y0 + r * (UH + BG), w: cw * UW + (cw - 1) * BG, h: rh * UH + (rh - 1) * BG, rot: 0,
}));

// C：对角瀑布串——竖幅相纸沿 (850,214)→(1724,930) 摊开，旋转 -15° 起每张 +3° 递增
const CW = 300, CH = 372;
const C: Box[] = Array.from({ length: N }, (_, i) => {
  const s = i / (N - 1);
  const cx = 850 + 874 * s, cy = 214 + 716 * s;
  return { x: cx - CW / 2, y: cy - CH / 2, w: CW, h: CH, rot: -15 + i * 3 };
});

// ───────────── 照片（程序插画，viewBox 160×100 + slice ≈ object-fit: cover）─────────────
// 只用公開授權照片（Wikimedia Commons：CC BY / BY-SA / CC0 / 公有領域）；使用者提供的照片限內部評測、不可對外散布
export const PHOTOS = [
  { f: 'ruins-st-paul-249559aa87d9', zh: '大三巴牌坊', n: 15 }, { f: 'a-ma-temple-33849fa41382', zh: '媽閣廟', n: 13 },
  { f: 'st-dominic-church-1fff768d327b', zh: '玫瑰堂', n: 13 }, { f: 'senado-square-e3ed46a17cb4', zh: '議事亭前地', n: 5 },
  { f: 'leal-senado-8678e7580936', zh: '市政署大樓', n: 12 }, { f: 'red-market-f1bf06a963c7', zh: '紅街市', n: 5 },
  { f: 'mandarins-house-b821dae3520b', zh: '鄭家大屋', n: 13 }, { f: 'cathedral-macau-088c5129951f', zh: '主教座堂', n: 5 },
  { f: 'st-lawrence-church-193eedf1f00e', zh: '聖老楞佐堂', n: 4 }, { f: 'taipa-houses-363353f7c75e', zh: '龍環葡韻', n: 25 },
  { f: 'lai-chi-vun-b9d94b3eaa4e', zh: '荔枝碗船廠', n: 5 }, { f: 'moorish-barracks-0acd79b22c38', zh: '港務局大樓', n: 11 },
];
const Photo: React.FC<{ i: number }> = ({ i }) => (
  <Img src={staticFile(`photos/${PHOTOS[i].f}.webp`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.92) contrast(1.04)' }} />
);

// ───────────── 分段控件（布局开关）─────────────
const SEG = ['檔案', '策展', '記憶'];
const SEG_W = 168, SEG_H = 60, SEG_PAD = 6;
const Segmented: React.FC<{ frame: number }> = ({ frame }) => {
  const p1 = ramp(frame, T_AB, 12, EASE.snappy);
  const p2 = ramp(frame, T_BC, 12, EASE.snappy);
  const pos = p1 + p2; // 0 → 1 → 2
  // 胶囊在途中横向拉长（像被拽过去），到位收回
  const stretch = 1 + 0.18 * (Math.sin(Math.PI * p1) + Math.sin(Math.PI * p2));
  const press = (k: number, t: number) => 1 - 0.05 * Math.sin(Math.PI * ramp(frame, t - 3, 8, EASE.linear)) * (k > 0 ? 1 : 0);
  return (
    <div style={{
      position: 'absolute', right: 96, top: 92, width: SEG_W * 3 + SEG_PAD * 2, height: SEG_H + SEG_PAD * 2, borderRadius: 999,
      background: alpha('#17212c', 0.85), boxShadow: `inset 0 0 0 1px ${L.line}, ${softShadow(6, { color: L.shadow, strength: 0.6 })}`,
    }}>
      <div style={{
        position: 'absolute', top: SEG_PAD, left: SEG_PAD + pos * SEG_W, width: SEG_W, height: SEG_H, borderRadius: 999,
        background: L.accent, transform: `scaleX(${stretch.toFixed(4)})`,
        boxShadow: `0 6px 16px -6px ${alpha(L.accent, 0.7)}, inset 0 1px 0 rgba(255,255,255,0.25)`,
      }} />
      {SEG.map((s, k) => {
        const on = Math.max(0, 1 - Math.abs(pos - k));
        return (
          <div key={s} style={{
            position: 'absolute', top: SEG_PAD, left: SEG_PAD + k * SEG_W, width: SEG_W, height: SEG_H,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            ...type(30, 600), letterSpacing: '-0.01em',
            color: on > 0.5 ? L.onAccent : L.ink2,
            transform: `scale(${(k === 1 ? press(1, T_AB) : k === 2 ? press(2, T_BC) : 1).toFixed(4)})`,
          }}>{s}</div>
        );
      })}
    </div>
  );
};

// 瓦片在某帧的几何：A→B、B→C 两段各自的进度，位置 / 宽高 / 旋转错开收敛
const tileAt = (frame: number, i: number) => {
  const sAB = T_AB + LAG + stagger(i, N, 10, EASE.out);
  const sBC = T_BC + LAG + stagger(i, N, 14, EASE.linear); // 发牌：等间隔依次摊开
  const pAB = ramp(frame, sAB, D_AB, MOVE);
  const pBC = ramp(frame, sBC, D_BC, MOVE);
  const sAB2 = ramp(frame, sAB + 2, D_AB, MOVE); // 宽高晚 2f
  const sBC2 = ramp(frame, sBC + 2, D_BC, MOVE);
  const rBC = ramp(frame, sBC + 4, D_BC, ROT_SETTLE); // 旋转晚 4f + 过冲
  const a = A[i], b = B[i], c = C[i];
  // 以中心插值位置（宽高变化时中心走直线，不会"先长后跑"）
  const cxA = a.x + a.w / 2, cyA = a.y + a.h / 2, cxB = b.x + b.w / 2, cyB = b.y + b.h / 2, cxC = c.x + c.w / 2, cyC = c.y + c.h / 2;
  const cx = mix(mix(cxA, cxB, pAB), cxC, pBC);
  const cy = mix(mix(cyA, cyB, pAB), cyC, pBC);
  const w = mix(mix(a.w, b.w, sAB2), c.w, sBC2);
  const h = mix(mix(a.h, b.h, sAB2), c.h, sBC2);
  const rot = mix(0, c.rot, rBC);
  const lift = Math.max(Math.sin(Math.PI * pAB), Math.sin(Math.PI * pBC));
  return { cx, cy, w, h, rot, lift, pBC: sBC2, moving: pBC > 0 };
};

export const S3Archive: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = mix(1, 1.025, ramp(frame, 0, 270, EASE.smooth)); // 全程极缓推近

  // 主图图注（B 态）：84f 起逐词升起，128f 起退场
  const capOut = ramp(frame, T_BC, 10, EASE.exit);
  // C 态大标题
  const HEAD = 158;

  const tiles = Array.from({ length: N }, (_, i) => ({ i, ...tileAt(frame, i) }));
  // 叠放次序：B→C 起按序号（后发的牌压在上面）；之前主图最高
  const inC = frame >= T_BC + LAG;
  const z = (i: number) => (inC ? 10 + i : i === 0 ? 30 : 10);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', fontFamily: FONT.sans }}>
      <Stage look={L} keyLight={{ x: 0.28, y: 0.02 }} fill={{ x: 0.9, y: 0.95 }} />

      <div style={{ position: 'absolute', inset: 0, transform: `scale(${cam.toFixed(5)})`, transformOrigin: '50% 46%' }}>
        {/* 页眉：品牌标志 + 小写字标 + 分镜板名（标志按亮底 light 版；字标与分镜名同一基线）。
            总宽压在 x≈620 以内——C 态首张相纸的左上角在 x≈650，页眉再长会被它盖住 */}
        <div style={{ position: 'absolute', left: 96, top: 92, height: 72, display: 'flex', alignItems: 'center', gap: 18, color: L.ink }}>
          <ShotcraftMark size={50} tone="dark" />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
            <span style={{ fontFamily: BRAND.font, fontSize: 36, fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1 }}>{BRAND.name}</span>
            <span style={{ ...type(32, 450), color: L.ink2 }}>城市記憶相冊</span>
          </div>
        </div>
        <Segmented frame={frame} />

        {/* C 态大标题（左下留白处） */}
        <div style={{ position: 'absolute', left: 96, top: 540, color: L.ink }}>
          <div style={{ ...type(100, 500, { serif: true }), letterSpacing: '0.01em', lineHeight: 1.12 }}>
            <TextReveal text="每張照片，" start={HEAD} by="char" variant="rise" each={6} gap={3} />
            <br />
            <TextReveal text="都回到一棟建築。" start={HEAD + 10} by="char" variant="rise" each={6} gap={3}
              unitStyle={() => ({ color: L.accent })} />
          </div>
          <div style={{
            ...type(32, 450), color: L.ink2, marginTop: 26,
            opacity: ramp(frame, HEAD + 14, 16, EASE.out), transform: `translateY(${mix(12, 0, ramp(frame, HEAD + 14, 18, EASE.snappy)).toFixed(2)}px)`,
          }}>真實照片 · 時間軸 · 作者與授權 · 地點解讀</div>
          <div style={{ display: 'flex', gap: 56, marginTop: 34, opacity: ramp(frame, 200, 14, EASE.out) }}>
            <div><Count to={305} at={204} dur={44} size={76} suffix="張實拍" /></div>
            <div><Count to={32} at={212} dur={40} size={76} suffix="個記憶點" /></div>
          </div>
        </div>

        {tiles.map(({ i, cx, cy, w, h, rot, lift, pBC }) => {
          // 开场：沿对角线错峰升起（从左上到右下）
          const order = (i % 4) + Math.floor(i / 4);
          const inP = ramp(frame, stagger(order, 6, 14, EASE.out) - 2, 16, EASE.snappy);
          const pad = 14 * pBC; // 相纸白边
          const radius = mix(16, 6, pBC);
          const scale = mix(0.94, 1, inP) * (1 + 0.035 * lift);
          const elev = 6 + 34 * lift + 8 * pBC;
          return (
            <div key={i} style={{
              position: 'absolute', left: cx - w / 2, top: cy - h / 2 + (1 - inP) * 40, width: w, height: h,
              transform: `rotate(${rot.toFixed(3)}deg) scale(${scale.toFixed(4)})`,
              opacity: inP, zIndex: z(i), borderRadius: radius,
              background: L.surface, boxShadow: softShadow(elev, { color: L.shadow, strength: 0.9 + 0.5 * pBC }),
            }}>
              <div style={{ position: 'absolute', inset: pad, borderRadius: Math.max(2, radius - pad * 0.7), overflow: 'hidden' }}>
                <Photo i={i} />
                {/* 照片内缘一圈极淡暗边：像冲印的晕影，让亮色照片在米色底上立得住 */}
                <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 0 1px rgba(60,30,10,0.10), inset 0 -60px 80px -40px rgba(40,20,10,0.18)' }} />
                {i === 0 && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(200deg, rgba(30,18,10,0) 40%, rgba(30,18,10,0.6) 100%)',
                    opacity: ramp(frame, T_AB + LAG + 16, 14, EASE.out) * (1 - capOut),
                  }} />
                )}
              </div>
              {/* 主图图注：B 态的策展语气 */}
              {i === 0 && frame >= T_AB + LAG + 20 && capOut < 1 && (
                <div style={{ position: 'absolute', left: 44, bottom: 36, color: '#fff8ee', opacity: 1 - capOut }}>
                  <div style={{ ...type(30, 650, { caps: true }), letterSpacing: '0.16em', color: '#ffd9b8', marginBottom: 10 }}>
                    <TextReveal text="記憶點 · MM-0001" start={T_AB + LAG + 22} by="word" variant="blur" each={14} />
                  </div>
                  <div style={{ ...type(84, 500, { serif: true }), letterSpacing: '-0.03em', textShadow: '0 2px 18px rgba(30,15,5,0.35)' }}>
                    <TextReveal text="大三巴牌坊" start={T_AB + LAG + 26} by="char" variant="rise" each={5} gap={3} />
                  </div>
                  <div style={{ ...type(32, 450), color: 'rgba(255,248,238,0.82)', marginTop: 8, opacity: ramp(frame, T_AB + LAG + 34, 14, EASE.out) }}>
                    15 張實拍 · 牌坊與紀念物 · 世界遺產
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Grain opacity={0.05} blend="overlay" />
    </div>
  );
};
