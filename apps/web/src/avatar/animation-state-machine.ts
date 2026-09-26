// ===== 动画状态机纯逻辑（可单测）=====
// 与 three.js / React 解耦：只负责状态转换与姿势曲线计算。
// 姿势（pose）是一个扁平的 key→number 表，由 avatar-rig 解释并驱动到
// blendshape / 骨骼 / 程序化子节点上。

import type { EmoteType } from '@balabala/shared'

export type AnimState = 'idle' | 'talking' | 'wave' | 'nod' | 'shake' | 'point' | 'clap' | 'laugh' | 'surprised'

/** 状态机事件 */
export type AnimEvent =
  | { type: 'talk_start' }
  | { type: 'talk_end' }
  | { type: 'emote'; emote: EmoteType; durationMs?: number }

/** 姿势参数表：取值 0~1 或弧度，由 rig 解释 */
export type Pose = Record<string, number>

/** 各 emote 的默认时长（ms），未显式传 durationMs 时使用 */
export const EMOTE_DEFAULT_DURATION: Record<EmoteType, number> = {
  wave: 1600,
  nod: 900,
  shake: 900,
  point: 1400,
  clap: 1600,
  laugh: 1600,
  surprised: 1500,
}

const EMOTE_TO_STATE: Record<EmoteType, AnimState> = {
  wave: 'wave',
  nod: 'nod',
  shake: 'shake',
  point: 'point',
  clap: 'clap',
  laugh: 'laugh',
  surprised: 'surprised',
}

interface MachineInternal {
  state: AnimState
  /** 是否处于「说话中」（与视觉状态解耦：emote 期间不打断） */
  talking: boolean
  /** emote 起始时间戳 */
  emoteStartAt: number
  /** 当前 emote 总时长 */
  emoteDuration: number
}

export interface AnimationMachine {
  /** 当前视觉状态 */
  readonly state: AnimState
  /** 处理事件，返回是否发生了转换 */
  transition: (event: AnimEvent, now: number) => void
  /** 每帧调用：检查 emote 是否超时并回归 */
  update: (now: number) => void
  /** 当前是否处于说话（含 emote 结束后应回到 talking 的情况） */
  isTalking: () => boolean
}

/**
 * 创建动画状态机。
 * talking 标志与视觉状态解耦：emote 播放期间 talk_start/talk_end 只会更新
 * talking 标志，不会打断正在播放的 emote；emote 结束后按 talking 回归。
 */
export function createAnimationMachine(): AnimationMachine {
  const m: MachineInternal = {
    state: 'idle',
    talking: false,
    emoteStartAt: 0,
    emoteDuration: 0,
  }

  const inEmote = () => m.state === 'wave' || m.state === 'nod' || m.state === 'shake' ||
    m.state === 'point' || m.state === 'clap' || m.state === 'laugh' || m.state === 'surprised'

  return {
    get state() {
      return m.state
    },

    transition(event, now) {
      switch (event.type) {
        case 'talk_start': {
          m.talking = true
          // emote 播放期间不打断，仅记录意图
          if (!inEmote()) m.state = 'talking'
          break
        }
        case 'talk_end': {
          m.talking = false
          if (!inEmote()) m.state = 'idle'
          break
        }
        case 'emote': {
          // 新 emote 可打断旧 emote，重新计时
          const dur = event.durationMs ?? EMOTE_DEFAULT_DURATION[event.emote]
          m.state = EMOTE_TO_STATE[event.emote]
          m.emoteStartAt = now
          m.emoteDuration = dur
          break
        }
      }
    },

    update(now) {
      if (!inEmote()) return
      if (now - m.emoteStartAt >= m.emoteDuration) {
        m.state = m.talking ? 'talking' : 'idle'
      }
    },

    isTalking() {
      return m.talking
    },
  }
}

/**
 * 根据状态与进入该状态后的经过时间，计算一帧的姿势参数。
 * 所有数值为 0~1（或角度弧度），由 rig 映射到具体骨骼/blendshape。
 * jawOpen 由口型 hook 另行叠加，这里只给姿势基础值。
 *
 * @param state    当前动画状态
 * @param elapsedMs 进入该状态后的经过毫秒数
 */
export function getPose(state: AnimState, elapsedMs: number): Pose {
  // 基础姿势：轻微呼吸浮动
  const breath = Math.sin(elapsedMs / 600) * 0.03
  const pose: Pose = {
    jawOpen: 0,
    headTilt: 0,      // 俯仰（点头方向），弧度
    headTurn: 0,      // 左右转头（摇头方向），弧度
    headRoll: 0,      // 歪头
    armRaiseL: 0,     // 左臂抬起 0~1
    armRaiseR: 0,     // 右臂抬起 0~1
    armSwingL: 0,     // 左臂前后摆动角度
    armSwingR: 0,
    bodyLean: 0,      // 身体前倾/后仰 0~1
    browRaise: 0,     // 眉毛抬起 0~1
    eyeOpen: 1,       // 眼睛睁开 0~1
    bounce: breath,   // 身体上下浮动
  }

  switch (state) {
    case 'idle': {
      // 轻微呼吸 + 偶尔微动
      pose.headRoll = Math.sin(elapsedMs / 1400) * 0.05
      break
    }
    case 'talking': {
      // 说话时头部轻微点动，身体微晃
      const t = elapsedMs / 1000
      pose.headTilt = Math.sin(t * 6) * 0.06
      pose.bodyLean = 0.05 + Math.sin(t * 4) * 0.02
      break
    }
    case 'wave': {
      // 右臂高举，正弦摆动
      pose.armRaiseR = 1
      pose.armSwingR = Math.sin(elapsedMs / 120) * 0.6
      pose.headTilt = -0.1
      break
    }
    case 'nod': {
      // 头部上下点
      pose.headTilt = Math.sin(elapsedMs / 90) * 0.35
      pose.bodyLean = 0.1
      break
    }
    case 'shake': {
      // 头部左右摇
      pose.headTurn = Math.sin(elapsedMs / 90) * 0.45
      break
    }
    case 'point': {
      // 右臂前伸指向，轻微抖动
      pose.armRaiseR = 0.6
      pose.armSwingR = 0.9
      pose.headTurn = 0.2
      break
    }
    case 'clap': {
      // 双臂抬起胸前，靠近拍合
      pose.armRaiseL = 0.7
      pose.armRaiseR = 0.7
      const clap = Math.abs(Math.sin(elapsedMs / 110))
      pose.armSwingL = -0.4 + clap * 0.3
      pose.armSwingR = 0.4 - clap * 0.3
      break
    }
    case 'laugh': {
      // 笑：后仰、张嘴、挑眉
      pose.bodyLean = 0.25
      pose.jawOpen = 0.6
      pose.browRaise = 0.5
      pose.headTilt = -0.15
      pose.armRaiseL = 0.2
      pose.armRaiseR = 0.2
      break
    }
    case 'surprised': {
      // 惊讶：挑眉、张嘴、后仰
      pose.browRaise = 1
      pose.jawOpen = 0.7
      pose.bodyLean = 0.2
      pose.eyeOpen = 1.1
      break
    }
  }
  return pose
}
