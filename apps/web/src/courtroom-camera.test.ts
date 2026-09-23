import { describe, expect, it } from 'vitest'
import {
  ROOM_CLAMP,
  SPEAKER_CAMERAS,
  SPEAKER_CAM_IDLE,
  SPEAKER_CAM_JUDGE,
  SPEAKER_CAM_PLAINTIFF,
  SPEAKER_CAM_DEFENDANT,
  TRIAL_CAMERA,
  TARGET_NUDGE,
  USER_INTERACTION_GRACE_SECONDS,
  WIZARD_CAMERA,
  cameraDistance,
  clampCameraPosition,
  getCameraForMode,
  nudgeTarget,
  pickSpeakerCamera,
  shouldFollow,
  verticalScreenRatio,
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

describe('主全景机位（第六轮 fov60 高机位）', () => {
  it('trial / wizard 都使用 fov=60', () => {
    expect(TRIAL_CAMERA.fov).toBe(60)
    expect(WIZARD_CAMERA.fov).toBe(60)
    expect(getCameraForMode('trial').fov).toBe(60)
    expect(getCameraForMode('bench').fov).toBe(60)
    expect(getCameraForMode('wizard').fov).toBe(60)
  })
  it('maxDistance 9.0，minDistance 保持 1.5', () => {
    expect(TRIAL_CAMERA.maxDistance).toBe(9.0)
    expect(TRIAL_CAMERA.minDistance).toBe(1.5)
  })
  // 第六轮：相机退到旁听席后方过道 z=4.5（旁听在 z=1.77/2.54，相机在其后俯视入画）。
  it('trial camera sits behind the back spectator bench (z=4.5 > back bench z=2.54)', () => {
    expect(TRIAL_CAMERA.position[2]).toBeGreaterThan(2.54)
  })
  it('main panorama uses the locked position [0,4.3,4.5] / target [0,0.9,-1.3]', () => {
    expect(TRIAL_CAMERA.position).toEqual([0, 4.3, 4.5])
    expect(TRIAL_CAMERA.target).toEqual([0, 0.9, -1.3])
  })
  it('main panorama position is inside ROOM_CLAMP', () => {
    const [x, y, z] = TRIAL_CAMERA.position
    expect(x).toBeGreaterThanOrEqual(ROOM_CLAMP.xMin)
    expect(x).toBeLessThanOrEqual(ROOM_CLAMP.xMax)
    expect(y).toBeGreaterThanOrEqual(ROOM_CLAMP.yMin)
    expect(y).toBeLessThanOrEqual(ROOM_CLAMP.yMax)
    expect(z).toBeGreaterThanOrEqual(ROOM_CLAMP.zMin)
    expect(z).toBeLessThanOrEqual(ROOM_CLAMP.zMax)
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
  it('ROOM_CLAMP ceiling is 4.5 (ceiling 4.8) and rear wall z=4.7 (pos z=4.5)', () => {
    expect(ROOM_CLAMP.yMax).toBe(4.5)
    expect(ROOM_CLAMP.zMax).toBe(4.7)
    expect(ROOM_CLAMP.zMin).toBe(-5.0)
  })
})

describe('verticalScreenRatio 屏幕占比纯函数', () => {
  it('matches the known fov=55 formula (tan 27.5° ≈ 0.5206)', () => {
    // ratio = h / (2 * d * tan(fov/2 rad))
    // d=5, h=1.8, fov=55 → 1.8 / (10 * 0.5206) ≈ 0.346
    expect(verticalScreenRatio(5, 55, 1.8)).toBeCloseTo(0.346, 2)
  })
  it('matches the known fov=45 baseline (tan 22.5° ≈ 0.4142)', () => {
    // d=5, h=1.8, fov=45 → 1.8 / (10 * 0.4142) ≈ 0.4346
    expect(verticalScreenRatio(5, 45, 1.8)).toBeCloseTo(0.435, 2)
  })
  it('scales inversely with distance and linearly with object height', () => {
    expect(verticalScreenRatio(10, 55, 1.8)).toBeCloseTo(verticalScreenRatio(5, 55, 0.9), 6)
    expect(verticalScreenRatio(5, 55, 3.6)).toBeCloseTo(verticalScreenRatio(5, 55, 1.8) * 2, 6)
  })
})

describe('主全景机位人物占比不贴脸（≤0.35，fov60）', () => {
  const CAM = TRIAL_CAMERA.position
  it('judge at [0,0.98,-3.1] occupies ≤35% of frame height', () => {
    const d = cameraDistance(CAM, [0, 0.98, -3.1])
    const ratio = verticalScreenRatio(d, TRIAL_CAMERA.fov, 1.8)
    expect(ratio).toBeLessThanOrEqual(0.35)
  })
  it('plaintiff at [-1.5,0.6,-1.3] occupies ≤35% of frame height', () => {
    const d = cameraDistance(CAM, [-1.5, 0.6, -1.3])
    const ratio = verticalScreenRatio(d, TRIAL_CAMERA.fov, 1.7)
    expect(ratio).toBeLessThanOrEqual(0.35)
  })
  it('defendant at [1.5,0.6,-1.3] occupies ≤35% of frame height', () => {
    const d = cameraDistance(CAM, [1.5, 0.6, -1.3])
    const ratio = verticalScreenRatio(d, TRIAL_CAMERA.fov, 1.7)
    expect(ratio).toBeLessThanOrEqual(0.35)
  })
})

describe('SPEAKER_CAMERAS 发言者机位（相机不贴脸）', () => {
  function expectInRoom(pos: [number, number, number]) {
    const [x, y, z] = pos
    expect(x).toBeGreaterThanOrEqual(ROOM_CLAMP.xMin)
    expect(x).toBeLessThanOrEqual(ROOM_CLAMP.xMax)
    expect(y).toBeGreaterThanOrEqual(ROOM_CLAMP.yMin)
    expect(y).toBeLessThanOrEqual(ROOM_CLAMP.yMax)
    expect(z).toBeGreaterThanOrEqual(ROOM_CLAMP.zMin)
    expect(z).toBeLessThanOrEqual(ROOM_CLAMP.zMax)
  }

  it('every static speaker camera position equals the main panorama (camera does not move)', () => {
    for (const key of Object.keys(SPEAKER_CAMERAS) as Array<keyof typeof SPEAKER_CAMERAS>) {
      expect(SPEAKER_CAMERAS[key].position).toEqual(TRIAL_CAMERA.position)
      expectInRoom(SPEAKER_CAMERAS[key].position)
    }
  })

  it('idle camera equals the locked main panorama (z=4.5 behind the benches)', () => {
    expect(SPEAKER_CAM_IDLE.position[2]).toBe(4.5)
    expect(SPEAKER_CAM_IDLE.position).toEqual(TRIAL_CAMERA.position)
    expect(SPEAKER_CAM_IDLE.target).toEqual(TRIAL_CAMERA.target)
  })

  it('speaker targets are only nudged ≤ TARGET_NUDGE from the main target', () => {
    for (const cam of [SPEAKER_CAM_JUDGE, SPEAKER_CAM_PLAINTIFF, SPEAKER_CAM_DEFENDANT]) {
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(cam.target[i] - TRIAL_CAMERA.target[i])).toBeLessThanOrEqual(TARGET_NUDGE + 1e-9)
      }
    }
  })

  it('judge / plaintiff / defendant cameras are not face-hugging (distance >= 2.5)', () => {
    expect(cameraDistance(SPEAKER_CAM_JUDGE.position, SPEAKER_CAM_JUDGE.target)).toBeGreaterThanOrEqual(2.5)
    expect(cameraDistance(SPEAKER_CAM_PLAINTIFF.position, SPEAKER_CAM_PLAINTIFF.target)).toBeGreaterThanOrEqual(2.5)
    expect(cameraDistance(SPEAKER_CAM_DEFENDANT.position, SPEAKER_CAM_DEFENDANT.target)).toBeGreaterThanOrEqual(2.5)
  })

  it('plaintiff and defendant cameras are mirror images', () => {
    expect(SPEAKER_CAM_PLAINTIFF.target[0]).toBeCloseTo(-SPEAKER_CAM_DEFENDANT.target[0])
    expect(SPEAKER_CAM_PLAINTIFF.target[1]).toBeCloseTo(SPEAKER_CAM_DEFENDANT.target[1])
    expect(SPEAKER_CAM_PLAINTIFF.target[2]).toBeCloseTo(SPEAKER_CAM_DEFENDANT.target[2])
    expect(SPEAKER_CAM_PLAINTIFF.position).toEqual(SPEAKER_CAM_DEFENDANT.position)
  })

  it('judge camera looks down at the elevated judge seat (camera y above target y)', () => {
    expect(SPEAKER_CAM_JUDGE.position[1]).toBeGreaterThan(SPEAKER_CAM_JUDGE.target[1])
  })
})

describe('nudgeTarget 发言者目标点偏移', () => {
  it('clamps each axis to ±TARGET_NUDGE from the main target', () => {
    const out = nudgeTarget([-9, -9, 9])
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(out[i] - TRIAL_CAMERA.target[i])).toBeLessThanOrEqual(TARGET_NUDGE + 1e-9)
    }
  })
  it('leaves already-close targets untouched', () => {
    expect(nudgeTarget(TRIAL_CAMERA.target)).toEqual(TRIAL_CAMERA.target)
  })
})

