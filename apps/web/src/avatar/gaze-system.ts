// ===== 程序化注视系统（纯逻辑，可单测）=====
// - 看向世界坐标目标点（计算头部局部偏航/俯仰）
// - 无明确目标时的随机扫视（saccade）
// - 眨眼节奏
// - 注视优先级：user（用户）> speaker（说话者）> random（随机点）
// 不依赖 three.js：输入世界坐标 + 自身朝向，输出局部 yaw/pitch 与眨眼度。

export interface GazePoint {
  x: number
  z: number
}

/** 注视目标来源（优先级从高到低） */
export type GazeSource = 'user' | 'speaker' | 'random'

const SOURCE_RANK: Record<GazeSource, number> = {
  user: 3,
  speaker: 2,
  random: 1,
}

export interface GazeAngles {
  /** 相对自身朝向的水平偏航（弧度，[-PI, PI]） */
  yaw: number
  /** 俯仰（弧度，正=抬头） */
  pitch: number
}

export interface GazeUpdate {
  /** 本帧选中的注视点（世界坐标） */
  point: GazePoint
  /** 眼睛睁开度 0~1（眨眼时短暂下降） */
  eyeOpen: number
  /** 本帧由哪个来源驱动 */
  source: GazeSource | 'none'
}

function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2)
  if (r > Math.PI) r -= Math.PI * 2
  if (r < -Math.PI) r += Math.PI * 2
  return r
}

/**
 * 计算从 from 看向 target 在自身 facingYaw 朝向系下的局部偏航与俯仰。
 * @param target 世界目标点
 * @param from   自身世界位置
 * @param facingYaw  自身面向角（弧度，three.js 中绕 Y 轴）
 */
export function gazeAnglesTo(target: GazePoint, from: GazePoint, facingYaw: number): GazeAngles {
  const dx = target.x - from.x
  const dz = target.z - from.z
  const worldYaw = Math.atan2(dx, dz) // three.js：前方为 +Z
  const yaw = wrapAngle(worldYaw - facingYaw)
  // 2D 坐标没有高度，俯仰按距离的一个经验衰减近似（近的抬眼多一点）
  const dist = Math.hypot(dx, dz) || 1
  const pitch = Math.atan(0.4 / dist)
  return { yaw, pitch }
}

export interface GazeTrackerOptions {
  /** 可注入的随机源（测试时传入确定性序列），默认 Math.random */
  random?: () => number
  /** 随机扫视间隔均值 ms，默认 2600 */
  saccadeMs?: number
  /** 眨眼平均间隔 ms，默认 3600 */
  blinkMs?: number
  /** 眨眼持续 ms，默认 160 */
  blinkDurationMs?: number
}

export interface GazeTracker {
  /** 设置某来源的注视目标；point 传 null 表示清除该来源 */
  setTarget: (source: GazeSource, point: GazePoint | null) => void
  /** 每帧驱动：返回本帧注视点/眨眼 */
  update: (now: number) => GazeUpdate
  /** 自身世界位置（注视角度计算用，仅元数据；角度由调用方结合 facingYaw 算） */
  setOrigin: (origin: GazePoint, facingYaw: number) => void
}

/**
 * 创建注视控制器。
 * 优先级：user > speaker > random；只有最高优先级来源存在时才看向它，
 * 否则在前方随机点之间做 saccade。眨眼按节奏独立运行。
 */
export function createGazeTracker(opts: GazeTrackerOptions = {}): GazeTracker {
  const rand = opts.random ?? Math.random
  const saccadeMs = opts.saccadeMs ?? 2600
  const blinkMs = opts.blinkMs ?? 3600
  const blinkDuration = opts.blinkDurationMs ?? 160

  const targets: Partial<Record<GazeSource, GazePoint>> = {}
  let origin: GazePoint = { x: 0, z: 0 }
  let facingYaw = 0

  let lastSaccadeAt = -Infinity
  let randomPoint: GazePoint = { x: 0, z: 2 }

  // 眨眼状态机
  let nextBlinkAt = rand() * blinkMs // 错开多角色眨眼
  let blinkStartAt = -Infinity

  function pickRandomPoint() {
    // 在前方 ±60°、2~5m 范围随机取一点
    const ang = (rand() - 0.5) * (Math.PI / 1.5)
    const dist = 2 + rand() * 3
    randomPoint = {
      x: Math.sin(ang) * dist,
      z: Math.cos(ang) * dist,
    }
  }
  pickRandomPoint()

  function activeSource(): GazeSource | 'none' {
    let best: GazeSource | 'none' = 'none'
    let bestRank = -1
    ;(['user', 'speaker', 'random'] as GazeSource[]).forEach((s) => {
      if (targets[s] && SOURCE_RANK[s] > bestRank) {
        best = s
        bestRank = SOURCE_RANK[s]
      }
    })
    return best
  }

  return {
    setOrigin(o, yaw) {
      origin = o
      facingYaw = yaw
    },
    setTarget(source, point) {
      if (point) targets[source] = point
      else delete targets[source]
    },
    update(now) {
      const src = activeSource()
      let point: GazePoint
      let active: GazeSource | 'none'
      if (src === 'user' || src === 'speaker') {
        point = targets[src]!
        active = src
      } else {
        // 无明确目标 → 随机扫视：到点换一个新随机点
        if (now - lastSaccadeAt >= saccadeMs) {
          lastSaccadeAt = now
          pickRandomPoint()
        }
        point = randomPoint
        active = 'random'
      }

      // —— 眨眼节奏 ——
      let eyeOpen = 1
      if (now >= nextBlinkAt && blinkStartAt < 0) {
        blinkStartAt = now
        nextBlinkAt = now + blinkMs * (0.7 + rand() * 0.6)
      }
      if (blinkStartAt >= 0) {
        const t = (now - blinkStartAt) / blinkDuration
        if (t >= 1) {
          blinkStartAt = -Infinity
        } else {
          // 中间闭合：1 - sin(pi*t) 形成快速闭眼再睁开
          eyeOpen = 1 - Math.sin(t * Math.PI) * 0.9
        }
      }

      return { point, eyeOpen, source: active }
    },
  }
}

export { wrapAngle }
