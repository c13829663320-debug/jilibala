/**
 * M13 第六轮 — 法庭固定席位纯逻辑（无 React / three 依赖，仅数值与字符串）。
 *
 * 固定席位（接 apps/web/public/models/court/*.glb）：
 *   judge / plaintiff / plaintiff-counsel / defendant / defendant-counsel / witness / juror
 *   + audience-01..06（后部阶梯长椅氛围 NPC，不发言、不朗读、不高亮）。
 *
 * 坐标基准（第六轮：GLB 解析 + 针孔投影核算锁定，逐字使用，勿自行调整）：
 *   默认主机位相机 [0,4.3,4.5] → target [0,0.9,-1.3]，fov 60；
 *   法官桌后 [0,0.98,-3.1]（面向 +z 法庭）；原被告+双方律师同排 z=-1.3，
 *   当事人在中、律师靠外（x=±1.5 / ±2.2）；证人移到侧面 [1.0,0.6,-1.9] 斜向法官、
 *   不挡中轴；陪审与前排旁听在 z=1.77 阶梯，后排旁听 z=2.54（抬高 0.16）。
 *   后排 z=3.31 留空，供动态名人/custom 辩护人席位（现有 z=0.4 一排，不冲突）。
 *
 * 朝向（模型默认面向 +z，即朝观众/相机）：
 *   judge 面向法庭(+z) → facing=0；
 *   原被告/双方律师/陪审团/旁听者 面向法官(-z) → facing=π；
 *   证人斜向法官 → facing=-0.5（移侧面不挡中轴）。
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
 * 核心 7 固定席位 + 6 旁听者（第六轮精确坐标，逐字）。
 * 原被告与双方律师同排 z=-1.3；证人移侧面斜向法官；
 * 动态名人辩护人仍排 z=0.4（旧坐标不动，与固定席位不冲突）。
 */
export function buildFixedSeats(): FixedSeatSpec[] {
  return [
    {
      id: 'seat-judge', name: '法官', kind: 'judge',
      model: seatModelUrl('judge'),
      position: [0, 0.98, -3.1],
      facing: 0, // 面向法庭(+z)
      npc: false,
    },
    {
      id: 'seat-plaintiff', name: '原告', kind: 'plaintiff',
      model: seatModelUrl('plaintiff'),
      position: [-1.5, 0.6, -1.3],
      facing: PI, // 面向法官(-z)
      npc: false,
    },
    {
      id: 'seat-plaintiff-counsel', name: '原告律师', kind: 'plaintiff-counsel',
      model: seatModelUrl('plaintiff-counsel'),
      position: [-2.2, 0.6, -1.3],
      facing: PI,
      npc: false,
    },
    {
      id: 'seat-defendant', name: '被告', kind: 'defendant',
      model: seatModelUrl('defendant'),
      position: [1.5, 0.6, -1.3],
      facing: PI,
      npc: false,
    },
    {
      id: 'seat-defendant-counsel', name: '被告律师', kind: 'defendant-counsel',
      model: seatModelUrl('defendant-counsel'),
      position: [2.2, 0.6, -1.3],
      facing: PI,
      npc: false,
    },
    {
      id: 'seat-witness', name: '证人', kind: 'witness',
      model: seatModelUrl('witness'),
      position: [1.0, 0.6, -1.9],
      facing: -0.5, // 斜向法官，移侧面不挡中轴
      npc: true,
    },
    {
      id: 'seat-juror', name: '陪审团', kind: 'juror',
      model: seatModelUrl('juror'),
      position: [1.5, 0.71, 1.77],
      facing: PI, // 面向法官
      npc: true,
    },
    // 6 旁听者：后部阶梯长椅两排（前排 z=1.77 地面 y=0.71，后排 z=2.54 抬高 y=0.87）。
    {
      id: 'seat-audience-1', name: '旁听者1', kind: 'audience',
      model: seatModelUrl('audience', 0),
      position: [-2.6, 0.71, 1.77],
      facing: PI,
      npc: true,
    },
    {
      id: 'seat-audience-2', name: '旁听者2', kind: 'audience',
      model: seatModelUrl('audience', 1),
      position: [-1.5, 0.71, 1.77],
      facing: PI,
      npc: true,
    },
    {
      id: 'seat-audience-3', name: '旁听者3', kind: 'audience',
      model: seatModelUrl('audience', 2),
      position: [2.6, 0.71, 1.77],
      facing: PI,
      npc: true,
    },
    {
      id: 'seat-audience-4', name: '旁听者4', kind: 'audience',
      model: seatModelUrl('audience', 3),
      position: [-2.3, 0.87, 2.54],
      facing: PI,
      npc: true,
    },
    {
      id: 'seat-audience-5', name: '旁听者5', kind: 'audience',
      model: seatModelUrl('audience', 4),
      position: [-1.2, 0.87, 2.54],
      facing: PI,
      npc: true,
    },
    {
      id: 'seat-audience-6', name: '旁听者6', kind: 'audience',
      model: seatModelUrl('audience', 5),
      position: [1.2, 0.87, 2.54],
      facing: PI,
      npc: true,
    },
  ]
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
