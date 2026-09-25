// ===== 功能闭环：场景生成 SSE 必须回传 sceneId =====
// 修复前：SSE 事件不含 sceneId，前端生成完拿不到场景 id，导致「保存/发布」提示尚未持久化。
import { describe, expect, it } from 'vitest'
import { parseSceneSseData } from './api-client'

describe('parseSceneSseData（场景生成 SSE）', () => {
  it('stage 事件携带 sceneId 可被解析', () => {
    const event = parseSceneSseData(
      JSON.stringify({ type: 'stage', stage: 'planning', message: '规划中', sceneId: 'scn-123' }),
    )
    expect(event?.type).toBe('stage')
    if (event?.type === 'stage') {
      expect(event.sceneId).toBe('scn-123')
    } else {
      throw new Error('应为 stage 事件')
    }
  })

  it('done 事件携带 sceneId 可被解析（兜底通道）', () => {
    const event = parseSceneSseData(
      JSON.stringify({ type: 'stage', stage: 'done', message: '完成', sceneId: 'scn-abc' }),
    )
    expect(event?.type).toBe('stage')
    if (event?.type === 'stage') expect(event.sceneId).toBe('scn-abc')
  })

  it('非法 JSON 返回 null，不抛错', () => {
    expect(parseSceneSseData('not-json{')).toBeNull()
    expect(parseSceneSseData('')).toBeNull()
  })
})
