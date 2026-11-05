import React from 'react';
import { Composition } from 'remotion';
import { Film, FILM_DURATION } from './Film';
import { MemoryVideo, calcMemoryMeta, MemoryProps } from './memory/MemoryVideo';
import { OralFilm, ORAL_DURATION } from './oral/OralFilm';
import { LaiChiVun30, LCV_DURATION, KaHo30, KAHO_DURATION } from './oral/Shorts';

export const Root: React.FC = () => (
  <>
    <Composition id="TujianFilm" component={Film} durationInFrames={FILM_DURATION} fps={30} width={1920} height={1080} defaultProps={{ bgm: true }} />
    <Composition id="MemoryVideo" component={MemoryVideo} durationInFrames={300} fps={30} width={1920} height={1080} calculateMetadata={calcMemoryMeta}
      defaultProps={{ title: '', building: '', buildingEn: '', persona: '', shots: [], credits: { photos: [], sources: [], voice: '', script: '' } } as MemoryProps} />
    <Composition id="LaiChiVun30" component={LaiChiVun30} durationInFrames={LCV_DURATION} fps={30} width={1920} height={1080} />
    <Composition id="KaHo30" component={KaHo30} durationInFrames={KAHO_DURATION} fps={30} width={1920} height={1080} />
    <Composition id="OralFilm" component={OralFilm} durationInFrames={ORAL_DURATION} fps={30} width={1920} height={1080} />
  </>
);
