/**
 * M13 第五轮 — 法庭 13 角色内置席位纯逻辑（无 React / three 依赖，仅数值与字符串）。
 *
 * 固定席位（接 apps/web/public/models/court/*.glb）：
 *   judge / plaintiff / plaintiff-counsel / defendant / defendant-counsel / witness / juror
 *   + audience-01..06（后部阶梯长椅氛围 NPC，不发言、不朗读、不高亮）。
 *
 * 坐标基准（第四轮已视觉验证）：
 *   房间 x/z ∈ [-5.4, 5.4]，相机主全景 [0,4.0,1.6]→[0,1.3,-0.8]；
 *   法官桌后 [0,1.0,-2.9]，原被告桌后 [±2.7,0.62,-0.4]，动态辩护人排 [±3.9,0.62,0.4]；
 *   后部旁听席阶梯长椅在 z≈2~5（相机 z=1.6 在其前方过道，不穿模）。
 *
 * 朝向（模型默认面向 +z，即朝观众/相机）：
 *   judge 面向法庭(+z) → facing=0；
 *   原被告/双方律师/证人/陪审团/旁听者 面向法官(-z) → facing=π。
 */
import type { CourtTurn } from '@balabala/shared'

export type CourtSeatKind =
  | 'judge'
  | 'plaintiff'
  | 'plaintiff-counsel'
  | 'defendant'
  | 'defendant-counsel'
  | 'witness'
  | 'juror'
  | 'audience'
  | 'defender' // 名人 / custom 动态辩护人（沿用旧逻辑）

export type Vec3 = [number, number, number]

export interface FixedSeatSpec {
  id: string
  name: string
  kind: CourtSeatKind
  model: string
  position: Vec3
  /** 绕 Y 轴朝向（弧度）。0 = 面向 +z（法庭/观众），π = 面向 -z（法官）。 */
  facing: number
  /** 氛围 NPC：不进发言轮次、不高亮、不朗读、不挂名牌。 */
  npc: boolean
}

export const COURT_MODELS_DIR = '/models/court'

/** seatToModel：固定席位角色 → 对应 GLB URL。audience 用 index 选 01..06。 */
export function seatModelUrl(kind: Exclude<CourtSeatKind, 'defender'>, audienceIndex = 0): string {
  switch (kind) {
    case 'judge': return `${COURT_MODELS_DIR}/judge.glb`
    case 'plaintiff': return `${COURT_MODELS_DIR}/plaintiff.glb`
    case 'plaintiff-counsel': return `${COURT_MODELS_DIR}/plaintiff-counsel.glb`
    case 'defendant': return `${COURT_MODELS_DIR}/defendant.glb`
    case 'defendant-counsel': return `${COURT_MODELS_DIR}/defendant-counsel.glb`
    case 'witness': return `${COURT_MODELS_DIR}/witness.glb`
    case 'juror': return `${COURT_MODELS_DIR}/juror.glb`
    case 'audience': {
      const n = String(audienceIndex + 1).padStart(2, '0')
      return `${COURT_MODELS_DIR}/audience-${n}.glb`
    }
  }
}

/** 是否氛围 NPC（旁听者 / 陪审团 / 证人）——永不进发言轮次。 */
export function isNpcKind(kind: CourtSeatKind): boolean {
  return kind === 'audience' || kind === 'juror' || kind === 'witness'
}

const PI = Math.PI

/**
 * 核心 7 固定席位 + 6 旁听者。
 * 律师位与当事人同桌（z=-0.4），动态名人辩护人仍排 z=0.4（旧坐标不动）。
 */
