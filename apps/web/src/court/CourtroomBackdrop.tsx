// 可复用的 3D 法庭背景:接入当前工程的 CourtroomView
// (balabala_courtroom.glb + 13 固定角色 GLB + buildFixedSeats 席位坐标 + TRIAL_CAMERA 第七轮相机)。
// S1~S5 都用它做底,UI 浮层盖在磨砂层上。写实法庭 GLB 不绕 Y180。
import { lazy, Suspense, useMemo } from 'react'
import type { CourtCase } from './types'
import type { CourtSeat } from '../CourtroomView'
import { buildFixedSeats, type FixedSeatSpec } from '../courtroom-seats'
import type { CourtPerspective } from '../courtroom-camera'

const CourtroomView = lazy(() => import('../CourtroomView'))

export interface ActiveSpeaker {
  speaker: string
  speakerId?: string
}

type Props = {
  courtCase?: CourtCase | null
  activeSpeaker?: ActiveSpeaker | null
  /** 保留旧签名兼容(上传版 character/perspective/speaker/verdictShot),现已不影响机位。 */
  [key: string]: unknown
}

function seatName(f: FixedSeatSpec, _courtCase?: CourtCase | null): string {
  // 3D 名牌统一用固定短名（原告/被告/法官/律师），避免长名与相邻名牌重叠；
  // 当事人完整身份在台词卡片与 UI 中展示。
  return f.name
}

function toCourtSeat(f: FixedSeatSpec, courtCase?: CourtCase | null, active?: ActiveSpeaker | null): CourtSeat {
  let role: CourtSeat['role'] = 'defender'
  let side: CourtSeat['side'] = null
  let isActive = false
  switch (f.kind) {
    case 'judge':
      role = 'judge'; isActive = active?.speaker === 'judge'; break
    case 'plaintiff':
      role = 'plaintiff'; side = 'plaintiff'; isActive = active?.speaker === 'plaintiff'; break
    case 'defendant':
      role = 'defendant'; side = 'defendant'; isActive = active?.speaker === 'defendant'; break
    case 'plaintiff-counsel':
      role = 'defender'; side = 'plaintiff'; break
    case 'defendant-counsel':
      role = 'defender'; side = 'defendant'; break
    default:
      // witness / juror / audience:氛围 NPC,不高亮
      role = 'defender'; side = null
  }
  // 辩护人(名人/custom)发言:按 speakerId 匹配
  if (role === 'defender' && f.kind !== 'witness' && f.kind !== 'juror' && f.kind !== 'audience') {
    isActive = active?.speaker === 'defender' && (!active.speakerId || active.speakerId === f.id)
  }
  return {
    id: f.id,
    name: seatName(f, courtCase),
    role,
    kind: f.kind,
    model: f.model,
    position: f.position,
    facing: f.facing,
    npc: f.npc,
    active: isActive,
    side,
  }
}

export function CourtroomBackdrop({ courtCase, activeSpeaker, perspective }: Props) {
  const fixedSeats = useMemo(() => buildFixedSeats(), [])
  const seats = useMemo<CourtSeat[]>(
    () => fixedSeats.map((f) => toCourtSeat(f, courtCase, activeSpeaker)),
    [fixedSeats, courtCase, activeSpeaker],
  )
  return (
    <div className="live-canvas-wrap">
      <Suspense fallback={null}>
        <CourtroomView seats={seats} cameraMode="trial" perspective={(perspective as CourtPerspective | undefined) ?? 'audience'} />
      </Suspense>
    </div>
  )
}
