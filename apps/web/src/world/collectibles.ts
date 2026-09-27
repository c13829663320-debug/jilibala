/**
 * 开放世界 · 探索收集品系统
 * ------------------------------------------------------------------
 * 广场与六座建筑室内散布收集品（水晶 / 徽章 / 隐藏宝箱）。
 * 走近自动拾取，触发 XP 奖励与成就解锁。
 * 收集状态持久化到 localStorage，跨会话保留。
 *
 * 与现有 XP/成就系统挂钩：
 *   - addXp()      → profile/playerProfile.ts
 *   - unlockAchievement() → profile/playerProfile.ts
 *   - CustomEvent 'balabala:collectible' → UI 弹 toast
 */
import { addXp, unlockAchievement, loadProfile, saveProfile, type PlayerProfile } from '../profile/playerProfile'

// ---------- 收集品类型 ----------
export type CollectibleRarity = 'common' | 'rare' | 'hidden'

export interface CollectibleDef {
  /** 全局唯一 id，如 'plaza_fountain_01' / 'court_bench_01' */
  id: string
  /** 所属场景：'plaza' 或建筑 id */
  scene: string
  /** 世界坐标（广场用世界坐标，室内用室内局部坐标） */
  x: number
  y: number
  z: number
  rarity: CollectibleRarity
  /** 展示名（拾取 toast 用） */
  name: string
  /** 关联成就 id（hidden 收集品通常解锁专属成就） */
  achievementId?: string
}

/** 各稀有度的 XP 奖励 */
export const RARITY_XP: Record<CollectibleRarity, number> = {
  common: 10,
  rare: 30,
  hidden: 50,
}

/** 各稀有度的视觉色 */
export const RARITY_COLOR: Record<CollectibleRarity, string> = {
  common: '#7dd87d',
  rare: '#5bb8e8',
  hidden: '#FFD600',
}

