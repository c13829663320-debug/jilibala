/**
 * 新手引导进度（localStorage 持久化）。
 *
 * 目标：新用户从开屏到玩上第一个游戏 ≤3 次点击。
 * - 记录是否已选兴趣、已玩过哪些场景；
 * - 老用户（有记录）不再打扰：跳过 InterestPicker，直接进入 RoomEntry。
 *
 * 所有读写都接受一个可选的 Storage 实现，默认 window.localStorage，
 * 这样在 node 环境（vitest）下可以注入内存 storage 做纯逻辑单测。
 */

export type InterestId = 'debate' | 'funny' | 'detective' | 'fitness'

export type SceneId = 'court' | 'talkshow' | 'werewolf' | 'bar' | 'gym' | 'library'

export interface InterestOption {
  id: InterestId
  label: string
  emoji: string
  tagline: string
}

export interface OnboardingProgress {
  /** 已选兴趣；null = 还没选过。 */
  selectedInterest: InterestId | null
  /** 已玩过的场景 id（首次进入并看过引导后记为已玩）。 */
  playedScenes: SceneId[]
  /** 用户曾主动跳过兴趣选择；之后不再弹 InterestPicker。 */
  interestSkipped: boolean
  /** R4-06: 多人新手引导进度（5 步） */
  multiplayerTour: MultiplayerTourProgress
  updatedAt: string | null
}

/** R4-06 多人引导单步高亮目标 */
export type MultiplayerTourTarget =
  | 'lobby-create'      // 大厅创建房间按钮
  | 'room-code'         // 房间码复制按钮
  | 'voice-or-chat'     // 语音/文字喊话
  | 'emote-wheel'       // 表情动作轮盘
  | 'safety-menu'       // 静音/屏蔽/举报

export interface MultiplayerTourStep {
  id: number
  target: MultiplayerTourTarget
  title: string
  body: string
}

export interface MultiplayerTourProgress {
  /** 当前进行到第几步（0-based） */
  step: number
  /** 是否已完成全部 5 步 */
  done: boolean
  /** 用户主动跳过整个多人引导 */
  skipped: boolean
}

export const EMPTY_MULTIPLAYER_TOUR: MultiplayerTourProgress = {
  step: 0,
  done: false,
  skipped: false,
}

/** R4-06 多人模式 5 步引导序列。 */
export const MULTIPLAYER_TOUR_STEPS: MultiplayerTourStep[] = [
  {
    id: 0,
    target: 'lobby-create',
    title: '创建你的第一个房间',
    body: '点这里开一个专属房间，朋友进来就能和你在同一个广场碰面。',
  },
  {
    id: 1,
    target: 'room-code',
    title: '邀请朋友',
    body: '房间码是进入房间的钥匙，点一下复制，发给朋友就能一起玩。',
  },
  {
    id: 2,
    target: 'voice-or-chat',
    title: '语音与文字喊话',
    body: '点右下角麦克风开麦聊天；不方便开麦时，用文字喊话也能让附近的人看到你。',
  },
  {
    id: 3,
    target: 'emote-wheel',
    title: '表情动作',
    body: '按数字键 1-7 做挥手、鼓掌、大笑等动作，不用说话也能打招呼。',
  },
  {
    id: 4,
    target: 'safety-menu',
    title: '安全功能',
    body: '点任意玩家可以静音、屏蔽或举报。你的社区体验，我们一起守护。',
  },
]

export const ONBOARDING_STORAGE_KEY = 'balabala.onboarding.v1'

export const EMPTY_PROGRESS: OnboardingProgress = {
  selectedInterest: null,
  playedScenes: [],
  interestSkipped: false,
  multiplayerTour: { ...EMPTY_MULTIPLAYER_TOUR },
  updatedAt: null,
}

/** 4 个大按钮：选完直接推荐对应场景。 */
export const INTERESTS: InterestOption[] = [
  { id: 'debate', emoji: '⚖️', label: '想辩论', tagline: '开庭审判，把小事吵成大案' },
  { id: 'funny', emoji: '🎤', label: '想搞笑', tagline: '上台讲段子，AI 观众笑给你看' },
  { id: 'detective', emoji: '🐺', label: '想推理', tagline: '圆桌夜谈，揪出隐藏的狼人' },
  { id: 'fitness', emoji: '🏋️', label: '想健身', tagline: 'AI 教练带练，边玩边出汗' },
]

