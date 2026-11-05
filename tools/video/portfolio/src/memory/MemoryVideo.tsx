// 途見建築介紹短片：真實照片＋對應建築內容的鏡頭運動＋AI 旁白＋出處字幕。
// 分鏡由 tools/video/memory-video/make.mjs 依知識庫生成，這裡只負責呈現。
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, CalculateMetadataFunction } from 'remotion';
import { T, FONT, EASE, Grain, Vignette } from '../kit';

export type Shot = { beat: string; src: string; audio: string; seconds: number; narration: string; caption?: string; sources: string;
  from: { x: number; y: number; zoom: number }; to: { x: number; y: number; zoom: number } };
export type MemoryProps = { title: string; building: string; buildingEn: string; persona: string; shots: Shot[];
  credits: { photos: string[]; sources: string[]; voice: string; script: string } };

const FPS = 30, FADE = 14, END = 6 * FPS;
const frames = (s: number) => Math.round(s * FPS);

export const calcMemoryMeta: CalculateMetadataFunction<MemoryProps> = ({ props }) => ({
  durationInFrames: props.shots.reduce((n, s) => n + frames(s.seconds), 0) + END,
});

// 鏡頭運動：以照片中的 focus 點為目標，平移量受縮放限制，畫面邊緣永不露出
const ShotView: React.FC<{ shot: Shot; dur: number }> = ({ shot, dur }) => {
  const f = useCurrentFrame();
  const t = EASE.smooth(Math.min(1, f / dur));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const z = lerp(shot.from.zoom, shot.to.zoom), x = lerp(shot.from.x, shot.to.x), y = lerp(shot.from.y, shot.to.y);
  const tx = (0.5 - x) * 1920 * (z - 1), ty = (0.5 - y) * 1080 * (z - 1);
  const fade = interpolate(f, [0, FADE, dur - FADE, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: fade, overflow: 'hidden', background: T.bg }}>
      <Img src={staticFile(shot.src)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `translate(${tx}px, ${ty}px) scale(${z})`, transformOrigin: '50% 50%' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(10,14,19,0.55) 0%, rgba(10,14,19,0) 22%, rgba(10,14,19,0) 58%, rgba(10,14,19,0.82) 100%)' }} />
    </AbsoluteFill>
  );
};

const Subtitle: React.FC<{ text: string; dur: number }> = ({ text, dur }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [6, 18, dur - 12, dur - 2], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <div style={{ position: 'absolute', left: 160, right: 160, bottom: 118, textAlign: 'center', fontFamily: FONT.sans, fontSize: 40, lineHeight: 1.5,
    color: T.ink, letterSpacing: '0.04em', textShadow: '0 2px 14px rgba(0,0,0,0.7)', opacity: o }}>{text}</div>;
};

const Meta: React.FC<{ shot: Shot; dur: number; index: number; total: number }> = ({ shot, dur, index, total }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [10, 26, dur - 10, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <div style={{ position: 'absolute', left: 80, bottom: 52, fontFamily: FONT.sans, fontSize: 18, color: T.ink2, letterSpacing: '0.08em', opacity: o }}>
        資料｜{shot.sources}{shot.caption ? `　·　${shot.caption}` : ''}
      </div>
      <div style={{ position: 'absolute', right: 80, bottom: 52, fontFamily: FONT.mono, fontSize: 16, color: T.ink3, letterSpacing: '0.2em', opacity: o }}>
        {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}　{shot.beat}
      </div>
    </>
  );
};

const TitleCard: React.FC<{ p: MemoryProps }> = ({ p }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [8, 30, 100, 124], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const line = interpolate(f, [14, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
    <AbsoluteFill style={{ opacity: o, background: 'radial-gradient(ellipse 70% 60% at 14% 18%, rgba(10,14,19,0.78) 0%, rgba(10,14,19,0.35) 55%, rgba(10,14,19,0) 80%)' }} />
    <div style={{ position: 'absolute', left: 120, top: 104, opacity: o, textShadow: '0 2px 18px rgba(0,0,0,0.6)' }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 16, letterSpacing: '0.32em', color: T.gold }}>途見 · TUJIAN　｜　給{p.persona}</div>
      <div style={{ fontFamily: FONT.serif, fontSize: 76, fontWeight: 500, color: T.ink, letterSpacing: '0.06em', marginTop: 18 }}>{p.title}</div>
      <div style={{ width: 420 * line, height: 1.5, marginTop: 18, background: `linear-gradient(90deg, ${T.gold}, rgba(216,180,90,0))` }} />
      <div style={{ fontFamily: FONT.sans, fontSize: 22, color: T.ink2, letterSpacing: '0.14em', marginTop: 14 }}>{p.building}　{p.buildingEn}</div>
    </div>
    </>
  );
};

const EndCard: React.FC<{ p: MemoryProps }> = ({ p }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', gap: 28, marginTop: 18 }}>
      <div style={{ width: 120, fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.24em', color: T.gold, paddingTop: 4 }}>{label}</div>
      <div style={{ flex: 1, fontFamily: FONT.sans, fontSize: 22, color: T.ink2, lineHeight: 1.6 }}>{value}</div>
    </div>
  );
  return (
    <AbsoluteFill style={{ background: T.bg, opacity: o, padding: '150px 200px' }}>
      <div style={{ fontFamily: FONT.serif, fontSize: 48, color: T.ink, letterSpacing: '0.08em' }}>{p.building}</div>
      <div style={{ width: 360, height: 1.5, background: T.line, margin: '24px 0 16px' }} />
      {row('資料出處', p.credits.sources.join('、'))}
      {row('照片', p.credits.photos.join('；'))}
      {row('旁白', p.credits.voice)}
      {row('分鏡', p.credits.script)}
      <div style={{ position: 'absolute', left: 200, bottom: 110, fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.3em', color: T.ink3 }}>畫面為實拍照片，未經 AI 生成或改動</div>
    </AbsoluteFill>
  );
};

export const MemoryVideo: React.FC<MemoryProps> = (p) => {
  let at = 0;
  const seqs = p.shots.map((s, i) => { const from = at, dur = frames(s.seconds); at += dur; return { s, i, from, dur }; });
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      {seqs.map(({ s, i, from, dur }) => (
        <Sequence key={i} from={from} durationInFrames={dur}>
          <ShotView shot={s} dur={dur} />
          <Subtitle text={s.narration} dur={dur} />
          <Meta shot={s} dur={dur} index={i} total={p.shots.length} />
          <Sequence from={8}><Audio src={staticFile(s.audio)} /></Sequence>
        </Sequence>
      ))}
      <Sequence from={0} durationInFrames={130}><TitleCard p={p} /></Sequence>
      <Sequence from={at} durationInFrames={END}><EndCard p={p} /></Sequence>
      <Vignette />
      <Grain />
      <div style={{ position: 'absolute', right: 80, top: 60, fontFamily: FONT.mono, fontSize: 14, letterSpacing: '0.22em', color: 'rgba(236,230,218,0.5)' }}>實拍照片 · AI 旁白</div>
    </AbsoluteFill>
  );
};
