// ============================================================================
// 全局玩家档案：XP / 段位 / 战绩 / 成就 / 每日挑战（纯逻辑，无副作用）
// 纯函数只操作 PlayerProfile 对象本身，localStorage 读写集中在底部持久层，
// 这样 vitest（node 环境）可以直接测纯函数，无需 jsdom。
// ============================================================================

export type SceneId = 'court' | 'talkshow' | 'werewolf' | 'bar' | 'gym' | 'library'

export const SCENE_LABEL: Record<SceneId, string> = {
  court: '趣味法庭',
  talkshow: '开放麦脱口秀',
  werewolf: '狼人杀',
  bar: '酒吧辩论',
  gym: '云健身',
  library: '图书馆擂台',
}

/** 每个场景一局结算后上报的归一化结果。 */
export interface GameResult {
  /** 本局是否获胜（失败/平局/冷场一律 false）。 */
  won: boolean
  /** 该场景的代表性分数（脱口秀平均分 / 健身总分 / 图书馆总分 / 狼人杀推理分），用于 bestScore。 */
  score?: number
  /** 场景专属明细，成就判定用。 */
  detail?: {
    tier?: string            // 脱口秀段位：'炸场' | '今日之星'
    correctCount?: number   // 图书馆答对题数
    totalQuestions?: number  // 图书馆总题数
    reasoningScore?: number  // 狼人杀推理分
    goldJoke?: boolean       // 脱口秀是否产生炸场金句
  }
}

export interface SceneStat {
  played: number
  wins: number
  bestScore: number
  lastPlayed: string
}

export interface DailyChallenge {
  date: string        // YYYY-MM-DD，当天有效
  scene: SceneId
  target: number      // 目标：该场景完成 target 局
  progress: number
  completed: boolean
}

export interface PlayerProfile {
  nickname: string
  avatarId: string
  level: number
  xp: number          // 当前等级内已积累 XP
  totalXp: number    // 累计 XP
  joinedAt: string
  stats: {
    totalGames: number
    wins: number
    losses: number
    favoriteScene: SceneId | ''
    perScene: Record<SceneId, SceneStat>
  }
  achievements: string[]
  dailyChallenge: DailyChallenge | null
}

// ---------------------------------------------------------------------------
// 段位称号
// ---------------------------------------------------------------------------
export const TIERS: Array<{ min: number; title: string }> = [
  { min: 81, title: '传奇' },
  { min: 51, title: '大师' },
  { min: 31, title: '达人' },
  { min: 11, title: '玩家' },
  { min: 1, title: '新手' },
]

export function getTierTitle(level: number): string {
  for (const t of TIERS) if (level >= t.min) return t.title
  return '新手'
}

// ---------------------------------------------------------------------------
// XP / 升级
// ---------------------------------------------------------------------------
/** 从 level 级升到下一级所需 XP：level N 需要 N*100 XP。 */
export function xpForLevel(level: number): number {
  return level * 100
}

/** 从累计 totalXp 反推等级（纯函数，便于测试与外部展示）。 */
export function getLevel(totalXp: number): number {
  let remaining = totalXp
  let level = 1
  while (level < MAX_LEVEL && remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level)
    level += 1
  }
  return level
}

export const MAX_LEVEL = 100

export interface AddXpOutcome {
  profile: PlayerProfile
  leveledUp: boolean
  levelsGained: number
  /** 跨大段位（新手/玩家/达人/大师/传奇边界）获得的额外奖励 XP。 */
  tierBonus: number
}

/**
 * 给 profile 增加 XP，处理升级与跨段位奖励。返回新的 profile（不原地改入参）。
 * 跨段位边界（11/31/51/81）时额外 +30 XP。
 */
export function addXp(profile: PlayerProfile, amount: number): AddXpOutcome {
  const next: PlayerProfile = {
    ...profile,
    stats: { ...profile.stats, perScene: { ...profile.stats.perScene } },
    dailyChallenge: profile.dailyChallenge ? { ...profile.dailyChallenge } : null,
  }
  let levelsGained = 0
  let tierBonus = 0
  next.xp += amount
  next.totalXp += amount

  while (next.level < MAX_LEVEL && next.xp >= xpForLevel(next.level)) {
    const before = getTierTitle(next.level)
    next.xp -= xpForLevel(next.level)
    next.level += 1
    levelsGained += 1
    const after = getTierTitle(next.level)
    if (after !== before) {
      // 跨大段位：额外奖励 30 XP（立即入账，可能再触发升级）。
      tierBonus += 30
      next.xp += 30
      next.totalXp += 30
    }
  }
  if (next.level >= MAX_LEVEL) next.xp = Math.min(next.xp, xpForLevel(MAX_LEVEL - 1))
  return { profile: next, leveledUp: levelsGained > 0, levelsGained, tierBonus }
}

