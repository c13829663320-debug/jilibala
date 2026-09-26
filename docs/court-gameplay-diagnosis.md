# 趣味法庭玩法深度诊断与重构方案

> 诊断对象：叽里呱啦 BalaBala「趣味法庭」完整场景（M13 court-orchestrator + 前端 CourtFlow 5-screen 状态机）
> 诊断方式：逐行阅读后端 `apps/api/src/court-orchestrator.ts` / `court-state.ts` / `court-routes.ts` / `bench-orchestrator.ts`，前端 `court/` 全部 screen + engine，以及 `packages/shared/src/index.ts` 中的 court 类型。
> 核心结论先行：**当前法庭是一个"AI 自动辩论赛播放器"，玩家被设计成了默认坐观众席的弹幕发送者。流程在技术上完整闭环，但玩家在 90% 的时间里没有任何决策点，其输入既不上屏、不被即时回应、也不影响判决。这就是"游戏不好玩"的根因。**

---

## 一、现状速览：一局庭审到底发生了什么

后端 `runCourtTrial`（`court-orchestrator.ts:295-617`）开庭循环是一个**无人值守的 for 循环**（`:565-605`），每一轮固定执行 8 步：

```
a. judgeSpeak()            法官自动开场/总结        (:569)
b. speakAsSide("plaintiff")  AI 原告自动发言        (:572)
c. speakAsDefender() ×N    AI 原告辩护人自动发言    (:575-579)
d. speakAsSide("defendant") AI 被告自动发言        (:582)
e. speakAsDefender() ×N    AI 被告辩护人自动发言    (:585-589)
f. drainPlayerInputs()     把玩家输入塞进 KB        (:592)
g. updateRecord()          AI 法官自动记录          (:595)
h. shouldContinue()         AI 法官自动决定是否续轮   (:598)
```

最多 5 轮（`MAX_ROUNDS = 5`，`:287`），一轮含 5~9 次串行 LLM 调用，全程玩家无任何暂停等待。前端 `CourtroomLive.tsx` 收到 SSE 的 turns 后以 `TURN_DELAY = 2400ms`（`:19`）自动逐句播放，一轮播完后 `waiting` 状态再等 1600ms 自动进入下一轮（`:184-194`）。

**玩家唯一能做的事**：点右下角 FAB，打开输入框，打一段字/传个文件名，POST `/player-input`（`court-routes.ts:206-235`），后端把它 push 进某方 KB 的 `user_additions` 数组（`drainPlayerInputs`，`:483-495`），作为"玩家补充"在下一轮 AI 发言时混进 context（`court-state.ts:136`）。

---

## 二、诊断结论（问题 → 根因（代码证据） → 影响）

### 问题 1：玩家从不"发言"，只是往 AI 的小抄里塞便利贴

- **根因**：`CourtTurn.speaker` 枚举只有 `'judge' | 'plaintiff' | 'defendant' | 'defender'`（`packages/shared/src/index.ts:485`），**没有 'player' 这个发言主体**。玩家输入在 `drainPlayerInputs()`（`court-orchestrator.ts:483-495`）里被处理为：
  ```ts
  full.plaintiff_kb.user_additions.push(`[玩家] ${input.content}`);
  ```
  它不生成任何 `CourtTurn`、不上屏、不进入 transcript，只是下一次 AI 发言 context 里一行 `玩家补充：...`（`court-state.ts:136`）。玩家说没说话、说了什么，法庭里没人看得见。
- **影响**：玩家的表达对"法庭这个世界"不可见。代入感为零——你不是当事人，你是隔着玻璃往 AI 小本本上写字的人。

### 问题 2：玩家输入是 fire-and-forget 弹幕，零即时反馈

- **根因**：
  - 前端提交是 fire-and-forget：`http-engine.ts:427-434` 里 `fetch(...).catch(() => {})`，不等响应。
  - 后端虽然发了 `player_input_ack` 事件（`court-orchestrator.ts:486`），但前端 `http-engine.ts:312` 的 `dispatch()` switch **根本没有 `case 'player_input_ack'`**，事件落入 default 被直接丢弃。
  - 玩家唯一的反馈是本地 1.6 秒的 `submitFlash`，文案写得很诚实——**"已提交，将在下一轮体现 ✓"**（`CourtroomLive.tsx:358`）。
  - 更糟的是消费时机：`drainPlayerInputs()` 固定排在每轮第 f 步（`:592`），即玩家中途发言，必须等本轮 5~9 次 AI 全部说完、`updateRecord` 跑完，才被塞进 KB，最快也要等下一轮 AI 才可能"引用"。
