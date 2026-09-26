# 共享玩法基础层（Gameplay Foundation）

> 位置：`packages/shared/src/gameplay/`
> 分支：`feat/gameplay-foundation`
> 目标：为 court / talkshow / werewolf / bar / gym / library 六场景提供**同一份**玩法编排框架，避免各场景重写状态机、计时、计分、段位、每日挑战、新手引导。

---

## 1. 模块清单

| 文件 | 职责 |
|---|---|
| `types.ts` | 核心类型：`GamePhase` / `PlayerSlot` / `GameEvent` / `GameResult` / `Tier` / `TimerState` / `TutorialStep` / `SceneId` |
| `base-orchestrator.ts` | 抽象编排基类 `BaseOrchestrator<TState,TAction,TConfig>` |
| `player-slots.ts` | 真人/AI 槽位纯函数 |
| `scoring.ts` | 段位 / 排位分 / 连胜纯函数 |
| `daily-challenge.ts` | 每日挑战（确定性种子） |
| `tutorial.ts` | `TutorialEngine` 新手引导引擎 |
| `index.ts` | 统一出口 |

六场景直接 `import { BaseOrchestrator, computeTier, ... } from '@balabala/shared'`。

---

## 2. 基类架构（文字架构图）

```
BaseOrchestrator<TState, TAction, TConfig>
├── 状态机
│   ├── phase: GamePhase            lobby→setup→playing→round→feedback→results
│   ├── transitionTo(phase)         带 phaseGuard() 守卫，拒绝返回 false
│   └── nextRound()                 currentRound++，封顶 maxRounds
├── 计时器
│   ├── startTimer(ms, onTimeout)   每回合/每行动；超时自动跑 onTimeout（AI 兜底）
│   ├── cancelTimer()
│   └── getTimer() → TimerState
├── 槽位
│   ├── setupSlots(roles, humanCount, personas)
│   ├── assignHuman(userId, nick)   默认绑 slot-0
│   ├── fillEmptySlotsWithAI()
│   └── getHumanSlots() / getAISlots()
├── 事件总线（手写 pub/sub，浏览器兼容）
│   ├── emit(event)
│   ├── on(type, handler) → unsub
│   └── off(handler)
├── 计分
│   ├── addScore(slotId, pts, reason)  → emit 'score_added'
│   └── getScore(slotId)
├── 正反馈节奏
│   ├── onFeedback(cb)              前端订阅"值得夸"事件
│   └── emitFeedback(kind, payload) 子类调用，type='feedback:<kind>'
├── 新手引导
│   ├── tutorial: TutorialEngine
│   ├── startTutorial() / skipTutorial()
├── 序列化
│   ├── getSnapshot() / loadSnapshot()   断线重连
└── 三个主方法
    ├── start(config)   → setup→playing，打时间戳
    ├── act(action)     → 仅 playing/round 阶段接受，cancelTimer 后落 state
    └── finish()        → cancelTimer→results→settle()→emit 'game_result'
```

子类必须实现：
- `abstract settle(): GameResult`
- `protected abstract applyAction(action: TAction): void`
- 按需覆写 `protected phaseGuard(from, to): boolean`

---

## 3. 六场景如何继承（子类骨架）

每个场景的 orchestrator 都继承 `BaseOrchestrator`，把自己的 state / action / config 填进泛型。

### 3.1 法庭 Court
```ts
interface CourtState { balance: number; ammo: number; unresolved: string[]; }
type CourtAction = { kind: 'attack' } | { kind: 'evidence'; id: string } | { kind: 'mock' };

class CourtOrchestrator extends BaseOrchestrator<CourtState, CourtAction, { caseId: string }> {
  protected phaseGuard(_f, to) {
    // 法庭只允许 playing 内细分 round，不允许跳 results
    return to === 'playing' || to === 'round' || to === 'feedback' || to === 'results';
  }
  protected applyAction(a: CourtAction) {
    // 命中 unresolved → balance += 8，emitFeedback('evidence_hit', {...})
  }
  settle(): GameResult {
    const tier = computeTier(this.slots[0].score, 100, COURT_TIER_LABELS);
    return { winner: this.slots[0].score >= 55 ? 'slot-0' : 'slot-1', tier, ... };
  }
}
```

### 3.2 脱口秀 Talkshow
```ts
interface TalkshowState { topic: string; jokes: Joke[]; index: number; }
type TalkshowAction = { kind: 'pick_topic'; topic: string } | { kind: 'submit_joke'; text: string; callbackTo?: number };
// settle: 三维度均分 → computeTier(avg, 100, TALKSHOW_LABELS)
```

