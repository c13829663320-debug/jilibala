# GDD · 脱口秀 Open Mic（玩法深化分册）

> 分支 `feat/scene-court-talkshow` · 引擎 `apps/api/src/talkshow-engine.ts`
> 基类：`BaseOrchestrator<TalkshowState, TalkshowAction, TalkshowConfig>`

## 0. 30 秒懂

你站在开放麦舞台上，主持人先热身，你从 4 张话题票里选一个，然后连讲 **3 个段子**，每个 **60 秒限时**。观众不再只打一个黑盒分数——而是拆成 **包袱 Punchline / 节奏 Pacing / 共鸣 Resonance** 三条；第 2、3 段你还能「回扣前段」，真引用到之前的梗，**共鸣 +15、观众反应升一档**。

## 1. 目标（Goal）

- 3 个段子平均分 **≥60** 拿「炸场」，≥85 拿「今日之星」。
- 单局约 **3-4 分钟**：热身 10s + 选话题 5s + 3 × 60s。
- 段位（按平均分百分位）：冷场(<30) / 尚可(30-60) / 炸场(60-85) / 今日之星(>85)。

## 2. 冲突（Conflict）

- 每个段子 **60 秒限时**，最后 10 秒变红提醒；超时未开口自动记「冷场」。
- 换话题会切断 callback 链；不回扣则少拿 +15 共鸣。
- 三个段子彼此独立还是互相成就，是玩家的核心赌注。

## 3. 选择（Choice）

- **选话题**：职场吐槽 / 恋爱翻车 / 我妈我爸 / 当代生活（`TOPIC_LIBRARY`）。
- **写段子**：自由文本，三维度评分。
- **下一招三选**（每段讲完）：顺着话题继续 / **Call back 第 N 段** / 换个话题。

| 维度 | 满分 | 含义 |
|---|---|---|
| punchline 包袱 | 40 | 结尾反转/梗够不够响 |
| pacing 节奏 | 30 | 铺垫是否拖沓、句子是否紧凑 |
| resonance 共鸣 | 30 | 观众能不能代入 |

- 真人恒占 **slot-0（演员）**；AI 填充 slot-1 主持人 + slot-2..4 三位观众评委。
- 计时器兜底：60s 到自动提交当前输入框文本，空文本=冷场。

## 4. 后果（Consequence）

- 评分外壳复用 `scorePlayerJoke()`（LLM 返回三维度 JSON）；无 LLM 环境用确定性兜底（文本长度/感叹号），绝不中断。
- Callback 检测是纯函数 `detectCallback(prevText, currentText)`：从前段抽 2-3 字关键词，看本段是否真引用。
  - 真引用 → `resonance +15`（钳到 30），reaction 升一档（silence→roast→mixed→applaud）。
  - 假引用 → note =「你说要 call back 但我没听到那个梗啊」，不加成。

## 5. 反馈（Feedback · 3 分钟正反馈节奏）

事件流：

- `talkshow_warmup` / `talkshow_topic_options`：主持人热身 + 话题票。
- `talkshow_topic_picked`：话题选定。
- `talkshow_joke_start`：开讲，推 60s 倒计时与可回扣段列表。
- `talkshow_time_warning`：最后 10 秒变红。
- `talkshow_joke_scored`：三维度分 + reaction + 一句指向可改进维度的吐槽。
- `feedback:joke`：每段讲完触发正反馈钩子。

UI 组件：`JokeScoreRadar.tsx`（三维度雷达条）、`AudienceWave.tsx`（音浪柱）、`CallbackChooser.tsx`（三选卡）、`JokeTimer.tsx`（倒计时）。

## 6. 结算（Settlement）

- 平均分 = 三段 total 均值；`computeOpenMicTier(average)` 给场景化文案，`computeTier(average,100)` 给统一段位。
- 最高分段子自动成「金句卡」进入高光。
- `GameResult.winner=null`（单人表演无对手），`scores={slot-0:平均分}`。
- 每日挑战：`getDailyChallenge('talkshow', date)`（如「三段全 callback」「单段 punchline ≥36」「零冷场」）。

## 7. 新手引导（TutorialEngine，可跳过）

首局 4 步：选话题 → 写第一段 → 看三维度评分 → 用 callback。`skipTutorial()` 后复玩不再触发。
