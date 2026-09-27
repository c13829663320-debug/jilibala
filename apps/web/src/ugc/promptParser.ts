// ============================================================================
// 一句话造场景 · 自然语言解析（纯函数，无外部 AI 依赖）
// 策略：关键词匹配 + 名人名/别名命中 + 模板兜底。云端无密钥也能工作。
// ============================================================================
import { CELEBRITIES, type SceneDraft, type UGCGameType, type UGCPropDraft } from '@balabala/shared'

/** 名人别名 → celebrity id（覆盖常见口语/英文名/尊称）。 */
const CELEBRITY_ALIASES: Record<string, string> = {
  '马斯克': 'elon-musk', 'Elon': 'elon-musk', 'elon': 'elon-musk', 'EM': 'elon-musk',
  '乔布斯': 'steve-jobs', '库克': 'tim-cook',
  '图灵': 'alan-turing', '爱因斯坦': 'albert-einstein', '牛顿': 'isaac-newton',
  '特斯拉': 'nikola-tesla', '居里': 'marie-curie', '居里夫人': 'marie-curie',
  '李白': 'li-bai', '苏轼': 'su-shi', '苏东坡': 'su-shi', '东坡': 'su-shi',
  '杜甫': 'du-fu', '白居易': 'bai-juyi', '王维': 'wang-wei',
  '鲁迅': 'lu-xun', '诸葛亮': 'zhuge-liang', '诸葛': 'zhuge-liang',
  '莎士比亚': 'shakespeare', '达芬奇': 'leonardo', '达·芬奇': 'leonardo',
  '梵高': 'van-gogh', '孔子': 'confucius', '苏格拉底': 'socrates',
  '老子': 'laozi', '尼采': 'nietzsche', '阿基米德': 'archimedes',
  '达尔文': 'charles-darwin', '钱学森': 'qian-xuesen', '袁隆平': 'yuan-longping',
  '亚当斯密': 'adam-smith', '亚当·斯密': 'adam-smith', '凯恩斯': 'john-maynard-keynes',
}

/** 由 CELEBRITIES 自动补一张 name→id 表（中文正式名）。 */
const NAME_TO_ID: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const c of CELEBRITIES) map[c.name] = c.id
  return { ...map, ...CELEBRITY_ALIASES }
})()

/** 主题/风格关键词规则：命中即打标。 */
interface ThemeRule {
  match: RegExp
  theme: string
  style: string
  lightPreset: string
  props: UGCPropDraft[]
}

const THEME_RULES: ThemeRule[] = [
  {
    match: /赛博|cyber|霓虹|neon|未来科技|机械|朋克/i,
    theme: 'cyberpunk', style: '赛博朋克', lightPreset: 'night',
    props: [
      { kind: 'torus', label: '霓虹招牌', color: '#ff2d78', scale: 1 },
      { kind: 'box', label: '悬浮长椅', color: '#1f6f8b', scale: 1 },
    ],
  },
  {
    match: /茶馆|茶铺|喝茶|茶桌|茶/i,
    theme: 'teahouse', style: '东方茶馆', lightPreset: 'day',
    props: [
      { kind: 'cylinder', label: '茶桌', color: '#6b4a2a', scale: 1 },
      { kind: 'cylinder', label: '茶炉', color: '#3a2a1a', scale: 0.8 },
    ],
  },
  {
    match: /古风|书院|竹简|古代|国学|诗词|文人/i,
    theme: 'ancient-study', style: '古风水墨', lightPreset: 'day',
    props: [
      { kind: 'box', label: '书架', color: '#5a4326', scale: 1.2 },
      { kind: 'box', label: '书案', color: '#6b5030', scale: 1 },
    ],
  },
  {
    match: /酒吧|喝酒|微醺|吧台|cocktail/i,
    theme: 'bar', style: '霓虹酒吧', lightPreset: 'night',
    props: [
      { kind: 'box', label: '吧台', color: '#2a1a2e', scale: 1 },
      { kind: 'cylinder', label: '吧凳', color: '#ffd600', scale: 0.7 },
    ],
  },
  {
    match: /法庭|审判|开庭|辩论庭|法院/i,
    theme: 'court', style: '庄严法庭', lightPreset: 'day',
    props: [
      { kind: 'box', label: '审判席', color: '#4fb3a5', scale: 1 },
    ],
  },
  {
    match: /星空|银河|星球|宇宙|星轨/i,
    theme: 'starlight', style: '星空', lightPreset: 'night',
    props: [
      { kind: 'sphere', label: '悬浮星球', color: '#4fb3a5', scale: 0.6 },
    ],
  },
  {
    match: /海底|深海|潜水|海洋|图书馆|书屋/i,
    theme: 'deepsea-library', style: '深海静谧', lightPreset: 'night',
    props: [
      { kind: 'box', label: '书架', color: '#0e4a66', scale: 1.2 },
    ],
  },
  {
    match: /健身|运动|举铁|撸铁|健身房/i,
    theme: 'gym', style: '未来健身', lightPreset: 'day',
    props: [
      { kind: 'cylinder', label: '哑铃', color: '#ffd600', scale: 0.5 },
    ],
  },
  {
    match: /童话|糖果|广场|旋转木马|游乐园/i,
    theme: 'fairy-plaza', style: '童话糖果', lightPreset: 'sunset',
    props: [
      { kind: 'cylinder', label: '喷泉', color: '#f7d9c4', scale: 1 },
    ],
  },
]