describe('pickSpeakerCamera 辩护人机位', () => {
  it('judge / plaintiff / defendant map to the static cameras', () => {
    expect(pickSpeakerCamera({ role: 'judge', side: null, position: [0, 0.98, -3.1] })).toEqual(SPEAKER_CAM_JUDGE)
    expect(pickSpeakerCamera({ role: 'plaintiff', side: 'plaintiff', position: [-1.5, 0.6, -1.3] })).toEqual(SPEAKER_CAM_PLAINTIFF)
    expect(pickSpeakerCamera({ role: 'defendant', side: 'defendant', position: [1.5, 0.6, -1.3] })).toEqual(SPEAKER_CAM_DEFENDANT)
  })

  it('camera position always stays at the main panorama (never face-hugs a defender)', () => {
    for (const side of ['plaintiff', 'defendant'] as const) {
      const cam = pickSpeakerCamera({ role: 'defender', side, position: [-3.9, 0.62, 0.4] })
      expect(cam.position).toEqual(TRIAL_CAMERA.position)
    }
  })

  it('left defender (plaintiff side) / right defender (defendant side) get distinct ids', () => {
    const left = pickSpeakerCamera({ role: 'defender', side: 'plaintiff', position: [-3.9, 0.62, 0.4] })
    const right = pickSpeakerCamera({ role: 'defender', side: 'defendant', position: [3.9, 0.62, 0.4] })
    expect(left.id).toBe('defender-left')
    expect(right.id).toBe('defender-right')
  })

  it('defender camera positions stay inside ROOM_CLAMP for the layout range', () => {
    for (const x of [-3.9, -4.8, -5.7, 3.9, 4.8, 5.7]) {
      const side = x < 0 ? 'plaintiff' : 'defendant'
      const cam = pickSpeakerCamera({ role: 'defender', side, position: [x, 0.62, 0.4] })
      const [cx, cy, cz] = cam.position
      expect(cx).toBeGreaterThanOrEqual(ROOM_CLAMP.xMin)
      expect(cx).toBeLessThanOrEqual(ROOM_CLAMP.xMax)
      expect(cy).toBeGreaterThanOrEqual(ROOM_CLAMP.yMin)
      expect(cy).toBeLessThanOrEqual(ROOM_CLAMP.yMax)
      expect(cz).toBeGreaterThanOrEqual(ROOM_CLAMP.zMin)
      expect(cz).toBeLessThanOrEqual(ROOM_CLAMP.zMax)
      // 不贴脸（主全景距离发言者始终 >= 2.5）
      expect(cameraDistance(cam.position, cam.target)).toBeGreaterThanOrEqual(2.5)
    }
  })
})

describe('shouldFollow 第六轮：发言者不自动跟随（恒 false）', () => {
  it('grace constant still exported (API compat) but following is disabled', () => {
    expect(USER_INTERACTION_GRACE_SECONDS).toBe(7)
  })
  it('always returns false regardless of interaction timing — camera never auto-follows', () => {
    expect(shouldFollow(-Infinity, 10)).toBe(false)
    expect(shouldFollow(9, 10)).toBe(false)
    expect(shouldFollow(0, 10)).toBe(false)
    expect(shouldFollow(9.8, 10, 0.5)).toBe(false)
    expect(shouldFollow(10 - USER_INTERACTION_GRACE_SECONDS, 10)).toBe(false)
  })
})
