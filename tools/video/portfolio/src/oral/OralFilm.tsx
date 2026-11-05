// 途見 · 口述記憶短片（約 3 分鐘）：〈荔枝碗，熱奶茶〉＋〈回九澳吃盆菜〉。
// 畫面全部是實拍照片（維基共享資源，CC／公有領域）與動態圖形，沒有 AI 生成影像；旁白為騰訊雲粵語語音合成。
// 內容取自澳門口述歷史協會訪談，受訪者不具名。時間軸由旁白實際長度（vo.json）決定。
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { EASE, FONT, T, LotusMark, ramp, mix } from '../kit';
import { Finish, Beams, Dust, Flare } from '../cine';
import VO from './vo.json';
import CREDITS from '../../public/oral/photos/CREDITS.json';
import { Photo, PH, Dissolve, Narration, YearMark, MacauMap, Coords, Coins, Slice, Pulse, Embers, SplitWipe, Sweep, Lamp, Handwrite, Kin, Banquet, Lanterns, Title, SourceTag } from './parts';

type VoId = keyof typeof VO;
const FPS = 30, LEAD = 14, TAIL = 27;
const vf = (id: VoId) => Math.round(VO[id].seconds * FPS);
const beat = (id: VoId) => LEAD + vf(id) + TAIL;

// ---- 時間軸 ----
type Seg = { key: string; dur: number; vo?: VoId[] };
const SEGS: Seg[] = [
  { key: 'open', dur: 300, vo: ['open1', 'open2'] },
  { key: 'cardA', dur: 120 },
  ...(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] as VoId[]).map((id) => ({ key: id, dur: beat(id), vo: [id] })),
  { key: 'bridge', dur: 190, vo: ['bridge'] },
  { key: 'cardB', dur: 120 },
  ...(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] as VoId[]).map((id) => ({ key: id, dur: beat(id), vo: [id] })),
  { key: 'coda', dur: 420, vo: ['coda1', 'coda2'] },
  { key: 'end', dur: 210 },
];
let acc = 0;
const PLACED = SEGS.map((s) => { const at = acc; acc += s.dur; return { ...s, at }; });
export const ORAL_DURATION = acc;
// 旁白在各段內的起點（open、coda 兩句分開）
const VO_AT: Record<string, number> = { open1: 40, open2: 150, coda1: 30, coda2: 30 + vf('coda1') + 24 };
const voAt = (id: VoId) => VO_AT[id] ?? LEAD;
const VO_WINDOWS = PLACED.flatMap((s) => (s.vo ?? []).map((id) => [s.at + voAt(id), s.at + voAt(id) + vf(id)] as [number, number]));

/** 每段的進出：黑場淡入＋輕微推近；出場淡出 */
const Scene: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const i = 1 - ramp(f, 0, 16, EASE.out), o = ramp(f, dur - 14, 14, EASE.exit);
  return <AbsoluteFill style={{ opacity: 1 - Math.max(i, o) * 0.92, transform: `scale(${1 + 0.03 * i + 0.02 * o})`, filter: `blur(${6 * Math.max(i, o)}px)` }}>{children}</AbsoluteFill>;
};
const Say: React.FC<{ id: VoId; y?: number }> = ({ id, y }) => <Narration text={VO[id].text} at={voAt(id)} frames={vf(id)} y={y} />;