- **影响**：玩家打完字 → 没有任何东西当场变化 → 不知道有没有用 → 索性不打了。这是"参与感弱"最直接的技术来源。

### 问题 3：没有任何"玩家决策点"，回合流程是写死的脚本

- **根因**：开庭循环 `:565-605` 的顺序（法官→原告→原告辩护人→被告→被告辩护人→记录→续轮判断）在代码里硬编码，玩家不能：选择本轮辩论策略、指定先质问谁、出示哪份证据、召唤辩护人、申请休庭或提前终结。`CourtPlayerInput.type` 虽然设计了 `'argument' | 'evidence' | 'question'`（`shared/index.ts:513`），但 `drainPlayerInputs` **完全不读 type 和 evidenceName**——你选"质问"，后端也只是 `push("[玩家] xxx")`，没有任何角色被触发去回答这个问题。`shouldContinue()`（`:535-560`）由 AI 法官决定，玩家不能说"我辩完了，请直接判"。
- **影响**：游戏循环里"选择"这一环整体缺失。玩家对本局怎么打没有任何掌控，本质是在看一段无法跳过剧情走向的 AI 动画。

### 问题 4：默认就是观众席，连"选边"都是个需要自己发现的隐藏功能

- **根因**：`CourtFlow.tsx:50` `useState<Perspective>('audience')`——玩家进庭默认坐**观众席**。而 `CourtroomLive.tsx:371` 明确写着 `{... !isAudience && <button className="live-input-fab">}`：**观众席连输入框都没有**。玩家要先发现底部那个"原告席/观众席/被告席"三切换（`:319-325`），点一下才能开始输入。更隐蔽的是：后端 `runCourtTrial` 虽然解构了 `perspective` 参数（`:296`），但**整个函数体内从未使用它**——视角切换唯一的作用就是 `CourtroomLive.tsx:199` 那行 `perspective === 'defendant' ? 'defendant' : 'plaintiff'`，决定你的话进哪方 KB。
- **影响**：产品把"旁听"做成了默认态，把"当事人"做成了一个需要二次发现的开关。新用户第一次进来，看到的是 5 分钟自动播放，连输入框都找不到——这就是"沦为旁观者"的产品入口证据。

### 问题 5：无数值、无局势、判决结果与玩家表现完全脱钩

- **根因**：全代码库没有任何"局势优势 / 陪审团支持度 / 战斗力"数值。`CourtRecord`（`shared/index.ts:495-505`）只有 `unresolved / resolved` 计数，前端 `CourtTrialPanel.tsx:91` 展示"未决 X / 已决 Y"，但它是 AI 对案件的归纳进度，不是玩家表现。更致命的是 `generateVerdict()`（`court-orchestrator.ts:620-678`）的 prompt 只包含 facts / evidence / turns 摘要 / record，**玩家的 `user_additions` 一个字都没进判决 prompt**；`:639` 明确写判决依据是"按事实权重/证据/逻辑/反驳有效性判定，不是谁先没话说"。
- **影响**：玩家说多说少、说好说坏，判决都一样。没有"我这波辩护让天平倒向我"的爽感，也没有归因——输了不知道输在哪，赢了也不知道是自己赢的。这是"胜负感缺失"的根因。

### 问题 6：上手链路过长，首个爽点出现在 60 秒之后

- **根因**：
  1. `analyzeCase()` 一次 LLM 调用，硬超时 **38 秒**（`court-orchestrator.ts:182` `38_000`）；
  2. 前端 `Analyzing.tsx:38-44` 在结果返回后**强制**再叠加 650+550+500 ≈ 1.7 秒动画；
  3. 然后是 `PartiesReview.tsx` 一整个只读确认页（看事实、编辑起诉状、选辩护人），玩家唯一动作是点"确认开庭"；
  4. 进 `CourtroomLive` 后第一句仍是 `judgeSpeak` 自动开场（`:569`），`TURN_DELAY=2400ms` 自动播放。
  - 从玩家点击"生成法庭"到第一次有意义的互动：乐观估计 8~15 秒，悲观（LLM 慢）38 秒以上，期间屏幕上只有转圈和三步进度条。
- **影响**：新用户在"还没玩到任何东西"的阶段就要等近一分钟，流失率高发区。30 秒能懂、3 分钟一次正反馈的共识目前完全不达标。

### 问题 7：自动推进让"点击继续"都变得可有可无

- **根因**：`CourtroomLive.tsx:140-144` 每句发言 2.4 秒自动翻页；`:184-194` 每轮播完 1.6 秒后**自动**进入下一轮或判决。玩家点不点击，庭审都会自己跑完。
- **影响**：操作被架空，玩家连"我看完了，继续"这种最基础的掌控感都没有。配合问题 2/3，整场体验退化为"挂着一个 AI 辩论赛直播"。

