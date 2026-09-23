/**
 * M13 趣味法庭 — 纯相机逻辑（无 React / three 依赖，仅数值元组）。
 *
 * 所有机位基于实测 GLB bounds：
 *   房间整体 x/z ∈ [-5.4, 5.4]，y ∈ [0, 10.8]；
 *   可用室内约 x/z ∈ [-4.5, 4.5]，天花板 y ≈ 6~7；
 *   旁听席阶梯长椅在 z ≈ 2~5（旧初始机位 z=3.7 正好埋入）。
 */

export type CameraMode = 'trial' | 'wizard' | 'bench'
export type Vec3 = [number, number, number]

export interface CameraConfig {
  position: Vec3
  target: Vec3
  fov: number
  minDistance: number
  maxDistance: number
  maxPolarAngle: number
  /** wizard 阶段缓慢自转，给安静全景 */
  autoRotate: boolean
  autoRotateSpeed: number
  /** trial/bench 才跟随发言席位；wizard 固定全景 */
  followSeats: boolean
}

/** 庭审 / 旧 bench 合议庭共用机位：中轴过道、略俯视，不穿旁听席。 */
export const TRIAL_CAMERA = {
  position: [0, 2.4, 1.2] as Vec3,
  target: [0, 1.0, -0.8] as Vec3,
  fov: 45,
  minDistance: 1.5,
  maxDistance: 7.0,
  maxPolarAngle: Math.PI / 2.05,
}

/** 创建向导阶段：靠后居中的安静全景，带缓慢自转。 */
export const WIZARD_CAMERA = {
  position: [0, 3.2, 3.8] as Vec3,
  target: [0, 1.5, -1.0] as Vec3,
  fov: 45,
}

/** 相机活动范围 clamp，防止穿出外墙 / 穿地 / 穿天花板。 */
export const ROOM_CLAMP = {
  xMin: -4.3,
  xMax: 4.3,
  yMin: 0.5,
  yMax: 6.0,
  zMin: -4.3,
  zMax: 4.3,
}

/** 把相机位置约束在 ROOM_CLAMP 范围内（返回新元组）。 */
export function clampCameraPosition(pos: Vec3): Vec3 {
  return [
    Math.min(ROOM_CLAMP.xMax, Math.max(ROOM_CLAMP.xMin, pos[0])),
    Math.min(ROOM_CLAMP.yMax, Math.max(ROOM_CLAMP.yMin, pos[1])),
    Math.min(ROOM_CLAMP.zMax, Math.max(ROOM_CLAMP.zMin, pos[2])),
  ]
}

/** 按模式取完整相机配置。bench 沿用 trial 机位（弧形席位 z=-1.2~-2.0 仍完整入画）。 */
export function getCameraForMode(mode: CameraMode): CameraConfig {
  if (mode === 'wizard') {
    return {
      position: WIZARD_CAMERA.position,
      target: WIZARD_CAMERA.target,
      fov: WIZARD_CAMERA.fov,
      minDistance: TRIAL_CAMERA.minDistance,
      maxDistance: TRIAL_CAMERA.maxDistance,
      maxPolarAngle: TRIAL_CAMERA.maxPolarAngle,
      autoRotate: true,
      autoRotateSpeed: 0.3,
      followSeats: false,
    }
  }
  // trial 与 bench 共用机位
  return {
    position: TRIAL_CAMERA.position,
    target: TRIAL_CAMERA.target,
    fov: TRIAL_CAMERA.fov,
    minDistance: TRIAL_CAMERA.minDistance,
    maxDistance: TRIAL_CAMERA.maxDistance,
    maxPolarAngle: TRIAL_CAMERA.maxPolarAngle,
    autoRotate: false,
    autoRotateSpeed: 0,
    followSeats: true,
  }
}
