/**
 * 开放世界 · 类型定义
 * ------------------------------------------------------------------
 * 这里只放与 three.js 解耦的纯类型，方便 collision.ts / config.ts
 * 在无 WebGL 环境下被 vitest 直接单测。
 */

/** 资产清单里单个模型的描述（由后台管线生成到 public/models/world/） */
export interface WorldAsset {
  id: string
  category: 'buildings' | 'plaza' | 'nature' | 'props' | 'npc'
  name: string
  /** 相对 /models/world/ 的路径，如 buildings/court.glb */
  path: string
  spec: 'high' | 'standard'
  credits: number
  size: number
  dimensions: { width: number; height: number; depth: number }
  inLibrary: boolean
  tags?: string[]
}

/** world-manifest.json 根结构 */
export interface WorldManifest {
  version: string
  generatedAt: string
  totalCredits: number
  assets: WorldAsset[]
}

/** 6 大场景建筑 id（与 @balabala/shared 的 SceneId 对齐） */
export type BuildingId = 'court' | 'talkshow' | 'werewolf' | 'bar' | 'gym' | 'library'

/** 单个建筑的静态布局配置（位置 / 入口 / 碰撞体 footprint） */
export interface BuildingConfig {
  id: BuildingId
  /** 中文展示名 */
  name: string
  /** 建筑中心 XZ（世界坐标，y=0） */
  x: number
  z: number
  /** 模型朝向：让模型 +z 面朝向世界中心 (0,0) */
  rotation: number
  /** footprint 宽（X 方向），用于生成 AABB 碰撞体 */
  width: number
  /** footprint 深（Z 方向），用于生成 AABB 碰撞体 */
  depth: number
  /** 入口触发点（在建筑正前方、朝世界中心一侧） */
  entranceX: number
  entranceZ: number
  /** 占位模型颜色（manifest 缺失时用程序化几何体兜底） */
  color: string
  /** 小地图 / 菜单图标 */
  emoji: string
  /** manifest 中对应资产的 id 前缀（找不到就用占位） */
  assetId: string
}

/** 玩家化身每帧高频读写的运行时状态（mutable ref，不走 React state） */
export interface PlayerRuntime {
  x: number
  /** 垂直高度偏移（跳跃时 >0，落地归 0） */
  y: number
  z: number
  /** 面朝方向（绕 Y 轴的弧度） */
  rotation: number
  /** 垂直速度（跳跃/重力） */
  velocityY: number
  onGround: boolean
}

/** 输入状态：键盘 / 摇杆 / 按钮写入，PlayerController 读取并消费 */
export interface InputState {
  /** 前后 -1..1（W=+1 前进 / S=-1） */
  forward: number
  /** 左右 -1..1（D=+1 右移 / A=-1） */
  strafe: number
  /** Shift 奔跑 */
  run: boolean
  /** 跳键按下（PlayerController 消费后置 false） */
  jumpQueued: boolean
  /** 交互键 E / 屏幕按钮按下（Interaction 消费后置 false） */
  interactQueued: boolean
}

/** 第三人称相机轨道状态 */
export interface CameraState {
  /** 水平角（绕玩家） */
  yaw: number
  /** 俯仰角（俯视/仰视） */
  pitch: number
  /** 相机到玩家距离 */
  distance: number
}

/**
 * 整个开放世界的共享运行时根对象。
 * 在 Plaza3D 里 new 一份，同时传给 Canvas 内的 3D 组件和 Canvas 外的 DOM 覆盖层，
 * 高频数据（位置/输入）全部走这个 mutable ref，避免每帧触发 React 重渲染。
 */
export interface WorldRuntime {
  player: PlayerRuntime
  input: InputState
  camera: CameraState
}

/** 构造一份初始运行时：玩家出生在中心广场南侧，面朝 -Z 的喷泉，相机在身后跟随 */
export function createWorldRuntime(): WorldRuntime {
  return {
    player: { x: 0, y: 0, z: 12, rotation: Math.PI, velocityY: 0, onGround: true },
    input: { forward: 0, strafe: 0, run: false, jumpQueued: false, interactQueued: false },
    // yaw=0 → 相机在玩家 +Z 身后，看向 -Z（喷泉方向）
    camera: { yaw: 0, pitch: 0.32, distance: 9 },
  }
}

// ---------- 碰撞体几何体（纯数据，无 three 依赖，便于单测） ----------
/** XZ 平面上的轴对齐包围盒 */
export interface AABB {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}
/** XZ 平面上的圆柱/圆 */
export interface CircleObs {
  x: number
  z: number
  r: number
}
/** 静态障碍碰撞体：建筑用 AABB，喷泉/树/灯用 circle */
export type Collider =
  | { kind: 'aabb'; box: AABB }
  | { kind: 'circle'; c: CircleObs }

/** 远端玩家（WS 同步过来的位置会被 lerp 到 targetX/targetZ） */
export interface RemotePlayer {
  userId: string
  nickname: string
  avatarType: string
  avatarRef: string
  x: number
  z: number
  rotation: number
  targetX: number
  targetZ: number
}
