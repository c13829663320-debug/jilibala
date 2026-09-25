// 脱口秀 R2 重构：前端共享类型。
export type Reaction = 'roast' | 'applaud' | 'mixed' | 'silence'
export type Tier = '冷场' | '尚可' | '炸场' | '今日之星'

export interface TopicOption {
  id: string
  label: string
  icon: string
  subtopics: string[]
}

export interface JokeDimensionScores {
  punchline: number // 0-40
  pacing: number // 0-30
  resonance: number // 0-30
}

export interface PerformedJoke {
  text: string
  topic: string
  callbackTo?: number
  callbackHit?: boolean
  scores: JokeDimensionScores
  total: number
  reaction: Reaction
  note: string
}

export const REACTION_META: Record<Reaction, { emoji: string; label: string; color: string; wave: number }> = {
  applaud: { emoji: '👏', label: '爆笑鼓掌', color: '#FFD600', wave: 1 },
  mixed: { emoji: '🤔', label: '有笑有叹', color: '#4fb3a5', wave: 0.6 },
  roast: { emoji: '🥀', label: '起哄吐槽', color: '#ff7a59', wave: 0.35 },
  silence: { emoji: '😶', label: '冷场', color: '#8a8a95', wave: 0.12 },
}

export const TIER_STYLE: Record<Tier, { emoji: string; color: string }> = {
  '冷场': { emoji: '🥶', color: '#8a8a95' },
  '尚可': { emoji: '🙂', color: '#4fb3a5' },
  '炸场': { emoji: '🔥', color: '#FFD600' },
  '今日之星': { emoji: '🌟', color: '#FFD600' },
}
