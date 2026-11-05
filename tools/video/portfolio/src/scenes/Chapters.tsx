// 三個全屏章節：立意（600f）· 政策關聯（990f）· 意義（520f）
// 底景為即夢生成的 AI 意象（Plate 右下角標示），政策引句只用官方原文、措辭為「呼應」（DESIGN.md §3）
import React from 'react';
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { EASE, FONT, LotusMark, T, mix, ramp } from '../kit';
import { BigType, Beams, Dust, Eyebrow, Finish, Flare, Letterbox, Plate, PunchCut } from '../cine';

const clampI = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const Center: React.FC<{ top: number; children: React.ReactNode }> = ({ top, children }) => <div style={{ position: 'absolute', left: 0, right: 0, top }}>{children}</div>;
const Sub: React.FC<{ text: string; at: number; out?: number; color?: string; size?: number }> = ({ text, at, out, color = T.ink2, size = 38 }) => {
  const f = useCurrentFrame();
  const o = ramp(f, at, 18, EASE.out) * (out == null ? 1 : 1 - ramp(f, out, 14, EASE.exit));
  return <div style={{ textAlign: 'center', fontFamily: FONT.sans, fontSize: size, color, letterSpacing: '0.08em', opacity: o, transform: `translateY(${(1 - ramp(f, at, 24, EASE.snappy)) * 20}px)`, textShadow: '0 4px 24px rgba(0,0,0,0.7)' }}>{text}</div>;
};

