// video-shotcraft 品牌件——demo 里出现 logo / 品牌名 / 宣传语时统一用这里：
// 标志 <ShotcraftMark>（「镜刻 / Frame Chisel」：开口取景框 + 琥珀斜切，与 assets/brand/logo-mark.svg 同一组路径）、
// 字标 <ShotcraftWordmark>、品牌色 BRAND、宣传文案库 PITCH。规范见 assets/brand/BRAND.md：
// 字标全小写（不做全大写科技字标）；标志不旋转斜切、不加发光/渐变/描边/投影，琥珀是唯一强调色。
// 纯 props 函数，只依赖 react；copy demo 时连同本文件一并带上并改 import 路径。
import React from 'react';

// 本片已換成「途見 TUJIAN」品牌（網站 tokens）：金 #d8b45a、夜藍 #0a0e13、米白 #ece6da；標誌是蓮花 A
export const BRAND = {
  name: '途見', // 正式名
  short: 'TUJIAN',
  repo: '',
  amber: '#D8B45A', // 品牌金
  ink: '#0A0E13', // 亮底上的標誌色
  paper: '#ECE6DA', // 暗底上的標誌色
  slate: '#A5AFBB', // 次級文字（暗底）
  font: '"Noto Serif SC", "Noto Serif TC", "Songti TC", STSong, serif', // 字標字體（襯線，本機已裝 Noto Serif SC 可變字重）
} as const;

// 蓮花 A：五瓣（viewBox 0 0 32 32）＋中心點，與網站 src/site-nav.js 同一組路徑
export const LOTUS_PETAL = 'M16 11.4C10.6 9.6 10.9 4.6 16 1.6 21.1 4.6 21.4 9.6 16 11.4Z';
export const LotusMark: React.FC<{ size?: number; color?: string; petals?: number; dot?: number; stroke?: number; style?: React.CSSProperties }> =
  ({ size = 96, color = BRAND.amber, petals = 1, dot = 1, stroke = 1.6, style }) => (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: 'block', overflow: 'visible', ...style }}>
      {[0, 72, 144, 216, 288].map((a, i) => {
        // petals 0→1：五瓣依序描出（每瓣用 pathLength 歸一化的虛線偏移）
        const p = Math.max(0, Math.min(1, petals * 5 - i));
        return p > 0 ? <path key={a} d={LOTUS_PETAL} transform={`rotate(${a} 16 16)`} fill="none" stroke={color} strokeWidth={stroke}
          strokeMiterlimit={8} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} /> : null;
      })}
      {dot > 0 && <circle cx={16} cy={16} r={2.3 * Math.min(1, dot)} fill={color} opacity={Math.min(1, dot)} />}
    </svg>
  );

// 标志的两段路径（viewBox 0 0 128 128）：frame = 开口取景框，cut = 斜切。分开导出，方便分段做动画
// （框先画出 / 斜切后划入、斜切单独上光等）。
export const MARK_PATHS = {
  frame: 'M16 16h96v26H42v44h70v26H16V16Z',
  cut: 'M92 48h28L84 84H56l36-36Z',
} as const;

// 标志。tone='dark' 用于暗底（取景框反白），'light' 用于亮底；frameColor / cutColor 可覆盖。
// cutProgress 0→1：斜切沿自身方向从无到有划入（默认 1 = 完整）；frameProgress 同理按取景框描出比例裁切。
export const ShotcraftMark: React.FC<{
  size?: number; tone?: 'dark' | 'light'; frameColor?: string; cutColor?: string;
  frameProgress?: number; cutProgress?: number; style?: React.CSSProperties;
}> = ({ size = 96, tone = 'dark', frameColor, cutColor, frameProgress = 1, cutProgress = 1, style }) => (
  <LotusMark size={size} color={frameColor ?? cutColor ?? (tone === 'dark' ? BRAND.amber : BRAND.ink)} petals={frameProgress} dot={cutProgress} style={style} />
);

// 字标：标志 + video-shotcraft 横排（logo-lockup.svg 的比例：标志高 ≈ 字号 2.1 倍，700 字重，+0.03em 字距）。
// size = 字号（px）；只要字不要标志时 mark={false}。
export const ShotcraftWordmark: React.FC<{
  size?: number; tone?: 'dark' | 'light'; color?: string; mark?: boolean;
  markScale?: number; gap?: number; weight?: number; fontFamily?: string; style?: React.CSSProperties;
}> = ({ size = 48, tone = 'dark', color, mark = true, markScale = 2.1, gap, weight, fontFamily, style }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: gap ?? size * 0.5, ...style }}>
    {mark && <ShotcraftMark size={size * markScale} tone={tone} />}
    <span style={{
      fontFamily: fontFamily ?? BRAND.font,
      fontSize: size, fontWeight: weight ?? 700, lineHeight: 1, letterSpacing: '0.03em', whiteSpace: 'nowrap',
      color: color ?? (tone === 'dark' ? BRAND.paper : BRAND.ink),
    }}>{BRAND.name}</span>
  </div>
);

// 宣传文案库——要写口号 / 标题 / 副标题 / 评价时从这里挑或照这个口径改写，别编与事实不符的数字
// （卡片数、star 数、用户数这类会变的数字不要写进画面）。
export const PITCH = {
  en: {
    motto: 'Frame motion. Craft the shot.', // 品牌短句（BRAND.md）
    taglines: [
      'One prompt to a finished promo.',
      'Cinematic product videos, crafted by your agent.',
      'Every shot, tuned in one place.',
      'Shot recipes for cinematic product films.',
      'Storyboard. Animate. Sound-design. Deliver.',
      'Your product, in motion.',
      'From screenshot to showreel.',
      'Direct the film. Let the agent shoot it.',
    ],
    features: [
      'Shot recipe cards', 'Real page captures', '2.5D camera moves', 'Beat-synced cuts',
      'Film-grade SFX', 'Motion workbench', 'Remotion render', 'JianYing export',
    ],
    praise: [
      'Feels like a launch film from a real studio.',
      'The first agent skill that actually understands pacing.',
      'Our promo shipped the same afternoon.',
      'Camera moves I would have keyframed for a week.',
      'Motion design without the motion designer bill.',
    ],
    works: 'An agent skill for Claude Code & Codex · Built on Remotion',
  },
  zh: {
    motto: '把运动，刻成镜头。', // 品牌短句（BRAND.md）
    taglines: [
      '一句话，出一支片。',
      '镜头配方卡，宣传片一键直出。',
      '让你的 agent 拍出电影感产品片。',
      '每一个镜头，都调到了位。',
      '分镜、动效、音效、交付，一条龙。',
      '把截图拍成大片。',
    ],
    features: ['镜头配方卡', '真实页面实拍', '2.5D 运镜', '踩点剪辑', '电影级音效', '动效工作台', 'Remotion 渲染', '剪映工程导出'],
    praise: [
      '像专业工作室做的发布片。',
      '第一个真正懂节奏的 agent 技能。',
      '下午提需求，晚上片子就上线了。',
      '这些运镜，我自己 K 帧要一周。',
    ],
    works: '适用于 Claude Code 与 Codex 的 agent 技能 · 基于 Remotion',
  },
} as const;
