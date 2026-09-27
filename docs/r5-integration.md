# 叽里呱啦 R5 · 长期目标线与"再来一局"钩子系统

> 分支：`feat/r5-gameplay` · 基线：main(45d3a38) + feat/gameplay-integration · 日期：2026-09-27
> 范围：名人关系系统 + 再来一局四件套 + BaseOrchestrator 节奏/结算统一 + 法庭招牌模式

---

## 1. 改了什么

### 1.1 名人关系系统（长期目标线）

**元循环**：单局六段 → 局后与具体名人产生关系变化 → 关系等级解锁专属内容 → 回到广场/名人馆指名开局。

| 关系等级 | 好感度阈值 | 解锁内容 |
|---|---|---|
| stranger（陌生人） | <0 | 基础对局 |
| acquaintance（熟人） | 0–19 | 专属开场白 |
| friend（朋友） | 20–39 | 专属称号 |
| close（密友） | 40–59 | 专属案件/话题/题库 |
| soulmate（知己） | ≥60 | 搭档模式解锁 |
| rival（宿敌） | ≤–30 | 宿敌约战、双倍关系变化 |

**好感度计算**（`computeAffinityDelta`）：胜+5 / 平+2 / 负–2，高光+3/个，翻盘+10，大胜(>85%)+5；宿敌(affinity<–30)胜负基础分翻倍。

**持久化**：`apps/api/.data/relationships/<userId>.json`，REST 路由 `GET /api/relationships`、`GET /api/relationships/:celebrityId`。真人之间复用 `friends.ts`。

### 1.2 "再来一局"钩子四件套

| 钩子 | 实现 | 触发 |
|---|---|---|
| (a) 关系钩子 | 局后「{名人}表示不服/邀战，再来一局？」指名同一对手 | 战败/关系升级 |
| (b) 连胜与翻盘 | `updateStreak` 追踪 currentStreak/bestStreak；`detectComeback` 检测过程<30%终局>50%；连胜奖励 3连+5/5连+10/7连+20 | 每局结算 |
| (c) 即时高光 | `detectHighlight` 六场景规则 + `captureHighlight` 收集；结算集中呈现 top 高光 | 局内关键事件 |
| (d) 可分享战果 | `buildResultCard` + `resultCardToText`；前端渲染战果卡 + 复制文案/分享按钮 | 每局结算 |

### 1.3 BaseOrchestrator 统一节奏与结算

- **钩子回调**：`OrchestratorHooks { onHighlight, onSettlement, onStreakChange, onRelationshipChange, onFeedback }`，全可选，向后兼容。
- **结算演出三态**：`big_win`(>85%) / `narrow_win` / `comeback_win`(过程<30%终局胜) / `draw` / `narrow_loss`(45–50%) / `big_loss`，`finish()` 自动检测。
- **反馈手感**：`emitFeedback(FeedbackEvent)` 支持飘字/音效/震屏/彩带，`emitFeedback(kind,payload)` 旧签名保留为重载。
- **高光类型**：key_evidence / golden_quote / epic_rebuttal / prophet_vote / extreme_performance / high_combo / comeback / perfect_round。

### 1.4 法庭招牌模式（Celebrity Court Signature）

**定位**：六场景中最有记忆点的招牌模式，戏剧化名人案件 + 陪审团情绪 + 结案陈词 + 名场面。

**名人案件库**（6 个确定性案件，不调 LLM）：
1. 牛顿 vs 莱布尼茨 — 微积分发明权之争
2. 马斯克 vs 乔布斯 — 产品理念之争
3. 苏格拉底 vs 雅典城邦 — 思想自由
4. 特斯拉 vs 爱迪生 — 电流之战
5. 武则天 vs 传统礼法 — 女性权力
6. 毕加索 vs 达利 — 艺术风格之争