// ═════════ 立意 ═════════
const STEPS = ['拍照', '識別', '定位', '建檔', '留下故事'];
const Flow: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0 }}>
      {STEPS.map((s, i) => {
        const p = interpolate(f, [at + i * 10, at + i * 10 + 14], [0, 1], { easing: Easing.out(Easing.back(1.6)), ...clampI });
        const line = ramp(f, at + i * 10 + 6, 12, EASE.snappy);
        return (
          <React.Fragment key={s}>
            <div style={{ transform: `scale(${p})`, padding: '16px 30px', borderRadius: 999, border: `1.5px solid ${T.gold}`, background: i === 4 ? T.gold : 'rgba(10,14,19,0.6)',
              color: i === 4 ? T.bg : T.ink, fontFamily: FONT.sans, fontSize: 34, fontWeight: 600, backdropFilter: 'blur(8px)' }}>{s}</div>
            {i < 4 && <div style={{ width: 70, height: 2, background: T.gold, transform: `scaleX(${line})`, transformOrigin: '0 50%' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};
export const WhyChapter: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Sequence durationInFrames={432}>
        <Plate src="gen/plate-why.png" dur={432} from={[30, 10, 1.08]} to={[-60, -20, 1.24]} dim={0.3}>
          <Beams strength={0.45} origin={[82, -12]} />
          <Dust n={80} drift={0.4} seed={3} />
        </Plate>
      </Sequence>
      <Sequence from={418} durationInFrames={182}>
        <Plate src="gen/calcada-1.jpg" dur={182} from={[0, 20, 1.16]} to={[-50, -10, 1.06]} dim={0.5} label>
          <Dust n={50} seed={7} alpha={0.7} />
        </Plate>
      </Sequence>
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(10,14,19,0) 30%, rgba(10,14,19,0.55) 100%)', opacity: f < 418 ? 1 : 0 }} />
      {/* 章節大字 */}
      <Center top={250}><Eyebrow text="CHAPTER 00 · PURPOSE" at={8} out={78} /></Center>
      <Center top={320}><BigType text="立 意" at={14} out={80} size={240} per={8} glow color={T.goldSoft} /></Center>
      {/* 問題 */}
      <Center top={330}><BigType text="城市的記憶，" at={96} out={196} size={120} /></Center>
      <Center top={490}><BigType text="藏在每一棟普通建築裡。" at={108} out={196} size={120} color={T.goldSoft} /></Center>
      <Center top={330}><BigType text="很多街巷與老房子，" at={214} out={404} size={110} /></Center>
      <Center top={480}><BigType text="還沒有被好好記錄。" at={228} out={404} size={110} color={T.goldSoft} /></Center>
      <Center top={660}><Sub text="景點有導覽，普通建築卻常常沒有名字、沒有檔案" at={262} out={404} /></Center>
      {/* 答案 */}
      <Center top={250}><Eyebrow text="途見的立意" at={432} /></Center>
      <Center top={320}><BigType text="讓每個人用一張照片，" at={438} size={104} /></Center>
      <Center top={460}><BigType text="為一棟建築建立檔案。" at={452} size={104} color={T.goldSoft} glow /></Center>
      <Center top={680}><Flow at={490} /></Center>
      <Flare at={70} y={430} />
      <Flare at={405} y={560} dur={30} />
      <Letterbox dur={600} />
      <Finish />
    </AbsoluteFill>
  );
};

// ═════════ 政策關聯 ═════════
const ITEMS = [
  { zh: '綜合旅遊休閒', one: true, on: true, r: '帶遊客從景點走進街巷' },
  { zh: '大健康', on: false }, { zh: '現代金融', on: false },
  { zh: '高新技術', on: true, r: '瀏覽器端 AI · 三維地圖 · 3DGS' },
  { zh: '會展商貿和文化體育', on: true, r: '記錄在地故事與建築文化' },
];
const OnePlusFour: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 120, top: 250 }}>
        <div style={{ fontFamily: FONT.serif, fontSize: 340, fontWeight: 300, lineHeight: 1, color: 'transparent', WebkitTextStroke: `2px ${T.gold}`,
          opacity: ramp(f, 0, 24, EASE.out), transform: `translateX(${(1 - ramp(f, 0, 40, EASE.snappy)) * -80}px)`, filter: 'drop-shadow(0 0 30px rgba(216,180,90,0.35))' }}>1+4</div>
        <div style={{ fontFamily: FONT.sans, fontSize: 34, color: T.ink, marginTop: 10, opacity: ramp(f, 16, 16, EASE.out) }}>經濟適度多元發展策略</div>
        <div style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.12em', color: T.ink2, marginTop: 14, opacity: ramp(f, 24, 16, EASE.out) }}>《澳門特別行政區經濟適度多元發展規劃（2024–2028年）》</div>
      </div>
      <div style={{ position: 'absolute', left: 860, top: 210, display: 'grid', gap: 22 }}>
        {ITEMS.map((it, i) => {
          const p = ramp(f, 30 + i * 9, 24, EASE.snappy);
          const r = ramp(f, 110 + i * 22, 22, EASE.snappy);
          return (
            <div key={it.zh} style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: p * (it.on ? 1 : 0.38), transform: `translateX(${(1 - p) * 60}px)` }}>
              <div style={{ minWidth: 380, padding: '18px 28px', borderRadius: 16, border: `1.5px solid ${it.on ? T.gold : 'rgba(165,175,187,0.35)'}`, background: it.on ? 'rgba(216,180,90,0.16)' : 'rgba(10,14,19,0.45)',
                fontFamily: FONT.serif, fontSize: it.one ? 46 : 40, fontWeight: 600, color: it.on ? T.ink : T.ink2, display: 'flex', alignItems: 'center', gap: 16, backdropFilter: 'blur(6px)' }}>
                <span style={{ fontFamily: FONT.mono, fontSize: 20, color: T.gold }}>{it.one ? '1' : '4'}</span>{it.zh}
              </div>
              {it.r && <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: r, transform: `translateX(${(1 - r) * 30}px)`, fontFamily: FONT.sans, fontSize: 34, color: T.goldSoft, whiteSpace: 'nowrap' }}>
                <span style={{ width: 60 * r, height: 2, background: T.gold }} /><LotusMark size={30} />{it.r}</div>}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
const QUOTES = [
  { q: '文化澳門', r: '為普通建築建立記憶檔案', bg: 'gen/plate-culture.png', size: 170 },
  { q: '建設美麗智慧澳門', r: '三維城市底圖 · 端側 AI 識別', bg: 'gen/plate-city.png', size: 130 },
  { q: '推進對大三巴一帶進行保護性更新活化', r: '大三巴 3DGS 實景數字紀錄', bg: 'splat', size: 84 },
  { q: '打造中西文明交流互鑒的重要窗口', r: '中葡建築的實拍、故事與研學', bg: 'gen/plate-culture.png', size: 90 },
];
const QuoteScreen: React.FC<{ i: number; dur: number }> = ({ i, dur }) => {
  const f = useCurrentFrame();
  const q = QUOTES[i];
  const reply = ramp(f, 46, 22, EASE.snappy);
  return (
    <AbsoluteFill>
      {q.bg === 'splat'
        ? <AbsoluteFill style={{ overflow: 'hidden' }}><OffthreadVideo src={staticFile('footage/splat-orbit.mp4')} startFrom={60} muted style={{ width: '100%', height: '100%', transform: `scale(${mix(1.16, 1.24, f / dur)})` }} /><AbsoluteFill style={{ background: 'rgba(10,14,19,0.55)' }} /></AbsoluteFill>
        : <Plate src={q.bg} dur={dur} from={i % 2 ? [40, 0, 1.2] : [-30, 10, 1.1]} to={i % 2 ? [-30, -10, 1.1] : [40, -10, 1.2]} dim={0.55} />}
      <Dust n={50} seed={11 + i} alpha={0.6} />
      <div style={{ position: 'absolute', right: 120, top: 200, fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.2em', color: T.goldSoft, opacity: ramp(f, 4, 12, EASE.out) }}>0{i + 1} / 04</div>
      <Center top={q.size > 120 ? 330 : 380}><BigType text={`「${q.q}」`} at={6} out={dur - 20} size={q.size} per={q.size > 120 ? 5 : 2} weight={500} /></Center>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center', opacity: reply * (1 - ramp(f, dur - 20, 16, EASE.exit)) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '20px 40px', borderRadius: 999, border: `1.5px solid ${T.gold}`, background: 'rgba(10,14,19,0.6)', backdropFilter: 'blur(10px)',
          transform: `translateY(${(1 - reply) * 30}px) scale(${0.94 + 0.06 * reply})`, fontFamily: FONT.sans, fontSize: 44, color: T.ink }}>
          <LotusMark size={40} /><span style={{ color: T.goldSoft }}>途見 →</span>{q.r}
        </div>
      </div>
      <Flare at={2} y={q.size > 120 ? 470 : 470} dur={28} />
    </AbsoluteFill>
  );
};
export const PolicyChapter: React.FC = () => {
  const f = useCurrentFrame();
  const QD = 135;
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Sequence durationInFrames={450}>
        <Plate src="gen/plate-city.png" dur={450} from={[0, 30, 1.06]} to={[-50, -20, 1.2]} dim={0.4}><Beams strength={0.3} origin={[50, -20]} /><Dust n={60} seed={5} /></Plate>
      </Sequence>
      <Sequence durationInFrames={120}>
        <Center top={250}><Eyebrow text="CHAPTER · POLICY" at={6} out={100} /></Center>
        <Center top={320}><BigType text="政策關聯" at={10} out={100} size={210} per={6} glow color={T.goldSoft} /></Center>
        <Center top={600}><Sub text="途見如何回應澳門的發展規劃" at={40} out={100} size={44} color={T.ink} /></Center>
      </Sequence>
      <Sequence from={120} durationInFrames={330}>
        {/* 1+4 面板的壓暗幕：城市光網底景太亮，描邊大字與灰階項目會被吃掉 */}
        <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(10,14,19,0.78) 0%, rgba(10,14,19,0.55) 45%, rgba(10,14,19,0.72) 100%)', opacity: ramp(f - 120, 0, 20, EASE.out) }} />
        <OnePlusFour />
      </Sequence>
      {QUOTES.map((_, i) => (
        <Sequence key={i} from={450 + i * QD} durationInFrames={QD + (i < 3 ? 6 : 0)}>
          <PunchCut dur={QD + (i < 3 ? 6 : 0)} outT={i < 3 ? 10 : 0}><QuoteScreen i={i} dur={QD} /></PunchCut>
        </Sequence>
      ))}
      {f >= 450 && (
        <div style={{ position: 'absolute', left: 120, top: 190, opacity: ramp(f, 450, 16, EASE.out) }}>
          <div style={{ fontFamily: FONT.serif, fontSize: 40, color: T.ink }}>呼應澳門「三五」規劃</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.12em', color: T.ink2, marginTop: 8 }}>《經濟和社會發展第三個五年規劃（2026–2030年）》· 政府新聞局 2026-08-18 公布</div>
        </div>
      )}
      <Letterbox dur={990} />
      <Finish />
    </AbsoluteFill>
  );
};

