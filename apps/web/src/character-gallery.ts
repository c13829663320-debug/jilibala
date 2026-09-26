// ===== M13 第五轮：3D 人物长廊纯逻辑（无 React / three 依赖，仅数值元组） =====
// 布局、吸附、领域色、问候语全部抽成纯函数，便于单测与 3D/平面两种视图共用。
// M13 第七轮：横排饱满 + 自定义角色 C 位居中 + 「创建我的人物」占位入口。
import type { UiCharacter } from './custom-characters'

export type HallTab = 'all' | 'mine' | 'plaza'

/** 单个展台在长廊世界坐标中的位置。角色面向 +Z（相机在 +Z 一侧）。 */
export type BoothPosition = {
  /** 横向偏移（世界单位），长廊水平铺开。 */
  x: number
  /** 纵深：中间展台靠前，两端展台向后弯，形成轻微弧度 + 透视近大远小。 */
  z: number
  /** 角色面向相机的偏转角：两端角色略转向中央镜头。 */
  rotationY: number
}

/**
 * 相邻展台横向间距（世界单位）。
 * 第七轮：2.6→2.25，人物放大后排布更饱满，两侧近大远小退得更快。
 */
export const BOOTH_SPACING = 2.25

/**
 * 弧度曲率：两端展台向后退的距离 = ARC * d^2。
 * 第七轮：0.32→0.55，两侧退远更明显，避免横向切边。
 */
export const ARC_CURVE = 0.55

/**
 * 3D 全屏环形布局半径（世界单位）。
 * 20 人时相邻弧长 = 2π*5.5/20 ≈ 1.73，人物互不重叠。
 */
export const RING_RADIUS = 5.5

/**
 * 把 count 个角色均匀排成一个水平圆环（3D 全屏环形选人界面）。
 *
 * 角度约定（与 CharacterGallery3D 的 group 旋转严格自洽）：
 * - 第 i 个角色的圆周角 angle = (i / count) * 2π；
 * - 局部位置 x = -radius*sin(angle)，z = -radius*cos(angle)；
 *   （相机在 +Z，angle=0 的角色在正前方 z=-radius。x 取 -sin 是为了让
 *    group 绕 Y 轴转到 rotation.y = -(activeIndex/count)*2π 时，
 *    恰好把 activeIndex 号角色精确转到世界 (0, -radius)，即屏幕投影中心。）
 * - rotationY = angle：角色面朝圆心；group 旋转后居中者正对相机（总转角 = angle + rotation.y = 0）。
 */
export function ringLayout(count: number, radius: number = RING_RADIUS): BoothPosition[] {
  const n = Math.max(0, Math.floor(count))
  const out: BoothPosition[] = []
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2
    out.push({
      x: -radius * Math.sin(angle),
      z: -radius * Math.cos(angle),
      rotationY: angle,
    })
  }
  return out
}

/**
 * 把 count 个角色沿横向等距、略带弧度地排成一列。
 * 默认以列表中点为世界原点（x=0 居中）；传入 centerIndex 时把该索引放在
 * 视觉正中央（x=0,z=0），用于「自定义角色 C 位」。
 */
export function galleryLayout(count: number, centerIndex?: number): BoothPosition[] {
  const n = Math.max(0, Math.floor(count))
  const center = Number.isFinite(centerIndex) ? (centerIndex as number) : (n - 1) / 2
  const out: BoothPosition[] = []
  for (let i = 0; i < n; i++) {
    const d = i - center
    const x = d * BOOTH_SPACING
    const z = -ARC_CURVE * d * d
    // 全部角色正面朝向屏幕（相机在 +Z 一侧），不在布局层做侧向偏转。
    const rotationY = 0
    out.push({ x, z, rotationY })
  }
  return out
}

/** 把索引夹在 [0, count-1]；count<=0 时返回 0。 */
export function clampGalleryIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, Math.round(index)))
}

/**
 * 拖拽松手后吸附到最近人物。
 *
 * dragUnits：拖拽位移换算成「几个展台宽」。向右拖（手指向右滑）看到右侧人物，
 * 即 continuousIndex 减小——故 snapped = round(currentIndex - dragUnits)。
 * 越界时夹到首尾。
 */
export function snapToNearestIndex(currentIndex: number, dragUnits: number, count: number): number {
  const continuous = currentIndex - dragUnits
  return clampGalleryIndex(continuous, count)
}

/** 领域色点：与 2D 卡片渐变同色系，克制不喧宾夺主。 */
export const FIELD_COLORS: Record<string, string> = {
  科技: '#5b8cff',
  商业: '#ffb347',
  科学: '#3ddc97',
  文学: '#e06ab8',
  艺术: '#ff7a59',
  哲学: '#9b7bff',
  政治: '#ffd600',
}

/** 自定义人物的领域色（品牌青绿 accent）。 */
export const CUSTOM_FIELD_COLOR = '#4fb3a5'

/** 取角色的领域色点：自定义人物用品牌青绿，预置名人按 field 查表，未知名给中性灰。 */
export function fieldColorFor(c: Pick<UiCharacter, 'isCustom' | 'field'>): string {
  if (c.isCustom) return CUSTOM_FIELD_COLOR
  return (c.field && FIELD_COLORS[c.field]) || '#8a8a8a'
}

