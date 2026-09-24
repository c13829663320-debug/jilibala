/**
 * M13 — 法庭固定席位纯逻辑（无 React / three 依赖，仅数值与字符串）。
 *
 * buildFixedSeats 当前只渲染核心 5 席（接 apps/web/public/models/court/*.glb）：
 *   judge / plaintiff / plaintiff-counsel / defendant / defendant-counsel
 *
 * 坐标基准：
 *   法官桌后 [0,0.25,-3.9]（面向 +z 法庭，facing=0）；
 *   原告/被告同排 z=-1.7（x=∓1.6），双方律师在外侧 z=-1.4（x=∓2.7），
 *   均面向法官（facing=π）。
 *
 * 注：witness / juror / audience 的 GLB 映射（seatModelUrl）与 isNpcKind 仍保留，
 * 但 buildFixedSeats 不再渲染它们，以保持庭审画面清爽、不拥挤。
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
 * 核心 5 固定席位：法官 + 原告/被告 + 双方律师。
 * 当事人同排 z=-1.7（x=∓1.6）、律师外侧 z=-1.4（x=∓2.7），水平拉开杜绝穿模。
 */
export function buildFixedSeats(): FixedSeatSpec[] {
  return [
    {
      id: 'seat-judge', name: '法官', kind: 'judge',
      model: seatModelUrl('judge'),
      // 后移到高背审判椅（环境 GLB 椅上有个装饰假发，会被法官身体挡住）；
      // 原 -3.45 太靠前，法官胸像悬在法官桌前讲台上，没坐进席位。
      position: [0, 0.25, -3.9],
      facing: 0, // judge.glb 默认正面朝 +z（观众席），真机实测 facing=0 露正脸、π 露后脑勺
      npc: false,
    },
    {
      id: 'seat-plaintiff', name: '原告', kind: 'plaintiff',
      model: seatModelUrl('plaintiff'),
      position: [-1.6, 0, -1.7],
      facing: PI, // 面向法官(-z)
      npc: false,
    },
    {
      id: 'seat-plaintiff-counsel', name: '原告律师', kind: 'plaintiff-counsel',
      model: seatModelUrl('plaintiff-counsel'),
      position: [-2.7, 0, -1.4],
      facing: PI,
      npc: false,
    },
    {
      id: 'seat-defendant', name: '被告', kind: 'defendant',
      model: seatModelUrl('defendant'),
      position: [1.6, 0, -1.7],
      facing: PI,
      npc: false,
    },
    {
      id: 'seat-defendant-counsel', name: '被告律师', kind: 'defendant-counsel',
      model: seatModelUrl('defendant-counsel'),
      position: [2.7, 0, -1.4],
      facing: PI,
      npc: false,
    },
  ]
}

/** 房间活动范围（与 courtroom-camera ROOM_CLAMP 对齐，旁听/陪审不得穿墙）。 */
export const SEAT_BOUNDS = {
  xMin: -4.3, xMax: 4.3,
  yMin: -0.5, yMax: 1.2,
  zMin: -3.9, zMax: 4.6,
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
