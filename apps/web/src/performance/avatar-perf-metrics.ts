/**
 * 化身性能指标采集（开发面板用）。
 *
 * 采集项：
 *   - drawCalls：场景中该化身贡献的 mesh 数（≈ draw call）
 *   - triangles：累计三角形数
 *   - bones：骨骼蒙皮关节数
 *   - animEvalMs：单帧姿势/动画评估耗时（滚动平均）
 *
 * 设计：滚动平均部分与 three.js 解耦，便于单测；three.js 遍历为薄封装。
 * 在 R3F 组件里：beginAnim() → 跑姿势 → endAnim()；每 N 帧 collectAvatarStats()。
 */
import type * as THREE from 'three'
import type { LodLevel } from '../avatar/avatar-lod'

export interface AvatarPerfSample {
  avatarId: string
  level: LodLevel
  drawCalls: number
  triangles: number
  bones: number
  /** 最近一次动画评估耗时（ms）。 */
  lastAnimEvalMs: number
  /** 滚动平均动画评估耗时（ms）。 */
  avgAnimEvalMs: number
}

/** 滚动窗口大小。 */
const WINDOW = 30

function nowMs(): number {
  // 兼容 node 单测（无 performance）
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

/** 单个化身的动画耗时采样器（纯逻辑，可单测）。 */
export class AnimTimer {
  private start = 0
  private running = false
  private samples: number[] = []
  private clock: () => number

  constructor(clock: () => number = nowMs) {
    this.clock = clock
  }

  begin(): void {
    this.start = this.clock()
    this.running = true
  }

  end(): number {
    if (!this.running) return 0
    this.running = false
    const ms = this.clock() - this.start
    this.samples.push(ms)
    if (this.samples.length > WINDOW) this.samples.shift()
    return ms
  }

  /** 最近一次耗时。 */
  get last(): number {
    return this.samples.length ? this.samples[this.samples.length - 1] : 0
  }

  /** 滚动平均耗时。 */
  get avg(): number {
    if (!this.samples.length) return 0
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length
  }

  get sampleCount(): number {
    return this.samples.length
  }
}

/**
 * 从 three.js 对象树统计 draw call / 三角形 / 骨骼数。
 * 薄封装：不做缓存，调用方每 N 帧调一次即可。
 */
export function collectAvatarStats(root: THREE.Object3D): { drawCalls: number; triangles: number; bones: number } {
  let drawCalls = 0
  let triangles = 0
  const boneSet = new Set<THREE.Object3D>()

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if ((mesh as unknown as { isMesh?: boolean }).isMesh && mesh.geometry) {
      drawCalls++
      const geo = mesh.geometry
      const index = geo.getIndex()
      const pos = geo.getAttribute('position')
      if (index) triangles += Math.floor(index.count / 3)
      else if (pos) triangles += Math.floor(pos.count / 3)
    }
    const skinned = obj as THREE.SkinnedMesh
    if ((skinned as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh && skinned.skeleton) {
      for (const bone of skinned.skeleton.bones) boneSet.add(bone)
    }
  })

  return { drawCalls, triangles, bones: boneSet.size }
}

/** 汇总成一份可直接渲染到开发面板的样本。 */
export function buildSample(
  avatarId: string,
  level: LodLevel,
  stats: { drawCalls: number; triangles: number; bones: number },
  timer: AnimTimer,
): AvatarPerfSample {
  return {
    avatarId,
    level,
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    bones: stats.bones,
    lastAnimEvalMs: timer.last,
    avgAnimEvalMs: timer.avg,
  }
}