// ---------- 收集品清单（广场 + 六座建筑） ----------
export const COLLECTIBLES: CollectibleDef[] = [
  // ===== 广场（6 个：4 common + 1 rare + 1 hidden）=====
  { id: 'plaza_fountain_01', scene: 'plaza', x: 4, y: 1, z: 2, rarity: 'common', name: '广场水晶·春' },
  { id: 'plaza_fountain_02', scene: 'plaza', x: -4, y: 1, z: -2, rarity: 'common', name: '广场水晶·夏' },
  { id: 'plaza_road_north', scene: 'plaza', x: 0, y: 1, z: -40, rarity: 'common', name: '北路徽章' },
  { id: 'plaza_road_south', scene: 'plaza', x: 0, y: 1, z: 40, rarity: 'common', name: '南路徽章' },
  { id: 'plaza_road_east', scene: 'plaza', x: 50, y: 1, z: 0, rarity: 'rare', name: '东侧稀有徽章' },
  { id: 'plaza_hidden_mountain', scene: 'plaza', x: -100, y: 2, z: -100, rarity: 'hidden', name: '边界秘境宝箱', achievementId: 'explorer_boundary' },

  // ===== 法庭（3 个）=====
  { id: 'court_gavel', scene: 'court', x: 0, y: 1.2, z: -3, rarity: 'rare', name: '法槌徽章' },
  { id: 'court_bench_left', scene: 'court', x: -4, y: 1, z: 2, rarity: 'common', name: '旁听席水晶' },
  { id: 'court_hidden_judge', scene: 'court', x: 0, y: 3, z: -5, rarity: 'hidden', name: '法官秘藏', achievementId: 'explorer_court' },

  // ===== 脱口秀（3 个）=====
  { id: 'talkshow_mic', scene: 'talkshow', x: 0, y: 1.5, z: -3, rarity: 'rare', name: '金麦克风' },
  { id: 'talkshow_audience_l', scene: 'talkshow', x: -3, y: 1, z: 3, rarity: 'common', name: '观众席水晶' },
  { id: 'talkshow_hidden_backstage', scene: 'talkshow', x: 4, y: 1, z: -4, rarity: 'hidden', name: '后台宝藏', achievementId: 'explorer_talkshow' },

  // ===== 狼人杀（3 个）=====
  { id: 'werewolf_table', scene: 'werewolf', x: 0, y: 1.2, z: 0, rarity: 'rare', name: '月圆徽章' },
  { id: 'werewolf_seat_1', scene: 'werewolf', x: -3, y: 1, z: -2, rarity: 'common', name: '狼人水晶' },
  { id: 'werewolf_hidden_attic', scene: 'werewolf', x: 3, y: 3.5, z: 3, rarity: 'hidden', name: '阁楼秘宝', achievementId: 'explorer_werewolf' },

  // ===== 酒吧（3 个）=====
  { id: 'bar_counter', scene: 'bar', x: 0, y: 1.3, z: -3, rarity: 'rare', name: '调酒师徽章' },
  { id: 'bar_table_1', scene: 'bar', x: -3, y: 1, z: 2, rarity: 'common', name: '吧台水晶' },
  { id: 'bar_hidden_cellar', scene: 'bar', x: -4, y: 0.5, z: -4, rarity: 'hidden', name: '酒窖珍藏', achievementId: 'explorer_bar' },

  // ===== 健身房（3 个）=====
  { id: 'gym_dumbbell', scene: 'gym', x: 0, y: 1, z: -2, rarity: 'rare', name: '力量徽章' },
  { id: 'gym_mirror', scene: 'gym', x: -4, y: 1, z: 0, rarity: 'common', name: '健身水晶' },
  { id: 'gym_hidden_rooftop', scene: 'gym', x: 3, y: 3.5, z: 3, rarity: 'hidden', name: '天台宝藏', achievementId: 'explorer_gym' },

  // ===== 图书馆（3 个）=====
  { id: 'library_desk', scene: 'library', x: 0, y: 1.2, z: -2, rarity: 'rare', name: '学者徽章' },
  { id: 'library_shelf_l', scene: 'library', x: -4, y: 1, z: 1, rarity: 'common', name: '书架水晶' },
  { id: 'library_hidden_vault', scene: 'library', x: 4, y: 0.5, z: -4, rarity: 'hidden', name: '禁书库秘藏', achievementId: 'explorer_library' },
]

/** 按场景筛选收集品 */
export function collectiblesForScene(scene: string): CollectibleDef[] {
  return COLLECTIBLES.filter((c) => c.scene === scene)
}

// ---------- 持久化 ----------
const LS_KEY = 'balabala.collectibles.v1'

function storageAvailable(): boolean {
  try { return typeof window !== 'undefined' && !!window.localStorage } catch { return false }
}

/** 读取已收集 id 集合 */
export function loadCollected(): Set<string> {
  if (!storageAvailable()) return new Set()
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(arr)
  } catch { return new Set() }
}

/** 写入已收集 id 集合 */
export function saveCollected(set: Set<string>): void {
  if (!storageAvailable()) return
  try { window.localStorage.setItem(LS_KEY, JSON.stringify([...set])) } catch { /* ignore */ }
}

// ---------- 拾取逻辑 ----------
export interface CollectOutcome {
  collected: boolean
  xpEarned: number
  leveledUp: boolean
  newLevel: number
  achievementUnlocked: string | null
  collectible: CollectibleDef
}

/**
 * 尝试拾取一个收集品。已拾取过则返回 collected:false。
 * 拾取成功：加 XP、解锁成就（如有）、持久化、派发事件。
 */