// ---------------------------------------------------------------------------
// 成就系统
// ---------------------------------------------------------------------------
export interface AchievementDef {
  id: string
  name: string
  desc: string
  icon: string
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_game', name: '初出茅庐', desc: '完成第 1 局', icon: '🌱' },
  { id: 'hundred_games', name: '百战不殆', desc: '累计完成 100 局', icon: '🎖️' },
  { id: 'winning_60', name: '常胜将军', desc: '胜率超过 60%（至少 10 局）', icon: '👑' },
  { id: 'court_gold', name: '法庭金牌大状', desc: '法庭累计获胜 10 局', icon: '⚖️' },
  { id: 'talkshow_star', name: '脱口秀今日之星', desc: '脱口秀拿下一次「今日之星」', icon: '🌟' },
  { id: 'werewolf_mvp', name: '狼人杀 MVP', desc: '狼人杀推理分超过 80', icon: '🐺' },
  { id: 'gym_blast', name: '健身房爆杆', desc: '云健身三关总分超过 4000', icon: '💪' },
  { id: 'library_master', name: '图书馆宗师', desc: '图书馆单局答对 8/8', icon: '📚' },
]

export function getAchievementDef(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

/** 返回新 profile 与本次新解锁的成就 id 列表（已去重）。 */
export function unlockAchievement(profile: PlayerProfile, id: string): { profile: PlayerProfile; newly: boolean } {
  if (profile.achievements.includes(id)) return { profile, newly: false }
  return {
    profile: { ...profile, achievements: [...profile.achievements, id] },
    newly: true,
  }
}

// ---------------------------------------------------------------------------
// 每日挑战（按日期确定性生成，同一天刷新不变化）
// ---------------------------------------------------------------------------
const SCENE_IDS: SceneId[] = ['court', 'talkshow', 'werewolf', 'bar', 'gym', 'library']

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function generateDailyChallenge(date: string = todayKey()): DailyChallenge {
  const h = hashString(date)
  const scene = SCENE_IDS[h % SCENE_IDS.length]
  const target = 2 + (h % 2) // 2 或 3 局
  return { date, scene, target, progress: 0, completed: false }
}

// ---------------------------------------------------------------------------
// 创建档案
// ---------------------------------------------------------------------------
function emptyPerScene(): Record<SceneId, SceneStat> {
  const out = {} as Record<SceneId, SceneStat>
  for (const s of SCENE_IDS) {
    out[s] = { played: 0, wins: 0, bestScore: 0, lastPlayed: '' }
  }
  return out
}

export function createProfile(nickname: string, avatarId = ''): PlayerProfile {
  return {
    nickname,
    avatarId,
    level: 1,
    xp: 0,
    totalXp: 0,
    joinedAt: new Date().toISOString(),
    stats: {
      totalGames: 0,
      wins: 0,
      losses: 0,
      favoriteScene: '',
      perScene: emptyPerScene(),
    },
    achievements: [],
    dailyChallenge: generateDailyChallenge(),
  }
}

// ---------------------------------------------------------------------------
// 一局结算上报（核心纯函数）
// ---------------------------------------------------------------------------
export interface GameReportSummary {
  xpEarned: number        // 本局实际入账 XP（含段位奖励、每日挑战奖励）
  baseXp: number
  leveledUp: boolean
  levelsGained: number
  tierBonus: number
  newlyUnlocked: string[] // 本次新解锁成就 id
  dailyCompleted: boolean
  newLevel: number
}

const WIN_XP = 50
const LOSE_XP = 20
const DAILY_REWARD_XP = 30

/**
 * 上报一局结果：更新战绩 / XP / 成就 / 每日挑战。
 * 返回新 profile 与结算摘要（供 UI 弹 toast）。
 */
export function reportGameResult(
  profile: PlayerProfile,
  scene: SceneId,
  result: GameResult,
): { profile: PlayerProfile; summary: GameReportSummary } {
  // 1) 基础战绩
  let p: PlayerProfile = {
    ...profile,
    stats: {
      ...profile.stats,
      perScene: { ...profile.stats.perScene },
    },
  }
  p.stats.totalGames += 1
  if (result.won) p.stats.wins += 1
  else p.stats.losses += 1

  const prev = p.stats.perScene[scene]
  const score = result.score ?? 0
  p.stats.perScene[scene] = {
    played: prev.played + 1,
    wins: prev.wins + (result.won ? 1 : 0),
    bestScore: Math.max(prev.bestScore, score),
    lastPlayed: new Date().toISOString(),
  }

  // 最爱场景：选累计场次最多者
  let fav: SceneId | '' = p.stats.favoriteScene
  let favPlayed = -1
  for (const s of SCENE_IDS) {
    const played = p.stats.perScene[s].played
    if (played > favPlayed) { favPlayed = played; fav = s }
  }
  p.stats.favoriteScene = fav

  // 2) 每日挑战：跨天则重置；命中场景则累计进度
  const today = todayKey()
  let dc = p.dailyChallenge
  if (!dc || dc.date !== today) dc = generateDailyChallenge(today)
  let dailyCompleted = false
  if (dc.scene === scene && !dc.completed) {
    dc = { ...dc, progress: dc.progress + 1 }
    if (dc.progress >= dc.target) {
      dc = { ...dc, completed: true }
      dailyCompleted = true
    }
  }
  p.dailyChallenge = dc

  // 3) XP：胜利 50 / 失败 20，每日挑战完成 +30
  const baseXp = result.won ? WIN_XP : LOSE_XP
  let totalXp = baseXp + (dailyCompleted ? DAILY_REWARD_XP : 0)
  const beforeTier = getTierTitle(p.level)
  const addOut = addXp(p, totalXp)
  p = addOut.profile
  void beforeTier

  // 4) 成就解锁
  const newly: string[] = []
  const tryUnlock = (id: string, cond: boolean) => {
    if (!cond) return
    const r = unlockAchievement(p!, id)
    p = r.profile
    if (r.newly) newly.push(id)
  }

  tryUnlock('first_game', p.stats.totalGames >= 1)
  tryUnlock('hundred_games', p.stats.totalGames >= 100)
  tryUnlock('winning_60', p.stats.totalGames >= 10 && p.stats.wins / p.stats.totalGames > 0.6)
  tryUnlock('court_gold', p.stats.perScene.court.wins >= 10)
  tryUnlock('talkshow_star', result.detail?.tier === '今日之星')
  tryUnlock('werewolf_mvp', (result.detail?.reasoningScore ?? result.score ?? 0) > 80)
  tryUnlock('gym_blast', (result.score ?? 0) > 4000)
  tryUnlock('library_master', (result.detail?.correctCount ?? 0) >= 8)

  const summary: GameReportSummary = {
    xpEarned: addOut.profile.totalXp - profile.totalXp,
    baseXp,
    leveledUp: addOut.leveledUp,
    levelsGained: addOut.levelsGained,
    tierBonus: addOut.tierBonus,
    newlyUnlocked: newly,
    dailyCompleted,
    newLevel: p.level,
  }
  return { profile: p, summary }
}

// ---------------------------------------------------------------------------
// 持久层（localStorage，node 测试环境下安全降级）
// ---------------------------------------------------------------------------
const LS_KEY = 'balabala.playerProfile.v1'

function storageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage
  } catch {
    return false
  }
}

