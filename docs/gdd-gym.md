# GDD · 健身房（Gym）— 90 秒三关电路

> 版本：M14 玩法深化（feat/scene-gym-library）
> 对应设计规格：`docs/gameplay-redesign-spec.md` §5
> 引擎：`apps/web/src/gym/engine.ts`（`GymOrchestrator extends BaseOrchestrator`，纯 TS，前端权威）
> 纯计分函数：`packages/shared/src/gym-circuit.ts`（复用，不重写）

## 1. 一句话核心幻想

**你不是在打卡——你在约 100 秒内连闯三关手眼协调小挑战，名人教练在旁边看着你爆不爆杆。**

## 2. 单局结构（约 100 秒）

| 时间 | 阶段 | 玩家做什么 |
|---|---|---|
| T+0s | 电路预览（selector） | 看今日三关卡片、选带练名人、看每日挑战 |
| T+5s | 关 1 · 反应关 ReactionTap（30s） | 绿圈随机出现，1.5s 内点中 |
| T+35s | 关间点评（不阻塞） | 教练 LLM 一句点评飘入侧边栏，自动进入下一关 |
| T+40s | 关 2 · 节奏关 RhythmTap（45s） | 音符滚到中线按空格/点击 |
| T+85s | 关间点评（不阻塞） | 同上 |
| T+90s | 关 3 · 力量关 PowerHold（20s，3 次） | 蓄力条进绿色区松开 |
| T+105s | 结算（results） | 总分 + 段位 + 自动打卡 |

## 3. 槽位（继承 BaseOrchestrator）

- `slot-0`：真人 = **挑战者**（humanCount=1，开局 assignHuman）
- `slot-1`：AI = **名人教练**（旁观者 + 每关一句 LLM 点评，不下场计分）

## 4. 三关规则（计分全部复用 gym-circuit.ts 纯函数）

### 4.1 反应关 ReactionTap（30s）
- 绿圈在 200×200 区域随机位置出现，存活 1500ms；间隔随机 600–1200ms。
- 命中：`score += scoreReactionHit(reactionMs)` = `max(50, 200 - ms)`，记录最快 bestMs。
- 漏点（圈超时消失）/ 点空（场上无圈时点别处）：`lives -= 1`（共 3 滴）。
- **lives=0 本关提前结束**，按已命中数计分；否则 30s 到时结束。

### 4.2 节奏关 RhythmTap（45s）
- 音符每 800ms 生成，600ms 滚到判定中线。
- 判定：`judgeRhythm(offsetMs)` → Perfect ±50ms / Good ±150ms / Miss 其他。
- 计分：`rhythmPoints(grade, comboBefore)`：Perfect `round(30 × (1 + comboBefore×0.1))`，Good 15，Miss 0。
- **combo = 连续 Perfect 数**；Good / Miss 立即清零。最高 maxCombo 带入结算。

### 4.3 力量关 PowerHold（20s，3 次）
- 蓄力条 0→100 用 1.2s 循环匀速上涨，绿色目标区 [80, 90]（中心 85）。
- 松开：`power = powerValue(pct)` = `100 - |pct - 85|`。
- 3 次取最大 bestPower，本关得分 = `scorePower(bestPower)` = bestPower × 10。

## 5. 总分与段位

- 总分 = 反应关分 + 节奏关分 + 力量关分（`circuitTotalScore`）。
- `getCircuitTier(total)`：

| 总分 | 段位 | 映射 GameResult.tier |
|---|---|---|
| < 2000 | bronze 青铜 | novice |
| 2000–2999 | silver 白银 | adept |
| 3000–3999 | gold 黄金 | expert |
| ≥ 4000 | explosive 爆杆 | master |

- 排位分（`computeRankPoints`）：gold/explosive 按 win、silver 按 draw、bronze 按 loss。

## 6. 教练点评（异步、不阻塞）

每关落盘 `StationResult` 后引擎 emit `station_completed`；前端订阅该事件，fire-and-forget 请求
`POST /api/gym/circuit/comment`（失败回退固定文案），点评飘入 CoachSidebar，玩家可直接进入下一关。

## 7. 新手引导（可跳过）

首局四步（`GymOrchestrator.tutorial`）：
1. `intro` — 今日电路预览：三关是什么、总时长约 100 秒。
2. `reaction` — 反应关演示：绿圈 1.5 秒内点中，漏点掉血。
3. `rhythm` — 节奏关判定：中线按空格，连续 Perfect 有 combo 加成。
4. `power` — 力量关蓄力：绿色区 [80,90] 松开，3 次取最好。

每步可「下一步 / 跳过引导」；跳过即标记完成，不再触发。

## 8. 每日挑战

`getDailyChallenge('gym', new Date())`（共享种子池，同日同场景所有人同题），例如「三关零失误」「节奏大师」。
在电路预览页展示；结算时用 `isChallengeCompleted` 判定达成。

## 9. 事件流

```
game_started → station_started{kind} → reaction_hit / reaction_miss / rhythm_judged / power_released
→ station_completed{result} → …（三关重复）→ game_result{result}
```

## 10. 验收要点

- [x] GymOrchestrator extends BaseOrchestrator，纯 TS 可单测（`apps/web/src/gym/gym-engine.test.ts`）。
- [x] lives=0 提前结束当前关；三关计分 / combo 加成 / 段位阈值全部由纯函数决定。
- [x] 玩法是状态机：selector → reaction → rhythm → power → results，非自动 tick。
- [x] 打卡 API `/api/gym/checkins` 复用，三关总分写入 note。
