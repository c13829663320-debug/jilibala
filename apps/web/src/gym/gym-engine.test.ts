// GymOrchestrator 单测：三关计分 / combo 加成 / lives=0 提前结束 / 段位阈值 / 教练点评触发。
import { describe, it, expect, beforeEach } from 'vitest'
import { GymOrchestrator, GYM_MAX_LIVES } from './engine'
import { getCircuitTier, CIRCUIT_STATIONS } from '@balabala/shared'

function makeOrch() {
  const orch = new GymOrchestrator({ tutorialEnabled: false, date: new Date('2026-09-27T08:00:00+08:00') })
  orch.setupChallenger('some-celebrity', 'u-1', '小明')
  orch.startCircuit()
  return orch
}

describe('GymOrchestrator · 槽位与开局', () => {
  it('真人=挑战者 slot-0，AI=教练 slot-1', () => {
    const orch = makeOrch()
    expect(orch.slots[0].role).toBe('challenger')
    expect(orch.slots[0].isHuman).toBe(true)
    expect(orch.slots[1].role).toBe('coach')
    expect(orch.slots[1].isHuman).toBe(false)
    expect(orch.phase).toBe('playing')
    expect(orch.state.stage).toBe('reaction')
  })

  it('继承 BaseOrchestrator：事件系统可用', () => {
    const orch = makeOrch()
    const seen: string[] = []
    orch.on('*', (e) => seen.push(e.type))
    orch.reactionHit(200)
    expect(seen).toContain('score_added')
  })
})

describe('关 1 · 反应关计分', () => {
  it('命中越快分越高，保底 50', () => {
    const orch = makeOrch()
    expect(orch.reactionHit(100)).toBe(100) // 200-100
    expect(orch.reactionHit(300)).toBe(50)  // 200-300=-100 → clamp 50
    expect(orch.reactionHit(900)).toBe(50)
    expect(orch.state.reaction.stationScore).toBe(200)
    expect(orch.state.reaction.bestMs).toBe(100)
  })

  it('漏点扣血；lives=0 返回应提前结束', () => {
    const orch = makeOrch()
    expect(orch.state.lives).toBe(GYM_MAX_LIVES)
    expect(orch.reactionMiss()).toBe(false)
    expect(orch.state.lives).toBe(2)
    orch.reactionMiss()
    expect(orch.state.lives).toBe(1)
    expect(orch.reactionMiss()).toBe(true) // 最后一滴
    expect(orch.state.lives).toBe(0)
  })
})

describe('关 2 · 节奏关与 combo 加成', () => {
  it('Perfect 连续时按 comboBefore 递增加成', () => {
    const orch = makeOrch()
    const r1 = orch.rhythmTap(0)   // perfect, comboBefore=0 → 30
    expect(r1.grade).toBe('perfect'); expect(r1.points).toBe(30)
    const r2 = orch.rhythmTap(10)  // perfect, comboBefore=1 → round(30*1.1)=33
    expect(r2.points).toBe(33)
    const r3 = orch.rhythmTap(-20) // perfect, comboBefore=2 → round(30*1.2)=36
    expect(r3.points).toBe(36)
    expect(orch.state.rhythm.maxCombo).toBe(3)
  })

  it('Good=15 并断连击；Miss=0 并断连击', () => {
    const orch = makeOrch()
    orch.rhythmTap(0); orch.rhythmTap(0) // combo=2
    const good = orch.rhythmTap(100) // offset 100ms → good
    expect(good.grade).toBe('good'); expect(good.points).toBe(15)
    expect(orch.state.rhythm.combo).toBe(0)
    const miss = orch.rhythmTap(300) // offset 300 → miss
    expect(miss.grade).toBe('miss'); expect(miss.points).toBe(0)
  })
})

