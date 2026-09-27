# 叽里呱啦玩法深化专项 · 集成说明

> 分支：`feat/gameplay-integration` · 基线：`651ae1a` · 日期：2026-09-27
> 范围：六场景核心循环深化 + 真人/AI 混合 + 平衡计分段位 + 统一编排基类 + 新手引导

---

## 1. 改了什么

### 1.1 共享编排基础层（`packages/shared/src/gameplay/`）

| 文件 | 职责 |
|---|---|
| `types.ts` | GamePhase / PlayerSlot / GameEvent / GameResult / Tier / TimerState / TutorialStep |
| `base-orchestrator.ts` | 抽象泛型基类 `BaseOrchestrator<TState,TAction,TConfig>`：阶段状态机+守卫、回合管理、setTimeout 计时器（超时 AI 兜底）、玩家槽位、手写 pub/sub 事件总线、计分钩子、正反馈钩子、新手引导、快照序列化 |
| `scoring.ts` | `computeTier`（四档阈值）、`computeRankPoints`（±5 死区/每 100 分 ±2）、`computeStreak`、`clampScore` |
| `daily-challenge.ts` | FNV-1a 日期种子（同日同种子），每场景 5-6 条预设挑战 + 完成校验 |
| `player-slots.ts` | createSlots / assignHumanToSlot / fillWithAI / getKeySlot（真人恒占 slot-0） |
| `tutorial.ts` | `TutorialEngine`，可跳过且不阻断复玩 |

基础层 55 个单测，纯函数含边界值，基类用 `TestOrchestrator` 子类覆盖状态机守卫、fake-timer 计时/超时、计分、事件退订、AI 填充、引导跳过、快照往返。

### 1.2 六场景引擎（全部继承 BaseOrchestrator）

| 场景 | 引擎文件 | 核心循环 | 单局时长 | 真人关键位 | AI 填充 |
|---|---|---|---|---|---|
| 趣味法庭 | `apps/api/src/court-engine.ts` | 3 轮出牌（4 牌×2 弹药）→ 天平结算 → 判决 | ~2 分钟 | 律师（slot-0） | 对方律师/法官/被告 |
| 脱口秀 | `apps/api/src/talkshow-engine.ts` | 选话题 → 3 段×60s → 三维度评分+callback | ~3-4 分钟 | 演员（slot-0） | 主持人+3 观众 |
| 狼人杀 | `apps/api/src/werewolf-engine.ts` | 夜→公布→90s 发言+动作牌→投票→胜负检查，3-4 昼夜 | ~6-8 分钟 | 任意角色（slot-0） | 其余 8 席 |
| 酒吧辩论 | `apps/api/src/bar-engine.ts` | 3 回合选角度→克制结算→AI 对称反驳 | ~1.5 分钟 | 辩手（slot-0） | 对手名人+酒保 |
| 健身房 | `apps/web/src/gym/engine.ts` | 反应关 30s→节奏关 45s→力量关 20s | ~100 秒 | 挑战者（slot-0） | 名人教练 |
| 图书馆 | `apps/api/src/library-engine.ts` | 选领域→8 题抢答（10s/题，3 命）→排名 | ~90 秒 | 攻擂方（slot-0） | 3 位名人对手 |

### 1.3 计分→段位→每日挑战链路

- **计分**：每场景用 `addScore(slotId, points, reason)` 累积，结算时 `computeTier(score, maxScore, labels)` 映射四档（novice<30% / adept 30-60% / expert 60-85% / master >85%），文案按场景换壳。
- **段位**：`computeRankPoints` 计算胜/平/负积分变化，对手分差修正。
- **每日挑战**：`getDailyChallenge(scene, date)` 用确定性种子选挑战，六场景均有 `GET /api/engine/*-daily` 端点和前端横幅（法庭/脱口秀/狼人杀/酒吧在 engine-routes，健身房/图书馆在组件内调用）。
- **复玩**：段位累积 + 每日挑战轮换 + 名人解锁（保留原有成就系统）。

### 1.4 新手引导

