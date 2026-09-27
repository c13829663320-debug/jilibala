# R5 · 关系与钩子基础层设计说明

> 范围：名人关系系统、BaseOrchestrator 钩子扩展、高光捕捉、战果卡、连胜/翻盘追踪。
> 所有纯函数在 `packages/shared/src/gameplay/`，前后端共用；持久化与路由在 `apps/api/src/relationship.ts`。

---

## 1. 元循环（单局 → 关系变化 → 等级解锁 → 指名开局）

```
            ┌──────────────────────────────────────────────┐
            │              单局（六场景任一）              │
            │  act() 内事件 ──► detectHighlight() 高光    │
            │  finish()     ──► buildSettlement() 三态    │
            └───────────────┬──────────────────────────────┘
                            │ SettlementResult / Highlight[]
                            ▼
        ┌───────────────────────────────────┐
        │  computeAffinityDelta()          │  胜/负/高光/翻盘/宿敌
        │  → 好感度 delta                  │
        └───────────────┬───────────────────┘
                        ▼
        ┌───────────────────────────────────┐
        │ applyRelationshipChange()        │  affinity 累计 → typeFromAffinity()
        │  更新档案 + 跨档解锁奖励          │  跨档 → newUnlock 弹窗
        └───────────────┬───────────────────┘
                        ▼
        ┌───────────────────────────────────┐
        │ 关系达到 friend/close/soulmate    │
        │ 解锁：开场白 / 称号 / 案件 / 搭档  │
        └───────────────┬───────────────────┘
                        ▼
        ┌───────────────────────────────────┐
        │ 广场/选人界面「指名」该名人开局    │  ← 解锁内容反哺开局体验
        └───────────────────────────────────┘
```

真人之间的好友关系复用 `apps/api/src/friends.ts`，本层只处理「玩家 ↔ 名人」。

---

## 2. 关系等级与解锁表

好感度 `affinity ∈ [-100, 100]`，由 `typeFromAffinity()` 映射：

| 档位 | affinity 区间 | 中文名 | 解锁奖励（`getUnlockForType`） |
|---|---|---|---|
| stranger | -30 < a < 0 | 陌路 | 无 |
| acquaintance | 0 ≤ a < 20 | 点头之交 | `greeting:<id>` 专属开场白 |
| friend | 20 ≤ a < 40 | 好友 | `title:<id>` 专属称号 |
| close | 40 ≤ a < 60 | 知己 | `case:<id>` 专属案件/话题 |
| soulmate | a ≥ 60 | 灵魂搭档 | `partner_mode:<id>` 搭档模式 |
| rival | a ≤ -30 | 宿敌 | 无（负向特殊档） |

`computeAffinityDelta()` 规则：
- 基础：胜 +5 / 平 +2 / 负 -2
- 高光：每个 +3
- 翻盘：额外 +10
- 大胜（得分率 > 85%）：再 +5
- 宿敌（当前 affinity < -30）：胜/负基础分**翻倍**（高光/翻盘不翻倍，避免叠加爆炸）

---

## 3. 高光类型与触发条件表

| HighlightType | 场景 | 触发事件 | 条件 |
|---|---|---|---|
| key_evidence | court | `court_card_resolved` | `hit===true && delta>=8` |
| golden_quote | talkshow | `joke_scored` | `scores.punchline>=35` |
| prophet_vote | werewolf | `vote_result` | `lynchedWerewolf===true` |
| epic_rebuttal | bar | `turn_resolved` | `effectiveness==='counter' && delta>=8` |
| extreme_performance | gym | `station_completed` | `perfectRate>=0.9` |
| high_combo | library | `answered` | `combo>=5` |
| comeback | 通用 | `settlement` | `comeback===true` |
| perfect_round | 通用 | （预留） | 单回合满分 |

`detectHighlight(scene, event, state)` 为纯函数，命中返回 `Highlight`，否则 `null`。

---

## 4. 结算演出三态判定规则

`BaseOrchestrator.buildSettlement()` 在 `finish()` 自动产出 `SettlementResult`：

| SettlementType | 条件 |
|---|---|
| big_win | 胜 且 终局得分率 > 85% |
| comeback_win | 胜 且 过程最低分率 < 30% 且 终局 > 50% |
| narrow_win | 胜，其余 |
| draw | 平局 |
| narrow_loss | 负 且 终局得分率 ∈ [45%, 50%)（惜败） |
| big_loss | 负，其余 |

判定依赖：
- `humanSlotId`（默认 `slot-0`，子类可覆写以适配阵营制）
- `settlementMaxScore`（默认 100）
- `minBalance`（`addScore` 时对玩家槽位追踪的最低分）
- `resolveResult()`（默认按 `winner === humanSlotId`，子类可覆写）

钩子：`onSettlement(settlement)` 在结算时回调；`onHighlight`/`onFeedback`/`onStreakChange`/`onRelationshipChange` 全可选，不传不影响现有行为。

---

## 5. 战果卡字段说明

`buildResultCard()` 聚合一局的全部对外展示数据：

| 字段 | 说明 |
|---|---|
| scene / sceneLabel | 场景 id / 中文名 |
| result | win / draw / loss |
| settlementType | 见上表三态 |
| score / maxScore | 本局得分 / 满分 |
| tier | { level, label } 段位 |
| rankPoints | 排位分变动 |
| streak | { current, best, isNewBest } 连胜 |
| highlights | 本局高光列表 |
| relationshipChanges | 与对手名人的关系变化（含新解锁） |
| opponent | { id, name, type: celebrity/human/ai } |
| durationMs / playedAt | 时长 / 时间 |

`resultCardToText()` 生成可复制分享文案；`resultCardToSharePrompt()` 生成文生图 prompt。渲染留给前端，本层只出数据。

---

## 6. 连胜 / 翻盘

- `updateStreak(stats, result)`：胜 `currentStreak=max(0,n)+1` 并刷新 `bestStreak`；负 `min(0,n)-1`；平归零。
- `getStreakBonus(n)`：3 连胜 +5 / 5 连胜 +10 / 7 连胜 +20，连败无惩罚。
- `detectComeback(scoreHistory, finalScore, maxScore)`：历史任一点 < 30% 且终局 > 50% 即翻盘。

`ServerProfile.stats` 与 `LeaderboardScope` 已从 3 场景扩展为六场景
（`court | talkshow | werewolf | bar | gym | library`）。

---

## 7. 文件清单

**packages/shared/src/gameplay/**
- `relationship.ts`（+ `.test.ts`）— 关系类型 + 纯函数
- `highlights.ts`（+ `.test.ts`）— 高光检测纯函数
- `result-card.ts`（+ `.test.ts`）— 战果卡拼装/文案/prompt
- `streak.ts`（+ `.test.ts`）— 连胜/翻盘纯函数
- `base-orchestrator.ts`（测试扩展）— 钩子/高光/结算三态
- `index.ts` — 统一导出

**apps/api/src/**
- `relationship.ts`（+ `.test.ts`）— 持久化 `.data/relationships/<userId>.json` + REST
- `server.ts` — 注册路由、排行榜 scope 扩六场景

**packages/shared/src/index.ts** — `ServerProfile.stats` / `LeaderboardScope` / `LeaderboardEntry.stats` 六场景化

**docs/r5-relationship-hooks.md** — 本文档

## 8. REST 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/relationships?userId=X` | 列出全部名人关系 |
| GET | `/api/relationships/:celebrityId?userId=X` | 单个关系档案 |
| POST | `/api/relationships/:celebrityId/reset` | 重置（测试用，body 带 userId） |
