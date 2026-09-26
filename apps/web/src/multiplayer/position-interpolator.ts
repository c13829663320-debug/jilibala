// ===== R4-01: 远端玩家位置插值 + 丢包外推 =====
//
// 纯 TS、无 DOM / Three 依赖，可在 node 环境直接单测。
//
// 背景：
//  - 服务端位置更新带递增 seq，但网络存在抖动与丢包。
//  - 若客户端每收到一个包就把化身瞬移过去，会看到抖动/跳变。
//  - 做法：渲染时把远端位置「滞后 100ms」做线性插值；
//    检测到 seq 跳跃（丢包）时，用最近速度外推，直到下一个真实位置到达。
//
// 注意：Three.js/浏览器侧的每帧集成（把 getPosition 结果喂给远端化身 mesh）
// 需在真机 WebGL 环境确认，云端无 GPU。

export interface PositionSample {
  userId: string
  x: number
  z: number
  rotation: number
  /** 服务端递增序号；缺失（旧服务端）时按 0 处理，不触发丢包逻辑 */
  seq: number
  /** 采样到达/发生时间（ms，由调用方时钟注入，便于测试） */
  t: number
}

export interface RenderedPosition {
  x: number
  z: number
  rotation: number
  /** 当前是否处于丢包外推状态 */
  extrapolating: boolean
  /** 距上一真实样本的时间（ms） */
  ageMs: number
}

export interface InterpolatorOptions {
  /** 渲染插值延迟（ms）。默认 100。 */
  interpolationDelayMs?: number
  /** 丢包后继续外推的最长时间（ms），超过则保持原位。默认 600。 */
  maxExtrapolationMs?: number
}

interface Track {
  /** 最近一个样本 */
  last: { x: number; z: number; rotation: number; seq: number; t: number }
  /** 上一个样本（用于插值与速度估计） */
  prev: { x: number; z: number; rotation: number; seq: number; t: number } | null
  /** 自上一样本起检测到的丢包数（seq 缺口）；新样本到达后清零 */
  pendingGap: number
}

const DEFAULTS = {
  interpolationDelayMs: 100,
  maxExtrapolationMs: 600,
} as const;

export class PositionInterpolator {
  private readonly tracks = new Map<string, Track>()
  private readonly interpolationDelayMs: number
  private readonly maxExtrapolationMs: number

  constructor(options: InterpolatorOptions = {}) {
    this.interpolationDelayMs = options.interpolationDelayMs ?? DEFAULTS.interpolationDelayMs
    this.maxExtrapolationMs = options.maxExtrapolationMs ?? DEFAULTS.maxExtrapolationMs
  }

  /** 收到一个远端位置样本（presence 中该玩家条目）。 */
  update(sample: PositionSample): void {
    const track = this.tracks.get(sample.userId)
    if (!track) {
      this.tracks.set(sample.userId, {
        last: { x: sample.x, z: sample.z, rotation: sample.rotation, seq: sample.seq, t: sample.t },
        prev: null,
        pendingGap: 0,
      })
      return
    }

    // 乱序/过期样本：忽略，不回退位置
    if (sample.seq <= track.last.seq) return

    // 序号跳跃 = 丢包。记录缺口，供 getPosition 进入外推。
    const expected = track.last.seq + 1
    if (sample.seq > expected) {
      track.pendingGap = sample.seq - expected
    } else {
      track.pendingGap = 0
    }

    track.prev = track.last
    track.last = { x: sample.x, z: sample.z, rotation: sample.rotation, seq: sample.seq, t: sample.t }
  }

  /**
   * 计算某远端玩家在 now 时刻应渲染的位置。
   * - 正常：在 (now - interpolationDelay) 时刻的两个样本间线性插值。
   * - 丢包且未超时：沿最近速度外推。
   * - 外推超时：保持最后已知位置。
   */
  getPosition(userId: string, now: number): RenderedPosition | null {
    const track = this.tracks.get(userId)
    if (!track) return null
    const { last, prev } = track
    const age = now - last.t

    // 1) 仍在插值延迟窗内：渲染「过去」位置，在 prev→last 间插值
    if (age <= this.interpolationDelayMs) {
      if (prev && prev.t !== last.t) {
        const targetT = now - this.interpolationDelayMs
        const f = Math.min(1, Math.max(0, (targetT - prev.t) / (last.t - prev.t)))
        return {
          x: prev.x + (last.x - prev.x) * f,
          z: prev.z + (last.z - prev.z) * f,
          rotation: last.rotation,
          extrapolating: false,
          ageMs: age,
        }
      }
      return { x: last.x, z: last.z, rotation: last.rotation, extrapolating: false, ageMs: age }
    }

    // 2) 已超过最后样本：若检测到丢包且外推未超时，用最近速度外推
    if (track.pendingGap > 0 && prev && age <= this.maxExtrapolationMs) {
      const dt = (last.t - prev.t) / 1000
      if (dt > 0) {
        const vx = (last.x - prev.x) / dt
        const vz = (last.z - prev.z) / dt
        const ahead = age / 1000
        return {
          x: last.x + vx * ahead,
          z: last.z + vz * ahead,
          rotation: last.rotation,
          extrapolating: true,
          ageMs: age,
        }
      }
    }

    // 3) 无丢包 / 外推超时：保持最后已知位置
    return { x: last.x, z: last.z, rotation: last.rotation, extrapolating: track.pendingGap > 0, ageMs: age }
  }

  /** 该玩家是否有待补偿的丢包。 */
  hasGap(userId: string): boolean {
    return (this.tracks.get(userId)?.pendingGap ?? 0) > 0
  }

  remove(userId: string): void {
    this.tracks.delete(userId)
  }

  clear(): void {
    this.tracks.clear()
  }
}
