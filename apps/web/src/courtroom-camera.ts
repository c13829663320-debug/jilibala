/**
 * M13 趣味法庭 — 纯相机逻辑（无 React / three 依赖，仅数值元组）。
 *
 * 所有机位基于实测 GLB bounds：
 *   房间整体 x/z ∈ [-5.4, 5.4]，y ∈ [0, 10.8]；
 *   可用室内约 x/z ∈ [-4.5, 4.5]，天花板 y ≈ 6~7；
 *   旁听席阶梯长椅在 z ≈ 2~5（相机主全景机位 z=1.6 在其前方过道，不穿模）。
 *
 * 第四轮视觉修复：从根上解决"角色贴脸、看不到法庭"。
 *   - fov 45 → 55，主全景机位作为默认（开庭 / 法官发言 / 无人突出都用）。
 *   - 发言者切换时 camera position 保持主全景不动，仅 target 轻微移向发言者
 *     （单轴偏移 ≤ 0.5），配合 SeatRing 金色脉冲 + SpeakerSpotlight 聚光 +
 *     名牌高亮来突出，而不是把相机怼到发言者脸上。
 *   - maxDistance 7 → 9，手势宽限 4 → 7 秒。
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

/** 主全景机位（默认：开庭、法官发言、无人突出都用它）。
 *  camera [0,4.0,1.6] → target [0,1.3,-0.8]。
 *  z=1.6 在旁听席(z≈2.0)前的过道，不穿模；略俯视，把法官(桌后)、原被告(两侧)、
 *  辩护人、法庭纵深同时收进画面。 */
export const TRIAL_CAMERA = {
  position: [0, 4.0, 1.6] as Vec3,
  target: [0, 1.3, -0.8] as Vec3,
  fov: 55,
  minDistance: 1.5,
  maxDistance: 9.0,
  maxPolarAngle: Math.PI / 2.05,
}

/** 创建向导阶段：靠后居中的安静全景，带缓慢自转。 */
export const WIZARD_CAMERA = {
  position: [0, 3.2, 3.8] as Vec3,
  target: [0, 1.5, -1.0] as Vec3,
  fov: 55,
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

/** 按模式取完整相机配置。bench 沿用 trial 机位（弧形席位 z=-1.2~-2.0 在广角全景中完整入画）。 */
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
  // trial 与 bench 共用主全景机位
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
 * 屏幕占比纯函数（用于测试断言机位不贴脸）。
 *
 * 透视相机下，高度 objectHeight 的物体在距离 distance 处、垂直视场角 fovDeg 时，
 * 占据画面垂直方向的比例：
 *
 *      visibleHeightAtDistance = 2 * distance * tan(fovDeg/2 · π/180)
 *      ratio = objectHeight / visibleHeightAtDistance
 *
 *  fov=55 时 tan(27.5°) ≈ 0.5206，可见高度 ≈ 1.041 × distance。
 *  主全景要求人物占比 ≤ 0.35（全身 + 周围法庭同时可见）；
 *  即便未来加发言者特写，也要求占比 ≤ 0.45（不贴脸）。
 * ========================================================================== */
export function verticalScreenRatio(distance: number, fovDeg: number, objectHeight: number): number {
  const halfRad = (fovDeg / 2) * (Math.PI / 180)
  return objectHeight / (2 * distance * Math.tan(halfRad))
}

/* ==========================================================================
 * M13 第四轮：发言者机位策略。
 *
 * 旧逻辑：发言者切换后 lerp 到一组固定近景机位，导致角色贴脸、看不到法庭。
 * 新逻辑：camera position 永远等于主全景机位 TRIAL_CAMERA.position（不动机位），
 * 只把 target 从主全景 target 向发言者位置轻微偏移（单轴 ≤ TARGET_NUDGE），
 * 配合 SeatRing + SpeakerSpotlight + 名牌高亮突出发言者。
 * ========================================================================== */

/** 发言者 target 相对主全景 target 的最大单轴偏移。 */
export const TARGET_NUDGE = 0.5

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 把主全景 target 向发言者位置轻微靠拢（单轴偏移 ≤ TARGET_NUDGE）。 */
export function nudgeTarget(speaker: Vec3): Vec3 {
  const [tx, ty, tz] = TRIAL_CAMERA.target
  return [
    tx + clamp(speaker[0] - tx, -TARGET_NUDGE, TARGET_NUDGE),
    ty + clamp(speaker[1] - ty, -TARGET_NUDGE, TARGET_NUDGE),
    tz + clamp(speaker[2] - tz, -TARGET_NUDGE, TARGET_NUDGE),
  ]
}

export interface SpeakerCamera {
  id: 'idle' | 'judge' | 'plaintiff' | 'defendant' | 'defender-left' | 'defender-right'
  target: Vec3
  position: Vec3
}

/** 无人发言 / 法官开场：完整法庭主全景。 */
export const SPEAKER_CAM_IDLE: SpeakerCamera = {
  id: 'idle',
  target: [...TRIAL_CAMERA.target] as Vec3,
  position: [...TRIAL_CAMERA.position] as Vec3,
}

/** 法官席位在 [0,1.0,-2.9]（法官桌后方、高背椅前）。target 仅向其轻微偏移。 */
export const SPEAKER_CAM_JUDGE: SpeakerCamera = {
  id: 'judge',
  target: nudgeTarget([0, 1.0, -2.9]),
  position: [...TRIAL_CAMERA.position] as Vec3,
}

/** 原告席位 [-2.7,0.62,-0.4]。 */
export const SPEAKER_CAM_PLAINTIFF: SpeakerCamera = {
  id: 'plaintiff',
  target: nudgeTarget([-2.7, 0.62, -0.4]),
  position: [...TRIAL_CAMERA.position] as Vec3,
}

/** 被告：原告机位的镜像。 */
export const SPEAKER_CAM_DEFENDANT: SpeakerCamera = {
  id: 'defendant',
  target: nudgeTarget([2.7, 0.62, -0.4]),
  position: [...TRIAL_CAMERA.position] as Vec3,
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
 * 按发言者角色 + 位置选机位。
 * 核心：camera position 永远是主全景机位（不贴脸），只把 target 轻微移向发言者。
 */
export function pickSpeakerCamera(info: ActiveSpeakerInfo): SpeakerCamera {
  const position = [...TRIAL_CAMERA.position] as Vec3
  if (info.role === 'judge') {
    return { id: 'judge', target: nudgeTarget(info.position), position }
  }
  if (info.role === 'plaintiff') {
    return { id: 'plaintiff', target: nudgeTarget(info.position), position }
  }
  if (info.role === 'defendant') {
    return { id: 'defendant', target: nudgeTarget(info.position), position }
  }
  return {
    id: info.side === 'plaintiff' ? 'defender-left' : 'defender-right',
    target: nudgeTarget(info.position),
    position,
  }
}

/** 用户最近一次手动拖拽/缩放后，相机自动跟随暂停多少秒（第四轮：4 → 7）。 */
export const USER_INTERACTION_GRACE_SECONDS = 7

/**
 * 纯逻辑：距上次用户交互 >= grace 秒时才允许自动跟随发言者机位。
 * lastInteraction / now 都用 r3f clock.getElapsedTime() 同一时间轴。
 */
export function shouldFollow(lastInteraction: number, now: number, graceSeconds: number = USER_INTERACTION_GRACE_SECONDS): boolean {
  return now - lastInteraction >= graceSeconds
}

/** 两点间欧氏距离（用于测试机位不贴脸 / 占比反推）。 */
export function cameraDistance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
