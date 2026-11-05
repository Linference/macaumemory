// 聲音：BGM（Mixkit 免費授權 tech-house，音量 ~0.34，首尾淡入淡出；bgm=false 渲無配樂版）＋ SFX 鈎幀表
// 詞彙：運鏡 whoosh／落地 impact／鋪墊 riser／光效 light／轉場 transition；畫面真有點擊才配點擊拟音
// 全片大 slam 只 3 處：鎖定市政署大樓、三項創新登場、收尾字標落地
import React from 'react';
import { Audio, Sequence, interpolate, staticFile } from 'remotion';
import { AT, FILM_DURATION } from './timeline';

type Cue = { from: number; src: string; volume: number; dur?: number; note: string };
const a = (p: string) => `audio/sfx/${p}.mp3`;

export const SFX: Cue[] = [
  // S1 開場：等高線生長的低頻呼吸 → 字標結晶 → 一點星塵
  { from: AT.s1.from + 4, src: a('transition/air-woosh-deep'), volume: 0.3, dur: 90, note: '等高線開始生長' },
  { from: AT.s1.from + 150, src: a('light/light-aura'), volume: 0.3, dur: 90, note: '蓮花描瓣' },
  { from: AT.s1.from + 244, src: a('impact/impact-deep-whoosh'), volume: 0.42, dur: 70, note: 'TUJIAN 同幀齊收' },
  { from: AT.s1.from + 250, src: a('light/shimmer-sparkle-sweep'), volume: 0.28, dur: 60, note: '結晶回落的餘輝' },
  // 立意（全屏章節）：雨夜街巷底景 → 大字「立意」→ 問題 → 答案與流程
  { from: AT.why.from, src: a('transition/transition-soft'), volume: 0.3, dur: 50, note: '雨夜街巷淡入' },
  { from: AT.why.from + 14, src: a('impact/impact-deep-whoosh'), volume: 0.4, dur: 70, note: '「立意」大字升起' },
  { from: AT.why.from + 70, src: a('light/light-sweep-magic'), volume: 0.22, dur: 70, note: '寬銀幕光條' },
  { from: AT.why.from + 96, src: a('transition/swoosh-slow'), volume: 0.24, dur: 40, note: '問題句' },
  { from: AT.why.from + 214, src: a('transition/swoosh-slow'), volume: 0.22, dur: 40, note: '換句' },
  { from: AT.why.from + 405, src: a('transition/whoosh-fast'), volume: 0.3, dur: 40, note: '換到碎石底景' },
  { from: AT.why.from + 438, src: a('impact/bass-hit-short'), volume: 0.3, dur: 30, note: '答案句' },
  { from: AT.why.from + 490, src: a('light/sparkle-touch'), volume: 0.2, dur: 30, note: '流程膠囊 1' },
  { from: AT.why.from + 530, src: a('light/sparkle-touch'), volume: 0.24, dur: 30, note: '流程膠囊 5（留下故事）' },
  // S3 照片檔案
  { from: AT.s3.from, src: a('transition/swoosh-slow'), volume: 0.28, dur: 40, note: '瓦片升起' },
  { from: AT.s3.from + 56, src: a('transition/transition-tech-slide'), volume: 0.3, dur: 40, note: '網格→策展' },
  { from: AT.s3.from + 132, src: a('transition/wind-woosh-throw'), volume: 0.3, dur: 50, note: '摊成相紙' },
  // S4 地圖
  { from: AT.s4.from, src: a('transition/air-woosh-deep'), volume: 0.32, dur: 60, note: '章節卡 01' },
  { from: AT.s4.from + 58, src: a('transition/whoosh-fast'), volume: 0.3, dur: 40, note: '漏光切入全景' },
  { from: AT.s4.from + 244, src: a('transition/air-whoosh-powerful'), volume: 0.34, dur: 60, note: '俯衝' },
  { from: AT.s4.from + 480 + 14, src: a('transition/sweep-fast-small'), volume: 0.3, dur: 30, note: '準星飛入' },
  { from: AT.s4.from + 480 + 46, src: a('impact/impact-zoom-quick'), volume: 0.5, dur: 40, note: 'slam #1：咬合市政署大樓' },
  // S5 GMVR
  { from: AT.s5.from, src: a('transition/air-woosh-deep'), volume: 0.32, dur: 60, note: '章節卡 02' },
  { from: AT.s5.from + 60 + 22, src: a('data/data-scan'), volume: 0.3, dur: 62, note: '掃描光帶' },
  { from: AT.s5.from + 60 + 128, src: a('light/sparkle-touch'), volume: 0.3, dur: 30, note: 'YOLO 框描出' },
  { from: AT.s5.from + 220, src: a('transition/transition-tech'), volume: 0.28, dur: 40, note: '特徵柱入場' },
  { from: AT.s5.from + 360 + 22, src: a('impact/hit-weak'), volume: 0.34, dur: 20, note: 'Top-1 落位' },
  { from: AT.s5.from + 360 + 32, src: a('impact/hit-weak'), volume: 0.26, dur: 20, note: 'Top-2 落位' },
  { from: AT.s5.from + 360 + 41, src: a('impact/hit-weak'), volume: 0.2, dur: 20, note: 'Top-3 落位（音量遞減防機槍感）' },
  { from: AT.s5.from + 360 + 62, src: a('light/sparkle-touch'), volume: 0.28, dur: 30, note: '判定膠囊' },
  { from: AT.s5.from + 490, src: a('transition/transition-soft'), volume: 0.26, dur: 40, note: '位置雷達' },
  { from: AT.s5.from + 600, src: a('transition/swoosh-quick'), volume: 0.28, dur: 30, note: '三張照片彈起' },
  { from: AT.s5.from + 600 + 80, src: a('light/light-spell'), volume: 0.26, dur: 30, note: '一致' },
  { from: AT.s5.from + 690, src: a('impact/impact-transition'), volume: 0.3, dur: 40, note: '準確率' },
  // S6 3DGS
  { from: AT.s6.from, src: a('transition/air-woosh-deep'), volume: 0.32, dur: 60, note: '章節卡 03' },
  { from: AT.s6.from + 58, src: a('light/light-transition-magic'), volume: 0.3, dur: 60, note: '高斯實景顯現' },
  // S8 創新點
  { from: AT.s8.from, src: a('transition/wind-pass-vibrate'), volume: 0.32, dur: 140, note: '技術詞穿越' },
  { from: AT.s8.from + 140, src: a('impact/impact-cine-big'), volume: 0.48, dur: 80, note: 'slam #2：三項創新' },
  { from: AT.s8.from + 140 + 40, src: a('light/sparkle-touch'), volume: 0.24, dur: 30, note: '創新 01' },
  { from: AT.s8.from + 140 + 130, src: a('light/sparkle-touch'), volume: 0.24, dur: 30, note: '創新 02' },
  { from: AT.s8.from + 140 + 220, src: a('light/sparkle-touch'), volume: 0.24, dur: 30, note: '創新 03' },
  // 政策關聯（全屏章節）：大字 → 1+4 → 三五規劃四句引句（每句一屏）
  { from: AT.policy.from, src: a('transition/air-woosh-deep'), volume: 0.32, dur: 60, note: '城市遠眺淡入' },
  { from: AT.policy.from + 10, src: a('impact/impact-cine-big'), volume: 0.42, dur: 80, note: '「政策關聯」大字' },
  { from: AT.policy.from + 120, src: a('impact/bass-hit-short'), volume: 0.32, dur: 30, note: '1+4 描邊大字' },
  { from: AT.policy.from + 230, src: a('light/sparkle-touch'), volume: 0.22, dur: 30, note: '回應：綜合旅遊休閒' },
  { from: AT.policy.from + 296, src: a('light/sparkle-touch'), volume: 0.2, dur: 30, note: '回應：高新技術' },
  { from: AT.policy.from + 318, src: a('light/sparkle-touch'), volume: 0.18, dur: 30, note: '回應：文化體育' },
  ...[0, 1, 2, 3].flatMap((i) => [
    { from: AT.policy.from + 450 + i * 135, src: a('transition/whoosh-fast'), volume: 0.28, dur: 40, note: `引句 ${i + 1} 換屏` },
    { from: AT.policy.from + 450 + i * 135 + 46, src: a('light/light-spell'), volume: 0.2, dur: 30, note: `途見的回應 ${i + 1}` },
  ]),
  // 意義（全屏章節）：大字「意義」→ 為城市／為遊客／為未來
  { from: AT.meaning.from, src: a('transition/transition-soft'), volume: 0.3, dur: 50, note: '檔案桌面淡入' },
  { from: AT.meaning.from + 8, src: a('impact/impact-deep-whoosh'), volume: 0.4, dur: 70, note: '「意義」大字' },
  { from: AT.meaning.from + 173, src: a('transition/whoosh-fast'), volume: 0.26, dur: 40, note: '為遊客' },
  { from: AT.meaning.from + 347, src: a('transition/whoosh-fast'), volume: 0.26, dur: 40, note: '為未來' },
  // S10 收尾：riser → impact（全片峰值）→ sparkle
  { from: AT.s10.from + 8, src: a('transition/whoosh-big'), volume: 0.34, dur: 60, note: '元素飛入合影' },
  { from: AT.s10.from + 30, src: a('riser/riser-cine'), volume: 0.4, dur: 146, note: '鋪墊至字標' },
  { from: AT.s10.from + 176, src: a('impact/impact-epic-trailer'), volume: 0.6, dur: 140, note: 'slam #3：字標落地（全片峰值）' },
  { from: AT.s10.from + 182, src: a('light/sparkle'), volume: 0.32, dur: 60, note: '餘韻' },
];

export const FilmAudio: React.FC<{ bgm: boolean }> = ({ bgm }) => (
  <>
    {bgm && (
      <Audio src={staticFile('audio/bgm/bgm-tech-house.mp3')}
        volume={(f) => 0.34 * interpolate(f, [0, 60, FILM_DURATION - 120, FILM_DURATION - 10], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
    )}
    {SFX.map((s, i) => (
      <Sequence key={i} from={s.from} durationInFrames={s.dur ?? 60} name={`sfx ${s.note}`}>
        <Audio src={staticFile(s.src)} volume={s.volume} />
      </Sequence>
    ))}
  </>
);
