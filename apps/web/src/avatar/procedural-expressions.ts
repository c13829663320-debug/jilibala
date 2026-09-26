// ===== 程序化表情系统（纯逻辑，可单测）=====
// 在 avatar-rig 的 setExpression（仅 neutral/happy/surprised/angry）之上扩展，
// 支持更丰富的表情：happy/sad/angry/surprised/fear/disgust/contempt/smirk。
// 每个表情由一组「面部权重」组合描述：眉/眼/嘴/头，再由 rig 映射到
// blendshape 权重或程序化节点。本文件不依赖 three.js，方便 node 环境单测。

import type { Pose } from './animation-state-machine'

/** 比 shared.AvatarExpression 更丰富的表情集合（本地扩展，不污染共享类型） */
export type ProceduralExpression =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'fear'
  | 'disgust'
  | 'contempt'
  | 'smirk'

/**
 * 一组可解释的面部权重。所有 0~1 的通道用于 blendshape/程序化映射；
 * head* 为弧度，由控制器叠加到头部旋转上。
 */
export interface ExpressionWeights {
  /** 眉毛整体上扬 0~1 */
  browUp: number
  /** 眉毛下压/内扣 0~1（悲伤/愤怒） */
  browDown: number
  /** 眉头紧锁靠拢 0~1（愤怒/专注） */
  browSqueeze: number
  /** 眼睛睁开度：1=常态，>1=睁大，<1=眯眼 */
  eyeOpen: number
  /** 眯眼/紧眼 0~1 */
  eyeSquint: number
  /** 嘴张开 0~1 */
  jawOpen: number
  /** 嘴角上扬 0~1 */
  smile: number
  /** 嘴角下撇 0~1 */
  frown: number
  /** 头部俯仰（点头方向）弧度 */
  headTilt: number
  /** 头部左右转弧度 */
  headTurn: number
  /** 头部侧倾弧度 */
  headRoll: number
}

/** 中性表情基线 */
export const NEUTRAL_WEIGHTS: ExpressionWeights = {
  browUp: 0,
  browDown: 0,
  browSqueeze: 0,
  eyeOpen: 1,
  eyeSquint: 0,
  jawOpen: 0,
  smile: 0,
  frown: 0,
  headTilt: 0,
  headTurn: 0,
  headRoll: 0,
}

/** 各表情的目标权重表（参考面部动作编码 FACS 的简化版） */
const EXPRESSION_TABLE: Record<ProceduralExpression, ExpressionWeights> = {
  neutral: { ...NEUTRAL_WEIGHTS },
  happy: {
    ...NEUTRAL_WEIGHTS,
    browUp: 0.25,
    eyeSquint: 0.25,
    jawOpen: 0.15,
    smile: 0.9,
    headRoll: 0.05,
  },
  sad: {
    ...NEUTRAL_WEIGHTS,
    browUp: 0.35,      // 眉头上扬
    browDown: 0.3,     // 眉尾下压
    eyeOpen: 0.7,
    frown: 0.85,
    headTilt: 0.12,    // 低头
  },
  angry: {
    ...NEUTRAL_WEIGHTS,
    browDown: 0.9,
    browSqueeze: 0.9,
    eyeOpen: 0.85,
    eyeSquint: 0.3,
    frown: 0.3,
    headTilt: 0.15,    // 低头逼近
    headRoll: -0.06,
  },
  surprised: {
    ...NEUTRAL_WEIGHTS,
    browUp: 1,
    eyeOpen: 1.35,
    jawOpen: 0.6,
    headTilt: -0.1,    // 微仰头
  },
  fear: {
    ...NEUTRAL_WEIGHTS,
    browUp: 0.8,
    browSqueeze: 0.4,
    eyeOpen: 1.3,
    jawOpen: 0.45,
    frown: 0.4,
    headTilt: -0.08,
  },
  disgust: {
    ...NEUTRAL_WEIGHTS,
    browDown: 0.5,
    browSqueeze: 0.3,
    eyeSquint: 0.5,
    frown: 0.5,
    headTilt: 0.1,
    headTurn: -0.25,   // 偏头躲开
  },
  contempt: {
    ...NEUTRAL_WEIGHTS,
    browUp: 0.2,
    smile: 0.4,        // 单侧轻蔑冷笑用不对称近似（整体微笑）
    frown: 0,
    headTilt: -0.05,
    headRoll: 0.12,    // 歪头
  },
  smirk: {
    ...NEUTRAL_WEIGHTS,
    browUp: 0.15,
    smile: 0.55,
    eyeSquint: 0.15,
    headRoll: 0.08,
    headTurn: 0.1,
  },
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** 取某表情的面部权重表（未知值回退 neutral） */
export function getExpressionWeights(expression: ProceduralExpression): ExpressionWeights {
  return EXPRESSION_TABLE[expression] ?? { ...NEUTRAL_WEIGHTS }
}

/**
 * 将面部权重映射为 rig 可消费的姿势增量（Pose）。
 * 只产出面部/头部通道，不动手臂；由 AvatarController 与状态机姿势合并。
 * - browRaise：由 browUp 减 browDown（正=抬眉，负=压眉）
 * - eyeOpen：基线 1，受睁大/眯眼共同调制
 * - jawOpen：表情自带的张嘴（笑/惊讶）
 */
export function expressionWeightsToPose(w: ExpressionWeights): Pose {
  const browRaise = clamp01(w.browUp) - clamp01(w.browDown)
  // 睁大抬升睁开度，眯眼压低；钳到 [0, 1.4]
  const eyeOpen = Math.min(1.4, Math.max(0, w.eyeOpen - w.eyeSquint * 0.6))
  return {
    browRaise,
    eyeOpen,
    jawOpen: clamp01(w.jawOpen),
    headTilt: w.headTilt,
    headTurn: w.headTurn,
    headRoll: w.headRoll,
  }
}

/** 便捷：表情 → 姿势增量一步到位 */
export function expressionToPose(expression: ProceduralExpression): Pose {
  return expressionWeightsToPose(getExpressionWeights(expression))
}

/**
 * 把旧的 shared.AvatarExpression（neutral/happy/surprised/angry）映射到新系统，
 * 保证 RemoteAvatar 现有调用无痛接入。
 */
export function legacyExpressionToProcedural(
  expr: 'neutral' | 'happy' | 'surprised' | 'angry' | string | undefined,
): ProceduralExpression {
  switch (expr) {
    case 'happy': return 'happy'
    case 'surprised': return 'surprised'
    case 'angry': return 'angry'
    case 'neutral':
    default: return 'neutral'
  }
}

/** 所有受支持的表情枚举（供 UI 遍历） */
export const ALL_EXPRESSIONS: ProceduralExpression[] = [
  'neutral', 'happy', 'sad', 'angry', 'surprised', 'fear', 'disgust', 'contempt', 'smirk',
]