### 问题 8：判决页是终点，不是下一局的起点

- **根因**：`VerdictScreen.tsx` 全部内容 = 盖章动画 + 判决书长文 + 4 个按钮（归档案卷 / 再来一场 / 复制链接 / 发布广场）。没有：本局评分、玩家表现归因（"你当庭出示的聊天截图是胜诉关键"）、连胜/战绩、成就徽章、"以对方视角重审一局"。`GET /api/court/cases`（`court-routes.ts:267-288`）案卷库只列历史案件摘要，无任何聚合统计。
- **影响**：一局结束即学习曲线结束。"再来一场"= 回到 `CreateCase` 重新走一遍 38 秒等待 + 自动播放，重玩动机为零。

### 问题 9：名人辩护人只是"换个音色的复读机"，且 court 模式把 bench 模式更好的互动能力丢了

- **根因**：`celebritySpeak()`（`bench-orchestrator.ts:142-157`）实现就是把 `persona` 塞进 system prompt 调一次 chat，无任何技能差异。court 模式下 `speakAsDefender`（`court-orchestrator.ts:413-446`）给它的 context 和原告/被告用的是同一个 `buildSpeakerContext`——辩护人不会专属质问、不会配合玩家战术。对比之下，**旧的合议庭 `bench-orchestrator.ts` 其实有更好的互动设计**：`drainInteractions()`（`:193-219`）支持 `vote`（实时 `vote_update` 票数事件）、`call`（指定名人优先发言回应，`:311-321`）、`evidence` 备注——但新法庭模式一个都没继承，只剩一个被丢弃的 ack。
- **影响**：花资源做的 3D 名人角色、语音、人设，产出只是每轮自动念一段风格相似的辩词，选哪个名人对游戏过程没有可感知的差别。

### 问题 10（补充）：玩家输入的 type / evidenceName 字段是死参数

- **根因**：`court-routes.ts:206-235` 的 player-input 端点接收 `type` 和 `evidenceName`，但 `drainPlayerInputs()`（`:483-495`）只取 `content`；前端 `CourtroomLive.tsx:200-203` 甚至 type 计算写了两遍（`'opinion'` vs `'argument'` 不一致）。证据名从不被任何 turn 的 `referenced_evidence` 引用，"举证"在这个游戏里不存在。
- **影响**：UI 上给了玩家"举证"的期待（回形针按钮、文件 chips），后端却把它当普通文字吞掉——期待落空本身就是负面体验。

---

## 三、P0 重构方案（必须做，解决"不好玩"的根因）

> 设计主线：**玩家从观众变当事人；AI 从主演变配角（辩护人/对手/法官）；每轮由玩家先做决定，AI 再围绕决定展开；玩家行为实时上屏、实时影响天平。**

### P0-1 玩家当主角：玩家即原告/被告本人，亲自发言上屏

| 项 | 内容 |
|---|---|
| 改哪些文件 | `packages/shared/src/index.ts`、`apps/api/src/court-orchestrator.ts`、`court-routes.ts`、`apps/web/src/court/CourtFlow.tsx`、`screens/CreateCase.tsx`（或 PartiesReview）、`screens/CourtroomLive.tsx`、`http-engine.ts` |
| 类型变化 | `CourtTurn.speaker` 联合类型加 `'player'`；`CourtCase` 加 `player_side: 'plaintiff' \| 'defendant'`；新增 SSE 事件 `{ type: 'player_turn'; turn: CourtTurn }` |
| 核心逻辑变化 | ① 创建案件时增加"我要告 TA（当原告）/ 我要应诉（当被告）"二选一，默认值不再是 audience。② 后端 `speakAsSide()` 拆成两条路：玩家侧**不再自动生成发言**，而是向房间广播 `player_turn_request` 事件后阻塞等待玩家通过 `/player-action` 提交；AI 侧（对方当事人 + 辩护人）照常自动发言。③ 玩家提交的内容**直接生成 speaker='player' 的 CourtTurn 上屏**，不再进 user_additions。④ 对方 AI 角色的 context 里把玩家刚说的话作为 `response_to_turn_id` 挂接，实现"对方听见你说话并回应"。 |
| 预期体验 | 玩家说的话立刻出现在法庭 transcript 里、有自己的气泡/头像，对方下一句明显在回应你——"我在这个法庭里是真实存在的人"。 |
| 复杂度 | **中**。状态机要从纯自动循环改为"等待玩家输入"的阻塞点，需设计玩家超时兜底（60s 未输入则 AI 辩护人代说一句并提示"辩护人替你补了一句"）。 |