export function collectItem(id: string): CollectOutcome | null {
  const def = COLLECTIBLES.find((c) => c.id === id)
  if (!def) return null

  const collected = loadCollected()
  if (collected.has(id)) {
    return { collected: false, xpEarned: 0, leveledUp: false, newLevel: 0, achievementUnlocked: null, collectible: def }
  }

  // 1) 标记已收集
  collected.add(id)
  saveCollected(collected)

  // 2) 加 XP
  const xp = RARITY_XP[def.rarity]
  let profile: PlayerProfile | null = loadProfile()
  if (!profile) {
    // 没有档案时创建一个（昵称兜底）
    profile = {
      nickname: '探索者', avatarId: '', level: 1, xp: 0, totalXp: 0,
      joinedAt: new Date().toISOString(),
      stats: {
        totalGames: 0, wins: 0, losses: 0, favoriteScene: '',
        perScene: {
          court: { played: 0, wins: 0, bestScore: 0, lastPlayed: '' },
          talkshow: { played: 0, wins: 0, bestScore: 0, lastPlayed: '' },
          werewolf: { played: 0, wins: 0, bestScore: 0, lastPlayed: '' },
          bar: { played: 0, wins: 0, bestScore: 0, lastPlayed: '' },
          gym: { played: 0, wins: 0, bestScore: 0, lastPlayed: '' },
          library: { played: 0, wins: 0, bestScore: 0, lastPlayed: '' },
        },
      },
      achievements: [], dailyChallenge: null,
    }
  }

  const xpOut = addXp(profile, xp)
  profile = xpOut.profile

  // 3) 解锁成就
  let achievementUnlocked: string | null = null
  if (def.achievementId) {
    const achOut = unlockAchievement(profile, def.achievementId)
    profile = achOut.profile
    if (achOut.newly) achievementUnlocked = def.achievementId
  }

  // 全收集成就
  if (collected.size >= COLLECTIBLES.length) {
    const achOut = unlockAchievement(profile, 'explorer_master')
    profile = achOut.profile
    if (achOut.newly) achievementUnlocked = 'explorer_master'
  }

  saveProfile(profile)

  // 4) 派发事件（UI 监听弹 toast）
  try {
    window.dispatchEvent(new CustomEvent('balabala:collectible', {
      detail: { id, name: def.name, xp, rarity: def.rarity, achievementUnlocked },
    }))
  } catch { /* ignore */ }

  return {
    collected: true,
    xpEarned: xp,
    leveledUp: xpOut.leveledUp,
    newLevel: profile.level,
    achievementUnlocked,
    collectible: def,
  }
}

/** 拾取检测：玩家位置与收集品距离 < threshold 时触发 */
export const COLLECT_DISTANCE = 2.0

export function checkProximity(
  playerX: number, playerY: number, playerZ: number,
  items: CollectibleDef[],
  collected: Set<string>,
): CollectibleDef | null {
  for (const item of items) {
    if (collected.has(item.id)) continue
    const dx = playerX - item.x
    const dy = playerY - item.y
    const dz = playerZ - item.z
    if (dx * dx + dy * dy + dz * dz < COLLECT_DISTANCE * COLLECT_DISTANCE) {
      return item
    }
  }
  return null
}

/** 探索成就定义（追加到现有成就墙） */
export const EXPLORATION_ACHIEVEMENTS = [
  { id: 'explorer_boundary', name: '边界行者', desc: '发现广场边界秘境', icon: '🏔️' },
  { id: 'explorer_court', name: '法庭探秘者', desc: '找到法庭隐藏收集品', icon: '⚖️' },
  { id: 'explorer_talkshow', name: '后台通行证', desc: '找到脱口秀后台宝藏', icon: '🎤' },
  { id: 'explorer_werewolf', name: '月圆猎人', desc: '找到狼人杀阁楼秘宝', icon: '🐺' },
  { id: 'explorer_bar', name: '酒窖鉴赏家', desc: '找到酒吧酒窖珍藏', icon: '🍺' },
  { id: 'explorer_gym', name: '巅峰攀登者', desc: '找到健身房天台宝藏', icon: '💪' },
  { id: 'explorer_library', name: '禁书管理员', desc: '找到图书馆禁书库秘藏', icon: '📚' },
  { id: 'explorer_master', name: '全图收藏家', desc: '收集全部 24 个探索品', icon: '🏆' },
]