每场景用 `TutorialEngine` 实现首局分步引导，可跳过，skip 后标记完成不再触发：
- 法庭：选边→看天平→出第一张牌→理解命中/未命中
- 脱口秀：选话题→写第一段→看三维度评分→用 callback
- 狼人杀：看身份→夜间行动→白天动作牌→投票→理解胜负
- 酒吧：选边→选角度→理解克制→看强度条
- 健身房：看电路→反应关演示→节奏关判定→力量关蓄力
- 图书馆：选领域→看对手→抢答→combo 加成

### 1.5 GDD 分册

`docs/gdd-court.md` / `gdd-talkshow.md` / `gdd-werewolf.md` / `gdd-bar.md` / `gdd-gym.md` / `gdd-library.md` + `docs/gameplay-foundation.md`（基础层架构）。

### 1.6 Web 端引擎接线（玩家真实入口）

四场景通过 HTTP 客户端 + 玩法面板组件接入新引擎，健身房为前端直接运行引擎：

| 场景 | engine-client | 玩法面板 | 接入位置 | 回退方式 |
|---|---|---|---|---|
| 法庭 | `apps/web/src/court/engine-client.ts` | `court/NewCourtGame.tsx` | CourtroomShell 默认 | 「经典模式」按钮 |
| 脱口秀 | `apps/web/src/talkshow/engine-client.ts` | `talkshow/NewTalkshowGame.tsx` | TalkshowShell 默认 | 「经典模式」按钮 |
| 狼人杀 | `apps/web/src/werewolf/engine-client.ts` | `werewolf/NewWerewolfGame.tsx` | WerewolfShell 默认 | `?old-ww=1` |
| 酒吧 | `apps/web/src/bar/engine-client.ts` | `bar/NewBarGame.tsx` | BarShell 默认 | `?old-bar=1` |
| 健身房 | 前端直接运行 `gym/engine.ts` | `gym/CircuitChallenge.tsx` | GymView | — |
| 图书馆 | 共用 `library-quiz.ts` 纯函数 | `library/QuizArena.tsx` | LibraryView | — |

REST 路由统一在 `apps/api/src/engine-routes.ts`：`/api/engine/{court,talkshow,werewolf,bar}/*`，含 new/act/snapshot/daily 端点。狼人杀引擎重构为 open/settle 对（openNight/settleNight、openVote/settleVote）以支持 Web 交互式逐阶段推进。

---

## 2. 如何验证

### 2.1 自动化测试

```bash
npm install
npm test    # shared 55 + api 439 + web 240 = 734 全通过
npm run build
```

### 2.2 单局引擎走查（无头，确定性输入）

各引擎均支持可注入的 AI 决策钩子和随机源，单测中用 fake timer 推进完整一局：
- 法庭：`court-engine.test.ts` — 出牌结算/天平胜负/超时 fallback/AI 填充/段位
- 脱口秀：`talkshow-engine.test.ts` — 三维度评分/callback 加成/超时提交
- 狼人杀：`werewolf-engine.test.ts` — 昼夜循环/胜负判定/动作牌/隐私不泄露
- 酒吧：`bar-engine.test.ts` — 克制表 9 组合/双维评分/倾向轮换
- 健身房：`gym-engine.test.ts` — 三关计分/combo/lives=0 提前结束
- 图书馆：`library-engine.test.ts` — 题目 fallback/AI 抢答/计分/胜负

### 2.3 真机验证（Chromium + SwiftShader，真实 UI 操作）

所有六场景均通过真实 UI 操作（CDP DOM click / puppeteer）从入口走到结算，`v2-*` 为 Web 接线后的真实对局截图：