/** 从 localStorage 读取档案；不存在 / 损坏则返回 null。 */
export function loadProfile(): PlayerProfile | null {
  if (!storageAvailable()) return null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PlayerProfile
    if (!parsed || typeof parsed.level !== 'number') return null
    // 兼容旧数据：补齐 perScene
    if (!parsed.stats.perScene) parsed.stats.perScene = emptyPerScene()
    return parsed
  } catch {
    return null
  }
}

export function saveProfile(profile: PlayerProfile): void {
  if (!storageAvailable()) return
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(profile))
  } catch { /* ignore */ }
}

/** 确保档案存在：没有则用昵称/化身新建。 */
export function ensureProfile(nickname: string, avatarId = ''): PlayerProfile {
  const existing = loadProfile()
  if (existing) return existing
  const created = createProfile(nickname, avatarId)
  saveProfile(created)
  return created
}

/**
 * 场景结算点调用的入口：读档 → 上报 → 写档 → 派发事件（供 UI 弹 XP toast）。
 * 纯函数 reportGameResult 本身可单测，这里只负责 I/O。
 */
export function submitGameResult(
  scene: SceneId,
  result: GameResult,
  identity?: { nickname: string; avatarId?: string },
): GameReportSummary | null {
  if (!storageAvailable()) return null
  let profile = loadProfile() ?? createProfile(identity?.nickname ?? '我', identity?.avatarId ?? '')
  const { profile: next, summary } = reportGameResult(profile, scene, result)
  saveProfile(next)
  try {
    window.dispatchEvent(new CustomEvent('balabala:game-reported', { detail: { scene, ...summary } }))
  } catch { /* ignore */ }
  return summary
}

export { SCENE_IDS }