// ═════════ 意義 ═════════
const MEAN = [
  { k: '為城市', a: '留下可查證的記憶', s: '每張照片都有來源、作者、授權與地點', bg: 'gen/plate-meaning.png' },
  { k: '為遊客', a: '從景點，走進街巷', s: '記憶點、在地聲音與步行路線', bg: 'gen/plate-why.png' },
  { k: '為未來', a: '每一棟普通建築，都有檔案', s: '可匯出、可複核、可延續的城市檔案', bg: 'gen/plate-lotus.png' },
];
export const MeaningChapter: React.FC = () => {
  const D = 520 / 3;
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      {MEAN.map((m, i) => (
        <Sequence key={i} from={Math.round(i * D)} durationInFrames={Math.round(D) + (i < 2 ? 6 : 0)}>
          <PunchCut dur={Math.round(D) + (i < 2 ? 6 : 0)} inT={i ? 12 : 0} outT={i < 2 ? 10 : 0}><MeanScreen m={m} i={i} dur={Math.round(D)} /></PunchCut>
        </Sequence>
      ))}
      <Letterbox dur={520} />
      <Finish />
    </AbsoluteFill>
  );
};
const MeanScreen: React.FC<{ m: typeof MEAN[number]; i: number; dur: number }> = ({ m, i, dur }) => {
  const f = useCurrentFrame();
  const title = i === 0 && f < 70;
  return (
    <AbsoluteFill>
      <Plate src={m.bg} dur={dur} from={i === 1 ? [-60, -20, 1.22] : [20, 10, 1.08]} to={i === 1 ? [20, 10, 1.1] : [-40, -10, 1.2]} dim={0.5}><Dust n={60} seed={21 + i} alpha={0.8} /></Plate>
      {i === 0 && <>
        <Center top={250}><Eyebrow text="CHAPTER · SIGNIFICANCE" at={4} out={60} /></Center>
        <Center top={320}><BigType text="意 義" at={8} out={62} size={230} per={8} glow color={T.goldSoft} /></Center>
      </>}
      {!title && <>
        <Center top={300}><Eyebrow text={m.k} at={i === 0 ? 70 : 6} out={dur - 18} /></Center>
        <Center top={370}><BigType text={m.a} at={i === 0 ? 76 : 12} out={dur - 18} size={124} color={i === 2 ? T.goldSoft : T.ink} glow={i === 2} /></Center>
        <Center top={570}><Sub text={m.s} at={i === 0 ? 100 : 36} out={dur - 18} /></Center>
      </>}
      <Flare at={i === 0 ? 72 : 8} y={520} dur={30} />
    </AbsoluteFill>
  );
};
