// 兩部 30 秒口述記憶短片：〈荔枝碗，熱奶茶〉〈回九澳吃盆菜〉。
// 畫面全部由程式碼繪製（Remotion + SVG／CSS），不使用任何照片，也沒有 AI 生成影像。
// 內容取自澳門口述歷史協會訪談（受訪者不具名）；旁白為騰訊雲普通話語音合成（501008）；配樂由 capture/score.py 程式作曲。
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { EASE, FONT, T, LotusMark, ramp, mix } from '../kit';
import { Finish, Beams, Dust } from '../cine';
import VO from './vo30.json';
import { Narration, YearMark, MacauMap, Coins, Pulse, Embers, SplitWipe, Sweep, Lamp, Handwrite, Kin, Banquet, Lanterns, SourceTag } from './parts';
import { Sky, Sea, Hills, Fog, Boat, Ribs, Corridor, Rift, PostRoom, Tree, Stove, Sheds, Sampan, Junks, Houses, Walker, Temple, Desk, Figure } from './draw';

type Id = keyof typeof VO;
const FPS = 30, LEAD = 3, TAIL = 5, INTRO = 24, END = 40;
const vf = (id: Id) => Math.round(VO[id].seconds * FPS);

type Beat = { id: Id; scene: (dur: number, vo: number) => React.ReactNode };
function plan(beats: Beat[]) {
  let at = 0;
  const placed = beats.map((b, i) => { const lead = LEAD + (i === 0 ? INTRO : 0); const dur = lead + vf(b.id) + TAIL; const s = { ...b, at, dur, lead }; at += dur; return s; });
  return { placed, total: at + END, endAt: at };
}

const Scene: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const i = 1 - ramp(f, 0, 10, EASE.out), o = ramp(f, dur - 8, 8, EASE.exit);
  return <AbsoluteFill style={{ opacity: 1 - Math.max(i, o) * 0.85, transform: `scale(${1 + 0.025 * i})`, filter: `blur(${5 * Math.max(i, o)}px)` }}>{children}</AbsoluteFill>;
};

/** 開場標題：疊在第一鏡上，字距收攏後縮到左上角 */
const OpenTitle: React.FC<{ zh: string; en: string }> = ({ zh, en }) => {
  const f = useCurrentFrame();
  const k = ramp(f, 30, 26, EASE.smooth);
  return (
    <div style={{ position: 'absolute', left: mix(960, 120, k), top: mix(470, 60, k), transform: `translateX(${mix(-50, 0, k)}%) scale(${mix(1, 0.34, k)})`, transformOrigin: '0 0' }}>
      <div style={{ display: 'flex' }}>
        {[...zh].map((ch, i) => { const p = ramp(f, i * 2, 26, EASE.snappy);
          return <span key={i} style={{ fontFamily: FONT.serif, fontSize: 110, fontWeight: 500, color: T.ink, letterSpacing: `${0.36 - 0.28 * p}em`, opacity: p, filter: `blur(${(1 - p) * 12}px)`, textShadow: '0 0 50px rgba(216,180,90,0.35)' }}>{ch}</span>; })}
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: '0.42em', color: T.goldSoft, marginTop: 14, opacity: ramp(f, 10, 20, EASE.out) }}>{en}</div>
    </div>
  );
};

