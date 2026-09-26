// ===== 地形高度 / 碰撞 纯函数模块 =====
// 自包含：不依赖 three、不依赖外部噪声库，仅用 mulberry32 + 256x256 梯度网格双线性插值。
// 可在 node 环境单测（vitest environment: node）。

import type { SceneBlueprint, SceneStructure } from '@balabala/shared'

/** mulberry32 伪随机数生成器：seed 决定序列，同 seed 同序列。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GRID_N = 256
const gridCache = new Map<number, Float32Array>()

/** 按 seed 取一张 [-1, 1] 的 256x256 噪声梯度网格（带缓存）。 */
function getGrid(seed: number): Float32Array {
  const cached = gridCache.get(seed)
  if (cached) return cached
  const rand = mulberry32(seed)
  const grid = new Float32Array(GRID_N * GRID_N)
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rand() * 2 - 1
  }
  gridCache.set(seed, grid)
  return grid
}

/** smoothstep 插值，让噪声更自然。 */
function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** 在 (x, z) 处采样单层 value noise（网格坐标可环绕，便于多 octave 叠加）。 */
function sampleNoise(x: number, z: number, seed: number): number {
  const grid = getGrid(seed)
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const tx = x - xi
  const tz = z - zi
  const x0 = ((xi % GRID_N) + GRID_N) % GRID_N
  const x1 = (x0 + 1) % GRID_N
  const z0 = ((zi % GRID_N) + GRID_N) % GRID_N
  const z1 = (z0 + 1) % GRID_N
  const sx = smooth(tx)
  const sz = smooth(tz)
  const v00 = grid[z0 * GRID_N + x0]
  const v10 = grid[z0 * GRID_N + x1]
  const v01 = grid[z1 * GRID_N + x0]
  const v11 = grid[z1 * GRID_N + x1]
  const a = v00 + (v10 - v00) * sx
  const b = v01 + (v11 - v01) * sx
  return a + (b - a) * sz
}

export interface TerrainParams {
  /** 高度振幅，默认 3 */
  amplitude?: number
  /** 基础频率（每米的网格数），默认 0.05 */
  frequency?: number
  /** octave 层数，默认 4 */
  octaves?: number
}

/**
 * 计算世界坐标 (x, z) 处的地形高度 y。
 * - seed 决定随机序列（同 seed 同输入必同输出）。
 * - size 是地形边长（米），地形以原点为中心。
 * - 边界处高度渐降为 0，防止玩家走出地形。
 */
export function terrainHeight(
  x: number,
  z: number,
  seed: number,
  size: number,
  params?: Record<string, number> | TerrainParams,
): number {
  const amplitude = params?.amplitude ?? 3
  const frequency = params?.frequency ?? 0.05
  const octaves = Math.max(1, Math.floor(params?.octaves ?? 4))

  let total = 0
  let amp = 1
  let freq = frequency
  let maxAmp = 0
  for (let o = 0; o < octaves; o++) {
    // 每个 octave 用不同的 seed 偏移，避免网格对齐
    total += sampleNoise(x * freq, z * freq, (seed + o * 101) >>> 0) * amp
    maxAmp += amp
    amp *= 0.5
    freq *= 2
  }
  let h = (total / maxAmp) * amplitude

  // 边界渐降：距离边界 margin 米内，高度线性衰减到 0
  const half = size / 2
  const margin = Math.min(8, half * 0.25)
  const distToEdge = Math.min(half - Math.abs(x), half - Math.abs(z))
  if (distToEdge < margin) {
    const t = Math.max(0, distToEdge / margin)
    h *= t
  }
  return h
}

/** 在 spawnPoint 处求出角色脚底 y，并加上 1.5（角色半高）作为出生中心高度。 */
export function resolveSpawnHeight(blueprint: SceneBlueprint): number {
  const [x, , z] = blueprint.spawnPoint
  const y = terrainHeight(
    x,
    z,
    blueprint.terrain.heightSeed,
    blueprint.terrain.size,
    blueprint.terrain.params,
  )
  return y + 1.5
}

/**
 * 碰撞检测纯函数。
 * - 结构 bbox 近似：以 position 为中心、max(scale.x, scale.z) * 1.5 为半宽的 AABB。
 * - bounds = [minX, minZ, maxX, maxZ]，超出即碰撞。
 * - radius 为玩家半径，返回 true 表示不可移动。
 */
export function checkCollision(
  position: [number, number, number],
  radius: number,
  structures: SceneStructure[],
  bounds: [number, number, number, number],
): boolean {
  const [x, , z] = position
  const [minX, minZ, maxX, maxZ] = bounds
  if (x - radius < minX || x + radius > maxX || z - radius < minZ || z + radius > maxZ) {
    return true
  }
  for (const s of structures) {
    const [sx, , sz] = s.position
    const halfW = Math.max(s.scale[0], s.scale[2]) * 1.5
    if (Math.abs(x - sx) < halfW + radius && Math.abs(z - sz) < halfW + radius) {
      return true
    }
  }
  return false
}
