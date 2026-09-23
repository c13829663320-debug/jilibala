import { describe, expect, it } from 'vitest'
import {
  ROOM_CLAMP,
  SPEAKER_CAMERAS,
  SPEAKER_CAM_IDLE,
  SPEAKER_CAM_JUDGE,
  SPEAKER_CAM_PLAINTIFF,
  SPEAKER_CAM_DEFENDANT,
  TRIAL_CAMERA,
  USER_INTERACTION_GRACE_SECONDS,
  WIZARD_CAMERA,
  cameraDistance,
  clampCameraPosition,
  getCameraForMode,
  pickSpeakerCamera,
  shouldFollow,
} from './courtroom-camera'

describe('clampCameraPosition', () => {
  it('clamps over-range x to the room walls', () => {
    expect(clampCameraPosition([9, 2, 0])[0]).toBe(ROOM_CLAMP.xMax)
    expect(clampCameraPosition([-9, 2, 0])[0]).toBe(ROOM_CLAMP.xMin)
  })
  it('clamps y between floor and ceiling', () => {
    expect(clampCameraPosition([0, -1, 0])[1]).toBe(ROOM_CLAMP.yMin)
    expect(clampCameraPosition([0, 99, 0])[1]).toBe(ROOM_CLAMP.yMax)
  })
  it('clamps z between the front and rear walls', () => {
    expect(clampCameraPosition([0, 2, 9])[2]).toBe(ROOM_CLAMP.zMax)
    expect(clampCameraPosition([0, 2, -9])[2]).toBe(ROOM_CLAMP.zMin)
  })
  it('leaves in-range positions untouched', () => {
    expect(clampCameraPosition([1, 2, 1.2])).toEqual([1, 2, 1.2])
  })
})

describe('getCameraForMode', () => {
  it('trial returns the aisle framing and seat following', () => {
    const c = getCameraForMode('trial')
    expect(c.position).toEqual(TRIAL_CAMERA.position)
    expect(c.target).toEqual(TRIAL_CAMERA.target)
    expect(c.followSeats).toBe(true)
    expect(c.autoRotate).toBe(false)
  })
  it('bench reuses the trial framing (arc seats still in frame)', () => {
    expect(getCameraForMode('bench')).toEqual(getCameraForMode('trial'))
  })
  it('wizard returns the rear panorama with slow auto-rotate', () => {
    const c = getCameraForMode('wizard')
    expect(c.position).toEqual(WIZARD_CAMERA.position)
    expect(c.target).toEqual(WIZARD_CAMERA.target)
    expect(c.followSeats).toBe(false)
    expect(c.autoRotate).toBe(true)
    expect(c.autoRotateSpeed).toBe(0.3)
  })
})

describe('camera framing invariants', () => {
  // 旁听席阶梯长椅在 z≈2~5；庭审初始机位必须在其前方，否则相机埋入长椅穿模。
  it('trial camera starts in front of the spectator benches (z < 2.0)', () => {
    expect(TRIAL_CAMERA.position[2]).toBeLessThan(2.0)
  })
  it('wizard camera stays inside ROOM_CLAMP', () => {
    const [x, y, z] = WIZARD_CAMERA.position
    expect(x).toBeGreaterThanOrEqual(ROOM_CLAMP.xMin)
    expect(x).toBeLessThanOrEqual(ROOM_CLAMP.xMax)
    expect(y).toBeGreaterThanOrEqual(ROOM_CLAMP.yMin)
    expect(y).toBeLessThanOrEqual(ROOM_CLAMP.yMax)
    expect(z).toBeGreaterThanOrEqual(ROOM_CLAMP.zMin)
    expect(z).toBeLessThanOrEqual(ROOM_CLAMP.zMax)
  })
})

describe('SPEAKER_CAMERAS 固定发言者机位', () => {
  function expectInRoom(pos: [number, number, number]) {
    const [x, y, z] = pos
    expect(x).toBeGreaterThanOrEqual(ROOM_CLAMP.xMin)
    expect(x).toBeLessThanOrEqual(ROOM_CLAMP.xMax)
    expect(y).toBeGreaterThanOrEqual(ROOM_CLAMP.yMin)
    expect(y).toBeLessThanOrEqual(ROOM_CLAMP.yMax)
    expect(z).toBeGreaterThanOrEqual(ROOM_CLAMP.zMin)
    expect(z).toBeLessThanOrEqual(ROOM_CLAMP.zMax)
  }

  it('every static speaker camera position is inside ROOM_CLAMP', () => {
    for (const key of Object.keys(SPEAKER_CAMERAS) as Array<keyof typeof SPEAKER_CAMERAS>) {
      expectInRoom(SPEAKER_CAMERAS[key].position)
    }
  })

  it('idle camera starts in front of the spectator benches (z < 2.0)', () => {
    // 旁听席阶梯长椅在 z≈2~5；idle 机位必须在其前方，否则相机埋入长椅穿模。
    expect(SPEAKER_CAM_IDLE.position[2]).toBeLessThan(2.0)
    // 与既有 TRIAL_CAMERA 全景口径一致
    expect(SPEAKER_CAM_IDLE.position).toEqual(TRIAL_CAMERA.position)
    expect(SPEAKER_CAM_IDLE.target).toEqual(TRIAL_CAMERA.target)
  })

  it('judge / plaintiff / defendant cameras are not face-hugging (distance >= 2.5)', () => {
    expect(cameraDistance(SPEAKER_CAM_JUDGE.position, SPEAKER_CAM_JUDGE.target)).toBeGreaterThanOrEqual(2.5)
    expect(cameraDistance(SPEAKER_CAM_PLAINTIFF.position, SPEAKER_CAM_PLAINTIFF.target)).toBeGreaterThanOrEqual(2.5)
    expect(cameraDistance(SPEAKER_CAM_DEFENDANT.position, SPEAKER_CAM_DEFENDANT.target)).toBeGreaterThanOrEqual(2.5)
  })

  it('plaintiff and defendant cameras are mirror images', () => {
    expect(SPEAKER_CAM_PLAINTIFF.target[0]).toBeCloseTo(-SPEAKER_CAM_DEFENDANT.target[0])
    expect(SPEAKER_CAM_PLAINTIFF.position[0]).toBeCloseTo(-SPEAKER_CAM_DEFENDANT.position[0])
    expect(SPEAKER_CAM_PLAINTIFF.position[1]).toBeCloseTo(SPEAKER_CAM_DEFENDANT.position[1])
    expect(SPEAKER_CAM_PLAINTIFF.position[2]).toBeCloseTo(SPEAKER_CAM_DEFENDANT.position[2])
  })

  it('judge camera looks down at the elevated judge seat (target y > position y? no, higher camera)', () => {
    // 相机略高于法官头部位置，形成略俯视
    expect(SPEAKER_CAM_JUDGE.position[1]).toBeGreaterThan(SPEAKER_CAM_JUDGE.target[1])
  })
})