// ---- 各段畫面 ----
const SCENES: Record<string, (dur: number) => React.ReactNode> = {
  open: (dur) => (
    <AbsoluteFill style={{ background: T.bg }}>
      <Photo src={PH('KITLV_-_65859_-_Chinese_junks_at_Macau_-_presumably_1900-1902.jpg')} dur={dur} mood="sepia" from={[0, 0, 1.18]} to={[-20, 10, 1.32]} dim={0.45} />
      <Dust n={50} alpha={0.5} />
      <OpenWords />
      <Flare at={250} y={540} />
    </AbsoluteFill>
  ),
  cardA: () => (<AbsoluteFill style={{ background: T.bg }}><MacauMap at={0} scale={2.2} focus="laichivun" opacity={0.35} draw={40} /><Title no="記憶 · 一" zh="荔枝碗，熱奶茶" en="LAI CHI VUN · A CUP OF HOT TEA" at={4} out={100} /></AbsoluteFill>),
  a1: (dur) => (
    <>
      <Dissolve at={Math.round(dur * 0.5)} d={36}
        a={<Photo src={PH('KITLV_-_65860_-_Chinese_junks_at_Macau_-_presumably_1900-1902.jpg')} dur={dur} mood="sepia" from={[0, 0, 1.08]} to={[-40, 0, 1.2]} />}
        b={<Photo src={PH('20251117_Estaleiros_Navais_de_Lai_Chi_Vun.jpg')} dur={dur} mood="cool" from={[0, 0, 1.12]} to={[30, -10, 1.22]} />} />
      <MacauMap at={20} scale={0.5} focus="taipa" x={640} y={0} opacity={0.95} pins={[{ p: 'laichivun', label: '路環 · 荔枝碗', at: 70 }]} />
      <YearMark year="1972" at={18} sub="路環 · COLOANE" />
      <Coords text="22.1211°N  113.5521°E" at={60} />
      <SourceTag text="澳門口述歷史協會〈荔枝碗，熱奶茶〉" at={30} x={120} y={60} />
      <Say id="a1" />
    </>
  ),
  a2: (dur) => (
    <>
      <Photo src={PH('lai-chi-vun__Lai_Chi_Vun_Shipyard.jpg')} dur={dur} mood="dusk" from={[0, 0, 1.06]} to={[-50, -20, 1.24]} bloom={0.45} />
      <Beams strength={0.55} origin={[70, -12]} />
      <Dust n={80} drift={0.3} alpha={0.8} />
      <Coins at={Math.round(vf('a2') * 0.22) + LEAD} />
      <Say id="a2" />
    </>
  ),
  a3: (dur) => (
    <>
      <Photo src={PH('coloane-village__Coloane_Village_Macau_2052759250_.jpg')} dur={dur} mood="mono" from={[0, 0, 1.15]} to={[0, 0, 1.3]} dim={0.4} bloom={0.15} />
      <Slice at={Math.round(vf('a3') * 0.32) + LEAD} />
      <YearMark year="1986" at={Math.round(vf('a3') * 0.32) + LEAD + 6} x={120} y={140} />
      <Say id="a3" />
    </>
  ),
  a4: (dur) => (
    <>
      <Photo src={PH('coloane-village__Coloane_Village_Macau_2051973505_.jpg')} dur={dur} mood="cold" from={[0, 0, 1.1]} to={[0, -30, 1.2]} />
      <WarmUp dur={dur} />
      <Pulse at={LEAD + 10} every={Math.round((vf('a4') - 20) / 10)} />
      <Say id="a4" />
    </>
  ),
  a5: (dur) => (
    <>
      <Photo src={PH('lai-chi-vun__cm_Son_Veng_Estaleiro_Naval_03-07-2023.jpg')} dur={dur} mood="warm" from={[0, 0, 1.1]} to={[-30, -24, 1.24]} bloom={0.5} />
      <Beams strength={0.35} origin={[20, -12]} />
      <Embers x={980} y={820} />
      <Say id="a5" />
    </>
  ),
  a6: (dur) => (
    <>
      <SplitWipe at={LEAD + 40} d={90}
        before={<Photo src={PH('lai-chi-vun__Lai_Chi_Vun_Shipyard.jpg')} dur={dur} mood="dusk" from={[0, 0, 1.12]} to={[-20, 0, 1.18]} />}
        after={<Photo src={PH('lai-chi-vun__cm_Lai_Chi_Vun_Shipyards_03-07-2023_2.jpg')} dur={dur} mood="warm" from={[0, 0, 1.12]} to={[20, 0, 1.18]} />} />
      <Embers n={26} x={960} y={1000} spread={1600} seed={9} />
      <Say id="a6" />
    </>
  ),
  bridge: () => (
    <AbsoluteFill style={{ background: T.bg }}>
      <Photo src={PH('Ka-Ho_shingle_beach_23-10-2023_3_.jpg')} dur={190} mood="cool" dim={0.7} from={[0, 0, 1.1]} to={[0, 0, 1.18]} />
      <BridgeMap />
      <Say id="bridge" y={940} />
    </AbsoluteFill>
  ),
  cardB: () => (<AbsoluteFill style={{ background: T.bg }}><MacauMap at={0} scale={2.2} focus="kaho" opacity={0.35} draw={40} /><Title no="記憶 · 二" zh="回九澳吃盆菜" en="KA HO · COMING HOME FOR POON CHOI" at={4} out={100} /></AbsoluteFill>),
  b1: (dur) => (
    <>
      <Photo src={PH('Estaleiros_Navais_de_Lai_Chi_Vun_03-09-2025.jpg')} dur={dur} mood="cool" from={[0, 0, 1.08]} to={[-60, 0, 1.18]} />
      <MacauMap at={10} scale={0.62} focus="taipa" x={560} y={-40} opacity={0.95} pins={[{ p: 'kaho', label: '九澳', at: 40 }, { p: 'peninsula', label: '澳門', at: 70 }]}
        route={{ from: 'kaho', to: 'peninsula', at: 90, d: Math.max(120, vf('b1') - 120), dashed: true }} />
      <SourceTag text="澳門口述歷史協會〈溫馨九澳情〉" at={30} />
      <Say id="b1" />
    </>
  ),
  b2: (dur) => (
    <>
      <Photo src={PH('KITLV_-_65859_-_Chinese_junks_at_Macau_-_presumably_1900-1902.jpg')} dur={dur} mood="sepia" from={[0, 0, 1.3]} to={[-60, 10, 1.42]} dim={0.4} />
      <Sweep at={LEAD} />
      <YearMark year="1910" at={LEAD + 6} sub="前後 · 海盜出沒" />
      <Say id="b2" />
    </>
  ),
  b3: (dur) => (
    <>
      <Photo src={PH('九澳村_-_Ka-Ho_Village_-_2016.06_-_panoramio.jpg')} dur={dur} mood="dusk" from={[0, 0, 1.12]} to={[0, -20, 1.2]} dim={0.3} />
      <Lamp />
      <YearMark year="1950s" at={LEAD} size={150} sub="九澳學校" />
      <Handwrite text="白天幹活 · 晚上讀書" at={LEAD + 50} />
      <Say id="b3" />
    </>
  ),
  b4: (dur) => (
    <>
      <Photo src={PH('Povoa_o_de_K_H_2023-04-09_.jpg')} dur={dur} mood="warm" from={[0, 0, 1.1]} to={[30, -10, 1.18]} dim={0.48} />
      <Kin at={LEAD + 6} />
      <Say id="b4" />
    </>
  ),
  b5: (dur) => (
    <>
      <Photo src={PH('Our_Lady_Village_of_Ka-Ho_03-09-2023_23_.jpg')} dur={dur} mood="cold" from={[0, 0, 1.16]} to={[0, 0, 1.06]} dim={0.36} />
      <MacauMap at={6} scale={0.62} focus="taipa" x={560} y={-40} opacity={0.9} pins={[{ p: 'kaho', label: '九澳', at: 20 }, { p: 'taipa', label: '氹仔', at: 120 }]}
        route={{ from: 'kaho', to: 'taipa', at: 60, d: 140 }} />
      <YearMark year="1993" at={Math.round(vf('b5') * 0.6) + LEAD} />
      <Say id="b5" />
    </>
  ),
  b6: (dur) => (
    <>
      <Dissolve at={Math.round(dur * 0.42)} d={30}
        a={<Photo src={PH('Decoration_at_Ka_Ho_Village.jpg')} dur={dur} mood="fest" from={[0, 0, 1.08]} to={[0, -20, 1.18]} dim={0.3} />}
        b={<Photo src={PH('20251019_Pagode_de_Sam_Seng.jpg')} dur={dur} mood="fest" from={[0, 0, 1.08]} to={[0, 0, 1.16]} dim={0.4} />} />
      <Lanterns at={LEAD} />
      <Banquet at={Math.round(dur * 0.48)} />
      <SourceTag text="農曆五月十三 · 三聖廟賀誕" at={LEAD + 10} x={120} y={1024} />
      <Say id="b6" y={190} />
    </>
  ),
  coda: () => <Coda />,
  end: () => <EndCard />,
};

