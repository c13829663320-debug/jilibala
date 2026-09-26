// ===== 全局玩家档案纯逻辑单测（XP / 升级 / 成就 / 每日挑战）=====
import { describe, expect, it } from 'vitest'
import {
  createProfile, addXp, reportGameResult, unlockAchievement, getLevel, getTierTitle,
  generateDailyChallenge, xpForLevel, todayKey,
  type PlayerProfile, type GameResult,
} from './playerProfile'

function fresh(): PlayerProfile {
  return createProfile('测试员', 'capsule')
}

describe('创建档案', () => {
  it('默认 1 级、0 XP、空战绩、带当日每日挑战', () => {
    const p = fresh()
    expect(p.level).toBe(1)
    expect(p.xp).toBe(0)
    expect(p.totalXp).toBe(0)
    expect(p.stats.totalGames).toBe(0)
    expect(p.achievements).toEqual([])
    expect(p.dailyChallenge?.date).toBe(todayKey())
  })
})

describe('XP 规则：胜 50 / 负 20', () => {
  it('胜利 +50 XP，失败 +20 XP', () => {
    let p = fresh()
    let r = reportGameResult(p, 'court', { won: true })
    expect(r.summary.baseXp).toBe(50)
    expect(r.profile.totalXp).toBe(50)
    p = r.profile
    r = reportGameResult(p, 'bar', { won: false })
    expect(r.summary.baseXp).toBe(20)
    expect(r.profile.totalXp).toBe(70)
  })

  it('胜场/负场累计进 stats', () => {
    let p = fresh()
    p = reportGameResult(p, 'gym', { won: true, score: 3200 }).profile
    p = reportGameResult(p, 'gym', { won: false, score: 1000 }).profile
    expect(p.stats.totalGames).toBe(2)
    expect(p.stats.wins).toBe(1)
    expect(p.stats.losses).toBe(1)
    expect(p.stats.perScene.gym.played).toBe(2)
    expect(p.stats.perScene.gym.wins).toBe(1)
    expect(p.stats.perScene.gym.bestScore).toBe(3200)
  })
})

describe('升级曲线：level N 需要 N*100 XP', () => {
  it('xpForLevel(1)=100, xpForLevel(2)=200', () => {
    expect(xpForLevel(1)).toBe(100)
    expect(xpForLevel(2)).toBe(200)
  })

  it('两次胜利（100 XP）从 Lv1 升到 Lv2', () => {
    let p = fresh()
    p = reportGameResult(p, 'court', { won: true }).profile // +50
    expect(p.level).toBe(1)
    p = reportGameResult(p, 'court', { won: true }).profile // +50 → 100，升级
    expect(p.level).toBe(2)
    expect(p.xp).toBe(0)
  })

  it('getLevel 与 addXp 一致', () => {
    // Lv1→2 需 100，Lv2→3 需 200，累计 300 到 Lv3。
    expect(getLevel(0)).toBe(1)
    expect(getLevel(100)).toBe(2)
    expect(getLevel(300)).toBe(3)
    expect(getLevel(299)).toBe(2)
  })
})

describe('段位称号', () => {
  it('Lv1-10 新手 / 11-30 玩家 / 31-50 达人 / 51-80 大师 / 81+ 传奇', () => {
    expect(getTierTitle(1)).toBe('新手')
    expect(getTierTitle(10)).toBe('新手')
    expect(getTierTitle(11)).toBe('玩家')
    expect(getTierTitle(30)).toBe('玩家')
    expect(getTierTitle(31)).toBe('达人')
    expect(getTierTitle(50)).toBe('达人')
    expect(getTierTitle(51)).toBe('大师')
    expect(getTierTitle(80)).toBe('大师')
    expect(getTierTitle(81)).toBe('传奇')
    expect(getTierTitle(100)).toBe('传奇')
  })

  it('跨大段位额外奖励 +30 XP', () => {
    // Lv10 → Lv11 是「新手→玩家」边界，需 10*100=1000 XP。
    let p = fresh()
    p.level = 10
    p.xp = 990   // 距 Lv11 还差 10
    // 一次失败 +20：先升 1 级（10 XP）到 Lv11（剩 10），跨段再 +30。
    const r = addXp(p, 20)
    expect(r.profile.level).toBe(11)
    expect(r.tierBonus).toBe(30)
    expect(r.leveledUp).toBe(true)
  })
})