### 3.3 狼人杀 Werewolf
```ts
interface WerewolfState { day: number; alive: PlayerSlot[]; dayActions: DayAction[]; }
type WerewolfAction =
  | { kind: 'claim_role'; role: string }
  | { kind: 'suspect'; seat: number }
  | { kind: 'pass' };
// 出局：slot.active=false 但保留观战；MAX_DAYS=4 强制 settle
```

### 3.4 酒吧 Bar
```ts
interface BarState { strength: number; playerAngle?: Angle; aiTendency: Tendency; }
type BarAction = { kind: 'pick_angle'; angle: Angle } | { kind: 'speak'; text: string };
// 克制表在 applyAction 里查纯函数，emitFeedback('counter', {...})
```

### 3.5 健身房 Gym
```ts
interface GymState { station: number; lives: number; score: number; results: StationResult[]; }
type GymAction =
  | { kind: 'reaction_tap'; reactionMs: number }
  | { kind: 'rhythm_hit'; deltaMs: number }
  | { kind: 'power_release'; power: number };
// 纯前端权威，无需服务端 LLM；三关结束 settle
```

### 3.6 图书馆 Library
```ts
interface LibraryState { domain: Domain; qIndex: number; combo: number; lives: number; }
type LibraryAction = { kind: 'answer'; choice: number };
// AI 抢答由 startTimer 在 2-8s 随机触发 onTimeout 完成
```

---

## 4. 计分 → 段位 → 每日挑战 链路

```
玩家动作 act()
   └─ applyAction() 内 addScore(slotId, pts, reason)
        └─ emit 'score_added'（前端分数条动）
              └─ finish() → settle()
                   ├─ computeTier(score, maxScore, labels)   ← 阈值固定
                   │     novice <30% / adept 30-60% / expert 60-85% / master ≥85%
                   ├─ computeRankPoints(result, myRank, oppRank)
                   │     win+25 / draw+10 / loss-15，±5 分内不修正，每超 100 分 ±2
                   ├─ computeStreak(consecutiveWins)  3连胜+5 / 5连胜+10 / 7连胜+20
                   └─ isChallengeCompleted(challengeId, result)
                         └─ getDailyChallenge(scene, today) 由日期种子选中当天挑战
```

- 段位阈值**全局统一**，文案按场景换壳（法庭：菜鸟律师→金牌大状；脱口秀：冷场→今日之星；酒吧：酒客→辩神；健身房：青铜→爆杆；图书馆：门外汉→宗师）。
- `getDailySeed(date)` 用 FNV-1a 哈希 `YYYY-MM-DD`，**同一天所有人同种子**，再异或 scene 名取模选中挑战池条目。

---

## 5. 真人 / AI 槽位分配规则

1. `setupSlots(roles, humanCount, personas)`：按 `roles` 长度建槽，`slotId = slot-0..n`。
2. **真人永远占第一个关键槽位（slot index 0）**。前 `humanCount` 个槽位先标记为真人占位（`isHuman=true` 但 `userId` 空）。
3. 真人到位后 `assignHuman(userId, nickname)` 绑到 `slot-0`。
4. 开局时若真人没到位（超时 / 单人练习），`fillEmptySlotsWithAI(personas)` 把所有空占位槽填成 AI。
5. `getKeySlot()` 返回第一个已绑定真人的槽位——即"关键一方"。
6. 出局不删槽：`slot.active=false`，保留观战视角（狼人杀幽灵观众）。

---

## 6. 新手引导接入方式

```ts
const orch = new CourtOrchestrator({
  maxRounds: 3,
  initialState,
  tutorialSteps: [
    { id: 'open',  title: '开庭', description: '选一张牌', target: '#hand', autoAdvance: false },
    { id: 'card',  title: '出牌', description: '点证据牌', target: '#evidence-card' },
  ],
});
orch.startTutorial();          // 仅新玩家首次进入
// 前端读 orch.tutorial.getCurrentStep() 渲染浮层；点下一步调 orch.tutorial.next()
orch.skipTutorial();          // 玩家跳过 → isCompleted=true，下次不再触发
```

- 引导**可跳过**，skip 后标记 `isCompleted`，持久层据此复玩时不再触发。
- 引导与玩法解耦：不阻塞 `act()`，纯 UI 层叠加。

---

## 7. 测试

- 纯函数（`scoring` / `player-slots` / `daily-challenge`）含边界值单测（阈值 0.30/0.60/0.85、±5 死区、种子确定性）。
- `base-orchestrator` 用 `TestOrchestrator` 子类集成测试：状态机守卫、fake-timer 计时/超时兜底、计分、事件订阅退订、真人/AI 填充、引导跳过、快照往返。
- 运行：`npm test`（shared → api → web）。
