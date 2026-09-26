import { describe, it, expect } from 'vitest'
import { createAnimationMachine, getPose, EMOTE_DEFAULT_DURATION } from './animation-state-machine'

describe('动画状态机：基础转换', () => {
  it('初始为 idle', () => {
    const m = createAnimationMachine()
    expect(m.state).toBe('idle')
  })

  it('idle → talk_start → talking', () => {
    const m = createAnimationMachine()
    m.transition({ type: 'talk_start' }, 0)
    expect(m.state).toBe('talking')
  })

  it('talking → talk_end → idle', () => {
    const m = createAnimationMachine()
    m.transition({ type: 'talk_start' }, 0)
    m.transition({ type: 'talk_end' }, 100)
    expect(m.state).toBe('idle')
  })

  it('idle 时 talk_end 保持 idle', () => {
    const m = createAnimationMachine()
    m.transition({ type: 'talk_end' }, 0)
    expect(m.state).toBe('idle')
  })
})

describe('动画状态机：emote', () => {
  it('idle 触发 emote → 对应 emote 状态', () => {
    const m = createAnimationMachine()
    m.transition({ type: 'emote', emote: 'wave' }, 0)
    expect(m.state).toBe('wave')
  })

  it('emote 可被新 emote 打断', () => {
    const m = createAnimationMachine()
    m.transition({ type: 'emote', emote: 'wave', durationMs: 5000 }, 0)
    expect(m.state).toBe('wave')
    // 中途被 nod 打断
    m.transition({ type: 'emote', emote: 'nod', durationMs: 5000 }, 1000)
    expect(m.state).toBe('nod')
  })

  it('emote 超时后回归 idle（未在说话）', () => {
    const m = createAnimationMachine()
    m.transition({ type: 'emote', emote: 'nod', durationMs: 1000 }, 0)
    // 未超时
    m.update(500)
    expect(m.state).toBe('nod')
    // 超时
    m.update(1001)
    expect(m.state).toBe('idle')
  })

  it('emote 期间 talk_end 不打断 emote，结束后回归 idle', () => {
    const m = createAnimationMachine()
    // 先开始说话
    m.transition({ type: 'talk_start' }, 0)
    expect(m.state).toBe('talking')
    // emote 打断说话
    m.transition({ type: 'emote', emote: 'wave', durationMs: 1000 }, 100)
    expect(m.state).toBe('wave')
    // emote 期间 talk_end：不应打断 wave
    m.transition({ type: 'talk_end' }, 300)
    expect(m.state).toBe('wave')
    // emote 结束：因为 talk_end 已置 talking=false，应回 idle
    m.update(1100)
    expect(m.state).toBe('idle')
  })

  it('emote 结束后仍在说话则回归 talking', () => {
    const m = createAnimationMachine()
    m.transition({ type: 'talk_start' }, 0)
    m.transition({ type: 'emote', emote: 'clap', durationMs: 800 }, 50)
    expect(m.state).toBe('clap')
    // emote 结束，仍在说话 → 回 talking
    m.update(900)
    expect(m.state).toBe('talking')
  })

  it('emote 期间 talk_start 不打断，结束后回归 talking', () => {
    const m = createAnimationMachine()
    // idle 状态触发 emote
    m.transition({ type: 'emote', emote: 'shake', durationMs: 1000 }, 0)
    // emote 期间开始说话：不打断 emote
    m.transition({ type: 'talk_start' }, 200)
    expect(m.state).toBe('shake')
    m.update(1100)
    expect(m.state).toBe('talking')
  })

  it('使用默认时长', () => {
    const m = createAnimationMachine()
    m.transition({ type: 'emote', emote: 'wave' }, 0)
    m.update(EMOTE_DEFAULT_DURATION.wave - 1)
    expect(m.state).toBe('wave')
    m.update(EMOTE_DEFAULT_DURATION.wave + 1)
    expect(m.state).toBe('idle')
  })
})

describe('getPose', () => {
  it('idle 姿势接近零且有呼吸浮动', () => {
    const p = getPose('idle', 0)
    expect(p.armRaiseR).toBe(0)
    expect(p.jawOpen).toBe(0)
  })

  it('wave 抬起右臂并随时间摆动', () => {
    const p1 = getPose('wave', 0)
    expect(p1.armRaiseR).toBe(1)
    const p2 = getPose('wave', 300)
    expect(p2.armSwingR).not.toBe(p1.armSwingR)
  })

  it('nod 俯仰、shake 摇头', () => {
    expect(getPose('nod', 200).headTilt).not.toBe(0)
    expect(getPose('shake', 200).headTurn).not.toBe(0)
  })

  it('laugh/surprised 有嘴部与眉毛动作', () => {
    expect(getPose('laugh', 0).jawOpen).toBeGreaterThan(0)
    expect(getPose('surprised', 0).browRaise).toBeGreaterThan(0.5)
  })
})