**机制**：
- 陪审团情绪 0–100（命中+5 / 被驳–3 / mock+2情绪–2天平）
- 结案陈词：玩家输入文本，`evaluateClosingStatement` 按长度+关键词+天平算 0–15 加成
- 最终裁决：`verdictScore = balance + (juryMood-50)/5 + closingScore`
- 名场面：关键证据命中(delta≥10)、完美反驳、翻盘、陪审团倒戈

**入口**：CourtroomShell 「招牌模式」按钮或 `?signature=1`。

---

## 2. 六玩法「目标-冲突-反馈-钩子」一览表

| 场景 | 目标 | 冲突 | 正反馈 | 高光类型 | 关系对象 | 再来一局钩子 |
|---|---|---|---|---|---|---|
| **法庭** | 3轮出牌天平胜诉 | 对方律师反驳+证据真伪 | 天平滑动+命中口播+弹药消耗 | key_evidence（证据delta≥8） | 对方律师名人 | 败诉方不服/指名再审 |
| **法庭招牌** | 名人案件陪审团裁决 | 名人对抗+陪审团倾向+戏剧冲突 | 陪审团情绪条+名场面播报+结案陈词 | key_evidence/dramatic_moment | 名人被告/原告 | 宿敌约战/关系升级解锁新案件 |
| **脱口秀** | 三维度评分炸场 | 60s限时+观众反应+callback | 评分条+音浪+callback共鸣+15 | golden_quote（punchline≥35） | 主持人+3观众名人 | 主持人邀战/连胜专场 |
| **狼人杀** | 阵营胜利（狼/好人） | 夜间信息不对称+白天投票+推理 | 动作牌+推理分+幽灵观战 | prophet_vote（投对狼） | 8席名人角色 | 被投出名宿敌/存活名人好友 |
| **酒吧** | 3回合角度克制胜诉 | 克制三角+AI对称反驳+倾向轮换 | 克制飘字+强度条+对话记录 | epic_rebuttal（克制delta≥8） | 对手名人（巴菲特等） | 对手不服/辩神连胜 |
| **健身房** | 三关电路总分达标 | 反应限时+节奏combo+力量蓄力 | 命中反馈+combo加成+教练点评 | extreme_performance（完美率≥90%） | 教练名人（合作关系） | 教练鼓励/破纪录挑战/关系解锁训练计划 |
| **图书馆** | 8题抢答压过AI | 10s限时+3命+AI抢答+combo×2 | 抢答得分+combo加成+排名变化 | high_combo（连对≥5） | 3位对手名人 | 惜败名人挑战/攻擂连胜/学友解锁题库 |

---

## 3. 文件清单

### 共享基础层（packages/shared/src/gameplay/）
- `relationship.ts` — 关系类型 + computeAffinityDelta/typeFromAffinity/getUnlockForType
- `highlights.ts` — detectHighlight 六场景规则 + 格式化/过滤
- `result-card.ts` — buildResultCard/resultCardToText/resultCardToSharePrompt
- `streak.ts` — updateStreak/getStreakBonus/detectComeback
- `base-orchestrator.ts` — 钩子/高光/结算三态/反馈事件扩展
- `index.ts` — 统一导出

### API 层（apps/api/src/）
- `relationship.ts` — 名人关系持久化 + REST 路由
- `r5-settlement.ts` — 路由终局统一结算桥（关系落库+连胜+战果卡）
- `court-signature-cases.ts` — 6 个名人案件库
- `court-signature-engine.ts` — 招牌模式引擎（陪审团+结案陈词+名场面）
- `court-engine.ts` / `talkshow-engine.ts` / `werewolf-engine.ts` / `bar-engine.ts` / `library-engine.ts` — 钩子接入
- `engine-routes.ts` — 六场景 + 招牌模式 REST 路由，结算时落库关系/连胜
- `db.ts` — normalizeStats 扩展六场景
- `server.ts` — 注册 relationship 路由

