// 一句话解析纯函数测试（node 环境）
import { describe, expect, it } from 'vitest'
import { parsePrompt, extractCelebrities } from './promptParser'

describe('extractCelebrities', () => {
  it('命中苏轼与马斯克', () => {
    const ids = extractCelebrities('一个赛博朋克茶馆，苏轼和马斯克在辩论')
    expect(ids).toContain('su-shi')
    expect(ids).toContain('elon-musk')
  })

  it('支持别名：苏东坡 / Elon', () => {
    expect(extractCelebrities('苏东坡约了Elon喝咖啡')).toEqual(
      expect.arrayContaining(['su-shi', 'elon-musk']),
    )
  })

  it('无人名时返回空数组', () => {
    expect(extractCelebrities('一个没人的空房间')).toEqual([])
  })

  it('去重且最多 4 位', () => {
    const ids = extractCelebrities('李白 李白 杜甫 白居易 鲁迅 苏轼 牛顿')
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeLessThanOrEqual(4)
  })
})

describe('parsePrompt', () => {
  it('解析示例句：赛博朋克茶馆辩论', () => {
    const d = parsePrompt('一个赛博朋克茶馆，苏轼和马斯克在辩论')
    expect(d.theme).toContain('cyberpunk')
    expect(d.theme).toContain('teahouse')
    expect(d.gameType).toBe('debate')
    expect(d.celebrityIds).toEqual(expect.arrayContaining(['su-shi', 'elon-musk']))
    expect(d.lightPreset).toBe('night') // 赛博朋克覆盖为夜间
  })

  it('识别收集玩法', () => {
    expect(parsePrompt('在古风书院里收集竹简').gameType).toBe('collect')
  })

  it('识别问答玩法', () => {
    expect(parsePrompt('和孔子来一场问答挑战').gameType).toBe('quiz')
  })

  it('空输入走兜底模板', () => {
    const d = parsePrompt('')
    expect(d.theme).toBeTruthy()
    expect(d.gameType).toBe('explore')
    expect(d.notes).toContain('兜底')
  })

  it('未识别主题也有默认主题', () => {
    const d = parsePrompt('奇奇怪怪的地方啊哈哈哈')
    expect(d.theme).toBeTruthy()
    expect(d.props.length).toBeGreaterThan(0)
  })

  it('保留原始描述与备注', () => {
    const d = parsePrompt('星空下李白吟诗')
    expect(d.rawPrompt).toBe('星空下李白吟诗')
    expect(d.notes).toBeTruthy()
  })
})