| 场景 | v2 证据 | 覆盖 |
|---|---|---|
| 法庭 | `court-evidence/v2-01-start.png` `v2-02-card-played.png` `v2-03-results.png` | 开局天平50:50+4手牌→出牌后天平58:42+命中resolved→结算段位+高光时刻 |
| 脱口秀 | `talkshow-evidence/v2-01-topic.png` `v2-02-joke-scored.png` `v2-03-results.png` | 话题票选→三维度评分22/25/18+音浪+callback→炸场段位+金句卡 |
| 狼人杀 | `werewolf-evidence/v2-01-setup.png` `v2-02-night.png` `v2-03-day-actions.png` `v2-04-results.png` | 身份牌(预言家)+夜晚查验→白天→动作牌→投票放逐+查验记录 |
| 酒吧 | `bar-evidence/v2-01-prepare.png` `v2-02-angle-choice.png` `v2-03-counter-feedback.png` `v2-04-results.png` | 准备页选边→对局内角度卡→**"克制!"飘字+强度条47/53**→辩手段位+25 |
| 健身房 | `gym-evidence/01-05.png` | selector→反应→节奏→力量→结算（青铜1315分） |
| 图书馆 | `library-evidence/01-05.png` | 选题→出题→AI抢答→结算（宗师600分6/8） |

旧版 API 事件流证据（`full-game.json` 等）保留作为补充。

---

## 3. 主窗口如何接入

1. **合并**：将 `feat/gameplay-integration` 合并到主分支（或先 review Draft PR #3）。
2. **前端接线（已完成）**：六场景全部从真实入口（Plaza→场景建筑→Shell/View）接入新引擎：
   - 法庭：`CourtroomShell` 默认渲染 `NewCourtGame`（天平+出牌+结算），「经典模式」回退旧 CourtFlow
   - 脱口秀：`TalkshowShell` 默认渲染 `NewTalkshowGame`（话题+三维度评分+callback），「经典模式」回退
   - 狼人杀：`WerewolfShell` 默认渲染 `NewWerewolfGame`（身份+夜晚+白天动作牌+投票），`?old-ww=1` 回退
   - 酒吧：`BarShell` 默认渲染 `NewBarGame`（选边+角度克制+裁决），`?old-bar=1` 回退
   - 健身房：`CircuitChallenge` 直接运行前端引擎（已接入）
   - 图书馆：`QuizArena` 接入引擎（已接入）
   - 所有新玩法通过 `apps/web/src/*/engine-client.ts` 调用 `/api/engine/*` REST 路由（健身房为前端直接运行）
3. **LLM 配置**：引擎的 AI 决策钩子在生产环境接真实 LLM 端点，当前走确定性兜底（云端无 LLM key 时不中断）。
4. **真人多人**：狼人杀引擎的槽位设计支持真人替换 AI 席，复用已有 WS 房间基础设施（`ws.ts` / `room-routes.ts` / `MultiplayerLobby`），真人行动通过 `act()` 进入引擎，超时自动 AI 兜底。

---

## 4. 测试与构建结果

- `npm test`：**734 passed**（shared 55 + api 439 + web 240），无回归
- `npm run build`：通过（shared tsc / api tsc / web vite build）
- 基线已有测试全部保留
- 新增：engine-client 单测（court/talkshow/bar）、NewCourtGame/NewTalkshowGame 组件测试、engine-routes API 测试

---

## 5. 遗留问题

1. ~~前端接线 P1~~ **已关闭**：法庭/脱口秀/狼人杀/酒吧四场景 Web 侧已接入新引擎，从真实入口可完成 开局→选择→反馈→结算 全链路；旧流程通过「经典模式」按钮或 `?old-*=1` 参数保留回退。
2. **offline-brain 测试**：`offline-brain.test.ts` 依赖未提交的生成数据（≥20 个脑 JSON），基线即存在，CI 需先跑脑生成脚本；与本任务无关。
3. ~~酒吧对局内截图~~ **已关闭**：通过 `data-testid` + CDP `document.querySelector().click()` 触发 handler（替代坐标点击），酒吧对局内 v2-02（角度选择）和 v2-03（克制反馈"克制!"飘字+强度条47/53）已留证。
4. **LLM 口播**：云端无 LLM key 时走确定性兜底文案，生产环境接真实端点后自动生效。
5. **e2e 钩子**：`main.tsx` 加了 `?__e2e=1` 跳过开屏的无害钩子，可保留或移除。
6. **狼人杀真机一局时长**：真机验证覆盖了开局→夜晚→白天→投票的核心链路，完整 3-4 昼夜对局由引擎单测（fake timer）覆盖。
