// ===== 程序化手势系统（纯逻辑，可单测）=====
// 定义手势库：wave/point/peace/thumbs_up/fist/open_palm/ok。
// 输出一份 Pose（手臂/手部节点旋转表），由 avatar-rig 解释到 arm/hand 节点。
// 不依赖 three.js：纯数学 + 时间轴曲线，便于 node 环境单测。

import type { Pose } from './animation-state-machine'

/** 手势枚举 */
export type GestureType =
  | 'none'
  | 'wave'
  | 'point'
  | 'peace'
  | 'thumbs_up'
  | 'fist'
  | 'open_palm'
  | 'ok'

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** 姿势基线：所有通道归零，手势在其上叠加 */
function basePose(): Pose {
  return {
    armRaiseL: 0,
    armRaiseR: 0,
    armSwingL: 0,
    armSwingR: 0,
    armTwistL: 0,
    armTwistR: 0,
    handGripL: 0,   // 握拳程度 0=张开, 1=满拳
    handGripR: 0,
    handPitchL: 0,  // 手腕俯仰（弧度）
    handPitchR: 0,
  }
}

/**
 * 根据手势与进入手势后的经过毫秒数，计算一帧的手臂/手部姿势。
 * - wave：随时间往复摆动（需要 elapsedMs）
 * - 其余为静态姿势，elapsedMs 仅用于极轻微的呼吸抖动
 *
 * @param gesture   手势
 * @param elapsedMs 进入该手势后的毫秒数（波形手势随时间变化）
 */
export function getGesturePose(gesture: GestureType, elapsedMs: number): Pose {
  const p = basePose()
  switch (gesture) {
    case 'wave': {
      // 右臂高举过头，前后/左右摆动
      p.armRaiseR = 1
      p.armSwingR = Math.sin(elapsedMs / 120) * 0.5
      p.armTwistR = 0.2
      p.handGripR = 0 // 挥手时手掌张开
      break
    }
    case 'point': {
      // 右臂前伸，食指方向用手臂伸直近似，手掌半开
      p.armRaiseR = 0.55
      p.armSwingR = 1.0
      p.handGripR = 0.35
      break
    }
    case 'peace': {
      // 右臂抬起胸前，手掌张开（V 字用整体张开近似）
      p.armRaiseR = 0.5
      p.armSwingR = 0.3
      p.handGripR = 0.15
      p.handPitchR = -0.2
      break
    }
    case 'thumbs_up': {
      // 右臂侧抬，拳头握起、手腕上翻（拇指竖起近似）
      p.armRaiseR = 0.35
      p.armTwistR = -0.6
      p.handGripR = 0.85
      p.handPitchR = -0.5
      break
    }
    case 'fist': {
      // 双手握拳
      p.handGripL = 1
      p.handGripR = 1
      p.armRaiseL = 0.15
      p.armRaiseR = 0.15
      break
    }
    case 'open_palm': {
      // 双手自然张开
      p.handGripL = 0
      p.handGripR = 0
      p.armRaiseR = 0.2
      break
    }
    case 'ok': {
      // 右臂抬起，手呈 O（半握 + 手腕放平）
      p.armRaiseR = 0.5
      p.armSwingR = 0.35
      p.handGripR = 0.55
      p.handPitchR = 0.1
      break
    }
    case 'none':
    default:
      break
  }
  return p
}

/** 判断某个手势是否为「动效型」（随时间变化），用于控制器决定是否需要持续刷新 */
export function isAnimatedGesture(gesture: GestureType): boolean {
  return gesture === 'wave'
}

/** 所有手势枚举（供 UI 遍历） */
export const ALL_GESTURES: GestureType[] = [
  'none', 'wave', 'point', 'peace', 'thumbs_up', 'fist', 'open_palm', 'ok',
]

export { clamp01 }