### P0-2 回合制玩家驱动：每轮先由玩家做关键决定

| 项 | 内容 |
|---|---|
| 改哪些文件 | `court-orchestrator.ts`（重写 `:565-605` 的 for 循环）、`court-routes.ts`（新增 `/player-action` 端点）、`shared/index.ts`（新事件）、`CourtroomLive.tsx`（行动面板 UI）、`http-engine.ts` |
| 核心逻辑变化 | 把现在的"AI 连说 5~9 句"改为**一轮 = 一个玩家决策点 + AI 响应**：<br>1. 每轮开始，后端 `judgeSpeak` 简短开场后，广播新事件 `round_choice`，携带 2~4 个行动卡片（由 LLM 根据当前争议点生成，如：「出示聊天截图，证明说好要还」/「质问对方：伞借给了谁？」/「召唤辩护人展开」/「亲自陈述 30 秒」）。<br>2. 玩家点选一张卡（或自由打字/语音发言），POST `/player-action`。<br>3. 后端根据选择展开：质问→触发对方当事人一段针对性回应；举证→触发法官记录该证据+对方反驳；召唤辩护人→`speakAsDefender` 围绕玩家选的论点展开。<br>4. 一轮结束（玩家行动 + 对方反应 + 辩护人补刀）后再进下一个 `round_choice`。<br>废弃 `drainPlayerInputs()` 的被动入队模式。 |
| 新增 UI | `CourtroomLive.tsx` 底部坞从"自动播放气泡"改为"决策面板"：回合开始时浮出 2~3 张行动卡片 + 一个自由发言输入框；卡片点击即高亮上屏，对方回应自动接续。 |
| 预期体验 | 每 30~60 秒玩家必须做一次选择，庭审走向由玩家点出来；3 分钟内至少 3~4 次"我选的，事情果然这么发展了"的正反馈。 |
| 复杂度 | **高**（P0 中最大的一块）。但可分期：第一步先做"玩家亲自发言"（P0-1），第二步把每轮自动播放前插一个必选行动卡。 |

### P0-3 即时反馈与可见后果

| 项 | 内容 |
|---|---|
| 改哪些文件 | `court-orchestrator.ts`、`shared/index.ts`（新事件）、`http-engine.ts`（dispatch 补 `player_*` 分支）、`CourtroomLive.tsx` |
| 核心逻辑变化 | ① 修复问题 2：`http-engine.ts:312` dispatch 补上玩家事件分支；`player_input_ack` 升级为 `player_echo`——玩家内容即时作为一条 `speaker='player'` 的 turn 插入 transcript（与 P0-1 共用）。② 玩家发言后，对方 AI 当事人**立即**生成一句针对性短回应（一次 ≤300 token 的 LLM 调用，走现有 `withRetry`），而不是等下一轮。③ 法官记录面板高亮玩家引用过的争议点状态变化（未决→已决时弹一个"法官采纳了你的观点 ✓"）。 |
| 预期体验 | 说完话 2~4 秒内看到对方接茬、天平微动，不再有"石沉大海"感。 |
| 复杂度 | **低~中**。主要是事件链路补全 + 一次额外短 LLM 调用。 |

### P0-4 引入"局势优势条"（陪审团支持度），判决可归因

| 项 | 内容 |
|---|---|
| 改哪些文件 | `court-state.ts`、`court-orchestrator.ts`（`generateVerdict` 改造）、`shared/index.ts`（record/case 加字段 + `momentum_update` 事件）、`CourtroomLive.tsx`（顶栏加 UI） |
| 核心逻辑变化 | ① `CourtRecord` 增 `momentum: { plaintiff: number; defendant: number }`（初始 50:50）。② 每次玩家行动后做一次轻量判定（可先用规则：出示证据 +8、有效质问 +6、无关发言 -2；后续再升级为小 LLM 打分），对方 AI 行动反向微调，广播 `momentum_update`。③ `generateVerdict()` prompt 注入最终 momentum 和**玩家行动清单**（`turns` 中 speaker='player' 的部分），要求判决理由显式引用："由于你当庭出示 X 并质问 Y，本庭采信……"。 |
| UI 变化 | 顶栏或法庭中央加一条滑动天平条（左原告色/右被告色），玩家发言后条上对应方向摆动 + 数字跳动；判决页（`VerdictScreen.tsx`）顶部除了"原告胜诉"，加一行**玩家表现归因**："你的关键举证：聊天截图 · 胜负贡献度 70%"。 |
| 预期体验 | 玩家行为第一次有了可量化、可见、可归因的后果；赢知道怎么赢的，输知道怎么输的。 |
| 复杂度 | **中**。数值规则先行，LLM 打分后补；前端一个动效条。 |

