# GDD · 图书馆（Library）— 90 秒知识擂台赛

> 版本：M14 玩法深化（feat/scene-gym-library）
> 对应设计规格：`docs/gameplay-redesign-spec.md` §6
> 引擎：`apps/api/src/library-engine.ts`（`LibraryOrchestrator extends BaseOrchestrator`，纯 TS，Node 可单测）
> 纯规则：`packages/shared/src/library-quiz.ts`（选题 / 抢答 / 计分 / 排名纯函数，前后端共用）
> 兜底题库：`apps/api/src/library-quiz-fallback.ts`（每领域 ≥15 题硬编码）

## 1. 一句话核心幻想

**你不是在和名人聊天——你在知识擂台赛上抢答，和 AI 名人比谁懂得多。**

## 2. 单局结构（约 90 秒）

| 时间 | 阶段 | 玩家做什么 |
|---|---|---|
| T+0s | 选领域 | [科学][文学][哲学][历史][艺术] 五选一 |
| T+5s | 出题 | 一次 LLM 生成 8 题（失败走 fallback 题库），3 位 AI 对手就座 |
| T+10s | 答题 ×8 | 每题 10 秒限时、4 选项；AI 会在 2-8s 间随机抢答抢分 |
| T+85s | 结算 | 排名 / 段位 / 败者名人金句 |

## 3. 槽位（继承 BaseOrchestrator）

- `slot-0`：真人 = **攻擂方**
- `slot-1..3`：AI = 三位领域对口名人对手（`QUIZ_OPPONENT_IDS[domain]`）

## 4. 规则（全部复用 library-quiz.ts 纯函数）

### 4.1 题目
- 开局一次 LLM 调用出 8 题（`POST /api/library/quiz/start`），整局不再调 LLM。
- 失败走 `QUIZ_FALLBACK_BANK`（每领域 ≥15 题随机抽 8）。
- 每题 4 选项，限时 10s（`QUIZ_QUESTION_TIME_LIMIT_MS`），共 8 题。

### 4.2 AI 抢答
- 每题由 `planBuzzes(domain, opponents, rand)` 规划 1-2 位 AI 在 2-8s 间抢答。
- 正确率：主场名人 0.85 / 客场 0.55（`celebBuzzAccuracy`）。
- AI 答对：该 AI +50；答错：该 AI -20（`AI_BUZZ_SUCCESS_SCORE` / `AI_BUZZ_WRONG_SCORE`）。
- 前端用 `setTimeout(buzz.atMs)` 触发，引擎只裁决结果（注入 rand 可测）。

### 4.3 玩家计分
- 答对：`playerScoreDelta(comboBefore)` = base 100 × (comboBefore ≥ 3 ? 2 : 1)。
- 答错 / 超时：lives -1，combo 归零；lives=3 起始，**lives=0 提前结束**。
- combo = 连对数（`nextCombo`）。

### 4.4 胜负与段位
- 排名 = 四人总分降序（`rankPlayers`）。
- **赢 = 总分压过 3 位 AI 中的 2 位**（即真人 rank ≤ 2）。
- 段位（`tierForRank`）：rank1 = 宗师 / rank2 = 学霸 / 其余 = 门外汉；
  GameResult.tier 映射：宗师→master，学霸→expert，门外汉→novice。

## 5. 引擎状态机（LibraryOrchestrator）

```
lobby → setup → playing
  beginQuestion(i)  → 规划本题 AI 抢答（发 buzz_scheduled）
  answer(choice)    → 答对加分/combo+1；答错/超时(lives-1)/combo=0
  applyCelebrityBuzz(celebId, correct) → AI 分数 ±
  nextQuestion()    → i+1，或 lives=0/题尽 → finish() → results
settle() → rankPlayers → winner = slot-0（rank≤2）:null
```

- `rand` 可注入（默认 Math.random），测试用确定性序列。
- 题目/对手由 config 注入（LLM 或 fallback），引擎不直接调 LLM。

## 6. 新手引导（可跳过）

首局四步：选领域 → 看对手榜 → 抢答规则（10s 限时 / 答错掉命）→ combo 加成（连对 3 题下题 ×2）。

## 7. 每日挑战

`getDailyChallenge('library', new Date())`，如「三连击」「力压双人」「全对」。
擂台开始前在选题页展示；结算 `isChallengeCompleted` 判定。

## 8. 保留旧资产

读书会 / 深度问答 / AI 馆员三个 tab 降级为「深聊」次级入口，`celebrityDeepChat` /
`bookRecommendation` 等全部保留。

## 9. 验收要点

- [x] LibraryOrchestrator extends BaseOrchestrator，纯 TS 可单测（`apps/api/src/library-engine.test.ts`）。
- [x] 覆盖：题目 fallback、AI 抢答概率、combo/命计分、胜负判定、超时、AI 填充。
- [x] 玩法是状态机：选题 → 8 题抢答 → 结算，非纯聊天。
