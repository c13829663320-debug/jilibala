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

/* ==========================================================================
 * M13 修复 B：按席位角色固定的"发言者机位"。
 *
 * 旧逻辑：发言者切换后相机保持用户当前 offset，距离不变，容易贴脸。
 * 新逻辑：每个发言角色有一组固定的 (target, camera position)，确保全身
 * 入画且距离 >= 2.5，同时周围法庭仍可见。所有坐标必须落在 ROOM_CLAMP 内。
 * ========================================================================== */

export interface SpeakerCamera {
  id: 'idle' | 'judge' | 'plaintiff' | 'defendant' | 'defender-left' | 'defender-right'
  target: Vec3
  position: Vec3
}

/** 无人发言 / 法官开场：完整法庭全景（法官 + 原被告 + 辩护人都入画）。 */
export const SPEAKER_CAM_IDLE: SpeakerCamera = {
  id: 'idle',
  target: [0, 1.0, -0.8],
  position: [0, 2.4, 1.2],
}

/** 法官：略俯视，法官全身 + 前方原被告入画，距离 ~2.9。
 *  法官席位高位 y=1.0，人脚落在 world y=1.0、头顶 ~2.78；target 取躯干中线 ~1.6
 *  才能把全身（脚 1.0 → 头 2.78）收进画面，而不是只对着膝盖。 */
export const SPEAKER_CAM_JUDGE: SpeakerCamera = {
  id: 'judge',
  target: [0, 1.6, -2.0],
  position: [0, 2.8, 0.6],
}

/** 原告：从中央偏右看原告，原告全身 + 法官 + 被告入画。
 *  原告席位 y=0.62，人脚 world y=0.62、头顶 ~2.3；target 取 ~1.4 收全身。 */
export const SPEAKER_CAM_PLAINTIFF: SpeakerCamera = {
  id: 'plaintiff',
  target: [-2.7, 1.4, -0.4],
  position: [-0.6, 2.3, 1.0],
}

/** 被告：原告机位的镜像。 */
export const SPEAKER_CAM_DEFENDANT: SpeakerCamera = {
  id: 'defendant',
  target: [2.7, 1.4, -0.4],
  position: [0.6, 2.3, 1.0],
}

/** 所有静态发言者机位（辩护人机位按席位 x 动态计算，见 pickSpeakerCamera）。 */
export const SPEAKER_CAMERAS: Record<'idle' | 'judge' | 'plaintiff' | 'defendant', SpeakerCamera> = {
  idle: SPEAKER_CAM_IDLE,
  judge: SPEAKER_CAM_JUDGE,
  plaintiff: SPEAKER_CAM_PLAINTIFF,
  defendant: SPEAKER_CAM_DEFENDANT,
}

/** CameraRig 用来选机位的发言者描述（CourtSeat 的角色 + 位置子集）。 */
export interface ActiveSpeakerInfo {
  role: 'judge' | 'plaintiff' | 'defendant' | 'defender'
  side: 'plaintiff' | 'defendant' | null
  position: Vec3
}

/**
 * 按发言者角色 + 位置选固定机位。
 * 辩护人机位：原告方（左侧，x<0）从 x+1.8 拍，被告方（右侧，x>0）从 x-1.8 拍，
 * 保证相机从法庭中央侧看辩护人而不是贴在辩护人脸上。
 */
export function pickSpeakerCamera(info: ActiveSpeakerInfo): SpeakerCamera {
  if (info.role === 'judge') return SPEAKER_CAM_JUDGE
  if (info.role === 'plaintiff') return SPEAKER_CAM_PLAINTIFF
  if (info.role === 'defendant') return SPEAKER_CAM_DEFENDANT
  const x = info.position[0]
  const z = info.position[2]
  if (info.side === 'plaintiff') {
    return {
      id: 'defender-left',
      target: [x, 1.4, z],
      position: [x + 1.8, 2.1, 1.6],
    }
  }
  return {
    id: 'defender-right',
    target: [x, 1.4, z],
    position: [x - 1.8, 2.1, 1.6],
  }
}

/** 用户最近一次手动拖拽/缩放后，相机自动跟随暂停多少秒。 */
export const USER_INTERACTION_GRACE_SECONDS = 4

/**
 * 纯逻辑：距上次用户交互 >= grace 秒时才允许自动跟随发言者机位。
 * lastInteraction / now 都用 r3f clock.getElapsedTime() 同一时间轴。
 */
export function shouldFollow(lastInteraction: number, now: number, graceSeconds: number = USER_INTERACTION_GRACE_SECONDS): boolean {
  return now - lastInteraction >= graceSeconds
}

/** 两点间欧氏距离（用于测试机位不贴脸）。 */
export function cameraDistance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