describe('关 3 · 力量关', () => {
  it('越靠近 85 力量越高，3 次取最好并 ×10 落盘', () => {
    const orch = makeOrch()
    orch.completeStation(); orch.completeStation() // 跳到力量关（idx=2）
    const a = orch.powerRelease(85) // power=100
    expect(a.power).toBe(100)
    const b = orch.powerRelease(70) // power = 100-15 = 85
    expect(b.power).toBe(85)
    const c = orch.powerRelease(95) // power = 100-10 = 90
    expect(c.power).toBe(90)
    expect(orch.state.power.bestPower).toBe(100)
    const last = orch.completeStation()
    expect(last.kind).toBe('power')
    expect(last.score).toBe(1000) // bestPower 100 × 10
  })
})

describe('关间流转与教练点评触发', () => {
  it('每关落盘发 station_completed（教练点评钩子），末关发 game_result', () => {
    const orch = makeOrch()
    const stationEvents: string[] = []
    orch.on('station_completed', (e) => stationEvents.push((e.payload as { result: { kind: string } }).result.kind))
    const resultEvent = vi_result(orch)

    orch.completeStation() // reaction
    expect(stationEvents).toEqual(['reaction'])
    expect(orch.state.currentStationIndex).toBe(1)
    expect(orch.state.stage).toBe('rhythm')

    orch.completeStation() // rhythm
    expect(stationEvents).toEqual(['reaction', 'rhythm'])
    expect(orch.state.stage).toBe('power')

    orch.completeStation() // power → finish
    expect(stationEvents).toEqual(['reaction', 'rhythm', 'power'])
    expect(resultEvent.fired).toBe(true)
    expect(orch.phase).toBe('results')
  })
})

describe('段位阈值', () => {
  it('getCircuitTier 阈值：<2000 bronze / <3000 silver / <4000 gold / >=4000 explosive', () => {
    expect(getCircuitTier(1999)).toBe('bronze')
    expect(getCircuitTier(2000)).toBe('silver')
    expect(getCircuitTier(2999)).toBe('silver')
    expect(getCircuitTier(3000)).toBe('gold')
    expect(getCircuitTier(3999)).toBe('gold')
    expect(getCircuitTier(4000)).toBe('explosive')
  })

  it('settle 输出 GameResult：gold/explosive 判真人胜，tier 映射统一四档', () => {
    const orch = makeOrch()
    // 手动灌满三关结果使总分 3300（gold）
    orch.state.stationResults.push({ kind: 'reaction', hits: 10, misses: 2, score: 800 })
    orch.state.stationResults.push({ kind: 'rhythm', hits: 12, misses: 3, maxCombo: 6, score: 1500 })
    orch.state.stationResults.push({ kind: 'power', hits: 3, misses: 0, bestPower: 100, score: 1000 })
    // 同步累加器（highlights 从这里取）
    orch.state.reaction.bestMs = 320
    orch.state.rhythm.maxCombo = 6
    orch.state.power.bestPower = 100
    orch.state.currentStationIndex = 2
    orch.state.stage = 'results'
    orch.cancelTimer()
    const result = orch.settle()
    expect(result.tier.score).toBe(3300)
    expect(result.tier.level).toBe('expert')
    expect(result.winner).toBe('slot-0')
    expect(result.highlights.length).toBeGreaterThan(0)
  })

  it('bronze 段位 winner=null、novice', () => {
    const orch = makeOrch()
    orch.state.stationResults.push({ kind: 'reaction', hits: 3, misses: 2, score: 300 })
    orch.state.stationResults.push({ kind: 'rhythm', hits: 4, misses: 4, score: 200 })
    orch.state.stationResults.push({ kind: 'power', hits: 3, misses: 0, bestPower: 40, score: 400 })
    orch.state.currentStationIndex = 2
    orch.state.stage = 'results'
    const result = orch.settle()
    expect(result.tier.level).toBe('novice')
    expect(result.winner).toBeNull()
  })
})

describe('每日挑战', () => {
  it('构造即从共享种子池取到当天挑战', () => {
    const orch = new GymOrchestrator({ tutorialEnabled: false, date: new Date('2026-09-27T08:00:00+08:00') })
    expect(typeof orch.dailyChallenge.title).toBe('string')
    expect(orch.dailyChallenge.id).toMatch(/^gym-/)
    expect(CIRCUIT_STATIONS.length).toBe(3)
  })
})

