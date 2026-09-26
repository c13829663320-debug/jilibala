import { describe, it, expect } from 'vitest'
import {
  getExpressionWeights,
  expressionWeightsToPose,
  expressionToPose,
  legacyExpressionToProcedural,
  ALL_EXPRESSIONS,
  NEUTRAL_WEIGHTS,
  type ProceduralExpression,
} from './procedural-expressions'

describe('程序化表情：权重表', () => {
  it('每个表情都返回权重，且通道落在合理范围', () => {
    for (const expr of ALL_EXPRESSIONS) {
      const w = getExpressionWeights(expr)
      expect(w.browUp).toBeGreaterThanOrEqual(0)
      expect(w.browUp).toBeLessThanOrEqual(1)
      expect(w.browDown).toBeGreaterThanOrEqual(0)
      expect(w.eyeOpen).toBeGreaterThan(0)
      expect(w.jawOpen).toBeGreaterThanOrEqual(0)
      expect(w.jawOpen).toBeLessThanOrEqual(1)
    }
  })

  it('neutral 等于基线', () => {
    expect(getExpressionWeights('neutral')).toEqual(NEUTRAL_WEIGHTS)
  })

  it('未知表情回退 neutral', () => {
    expect(getExpressionWeights('unknown' as ProceduralExpression)).toEqual(NEUTRAL_WEIGHTS)
  })

  it('各表情形态可区分：惊讶睁眼大、悲伤撇嘴、愤怒皱眉', () => {
    const surprised = getExpressionWeights('surprised')
    const sad = getExpressionWeights('sad')
    const angry = getExpressionWeights('angry')
    const happy = getExpressionWeights('happy')

    expect(surprised.eyeOpen).toBeGreaterThan(1.1)
    expect(surprised.browUp).toBeGreaterThan(0.8)
    expect(sad.frown).toBeGreaterThan(0.6)
    expect(angry.browSqueeze).toBeGreaterThan(0.7)
    expect(happy.smile).toBeGreaterThan(0.7)
  })

  it('fear / disgust / contempt / smirk 不与 neutral 雷同', () => {
    for (const e of ['fear', 'disgust', 'contempt', 'smirk'] as ProceduralExpression[]) {
      const w = getExpressionWeights(e)
      // 至少有一个通道偏离 neutral
      const diff =
        Math.abs(w.browUp) + Math.abs(w.eyeOpen - 1) + Math.abs(w.jawOpen) +
        Math.abs(w.smile) + Math.abs(w.frown)
      expect(diff).toBeGreaterThan(0.1)
    }
  })
})

describe('程序化表情：权重 → Pose', () => {
  it('browRaise 由抬眉减压眉合成', () => {
    const w = getExpressionWeights('angry')
    const pose = expressionWeightsToPose(w)
    expect(pose.browRaise).toBeLessThan(0) // 压眉 → 负
  })

  it('惊讶表情 eyeOpen 被抬升、jawOpen>0', () => {
    const pose = expressionToPose('surprised')
    expect(pose.eyeOpen).toBeGreaterThan(1.1)
    expect(pose.jawOpen).toBeGreaterThan(0.4)
  })

  it('eyeOpen 受眯眼压制且不越界', () => {
    const pose = expressionWeightsToPose({
      ...NEUTRAL_WEIGHTS, eyeOpen: 2, eyeSquint: 1,
    })
    expect(pose.eyeOpen).toBeLessThanOrEqual(1.4)
  })

  it('neutral pose 通道归零', () => {
    const pose = expressionToPose('neutral')
    expect(pose.browRaise).toBe(0)
    expect(pose.jawOpen).toBe(0)
    expect(pose.headTilt).toBe(0)
  })
})

describe('程序化表情：旧 AvatarExpression 兼容映射', () => {
  it('happy/surprised/angry 直映，其余回 neutral', () => {
    expect(legacyExpressionToProcedural('happy')).toBe('happy')
    expect(legacyExpressionToProcedural('surprised')).toBe('surprised')
    expect(legacyExpressionToProcedural('angry')).toBe('angry')
    expect(legacyExpressionToProcedural('neutral')).toBe('neutral')
    expect(legacyExpressionToProcedural(undefined)).toBe('neutral')
    expect(legacyExpressionToProcedural('weird')).toBe('neutral')
  })
})