/** 兜底主题（啥都没命中时）。 */
const FALLBACK_THEME: ThemeRule = {
  match: /./, theme: 'starlight-plaza', style: '星空广场', lightPreset: 'night',
  props: [{ kind: 'sphere', label: '装饰球', color: '#4fb3a5', scale: 0.5 }],
}

/** 玩法类型关键词。 */
function detectGameType(text: string): { gameType: UGCGameType; note: string } {
  if (/辩论|争论|辩论赛|辩|讨论|对决/i.test(text)) return { gameType: 'debate', note: '玩法=辩论' }
  if (/收集|寻宝|找|搜集|拾取/i.test(text)) return { gameType: 'collect', note: '玩法=收集' }
  if (/问答|答题|quiz|问答挑战|竞答/i.test(text)) return { gameType: 'quiz', note: '玩法=问答' }
  if (/竞速|赛跑|到达|比赛|冲线|reach/i.test(text)) return { gameType: 'reach', note: '玩法=竞速' }
  return { gameType: 'explore', note: '玩法=自由探索(兜底)' }
}

/** 从文本中抽取参与名人 id（保持出现顺序，去重）。 */
export function extractCelebrities(text: string): string[] {
  const ids: string[] = []
  // 先匹配较长别名（避免“东坡”被“东”之类截断——这里别名都显式列出，按长度降序）
  const entries = Object.entries(NAME_TO_ID).sort((a, b) => b[0].length - a[0].length)
  let rest = text
  for (const [name, id] of entries) {
    if (rest.includes(name)) {
      if (!ids.includes(id)) ids.push(id)
      rest = rest.split(name).join(' ')
    }
  }
  return ids.slice(0, 4) // 最多 4 位参与者
}

/** 匹配主题规则：所有命中的规则拼成复合 theme（用 - 连接）。 */
function matchThemes(text: string): { themes: string[]; styles: string[]; light: string; props: UGCPropDraft[]; usedFallback: boolean } {
  const hit = THEME_RULES.filter((r) => r.match.test(text))
  const themes: string[] = []
  const styles: string[] = []
  const props: UGCPropDraft[] = []
  for (const r of hit) {
    themes.push(r.theme)
    styles.push(r.style)
    props.push(...r.props)
  }
  // 光照优先级：夜间氛围 > 黄昏 > 清晨 > 白天（多主题命中时取最有氛围的）
  const lightRank: Record<string, number> = { night: 3, sunset: 2, dawn: 1, day: 0 }
  const light = hit
    .map((r) => r.lightPreset)
    .sort((a, b) => (lightRank[b] ?? 0) - (lightRank[a] ?? 0))[0] ?? 'day'
  if (themes.length === 0) {
    return {
      themes: [FALLBACK_THEME.theme],
      styles: [FALLBACK_THEME.style],
      light: FALLBACK_THEME.lightPreset,
      props: FALLBACK_THEME.props,
      usedFallback: true,
    }
  }
  return { themes, styles, light, props: props.slice(0, 5), usedFallback: false }
}

/** 从一句话描述提炼标题。 */
function deriveTitle(raw: string, themes: string[], celebrityIds: string[]): string {
  const style = themes.join('·')
  const who = celebrityIds.length > 0 ? ` · ${celebrityIds.length}位名人` : ''
  return `${style}${who}`
}

/**
 * 把自然语言一句话解析为结构化 SceneDraft。纯函数。
 * 示例："一个赛博朋克茶馆，苏轼和马斯克在辩论"
 *   → theme: cyberpunk-teahouse, celebrityIds: [su-shi, elon-musk], gameType: debate
 */
export function parsePrompt(rawInput: string): SceneDraft {
  const rawPrompt = (rawInput ?? '').trim()
  const text = rawPrompt || '一个好玩的地方'

  const celebrityIds = extractCelebrities(text)
  const { themes, styles, light, props, usedFallback } = matchThemes(text)
  const { gameType, note: gameNote } = detectGameType(text)

  const theme = themes.join('-')
  const style = styles.join('·')
  const title = deriveTitle(rawPrompt, themes, celebrityIds)
  const notes = `${usedFallback ? '未命中主题·已走兜底模板' : themes.length > 1 ? '多主题复合' : '主题命中'}；${gameNote}${celebrityIds.length ? `；参与${celebrityIds.length}位名人` : ''}`

  return {
    title: rawPrompt.slice(0, 16) || title,
    rawPrompt: text,
    theme,
    style,
    celebrityIds,
    gameType,
    props,
    lightPreset: light,
    notes,
  }
}
