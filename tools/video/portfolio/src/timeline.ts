// 全片時間線（唯一事實源）：畫面（Film.tsx）與 SFX 鈎幀表（Audio.tsx）都從這裡取起點，挪動鏡頭時音效自動跟隨
// v2：立意／政策關聯／意義 升為全屏章節（使用者要求這三點必須明顯可見）
export const AT = {
  s1: { from: 0, dur: 330 },
  why: { from: 330, dur: 600 },
  s3: { from: 930, dur: 264 },
  s4: { from: 1194, dur: 576 },
  s5: { from: 1770, dur: 740 },
  s6: { from: 2510, dur: 420 },
  s8: { from: 2930, dur: 450 },
  policy: { from: 3380, dur: 990 },
  meaning: { from: 4370, dur: 520 },
  s10: { from: 4890, dur: 510 },
} as const;
export const FILM_DURATION = 5400;
