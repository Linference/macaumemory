// 全片時間線：SHOTS 是唯一事實源（字幕、SFX 鈎幀都從它派生）
import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { AT, FILM_DURATION } from './timeline';
import { FilmAudio } from './Audio';
import { S1Opening } from './scenes/S1Opening';
import { S3Archive } from './scenes/S3Archive';
import { S4Map } from './scenes/S4Map';
import { S5Gmvr } from './scenes/S5Gmvr';
import { S6Splat, S8Innovation, S10Finale } from './scenes/S6to10';
import { WhyChapter, PolicyChapter, MeaningChapter } from './scenes/Chapters';

const SCENES = { s1: S1Opening, why: WhyChapter, s3: S3Archive, s4: S4Map, s5: S5Gmvr, s6: S6Splat, s8: S8Innovation, policy: PolicyChapter, meaning: MeaningChapter, s10: S10Finale };
export const SHOTS = Object.fromEntries(Object.entries(AT).map(([k, t]) => [k, { ...t, C: SCENES[k as keyof typeof SCENES] }]));
export { FILM_DURATION };

export const Film: React.FC<{ bgm: boolean }> = ({ bgm }) => (
  <AbsoluteFill style={{ background: '#0a0e13' }}>
    {Object.entries(SHOTS).map(([k, s]) => (
      <Sequence key={k} from={s.from} durationInFrames={s.dur} name={k}><s.C /></Sequence>
    ))}
    <FilmAudio bgm={bgm} />
  </AbsoluteFill>
);