export function buildFixedSeats(): FixedSeatSpec[] {
  const seats: FixedSeatSpec[] = [
    {
      id: 'seat-judge', name: '法官', kind: 'judge',
      model: seatModelUrl('judge'),
      position: [0, 1.0, -2.9],
      facing: 0, // 面向法庭(+z)
      npc: false,
    },
    {
      id: 'seat-plaintiff', name: '原告', kind: 'plaintiff',
      model: seatModelUrl('plaintiff'),
      position: [-2.7, 0.62, -0.4],
      facing: PI, // 面向法官(-z)
      npc: false,
    },
    {
      id: 'seat-plaintiff-counsel', name: '原告律师', kind: 'plaintiff-counsel',
      model: seatModelUrl('plaintiff-counsel'),
      position: [-3.6, 0.62, -0.4],
      facing: PI,
      npc: false,
    },
    {
      id: 'seat-defendant', name: '被告', kind: 'defendant',
      model: seatModelUrl('defendant'),
      position: [2.7, 0.62, -0.4],
      facing: PI,
      npc: false,
    },
    {
      id: 'seat-defendant-counsel', name: '被告律师', kind: 'defendant-counsel',
      model: seatModelUrl('defendant-counsel'),
      position: [3.6, 0.62, -0.4],
      facing: PI,
      npc: false,
    },
    {
      id: 'seat-witness', name: '证人', kind: 'witness',
      model: seatModelUrl('witness'),
      position: [0, 0.62, -1.4],
      facing: PI, // 面向法官
      npc: true,
    },
    {
      id: 'seat-juror', name: '陪审团', kind: 'juror',
      model: seatModelUrl('juror'),
      position: [4.6, 0.0, 2.4],
      facing: PI, // 面向法官
      npc: true,
    },
  ]

  // 6 旁听者：后部阶梯长椅两排（前排 z=2.5 地面，后排 z=3.7 抬高 0.4），填满不稀疏。
  const rowX = [-2.5, 0, 2.5]
  let idx = 0
  for (const x of rowX) {
    seats.push({
      id: `seat-audience-${idx + 1}`, name: `旁听者${idx + 1}`, kind: 'audience',
      model: seatModelUrl('audience', idx),
      position: [x, 0.0, 2.5],
      facing: PI,
      npc: true,
    })
    idx++
  }
  for (const x of rowX) {
    seats.push({
      id: `seat-audience-${idx + 1}`, name: `旁听者${idx + 1}`, kind: 'audience',
      model: seatModelUrl('audience', idx),
      position: [x, 0.4, 3.7],
      facing: PI,
      npc: true,
    })
    idx++
  }
  return seats
}

/** 房间活动范围（与 courtroom-camera ROOM_CLAMP 对齐，旁听/陪审不得穿墙）。 */
export const SEAT_BOUNDS = {
  xMin: -5.2, xMax: 5.2,
  yMin: 0.0, yMax: 1.2,
  zMin: -3.2, zMax: 4.6,
}

/** 两点水平距离（用于测试旁听者不重叠）。 */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dz * dz)
}

/**
 * 陪审团支持率纯逻辑：按双方发言（及证据引用加权）估算民意。
 *  - plaintiff 发言 → 原告 +；defendant 发言 → 被告 +；
 *  - defender 发言按 defenderSideById(speakerId) 归边；未知边对半分；
 *  - judge 发言不计入；引用证据的发言权重 ×1.5/条。
 *  - 无发言时 50/50；输出整数百分比，两者和为 100。
 */
export function calculateSupportRate(
  turns: readonly CourtTurn[],
  defenderSideById?: ReadonlyMap<string, 'plaintiff' | 'defendant'>,
): { plaintiff: number; defendant: number } {
  let p = 0
  let d = 0
  for (const t of turns) {
    const weight = 1 + t.referenced_evidence.length * 0.5
    if (t.speaker === 'plaintiff') {
      p += weight
    } else if (t.speaker === 'defendant') {
      d += weight
    } else if (t.speaker === 'defender') {
      const side = defenderSideById?.get(t.speakerId)
      if (side === 'plaintiff') p += weight
      else if (side === 'defendant') d += weight
      else { p += weight / 2; d += weight / 2 }
    }
    // judge 不计入民意
  }
  const total = p + d
  if (total <= 0) return { plaintiff: 50, defendant: 50 }
  const pct = Math.round((p / total) * 100)
  return { plaintiff: pct, defendant: 100 - pct }
}

/** 运行时事件过滤：NPC 角色永不作为发言者出现（防御性，后端本就只发 4 类角色）。 */
export const SPEAKABLE_ROLES: ReadonlySet<CourtTurn['speaker']> = new Set(['judge', 'plaintiff', 'defendant', 'defender'])

export function isSpeakerNpc(turn: CourtTurn): boolean {
  return !SPEAKABLE_ROLES.has(turn.speaker)
}
