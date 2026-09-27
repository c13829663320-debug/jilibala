// ===== R5: 陌生人破冰话题生成（纯函数） =====
//
// 依据「当前场景 + 同房间在场名人领域」生成破冰话题卡片。
// 纯函数、确定性输出（无随机），便于 vitest 覆盖。
// 数据为前端内置，不调用名人域接口（最小接线，话题文案后续可由名人域替换）。

import type { CelebrityField, SceneId } from '@balabala/shared'

export interface IcebreakerContext {
  /** 当前所在场景。 */
  sceneId?: SceneId
  /** 同房间在场名人的领域（来自名人域），用于生成针对性话题。 */
  celebrityFields?: CelebrityField[]
  /** 是否已有队友（同队时话题偏合作，否则偏陌生人破冰）。 */
  hasTeammate?: boolean
}

/** 每个场景对应的场景化话题。 */
const SCENE_TOPICS: Record<SceneId, string[]> = {
  court: [
    '如果你是法官，这个案子你会怎么判？',
    '原告和被告，你更站哪一边？',
    '你觉得这个案子最关键的证据是什么？',
  ],
  talkshow: [
    '今天开放麦，你最想吐槽什么？',
    '最近有什么梗让你笑到不行？',
    '如果上台讲三分钟，你会讲什么？',
  ],
  werewolf: [
    '开局你最怀疑谁？为什么？',
    '第一轮你会把票投给谁？',
    '你觉得第一个被投出去的会是好人还是狼？',
  ],
  bar: [
    '这个辩题，你站正方还是反方？',
    '你最近一次和人认真争论是为了什么？',
    '你觉得辩论里最有说服力的技巧是什么？',
  ],
  gym: [
    '今天打算练哪个部位？',
    '你最想突破的一个重量是？',
    '你健身路上最励志的一件事？',
  ],
  library: [
    '你最近在读什么书？',
    '如果和在场的这位名人聊十分钟，你会先问什么？',
    '哪本书改变过你的想法？',
  ],
}

/** 每个名人领域对应的话题。 */
const FIELD_TOPICS: Record<CelebrityField, string[]> = {
  科技: ['如果让你当面问马斯克一个问题，你会问什么？', '你觉得十年后我们的生活会被 AI 改成什么样？'],
  商业: ['你觉得创业最需要的一种能力是什么？', '你最佩服的一位企业家是谁？为什么？'],
  科学: ['你最近最好奇的一个科学问题是什么？', '如果能做一次实验，你想验证什么？'],
  文学: ['你最喜欢的一本书是？它哪里打动了你？', '如果写一本书，你会写什么题材？'],
  艺术: ['你最近被哪件作品打动过？', '你觉得艺术最重要的功能是？'],
  哲学: ['你怎么定义「成功」？', '如果只能保留一条人生信条，你会留哪条？'],
  政治: ['如果能制定一条新规则，你会定什么？', '你觉得好的公共讨论最重要的是什么？'],
}

/** 陌生人之间通用的破冰话题。 */
const GENERIC_TOPICS = [
  '你是第一次来这个房间吗？',
  '你平时最喜欢玩哪个玩法？',
  '今天上线最想做什么？',
]

/**
 * 生成破冰话题列表。
 * 顺序：场景话题 -> 在场名人领域话题 -> （无队友时）通用破冰话题。
 * 去重，最多返回 maxTopics 条（默认 6）。
 */
export function generateIcebreakerTopics(ctx: IcebreakerContext = {}, maxTopics = 6): string[] {
  const out: string[] = []
  const push = (list: string[] | undefined) => {
    if (!list) return
    for (const t of list) {
      if (!out.includes(t)) out.push(t)
      if (out.length >= maxTopics) return
    }
  }

  if (ctx.sceneId) push(SCENE_TOPICS[ctx.sceneId])
  if (ctx.celebrityFields) {
    for (const field of ctx.celebrityFields) push(FIELD_TOPICS[field])
  }
  if (!ctx.hasTeammate) push(GENERIC_TOPICS)

  return out.slice(0, maxTopics)
}