/** 兴趣 → 推荐场景（1:1 直达，跳过广场迷路）。 */
export const INTEREST_SCENE_MAP: Record<InterestId, SceneId> = {
  debate: 'court',
  funny: 'talkshow',
  detective: 'werewolf',
  fitness: 'gym',
}

export const SCENE_LABELS: Record<SceneId, string> = {
  court: '趣味法庭',
  talkshow: '脱口秀剧场',
  werewolf: '狼人杀馆',
  bar: '酒吧辩论赛',
  gym: '健身房',
  library: '图书馆',
}

export const SCENE_DESCRIPTIONS: Record<SceneId, string> = {
  court: 'AI 陪审团在线，一句话立案，当庭辩论当庭宣判。',
  talkshow: '你的段子现场收获实时笑声，冷场也有人捧场。',
  werewolf: '身份成谜的圆桌夜谈，靠逻辑和口才活到最后。',
  bar: '围坐吧台和名人对辩，酒保最后给你一句金句。',
  gym: 'AI 教练 + 名人带练，节奏游戏式云健身。',
  library: '和名人一对一深度问答，读懂一本书。',
}

/** 每个场景首次进入时的 3 步引导文案（半透明浮层，可一键跳过）。 */
export const FIRST_TIME_STEPS: Record<SceneId, string[]> = {
  court: [
    '这是你的手牌：事实、主张和证据都在手里',
    '点这里出牌，把你的论点打到桌面上',
    '看天平变化，AI 陪审团会实时裁决',
  ],
  talkshow: [
    '麦克风在你手里，聚光灯已经亮了',
    '点这里开始讲你的第一个段子',
    '看观众笑声条变化，越炸场越高分',
  ],
  werewolf: [
    '天黑请闭眼，天亮后看你的身份',
    '点这里发言，说服身边的玩家',
    '观察投票与遗言，揪出隐藏的狼人',
  ],
  bar: [
    '围坐吧台，选一个最想抬杠的话题',
    '点这里发言，和名人正面开辩',
    '酒保会在最后总结全场金句',
  ],
  gym: [
    'AI 教练已就位，音乐节拍响起',
    '点这里开始跟练，跟着节奏动起来',
    '看节奏连击，别掉拍，练完有成就感',
  ],
  library: [
    '选一本你最想聊的书',
    '点这里向名人提问，越深越好',
    '看问答层层展开，读完这本书',
  ],
}

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 每次都返回全新对象（playedScenes 数组不可跨调用共享，避免 push 污染）。 */
function freshProgress(): OnboardingProgress {
  return {
    selectedInterest: null,
    playedScenes: [],
    interestSkipped: false,
    multiplayerTour: { ...EMPTY_MULTIPLAYER_TOUR },
    updatedAt: null,
  }
}

/** 从 localStorage 读取进度；损坏 / 缺失时返回空进度（视为新用户）。 */
export function loadProgress(storage?: Storage | null): OnboardingProgress {
  const store = storage ?? defaultStorage()
  if (!store) return freshProgress()
  try {
    const raw = store.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return freshProgress()
    const parsed = JSON.parse(raw) as Partial<OnboardingProgress>
    const mt = parsed.multiplayerTour
    return {
      selectedInterest: typeof parsed.selectedInterest === 'string' ? (parsed.selectedInterest as InterestId) : null,
      playedScenes: Array.isArray(parsed.playedScenes)
        ? (parsed.playedScenes.filter((s): s is SceneId => typeof s === 'string') as SceneId[])
        : [],
      interestSkipped: parsed.interestSkipped === true,
      multiplayerTour: {
        step: typeof mt?.step === 'number' ? Math.max(0, Math.min(MULTIPLAYER_TOUR_STEPS.length - 1, Math.floor(mt.step))) : 0,
        done: mt?.done === true,
        skipped: mt?.skipped === true,
      },
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    }
  } catch {
    return freshProgress()
  }
}

export function saveProgress(progress: OnboardingProgress, storage?: Storage | null): void {
  const store = storage ?? defaultStorage()
  if (!store) return
  try {
    store.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }))
  } catch {
    /* storage may be unavailable (private mode / quota) */
  }
}