// 小工具：监听 game_result
function vi_result(orch: GymOrchestrator) {
  const box = { fired: false }
  orch.on('game_result', () => { box.fired = true })
  return box
}

// ===== R5 · 钩子四件套 =====

describe('R5 · 三关高光捕获', () => {
  it('反应关：命中率≥90% → extreme_performance；0ms 命中 → perfect_round', () => {
    const orch = makeOrch()
    orch.reactionHit(0) // 0ms 完美命中
    for (let i = 0; i < 9; i++) orch.reactionHit(120) // 共 10 命中 0 漏点 = 100%
    orch.completeStation() // reaction
    const types = orch.getHighlights().map((h) => h.type)
    expect(types).toContain('extreme_performance')
    expect(types).toContain('perfect_round')
  })

  it('节奏关：maxCombo≥10 → high_combo；全 Perfect → perfect_round', () => {
    const orch = makeOrch()
    orch.completeStation() // reaction → rhythm
    for (let i = 0; i < 12; i++) orch.rhythmTap(0) // 全 perfect，maxCombo=12
    orch.completeStation() // rhythm
    const types = orch.getHighlights().map((h) => h.type)
    expect(types).toContain('high_combo')
    expect(types).toContain('perfect_round')
  })

  it('力量关：bestPower≥90 → extreme_performance', () => {
    const orch = makeOrch()
    orch.completeStation(); orch.completeStation() // → power
    orch.powerRelease(85) // bestPower=100
    orch.completeStation() // power → finish
    const types = orch.getHighlights().map((h) => h.type)
    expect(types).toContain('extreme_performance')
    expect(orch.phase).toBe('results')
  })
})

describe('R5 · 关系 / 连胜 / 战果卡 / 翻盘', () => {
  it('完成挑战：对教练产生好感度变化，战果卡可分享', () => {
    const orch = makeOrch()
    // 灌入高分三关（win）
    orch.state.stationResults.push({ kind: 'reaction', hits: 10, misses: 0, bestMs: 120, score: 1500 })
    orch.state.stationResults.push({ kind: 'rhythm', hits: 15, misses: 0, maxCombo: 8, score: 1800 })
    orch.state.stationResults.push({ kind: 'power', hits: 3, misses: 0, bestPower: 100, score: 1000 })
    orch.state.reaction.bestMs = 120
    orch.state.rhythm.maxCombo = 8
    orch.state.power.bestPower = 100
    orch.state.currentStationIndex = 2
    orch.state.stage = 'results'
    orch.cancelTimer()
    const result = orch.settle() as ReturnType<typeof orch.settle> & { relationshipChanges: Array<{ celebrityId: string; delta: number }>; resultCardText: string; streak: { current: number; best: number } }
    expect(result.winner).toBe('slot-0')
    expect(result.relationshipChanges).toHaveLength(1)
    expect(result.relationshipChanges[0].celebrityId).toBe('some-celebrity')
    expect(result.relationshipChanges[0].delta).toBeGreaterThan(0)
    expect(result.streak.current).toBe(1) // 首局胜 = 1 连胜
    expect(result.resultCardText).toContain('健身房')
  })

  it('翻盘检测：反应关低分、节奏+力量关追上来 → comeback=true', () => {
    const orch = makeOrch()
    // reaction 9 命中×100 = 900（早期分率 ~20% < 30%）
    for (let i = 0; i < 9; i++) orch.reactionHit(100)
    orch.completeStation()
    // rhythm 12 个 perfect ≈ 558
    for (let i = 0; i < 12; i++) orch.rhythmTap(0)
    orch.completeStation()
    // power 满分 1000 → 终局 ≈2458（>50%）
    orch.powerRelease(85)
    const result = orch.completeStation() // power → finish
    expect(result.kind).toBe('power')
    const hooks = orch.lastResult!
    expect(hooks.comeback).toBe(true)
    // 终局 2458<3000 仍判负，但翻盘轨迹已被识别。
    expect(['comeback_win', 'big_loss', 'narrow_loss']).toContain(hooks.settlementType)
  })
})
