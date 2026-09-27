// ===== R5: 破冰话题生成纯函数测试 =====
import { describe, expect, it } from 'vitest'
import { generateIcebreakerTopics } from './icebreaker'

describe('generateIcebreakerTopics', () => {
  it('空上下文：返回通用破冰话题', () => {
    const topics = generateIcebreakerTopics({})
    expect(topics.length).toBeGreaterThan(0)
    // 无队友时应包含通用话题
    expect(topics.some((t) => t.includes('第一次来'))).toBe(true)
  })

  it('按场景生成场景化话题', () => {
    const topics = generateIcebreakerTopics({ sceneId: 'court' })
    expect(topics.some((t) => t.includes('法官'))).toBe(true)
  })

  it('按在场名人领域追加话题', () => {
    const topics = generateIcebreakerTopics({ sceneId: 'library', celebrityFields: ['科技'] })
    expect(topics.some((t) => t.includes('马斯克'))).toBe(true)
    // 场景话题仍在
    expect(topics.some((t) => t.includes('书'))).toBe(true)
  })

  it('有队友时不追加通用破冰话题', () => {
    const topics = generateIcebreakerTopics({ sceneId: 'gym', hasTeammate: true })
    expect(topics.some((t) => t.includes('第一次来'))).toBe(false)
  })

  it('去重且不超过 maxTopics', () => {
    const topics = generateIcebreakerTopics(
      { sceneId: 'court', celebrityFields: ['科技', '商业', '科学', '文学'] },
      4,
    )
    expect(topics.length).toBe(4)
    expect(new Set(topics).size).toBe(4)
  })

  it('确定性：相同输入输出一致', () => {
    const a = generateIcebreakerTopics({ sceneId: 'werewolf', celebrityFields: ['哲学'] })
    const b = generateIcebreakerTopics({ sceneId: 'werewolf', celebrityFields: ['哲学'] })
    expect(a).toEqual(b)
  })
})
