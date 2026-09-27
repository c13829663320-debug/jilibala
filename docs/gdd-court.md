# GDD · 趣味法庭 Court（玩法深化分册）

> 分支 `feat/scene-court-talkshow` · 引擎 `apps/api/src/court-engine.ts`
> 基类：`BaseOrchestrator<CourtEngineState, CourtAction, CourtConfig>`

## 0. 30 秒懂

你是法庭上那支决定胜负的律师。天平居中开庭，3 轮里你每轮有 **2 点弹药**，从 4 张预制牌里选着打：**攻击论点 / 出示证据 / 嘲讽对方 / 要求法官记录**。牌面命中「未决争议点」天平大涨，没命中小涨，嘲讽越界还会反向。3 轮结束时你方天平 **≥55 即胜诉**。

## 1. 目标（Goal）

- 把终局天平停在你方 ≥50（>50 胜诉，=50 平局，<50 败诉）。
- 单局约 **2 分钟**：开庭 5s + 3 轮 × ~30s + 判决 10s。
- 段位（按你方天平百分位）：菜鸟律师(<30) / 出庭律师(30-60) / 王牌律师(60-85) / 金牌大状(>85)。

## 2. 冲突（Conflict）

- 对手 AI 每轮固定 **-4** 天平（玩家上一张 attack 命中则下轮减免 2）。
- 玩家每轮只有 **2 点弹药**，而 4 张牌里最贵的组合要 2 点；必须决定「打哪个争议点」。
- 争议点数量有限：一张证据牌命中后该点即「查明」，下一轮不能再靠它涨天平。

## 3. 选择（Choice）

| 牌 | 弹药 | 命中争议点 | 未命中 |
|---|---|---|---|
| attack 攻击论点（自由写一句） | 1 | 天平 +6，下轮对手反驳 -2 | +1 |
| evidence 出示证据（选已上传证据） | 1 | 天平 +8，该争议点标记查明 | +2 |
| mock 嘲讽（自由写） | 1 | 天平 +3；含越界词则 **-3** | 0 |
| request_record 要求记录某事实 | 0 | 把事实写入庭审记录，下轮双方可见 | — |

- 真人恒占 **slot-0（律师，关键一方）**；AI 填充 slot-1 对方律师 / slot-2 法官 / slot-3 当事人。
- 每轮玩家回合 **15 秒限时**，超时自动 pass（`BaseOrchestrator.startTimer` 兜底，绝不卡死）。

## 4. 后果（Consequence）

- 所有结算走 `court-state.ts` 纯函数：`resolveCard()` → `{delta, hit, judgeComment}`，`applyBalance()` 做 0-100 互补钳制。
- 确定性输入 → 可复算：同样的牌 + 同样的证据池，天平结果完全一致。
- 越界嘲讽（启发式词表：笨蛋/蠢货/白痴/滚/垃圾/…）当场反向 -3，弹药不退。

## 5. 反馈（Feedback · 3 分钟正反馈节奏）

事件流（与 shared `CourtTrialEvent` 对齐，前端组件直连）：

- `court_balance_update`：天平滑动 + lastDelta 飘字（绿色命中 / 灰色未中 / 红色越界）。
- `court_player_turn`：推本回合弹药、4 张手牌、当前未决争议点。
- `court_card_resolved`：法官口播「此点已查明 / 关联不强 / 嘲讽越界」。
- `court_round_recap`：每轮小结剩余争议点与天平。
- `feedback:court_hit`：命中时触发正反馈钩子（每局至少 1 次，命中即夸）。

UI 组件：`BalanceScale.tsx`（顶部互补天平）、`PlayerHandCards.tsx`（手牌+⚡弹药）、`EvidencePicker.tsx`（选证据）、`JudgeGavelOverlay.tsx`（法槌小结）。

## 6. 结算（Settlement）

- 胜方**由天平决定**，LLM 不再自由心证：`decideWinnerFromBalance()`。
- `GameResult`：`winner=slot-0/slot-1/null`；`scores={slot-0:玩家天平, slot-1:对方天平}`；段位用 `computeTier(天平, 100)`；排位分用 `computeRankPoints(win/draw/loss)`。
- 高光回放：`playerMoves` 中所有 `hit=true` 的牌（「第 2 轮【出示证据】…」）。
- 每日挑战：`getDailyChallenge('court', date)`（如「铁证如山：靠证据牌取胜」「正人君子：不用 mock 牌取胜」）。

## 7. 新手引导（TutorialEngine，可跳过）

首局 4 步：选边 → 看懂天平 → 出第一张牌 → 理解命中/未命中。`skipTutorial()` 后标记完成，复玩不再触发。