describe('成就解锁', () => {
  it('完成第 1 局解锁「初出茅庐」', () => {
    const r = reportGameResult(fresh(), 'court', { won: true })
    expect(r.summary.newlyUnlocked).toContain('first_game')
    expect(r.profile.achievements).toContain('first_game')
  })

  it('法庭累计胜 10 局解锁「法庭金牌大状」', () => {
    let p = fresh()
    for (let i = 0; i < 10; i++) {
      p = reportGameResult(p, 'court', { won: true }).profile
    }
    expect(p.stats.perScene.court.wins).toBe(10)
    expect(p.achievements).toContain('court_gold')
  })

  it('健身房总分 > 4000 解锁「爆杆」', () => {
    const r = reportGameResult(fresh(), 'gym', { won: true, score: 4200 })
    expect(r.summary.newlyUnlocked).toContain('gym_blast')
  })

  it('狼人杀推理分 > 80 解锁「MVP」', () => {
    const r = reportGameResult(fresh(), 'werewolf', {
      won: true, score: 90, detail: { reasoningScore: 90 },
    })
    expect(r.summary.newlyUnlocked).toContain('werewolf_mvp')
  })

  it('脱口秀「今日之星」解锁成就', () => {
    const r = reportGameResult(fresh(), 'talkshow', {
      won: true, score: 95, detail: { tier: '今日之星' },
    })
    expect(r.summary.newlyUnlocked).toContain('talkshow_star')
  })

  it('图书馆答对 8/8 解锁「宗师」', () => {
    const r = reportGameResult(fresh(), 'library', {
      won: true, score: 800, detail: { correctCount: 8, totalQuestions: 8 },
    })
    expect(r.summary.newlyUnlocked).toContain('library_master')
  })

  it('成就不重复解锁', () => {
    let p = fresh()
    p = reportGameResult(p, 'court', { won: true }).profile // first_game
    const before = p.achievements.length
    const r = reportGameResult(p, 'court', { won: true })
    expect(r.profile.achievements.length).toBe(before)
    expect(r.summary.newlyUnlocked).not.toContain('first_game')
  })
})

describe('每日挑战', () => {
  it('同一天生成的挑战确定（场景/目标一致），跨天变化', () => {
    const a = generateDailyChallenge('2026-09-26')
    const b = generateDailyChallenge('2026-09-26')
    expect(a).toEqual(b)
    expect(a.target).toBeGreaterThanOrEqual(2)
    expect(a.target).toBeLessThanOrEqual(3)
    expect(generateDailyChallenge('2026-09-27').scene).not.toBe(a.scene) // 大概率不同
  })

  it('命中场景累计进度，达标后完成并奖励 +30 XP', () => {
    let p = fresh()
    const dc = p.dailyChallenge!
    for (let i = 0; i < dc.target; i++) {
      const prevTotal = p.totalXp
      const r = reportGameResult(p, dc.scene, { won: true })
      p = r.profile
      if (i === dc.target - 1) {
        expect(r.summary.dailyCompleted).toBe(true)
        // 最后一局 = 50（胜）+ 30（每日奖励），单局增量应为 80。
        expect(p.totalXp - prevTotal).toBe(80)
      } else {
        expect(r.summary.dailyCompleted).toBe(false)
      }
    }
    expect(p.dailyChallenge?.completed).toBe(true)
    expect(p.dailyChallenge?.progress).toBe(dc.target)
  })
})

describe('最爱场景与总览', () => {
  it('累计场次最多的场景成为最爱场景', () => {
    let p = fresh()
    p = reportGameResult(p, 'bar', { won: true }).profile
    p = reportGameResult(p, 'bar', { won: false }).profile
    p = reportGameResult(p, 'court', { won: true }).profile
    expect(p.stats.favoriteScene).toBe('bar')
  })
})