### P0-5 缩短上手：30 秒内进入互动

| 项 | 内容 |
|---|---|
| 改哪些文件 | `court-orchestrator.ts`（`analyzeCase` 拆分）、`court-routes.ts`、`screens/Analyzing.tsx`、`screens/PartiesReview.tsx`、`http-engine.ts`（analyzeCase 改流式/分段） |
| 核心逻辑变化 | ① `analyzeCase`（`:148-220`）从"一次调用等全部"改为两段：**先同步返回 title + 双方姓名/立场（一次 <2s 的小调用）**，facts/KB/文书转异步在后台补，前端拿到第一帧就进 `PartiesReview`。② `Analyzing.tsx:38-44` 强制的 1.7s 假动画砍掉。③ 等待期不再是白屏转圈：Review 页在 AI 补全 KB 的同时，玩家可以先**选边、选辩护人、编辑自己的起诉状**，这些动作不依赖 KB。④ 提供"快速开庭"入口：3 个预置生活小案（现有 `DRAFT_FALLBACKS`，`:231-244`）一键进庭，完全跳过 analyze。 |
| 预期体验 | 30 秒内玩家就能选好"我是原告、带辩护人 XXX、开庭"，第一个决策点出现在 1 分钟内。 |
| 复杂度 | **中**。主要是把串行等待改并行/流式，后端状态机要允许 KB 迟到补齐。 |

---

## 四、P1 重构方案（重要但可稍后）

| 方案 | 改哪些文件 / 核心变化 | 预期体验 | 复杂度 |
|---|---|---|---|
| **P1-1 成就与战绩系统** | 后端新增 user 维度统计表（胜诉率、场均发言数、关键举证数）；`GET /api/court/cases`（`court-routes.ts:267`）返回时聚合；案卷库页 + VerdictScreen 展示"本赛季战绩 3 胜 1 负"、徽章（如"铁证如山"=单局举证 3 次以上） | 结束页有长期目标驱动 | 中 |
| **P1-2 重玩激励：换边重审 / 同一案件再战** | 复用现有 case 的 facts/evidence，新增 `/api/court/cases/:id/rematch?side=defendant`，用同一份证据书换视角开庭；VerdictScreen 加"现在换你来当被告，能不能翻案？" | 同一素材两次游玩，降低内容生产成本，提升重开动机 | 中 |
| **P1-3 名人辩护人个性化技能** | `character` 定义里给每个名人加一个 `signatureMove`（如：逻辑型=一轮一次"犀利质问"免费使用、幽默型=一次"气氛扭转"加 momentum）；`speakAsDefender`（`:413`）按技能生成不同结构的辩词；玩家行动卡片里出现"召唤 XX 使用其绝活" | 选名人不再只是选音色，而是选战术角色，收集欲驱动 | 中~高 |
| **P1-4 多人旁听互动增强** | 移植 bench 模式已有能力：`drainInteractions` 的 vote（`bench-orchestrator.ts:193-203`）直接搬进 court——观众投票实时影响 momentum 条；旁听席弹幕/围观人数已有的 `onlineCount`（`CourtroomLive.tsx:56`）放大展示 | 单人开庭也有现场感，社交传播时旁观者有事做 | 中 |
| **P1-5 玩家亲自收尾：最后陈述** | 判决前插入一个玩家专属 turn（语音录制优先），30 秒亲自陈词，`generateVerdict` 把最后陈述作为判决 prompt 的压轴输入 | 一局的情绪高潮由玩家自己完成，分享欲最强的片段 | 低~中 |

---

## 五、建议落地顺序

1. **第一批（1~2 个迭代内见效）**：P0-3 即时反馈（补事件链路，成本最低）→ P0-5 缩短上手（砍等待）→ P0-1 玩家亲自发言上屏。这三件做完，"旁观者"感就基本消除。
2. **第二批**：P0-2 回合制决策点（核心玩法骨架）+ P0-4 局势优势条（让选择有重量）。
3. **第三批**：P1 各项按需补，其中 P1-2（换边重审）投入产出比最高，建议优先于 P1-1 成就。

**衡量重构是否成功的北极星指标**：新用户从进入到第一个玩家 turn 上屏 ≤ 60 秒；单局内玩家主动行动次数 ≥ 4；判决后"再来一局"转化率显著提升；玩家 turn 占全部 turn 的比例从现在的 **0%** 提升到 **20% 以上**。