/** 记录已选兴趣，返回最新进度。 */
export function recordInterest(interest: InterestId, storage?: Storage | null): OnboardingProgress {
  const progress = loadProgress(storage)
  progress.selectedInterest = interest
  progress.interestSkipped = false
  saveProgress(progress, storage)
  return progress
}

/** 用户跳过兴趣选择：之后不再弹 InterestPicker。 */
export function recordInterestSkipped(storage?: Storage | null): OnboardingProgress {
  const progress = loadProgress(storage)
  progress.interestSkipped = true
  saveProgress(progress, storage)
  return progress
}

/** 记录某个场景已玩过（首次进入并看过引导后调用）。 */
export function recordScenePlayed(scene: SceneId, storage?: Storage | null): OnboardingProgress {
  const progress = loadProgress(storage)
  if (!progress.playedScenes.includes(scene)) {
    progress.playedScenes = [...progress.playedScenes, scene]
    saveProgress(progress, storage)
  }
  return progress
}

/** 是否为全新用户：localStorage 里完全没有引导记录。 */
export function isNewUser(storage?: Storage | null): boolean {
  const store = storage ?? defaultStorage()
  if (!store) return true
  try {
    return store.getItem(ONBOARDING_STORAGE_KEY) == null
  } catch {
    return true
  }
}

/** 是否需要先弹兴趣选择器（新用户或从未选过且没跳过）。 */
export function needsInterestSelection(storage?: Storage | null): boolean {
  const progress = loadProgress(storage)
  return progress.selectedInterest == null && !progress.interestSkipped
}

/** 该场景是否已经玩过（玩过就不再弹 FirstTimeGuide）。 */
export function hasPlayedScene(scene: SceneId, storage?: Storage | null): boolean {
  return loadProgress(storage).playedScenes.includes(scene)
}

/** 根据已选兴趣给出推荐场景；没选过返回 null。 */
export function getRecommendedScene(storage?: Storage | null): SceneId | null {
  const interest = loadProgress(storage).selectedInterest
  return interest ? INTEREST_SCENE_MAP[interest] : null
}

// ===== R4-06: 多人新手引导（5 步） =====

/** 是否需要展示多人引导（未完成且未跳过）。 */
export function needsMultiplayerTour(storage?: Storage | null): boolean {
  const p = loadProgress(storage)
  return !p.multiplayerTour.done && !p.multiplayerTour.skipped
}

/** 前进到下一步；走完最后一步自动标记 done。返回最新进度。 */
export function advanceMultiplayerTour(storage?: Storage | null): OnboardingProgress {
  const p = loadProgress(storage)
  const nextStep = p.multiplayerTour.step + 1
  p.multiplayerTour = {
    step: nextStep,
    done: nextStep >= MULTIPLAYER_TOUR_STEPS.length,
    skipped: false,
  }
  saveProgress(p, storage)
  return p
}

/** 手动完成多人引导。 */
export function completeMultiplayerTour(storage?: Storage | null): OnboardingProgress {
  const p = loadProgress(storage)
  p.multiplayerTour = { step: MULTIPLAYER_TOUR_STEPS.length - 1, done: true, skipped: false }
  saveProgress(p, storage)
  return p
}

/** 跳过多人引导。 */
export function skipMultiplayerTour(storage?: Storage | null): OnboardingProgress {
  const p = loadProgress(storage)
  p.multiplayerTour = { ...p.multiplayerTour, skipped: true, done: true }
  saveProgress(p, storage)
  return p
}

/** 设置里「重置多人引导」：下次进入房间重新弹。 */
export function resetMultiplayerTour(storage?: Storage | null): OnboardingProgress {
  const p = loadProgress(storage)
  p.multiplayerTour = { step: 0, done: false, skipped: false }
  saveProgress(p, storage)
  return p
}

/** 当前应展示的多人引导步骤（无则 null）。 */
export function currentMultiplayerStep(storage?: Storage | null): MultiplayerTourStep | null {
  const p = loadProgress(storage)
  if (p.multiplayerTour.done || p.multiplayerTour.skipped) return null
  return MULTIPLAYER_TOUR_STEPS[p.multiplayerTour.step] ?? null
}