/** 走近/点击时朗读的问候语。自定义人物缺省给一句友好兜底。 */
export function greetingFor(c: Pick<UiCharacter, 'isCustom' | 'greeting'>): string {
  const g = (c.greeting ?? '').trim()
  if (g) return g
  return c.isCustom ? '你好，很高兴见到你，想聊点什么？' : '你好，很高兴见到你。'
}

/**
 * 长廊可展示的角色集合（带模型的优先；无模型的在 3D 视图用占位人形兜底）。
 * 这里只做映射，不做过滤——过滤由 tab/搜索在调用处完成。
 */
export type GalleryEntry = {
  character: UiCharacter
  /** 世界坐标位置（由 galleryLayout 给出）。 */
  booth: BoothPosition
  /** 领域色点。 */
  color: string
  /** 问候语（已兜底）。 */
  greeting: string
  /** 「创建我的人物」占位入口：点击不进对话，跳分身工坊。 */
  isCreateEntry?: boolean
}

/** 把角色列表映射成长廊条目（含展台位置与展示元数据）。中点居中。 */
export function buildGalleryEntries(characters: UiCharacter[], centerIndex?: number): GalleryEntry[] {
  const layout = galleryLayout(characters.length, centerIndex)
  return characters.map((character, i) => ({
    character,
    booth: layout[i],
    color: fieldColorFor(character),
    greeting: greetingFor(character),
  }))
}

/** 创建占位入口的特殊 id（不与任何真实人物冲突）。 */
export const CREATE_ENTRY_ID = '__create_my_character__'

/** 构造「创建我的人物」占位人物（无模型，3D 用 + 号展台渲染）。 */
export function makeCreateEntryCharacter(): UiCharacter {
  return {
    id: CREATE_ENTRY_ID,
    name: '创建我的人物',
    title: '进入分身工坊',
    intro: '',
    tags: [],
    greeting: '',
    portrait: '',
    isCustom: true,
  }
}

/**
 * 把「名人 + 我的自定义人物 + 广场人物」按 tab 组织成长廊序列，并决定默认 C 位。
 *
 * 规则：
 * - all：最近创建的自定义人物放正中央（青绿光环），名人左右交替分布两侧；
 *   无自定义人物时中央放「创建我的人物」入口。其余自定义人物插在 C 位近旁。
 * - mine：仅我的自定义人物，最近创建的居中（无则只放创建入口）。
 * - plaza：广场公开人物，保持中点居中。
 *
 * mine 数组应由调用处按「最近创建/使用」降序排好（mine[0] 即 C 位候选）。
 */
export function buildGallerySequence(args: {
  tab: HallTab
  celebs: UiCharacter[]
  mine: UiCharacter[]
  plaza: UiCharacter[]
}): { entries: GalleryEntry[]; centerIndex: number } {
  const { tab, celebs, mine, plaza } = args

  /** 覆盖为环形 booth（保留条目顺序与 isCreateEntry 标记不变）。 */
  const ringify = (entries: GalleryEntry[]): GalleryEntry[] => {
    const ring = ringLayout(entries.length)
    return entries.map((e, i) => ({ ...e, booth: ring[i] }))
  }

  // plaza：公开人物，中点居中，不掺创建入口。
  if (tab === 'plaza') {
    const entries = ringify(buildGalleryEntries(plaza))
    return { entries, centerIndex: clampGalleryIndex((plaza.length - 1) / 2, plaza.length) }
  }

  // mine：仅自定义人物，最近创建居中；空列表 → 只放创建入口。
  if (tab === 'mine') {
    if (mine.length === 0) {
      const seq = [makeCreateEntryCharacter()]
      const entries = ringify(buildGalleryEntries(seq, 0))
      entries[0] = { ...entries[0], isCreateEntry: true }
      return { entries, centerIndex: 0 }
    }
    const entries = ringify(buildGalleryEntries(mine, 0))
    return { entries, centerIndex: 0 }
  }

  // all：最近自定义居中，名人两侧交替，其余自定义近旁插入。
  const left: UiCharacter[] = []
  const right: UiCharacter[] = []

  // 名人左右交替：第 0、2、4… 位放左侧，第 1、3、5… 位放右侧。
  celebs.forEach((c, i) => {
    if (i % 2 === 0) left.push(c)
    else right.push(c)
  })

  // C 位：最近创建的自定义人物；没有则用创建入口占位。
  const centerChar: UiCharacter = mine[0] ?? makeCreateEntryCharacter()
  const isCreateCenter = !mine[0]

  // 其余自定义人物（mine[1..]）贴近 C 位左右交替插入：左先右后。
  const rest = mine.slice(1)
  rest.forEach((c, i) => {
    if (i % 2 === 0) left.push(c)
    else right.push(c)
  })

  const seq = [...left, centerChar, ...right]
  const centerIndex = left.length
  const entries = ringify(buildGalleryEntries(seq, centerIndex))
  if (isCreateCenter) {
    entries[centerIndex] = { ...entries[centerIndex], isCreateEntry: true }
  }
  return { entries, centerIndex }
}
