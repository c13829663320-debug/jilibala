import { describe, expect, it } from 'vitest'
import {
  ROOM_CLAMP,
  TRIAL_CAMERA,
  WIZARD_CAMERA,
  clampCameraPosition,
  getCameraForMode,
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