### Web 层（apps/web/src/）
- `court/NewSignatureCourtGame.tsx` — 招牌模式前端（案件选择/对局/结案/结算）
- `court/NewCourtGame.tsx` — 普通法庭结算页接入高光/关系/连胜/战果卡
- `talkshow/NewTalkshowGame.tsx` / `werewolf/NewWerewolfGame.tsx` / `bar/NewBarGame.tsx` — 结算页接入
- `gym/CircuitChallenge.tsx` / `library/QuizArena.tsx` — 结算页接入
- `lib/r5.tsx` — 共用 R5 结算面板组件（翻盘横幅/高光/关系/连胜/战果卡/再来一局）
- `court/engine-client.ts` / `talkshow/engine-client.ts` / `werewolf/engine-client.ts` / `bar/engine-client.ts` — 类型扩展

### 文档
- `docs/r5-relationship-hooks.md` — 关系与钩子基础层设计
- `docs/r5-court-signature.md` — 法庭招牌模式设计

---

## 4. 测试与构建

- `npm test`：**1139 passed**（shared 105 + api 644 + web 390），无回归
- `npm run build`：通过（shared tsc / api tsc / web vite build）
- 新增测试覆盖：关系结算、高光触发（六场景）、连胜/翻盘、战果卡数据、招牌引擎完整一局、无头全游戏验证

---

## 5. 真机/无头证据

| 场景 | 证据 | 覆盖 |
|---|---|---|
| 法庭招牌 | `artifacts/court-signature-evidence/01-05.png` | 案件选择→对局(天平+陪审团情绪)→结案陈词→裁决(名场面+关系+战果卡) |
| 法庭招牌 | `r1-regular-game.png` / `r2-regular-results.png` | 普通法庭钩子链路（关系+14/1连胜/3高光/战果卡） |
| 脱口秀 | 无头验证（r5-headless.test.ts） | 翻盘局 comeback=true / golden_quote 捕获 / 4条关系变化落库 |
| 狼人杀 | 无头验证 | 整局好人胜 / prophet_vote 高光 / 关系落库 / 阵营胜负映射 |
| 酒吧 | 无头验证 | 三回合全克制 epic_rebuttal+perfect_round / 对手巴菲特 / outcome=win |
| 健身房 | 无头验证 | 5条高光全中 / 教练关系+23(acquaintance→friend) / 翻盘识别 |
| 图书馆 | 无头验证 | extreme_performance/high_combo/perfect_round / 3位名人关系 / 1连胜新纪录 |

---

## 6. 合并说明

- 从 main(45d3a38) 切出 `feat/r5-gameplay`
- merge `origin/feat/gameplay-integration`（ddd85eb）：解决 server.ts（R4路由+engine-routes）和 shared/index.ts（scene-ugc+gameplay）冲突，取并集
- 基础层 commit b57575f（关系系统+钩子扩展+战果卡+连胜）
- 三个并行分支合并回：
  - `feat/r5-court-signature`（cb353cc）— 零冲突
  - `feat/r5-twb-hooks`（3da0c4a）— engine-routes.ts 导入冲突，取并集
  - `feat/r5-gl-hooks`（a755c8a）— db.ts normalizeStats 类型冲突（取更严格的六场景联合类型）+ engine-routes.ts 导入冲突（取并集）
- 最终 HEAD：`9aa6914`

---

## 7. 遗留问题

1. **战果卡图片生成**：当前 `resultCardToSharePrompt` 生成 prompt 文本，实际图片渲染需前端 canvas 或后端图片服务；复制文案已可用。
2. **图书馆分享文案对手名**：`resultCardToText` 对多对手只取主对手名，前端结算页用 `relationshipChanges[].reason` 逐条正确渲染，纯文本分享有此小瑕疵。
3. **LLM 口播/评分**：云端无 LLM key 时走确定性兜底，生产接真实端点后自动生效。
4. **offline-brain 测试**：依赖未提交的生成数据，基线即存在，与本任务无关。
5. **关系等级解锁内容的实际消费**：专属开场白/称号/案件已在数据层标记解锁，前端名人馆/场景入口的解锁展示为 P1 接线。