const EndCard: React.FC<{ title: string; source: string }> = ({ title, source }) => {
  const f = useCurrentFrame();
  const o = ramp(f, 0, 12, EASE.out);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 50% at 50% 45%, rgba(216,180,90,0.08) 0%, ${T.bg} 70%)`, alignItems: 'center', justifyContent: 'center', opacity: o }}>
      <LotusMark size={58} />
      <div style={{ fontFamily: FONT.serif, fontSize: 56, color: T.ink, letterSpacing: '0.12em', marginTop: 22 }}>{title}</div>
      <div style={{ width: 360 * ramp(f, 4, 20, EASE.smooth), height: 1.5, background: T.gold, margin: '22px 0 20px' }} />
      <div style={{ fontFamily: FONT.sans, fontSize: 20, color: T.ink2, letterSpacing: '0.06em', lineHeight: 1.8, textAlign: 'center' }}>
        依澳門口述歷史協會〈{source}〉訪談改編 · 受訪者不具名<br />
        畫面與配樂全部以程式碼生成（Remotion／numpy），無照片、無 AI 生成影像<br />旁白：騰訊雲普通話語音合成（AI）
      </div>
    </AbsoluteFill>
  );
};

function Film({ beats, title, en, source, music }: { beats: Beat[]; title: string; en: string; source: string; music: string }) {
  const { placed, total, endAt } = plan(beats);
  const speaking = placed.map((b) => [b.at + b.lead, b.at + b.lead + vf(b.id)] as [number, number]);
  const vol = (fr: number) => { const base = speaking.some(([a, z]) => fr >= a - 6 && fr <= z + 6) ? 0.5 : 0.85; return base * ramp(fr, 0, 20, EASE.out) * (1 - ramp(fr, total - 30, 30, EASE.exit)); };
  const Comp: React.FC = () => (
    <AbsoluteFill style={{ background: T.bg }}>
      <Audio src={staticFile(music)} volume={vol} />
      {placed.map((b) => (
        <Sequence key={b.id} from={b.at} durationInFrames={b.dur}>
          <Scene dur={b.dur}>
            {b.scene(b.dur, b.lead)}
            <Narration text={VO[b.id].text} at={b.lead} frames={vf(b.id)} y={910} />
          </Scene>
          <Sequence from={b.lead}><Audio src={staticFile(VO[b.id].src)} /></Sequence>
        </Sequence>
      ))}
      <Sequence from={0} durationInFrames={placed[0].dur}><OpenTitle zh={title} en={en} /></Sequence>
      <Sequence from={endAt} durationInFrames={END}><EndCard title={title} source={source} /></Sequence>
      <Finish />
    </AbsoluteFill>
  );
  return { Comp, total };
}

// ---------------- 〈荔枝碗，熱奶茶〉 ----------------
const BoatIn: React.FC<{ dur: number }> = ({ dur }) => { const f = useCurrentFrame(); const t = ramp(f, 0, dur, EASE.smooth); return <Boat x={mix(320, 900, t)} y={mix(780, 720, t)} s={mix(1.5, 0.95, t)} />; };
const LCV: Beat[] = [
  { id: 'l1', scene: (dur, vo) => (<>
    <Sky top="#18242f" bottom="#5f7787" glow={{ x: 72, y: 62, c: 'rgba(255,196,130,0.5)', r: 30 }} />
    <Hills y={690} h={190} seed={2} at={4} x0={980} x1={1920} />
    <Hills y={690} h={90} seed={5} at={10} x0={-40} x1={760} fill="#0e1922" />
    <Fog y={600} opacity={0.32} />
    <Sea y={690} reflect={{ x: 72, c: 'rgba(255,196,130,0.35)' }} />
    <BoatIn dur={dur} />
    <YearMark year="1972" at={vo + 10} x={120} y={210} size={190} sub="路環 · COLOANE" />
    <MacauMap at={vo} scale={0.42} focus="taipa" x={720} y={-70} opacity={0.9} pins={[{ p: 'laichivun', label: '荔枝碗', at: vo + 50 }]} draw={30} />
  </>) },
  { id: 'l2', scene: (dur, vo) => (<>
    <Sky top="#0f0b08" bottom="#2c1d12" glow={{ x: 68, y: 8, c: 'rgba(255,190,110,0.35)', r: 50 }} />
    <Beams strength={0.55} origin={[66, -12]} />
    <Ribs at={vo - 2} />
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}><Figure x={420} y={812} s={1.3} pose="crouch" /></svg>
    <Dust n={70} drift={0.3} alpha={0.75} />
    <Coins at={vo + Math.round(vf('l2') * 0.3)} x={1360} y={240} />
  </>) },
  { id: 'l3', scene: (dur, vo) => (<>
    <Sky top="#1b1d20" bottom="#5c6066" />
    <Corridor at={vo - 2} />
    <Rift at={vo + Math.round(vf('l3') * 0.34)} />
    <YearMark year="1986" at={vo + Math.round(vf('l3') * 0.34) + 4} x={120} y={140} size={190} />
  </>) },
  { id: 'l4', scene: (dur, vo) => (<>
    <Sky top="#141b22" bottom="#2b2722" />
    <PostRoom at={vo} every={18} dur={dur} />
    <Pulse at={vo + 4} every={18} x={760} y={560} count={8} />
  </>) },
  { id: 'l5', scene: (dur, vo) => (<>
    <Sky top="#2d2416" bottom="#6b4a26" glow={{ x: 30, y: 30, c: 'rgba(255,214,150,0.45)', r: 50 }} />
    <Beams strength={0.32} origin={[28, -12]} />
    <Tree at={vo - 3} />
    <Stove at={vo + 14} />
    <Embers n={44} x={1240} y={820} spread={260} />
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}><Figure x={1090} y={860} s={1.5} pose="crouch" /></svg>
  </>) },
  { id: 'l6', scene: (dur, vo) => (<>
    <SplitWipe at={vo + 6} d={60} labels={['昔', '今']}
      before={<><Sky top="#0e0b08" bottom="#2a1c12" /><Sea y={800} lines={10} /><Sheds at={0} mode="old" /></>}
      after={<><Sky top="#18304a" bottom="#c79a62" glow={{ x: 50, y: 70, c: 'rgba(255,214,150,0.5)' }} /><Sea y={800} lines={10} reflect={{ x: 50, c: 'rgba(255,214,150,0.4)' }} /><Sheds at={vo + 10} mode="new" /></>} />
    <Embers n={20} x={960} y={1020} spread={1600} seed={8} />
  </>) },
];
const lcv = Film({ beats: LCV, title: '荔枝碗，熱奶茶', en: 'LAI CHI VUN · AN ORAL HISTORY', source: '荔枝碗，熱奶茶', music: 'oral/score-lcv.wav' });
export const LaiChiVun30 = lcv.Comp, LCV_DURATION = lcv.total;

// ---------------- 〈回九澳吃盆菜〉 ----------------
const SampanGo: React.FC<{ dur: number }> = ({ dur }) => { const f = useCurrentFrame(); const t = ramp(f, 0, dur, EASE.smooth); return <Sampan x={mix(1500, 700, t)} y={mix(760, 730, t)} s={mix(1.3, 1, t)} />; };
const Guards: React.FC = () => (<>
  <Hills y={760} h={70} seed={3} at={0} x0={-60} x1={700} fill="#060a0f" />
  <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
    {[0, 1, 2, 3, 4].map((i) => <Figure key={i} x={200 + i * 62} y={712 + Math.abs(i - 2) * 4} s={0.9 + (i % 2) * 0.12} pose="stand" />)}
  </svg>
</>);
const HousesFade: React.FC<{ dur: number }> = ({ dur }) => { const f = useCurrentFrame(); return <Houses at={0} fade={ramp(f, dur * 0.25, dur * 0.6, EASE.smooth)} />; };
const KAHO: Beat[] = [
  { id: 'k1', scene: (dur, vo) => (<>
    <Sky top="#132230" bottom="#4f6b72" glow={{ x: 30, y: 58, c: 'rgba(255,200,140,0.35)', r: 35 }} />
    <Hills y={690} h={200} seed={7} at={4} x0={-60} x1={900} />
    <Fog y={610} opacity={0.26} />
    <Sea y={690} reflect={{ x: 30, c: 'rgba(255,200,140,0.3)' }} />
    <SampanGo dur={dur} />
    <MacauMap at={vo} scale={0.42} focus="taipa" x={720} y={-70} opacity={0.9} pins={[{ p: 'kaho', label: '九澳', at: vo + 20 }, { p: 'peninsula', label: '澳門', at: vo + 40 }]}
      route={{ from: 'kaho', to: 'peninsula', at: vo + 50, d: Math.max(60, vf('k1') - 50), dashed: true }} draw={30} />
  </>) },
  { id: 'k2', scene: (dur, vo) => (<>
    <Sky top="#05090f" bottom="#1a2533" glow={{ x: 50, y: 64, c: 'rgba(120,150,190,0.25)', r: 40 }} />
    <Sea y={700} color="rgba(150,180,210," />
    <Junks at={vo} y={700} />
    <Sweep at={vo} x={330} y={700} />
    <Guards />
    <YearMark year="1910" at={vo + 4} x={1340} y={150} size={170} sub="前後 · 海盜出沒" />
  </>) },
  { id: 'k3', scene: (dur, vo) => (<>
    <Sky top="#07090b" bottom="#14110d" />
    <Desk at={vo - 2} />
    <Lamp x={1290} y={640} />
    <Handwrite text="白天幹活 · 晚上讀書" at={vo + 6} y={360} size={96} />
    <YearMark year="1950s" at={vo} x={120} y={110} size={110} />
  </>) },
  { id: 'k4', scene: (dur, vo) => (<>
    <Sky top="#2a2015" bottom="#55402a" glow={{ x: 50, y: 30, c: 'rgba(255,214,150,0.3)', r: 50 }} />
    <Houses at={0} y={900} />
    <Kin at={vo - 2} />
  </>) },
  { id: 'k5', scene: (dur, vo) => (<>
    <Sky top="#1b2128" bottom="#3a4148" />
    <HousesFade dur={dur} />
    <Walker at={vo} dur={dur - vo} />
  </>) },
  { id: 'k6', scene: (dur, vo) => (<>
    <Sky top="#1c0d0a" bottom="#5a2416" glow={{ x: 50, y: 40, c: 'rgba(255,150,80,0.35)', r: 45 }} />
    <Temple at={vo - 3} base={560} />
    <Lanterns at={vo} />
    <Banquet at={vo + Math.round(vf('k6') * 0.3)} />
    <SourceTag text="農曆五月十三 · 三聖廟賀誕" at={vo + 10} x={120} y={1024} />
  </>) },
];
const kaho = Film({ beats: KAHO, title: '回九澳吃盆菜', en: 'KA HO · AN ORAL HISTORY', source: '溫馨九澳情', music: 'oral/score-kaho.wav' });
export const KaHo30 = kaho.Comp, KAHO_DURATION = kaho.total;