describe('pickSpeakerCamera 辩护人机位', () => {
  it('judge / plaintiff / defendant map to the static cameras', () => {
    expect(pickSpeakerCamera({ role: 'judge', side: null, position: [0, 1.0, -2.4] })).toEqual(SPEAKER_CAM_JUDGE)
    expect(pickSpeakerCamera({ role: 'plaintiff', side: 'plaintiff', position: [-2.7, 0.62, -0.4] })).toEqual(SPEAKER_CAM_PLAINTIFF)
    expect(pickSpeakerCamera({ role: 'defendant', side: 'defendant', position: [2.7, 0.62, -0.4] })).toEqual(SPEAKER_CAM_DEFENDANT)
  })

  it('left defender (plaintiff side) gets camera at x+1.8 looking inward', () => {
    const cam = pickSpeakerCamera({ role: 'defender', side: 'plaintiff', position: [-3.9, 0.62, 0.4] })
    expect(cam.id).toBe('defender-left')
    expect(cam.target).toEqual([-3.9, 1.4, 0.4])
    expect(cam.position).toEqual([-3.9 + 1.8, 2.1, 1.6])
    expect(cam.position[0]).toBeGreaterThan(cam.target[0]) // 相机在辩护人右侧（中央方向）
  })

  it('right defender (defendant side) gets camera at x-1.8 looking inward', () => {
    const cam = pickSpeakerCamera({ role: 'defender', side: 'defendant', position: [3.9, 0.62, 0.4] })
    expect(cam.id).toBe('defender-right')
    expect(cam.target).toEqual([3.9, 1.4, 0.4])
    expect(cam.position).toEqual([3.9 - 1.8, 2.1, 1.6])
    expect(cam.position[0]).toBeLessThan(cam.target[0]) // 相机在辩护人左侧（中央方向）
  })

  it('defender camera positions stay inside ROOM_CLAMP for the layout range', () => {
    for (const x of [-3.9, -4.8, -5.7, 3.9, 4.8, 5.7]) {
      const side = x < 0 ? 'plaintiff' : 'defendant'
      const cam = pickSpeakerCamera({ role: 'defender', side, position: [x, 0.62, 0.4] })
      const [cx, cy, cz] = cam.position
      // 相机侧（x±1.8）必须落在房间内
      expect(cx).toBeGreaterThanOrEqual(ROOM_CLAMP.xMin)
      expect(cx).toBeLessThanOrEqual(ROOM_CLAMP.xMax)
      expect(cy).toBeGreaterThanOrEqual(ROOM_CLAMP.yMin)
      expect(cy).toBeLessThanOrEqual(ROOM_CLAMP.yMax)
      expect(cz).toBeGreaterThanOrEqual(ROOM_CLAMP.zMin)
      expect(cz).toBeLessThanOrEqual(ROOM_CLAMP.zMax)
      // 不贴脸（侧卫机位略近，>=2.0 仍为中景而非特写）
      expect(cameraDistance(cam.position, cam.target)).toBeGreaterThanOrEqual(2.0)
    }
  })
})

describe('shouldFollow 用户交互宽限期', () => {
  it('allows following when there is no recorded interaction', () => {
    expect(shouldFollow(-Infinity, 10)).toBe(true)
  })
  it('blocks following within the grace window after user interaction', () => {
    // 刚交互 1 秒前
    expect(shouldFollow(9, 10)).toBe(false)
    expect(shouldFollow(6.5, 10)).toBe(false)
  })
  it('resumes following after the grace window elapses', () => {
    expect(shouldFollow(10 - USER_INTERACTION_GRACE_SECONDS, 10)).toBe(true)
    expect(shouldFollow(5.9, 10)).toBe(true) // 4.1 秒前
  })
  it('honors a custom grace seconds override', () => {
    // grace=0.5s：0.2s 前刚交互 → 不跟随；0.5s 前 → 恢复跟随
    expect(shouldFollow(9.8, 10, 0.5)).toBe(false)
    expect(shouldFollow(9.5, 10, 0.5)).toBe(true)
  })
})