const OpenWords: React.FC = () => {
  const f = useCurrentFrame();
  const o2 = ramp(f, 240, 30, EASE.out);
  return (
    <>
      <Narration text={VO.open1.text} at={40} frames={vf('open1')} y={470} />
      <Narration text={VO.open2.text} at={150} frames={vf('open2')} y={540} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: o2 * (1 - ramp(f, 280, 20, EASE.exit)) }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 20, letterSpacing: '0.6em', color: T.gold }}>途見 · 口述記憶</div>
      </AbsoluteFill>
    </>
  );
};
const WarmUp: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ background: 'radial-gradient(ellipse 80% 70% at 75% 40%, rgba(255,170,80,0.35) 0%, rgba(0,0,0,0) 70%)', mixBlendMode: 'screen', opacity: ramp(f, dur * 0.35, dur * 0.55, EASE.smooth) }} />;
};
const BridgeMap: React.FC = () => {
  const f = useCurrentFrame();
  const z = mix(2.6, 1.15, ramp(f, 0, 120, EASE.smooth));
  return (
    <>
      <MacauMap at={0} scale={z} focus="coloane" pins={[{ p: 'laichivun', label: '荔枝碗', at: 10 }, { p: 'kaho', label: '九澳', at: 110 }]} route={{ from: 'laichivun', to: 'kaho', at: 50, d: 80 }} draw={30} />
      <Coords text="LAI CHI VUN → KA HO" at={40} x={120} y={120} />
    </>
  );
};
const Coda: React.FC = () => {
  const f = useCurrentFrame();
  const cards = [{ src: 'lai-chi-vun__Lai_Chi_Vun_Shipyard.jpg', t: '荔枝碗，熱奶茶', x: 560 }, { src: '20251019_Pagode_de_Sam_Seng.jpg', t: '回九澳吃盆菜', x: 1360 }];
  const ghost = ramp(f, 200, 60, EASE.smooth);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at 50% 45%, rgba(216,180,90,0.08) 0%, ${T.bg2} 45%, ${T.bg} 100%)` }}>
      <MacauMap at={0} scale={1} opacity={0.18} draw={60} />
      {cards.map((c, i) => {
        const p = ramp(f, 10 + i * 12, 34, EASE.snappy);
        return (
          <div key={i} style={{ position: 'absolute', left: c.x - 210, top: 250, width: 420, opacity: p, transform: `translateY(${(1 - p) * 40}px) rotate(${(i ? 1 : -1) * 2 * (1 - p)}deg)` }}>
            <div style={{ height: 260, borderRadius: 6, overflow: 'hidden', border: `1px solid ${T.line}`, boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>
              <img src={staticFile(PH(c.src))} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.8) brightness(0.85)' }} />
            </div>
            <div style={{ marginTop: 16, fontFamily: FONT.serif, fontSize: 30, color: T.ink }}>{c.t}</div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, fontFamily: FONT.mono, fontSize: 13, letterSpacing: '0.2em', color: T.goldSoft, opacity: ramp(f, 60 + i * 12, 20, EASE.out) }}>
              <span style={{ color: '#7fd18b' }}>✓</span>已核對訪談原文 · 澳門口述歷史協會</div>
          </div>
        );
      })}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const x = 260 + i * 280, y = 760 + (i % 2) * 40;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: 200, height: 56, borderRadius: 6, border: '1px dashed rgba(216,180,90,0.4)', opacity: ghost * (0.3 + 0.1 * (i % 3)),
          display: 'grid', placeItems: 'center', fontFamily: FONT.mono, fontSize: 12, letterSpacing: '0.2em', color: 'rgba(236,230,218,0.5)', transform: `translateY(${(1 - ghost) * 20}px)` }}>下一段記憶</div>;
      })}
      <Say id="coda1" y={120} />
      <Say id="coda2" y={900} />
    </AbsoluteFill>
  );
};
const EndCard: React.FC = () => {
  const f = useCurrentFrame();
  const o = ramp(f, 0, 20, EASE.out);
  const used = ['KITLV_-_65859', 'KITLV_-_65860', '20251117_Estaleiros', 'Lai_Chi_Vun_Shipyard.jpg', 'Son_Veng', 'Coloane_Village_Macau_2052759250', 'Coloane_Village_Macau_2051973505', 'cm_Lai_Chi_Vun_Shipyards_03-07-2023_2', 'Ka-Ho_shingle', 'Estaleiros_Navais_de_Lai_Chi_Vun_03-09-2025', '九澳村', 'Povoa', 'Our_Lady', 'Decoration', 'Pagode_de_Sam_Seng'];
  const credits = (CREDITS as { file: string; author: string; license: string }[]).filter((c) => used.some((u) => c.file.includes(u)));
  const people = [...new Map(credits.map((c) => [`${c.author.replace(/Unknown author/g, '佚名').slice(0, 30)}｜${c.license}`, 1])).keys()];
  return (
    <AbsoluteFill style={{ background: T.bg, opacity: o, padding: '120px 180px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <LotusMark size={54} />
        <div style={{ fontFamily: FONT.serif, fontSize: 52, color: T.ink, letterSpacing: '0.1em' }}>途見 · 口述記憶</div>
      </div>
      <div style={{ width: 420 * ramp(f, 6, 30, EASE.smooth), height: 1.5, background: T.gold, margin: '28px 0 30px' }} />
      {[
        ['內容', '依澳門口述歷史協會〈荔枝碗，熱奶茶〉〈溫馨九澳情〉訪談改編；受訪者不具名'],
        ['畫面', '實拍照片（維基共享資源）與動態圖形；本片沒有 AI 生成影像'],
        ['照片', people.join('；')],
        ['旁白', '騰訊雲粵語語音合成（AI）'],
        ['地圖', '澳門行政區輪廓：Overture Maps'],
      ].map(([k, v], i) => (
        <div key={k} style={{ display: 'flex', gap: 30, marginTop: 20, opacity: ramp(f, 10 + i * 6, 20, EASE.out) }}>
          <div style={{ width: 90, fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.3em', color: T.gold, paddingTop: 4 }}>{k}</div>
          <div style={{ flex: 1, fontFamily: FONT.sans, fontSize: k === '照片' ? 17 : 22, color: T.ink2, lineHeight: 1.6 }}>{v}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
};

export const OralFilm: React.FC = () => {
  const music = (frame: number) => {
    const speaking = VO_WINDOWS.some(([a, b]) => frame >= a - 8 && frame <= b + 8);
    return speaking ? 0.32 : 0.62;
  };
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Audio src={staticFile('oral/pad.mp3')} volume={music} />
      {PLACED.map((s) => (
        <Sequence key={s.key} from={s.at} durationInFrames={s.dur}>
          <Scene dur={s.dur}>{SCENES[s.key](s.dur)}</Scene>
          {(s.vo ?? []).map((id) => <Sequence key={id} from={voAt(id)}><Audio src={staticFile(VO[id].src)} volume={1} /></Sequence>)}
        </Sequence>
      ))}
      <Finish />
    </AbsoluteFill>
  );
};
