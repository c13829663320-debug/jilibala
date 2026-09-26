# 叽里呱啦 BalaBala · 六场景玩法重构规格

> 版本：v1.0 · 分支 `feat/talkshow-bar-player-driven` · 2026-09-26
> 范围：趣味法庭 / 脱口秀 / 狼人杀 / 酒吧辩论 / 健身房 / 图书馆
> 目标：解决"做出来不好玩"——把每个场景从"看 AI 聊天 / 自动 tick 计数"改成"玩家在有代价的局面里做有反馈的选择"。

---

## 0. 总览

### 0.1 诊断框架（逐场景复用）

```
局面 → 可见信息 → 可选动作 → 代价 → 规则结算 → 反馈 → 下一次选择
```

一条链上任何一环断了，玩家就会觉得"不好玩"：
- **没有可选动作** → 看客（法庭、图书馆、健身房现状）
- **代价不可读** → 乱点（酒吧现状：不知道自己哪句强）
- **结算与玩家动作脱钩** → 自嗨（法庭：玩家打字不影响庭审走向）
- **反馈延迟或抽象** → 无感（脱口秀：一个 0-100 分，不知道好在哪）
- **失败后无法继续** → 挫败（狼人杀：出局即旁观 10 分钟）

### 0.2 跨场景根因（读完 6 个 orchestrator 后的共同结论）

| 根因 | 证据 |
|---|---|
| R1. 玩家动作与结算异步脱钩 | 法庭 `drainPlayerInputs()` 在每轮末尾才消费玩家输入，且只 append 到 KB，不改变该轮发言走向；酒吧玩家发言后 AI 反驳是固定 +2 |
| R2. 评分是黑盒 LLM 单值 | 脱口秀 `scorePlayerJoke` 只返回 0-100 + reaction + comment；酒吧 `scorePlayerArgument` 只返回 0-10；玩家无法归因"我下次该改什么" |
| R3. 玩家没有"构筑/战术"选择 | 所有场景玩家都是"自由文本输入"，没有预制选项卡、没有角度选择、没有资源管理 |
| R4. 无即时操作层 | 健身房训练 session 是 `setInterval` 自动 tick（reps 280ms +1，time 1s -1），玩家全程零输入；图书馆是三个聊天框 |
| R5. 单局时长失控且死亡即出局 | 狼人杀 9 人局每昼夜 ~2-4 分钟，3-5 天 = 10-20 分钟；玩家出局后 `alive=false` 直到结束 |
| R6. 复玩动机只有"再试一次" | 没有段位累积、没有每日挑战、没有名人解锁、没有分数榜 |

### 0.3 可复用引擎资产（禁止各场景重写）

以下模块已经在 `apps/api/src/` 中跑通，所有场景重构直接复用：

| 资产 | 位置 | 用途 |
|---|---|---|
| `ChatFn` 类型 + `celebritySpeak` + `withRetry` + `withTimeout` + `extractJson` + `tidySpeech` | `bench-orchestrator.ts` | 所有 LLM 调用的标准外壳：超时、重试、JSON 抽取、文本清洗 |
| `resolveCharacter(id)` → `ResolvedCharacter` | `character-resolver.ts` | 名人 / 自定义人物解析，所有场景统一入口 |
| 状态机 + `transitionStatus` + `onEvent` 流式事件 | `court-orchestrator.ts` / `court-state.ts` | `DRAFT→ANALYZING→…→COMPLETED` 模式，事件通过 `onEvent({type, ...})` 推 WS |
| KB 结构 `{facts, claims, arguments, assumptions, opponent_arguments, user_additions}` | `court-orchestrator.ts` | 任何"多轮辩论/对话"场景的共享记忆结构 |
| 双向强度条 `applyStrengthDelta({pro,con}, side, delta)` + `decideWinner` | `bar-orchestrator.ts` | 0-100 互补条，任何"对抗类"场景直接用 |
| 段位计算纯函数 `computeOpenMicTier(average)` | `talkshow-orchestrator.ts` | 分档文案（冷场/尚可/炸场/今日之星）模式 |
| 等待真人行动 + 超时兜底 `waitForReal*` | `werewolf-orchestrator.ts` | 任何"限时玩家动作"的标准 Promise + setTimeout 模式 |
| 私密快照 `getSnapshotForPlayer` + `sendToUser` | `werewolf-orchestrator.ts` | 任何"每人看到不同信息"的场景（已落地狼人杀） |
| 连续天数 / 成就判定纯函数 | `gym-orchestrator.ts` | `calculateStreak` / `checkAchievements` 保留 |

**统一改造要求**：所有新场景 orchestrator 必须（a）导出纯函数便于 vitest；（b）用 `onEvent` 流式推事件；（c）失败一律 fallback 不中断；（d）评分拆成 ≥2 个维度而不是单值。

---

## 1. 趣味法庭 Court

### 1.1 一句话核心幻想
**你是法庭上那支决定胜负的律师——你的每句反驳、每份证据，都真实地把法官的天平往你这边推。**

### 1.2 现状诊断（真实代码走读）

```
局面：5 轮 AI 自动辩论（法官→原告→辩护人→被告→辩护人），玩家是其中一方当事人。
可见信息：法官记录 record.facts/claims/unresolved，双方 KB。
可选动作：开庭前选边 + 指派名人辩护人；庭审中随时打字"补充意见"。
代价：无。打字不消耗任何资源，不打断当前轮次。
规则结算：drainPlayerInputs() 在每轮末尾把玩家文本 push 到 KB.user_additions，下一轮 AI 发言时参考。
反馈：玩家看不到"我这句话改变了什么"。判决由 LLM 综合所有记录自由生成。
下一次选择：再打一行字。
```

**断链点**：玩家动作 → 结算 是异步且弱耦合的。玩家打字 ≠ 当回合辩护。判决是 LLM 的自由心证，玩家无法归因。

### 1.3 重构核心循环（90 秒走读）

```
T+0s   开庭。法官宣布争议焦点 1 条（大字浮层）。天平条显示 50:50。
T+5s   原告 AI 自动发言（8-12 秒语音+字幕）。
T+15s  轮到你（玩家）。屏幕出现 3 张预制牌：
       [攻击论点] [出示证据] [嘲讽对方] [要求法官记录]
       每张牌下面有 1 个数字图标：出牌消耗 1 点"弹药"，你本回合有 2 点。
T+25s  玩家选【出示证据】→ 从己方 KB 里选 1 条已上传证据（或自由写一句话）。
       系统结算：这条证据是否命中当前 unresolved 争议点？
       - 命中 → 天平 +8，法官说"此点已查明"，unresolved 减 1，绿色暴击动画。
       - 未命中 → 天平 +2，法官说"此点与本案关联不强"，灰色，弹药不返还。
T+40s  被告 AI 针对性反驳（它会引用你刚出的证据），天平 -4。
T+50s  法官小结本回合：unresolved 还剩几条，天平 56:44。
T+55s  进入第 2 轮。玩家弹药补满到 2。
…（共 3 轮，不是 5 轮）…
T+80s  3 轮结束，天平停在 62:38。法官据此判决（不再自由发挥）。
T+90s  判决书 + 你的"高光时刻"回放（你打出的那张 +8 证据被高亮）。
```

### 1.4 四要素

| 要素 | 设计 |
|---|---|
| 目标 | 让天平在 3 轮结束时停在你方 ≥55（或 ≥50 平局上诉）。 |
| 冲突 | 对手 AI 每轮自动 -4~-6；玩家每轮只有 2 点弹药，必须选"打哪个争议点"。 |
| 反馈 | 天平条实时滑动 + 法官口播"此点已查明/关联不强" + 每回合 unresolved 计数。 |
| 奖励 | 胜方判决 + 高光回放 + 段位（见 1.6）+ 名人辩护人好感度。 |

### 1.5 需要新增/修改的机制

**状态机改造**：
```
旧：DRAFT→ANALYZING→GENERATED→CONFIRMED→IN_PROGRESS→JUDGING→COMPLETED
新：在 IN_PROGRESS 内细分：
    stage: "judge_open" | "side_speech" | "player_turn" | "rebuttal" | "round_recap"
    每轮结构固定：judge_open → 对手 side_speech → player_turn（等玩家，15s 超时）→ 对手 rebuttal → round_recap
```

**新增状态字段**（`CourtCase` / 运行时 `CourtRuntime`）：
```ts
interface CourtRuntime {
  round: number;              // 1..3（旧 MAX_ROUNDS=5 改为 3）
  maxRounds: 3;
  balance: { plaintiff: number; defendant: number };  // 0-100 互补，初值 50:50
  ammo: { plaintiff: number; defendant: number };    // 每轮补 2
  unresolved: string[];       // 从 record.unresolved 继承
  playerMoves: Array<{           // 玩家打出的牌，用于高光回放
    round: number;
    card: "attack" | "evidence" | "mock" | "request_record";
    targetEvidenceId?: string;
    freeText?: string;
    delta: number;           // 实际产生的天平变化
    hit: boolean;            // 是否命中 unresolved
  }>;
}
```

**新增事件**（WS `onEvent`）：
- `court_balance_update({balance, lastDelta, reason})` — 天平滑动动画
- `court_player_turn({round, ammo, handCards, unresolved})` — 推 3 张牌给前端
- `court_card_resolved({card, hit, delta, judgeComment})` — 结算反馈
- `court_round_recap({round, unresolved, balance})`

**预制牌的规则结算**（服务端权威，纯函数）：
| 牌 | 弹药 | 命中 unresolved | 未命中 |
|---|---|---|---|
| attack（自由写一句论点） | 1 | 天平 +6，对手下轮 rebuttal 权重 -2 | +1 |
| evidence（选已上传证据） | 1 | 天平 +8，对应 unresolved 标记 resolved | +2 |
| mock（嘲讽/幽默） | 1 | 天平 +3，但若 LLM 判定"越界"则 -3（风险牌） | 0 |
| request_record（要求法官记录某事实） | 0 | 把 1 条 facts 加入 record，下轮双方 AI 可见 | — |

**判决改造**：不再让 LLM 自由判。天平 ≥55 自动判该方胜；50-55 由 LLM 写"情理判决"文案但 winner 仍由天平决定。LLM 只负责写 `reasoning` / `keyMoments`，不再决定 `winner`。

**UI 组件新增**：
- `BalanceScale.tsx`：顶部天平条，左原告右被告，滑动动画，最近一次 delta 飘字。
- `PlayerHandCards.tsx`：底部 3-4 张可出牌，弹药图标（⚡×2），牌灰=弹药不足。
- `EvidencePicker.tsx`：选 evidence 牌时弹出己方已上传证据列表。
- `JudgeGavelOverlay.tsx`：每回合法官小结时的法槌动画。

### 1.6 时长 / 复玩

- 单局：开庭准备 30s + 3 轮 × ~25s = **约 2 分钟**（旧版 5 轮 LLM 串行可能 5-8 分钟）。
- 复玩动机：
  - 段位：胜/平/负 → 累积"胜诉率"，新增 `CourtRank`（菜鸟律师→金牌大状）。
  - 每日案件：AI 每天推 1 个新案情 seed。
  - 名人辩护人收藏：不同名人辩护人口味不同（鲁迅犀利、钱学森严谨），解锁新搭配。

### 1.7 可复用资产
- `celebritySpeak` / `buildSpeakerContext` / `tidySpeech` / `withRetry` 全部保留。
- `applyStrengthDelta` 从 bar 导入，作为 `balance` 的结算函数（直接改名复用）。
- KB 结构原样保留，`user_additions` 改名为 `playerMoves` 并结构化。
- 判决生成 `generateVerdict` 保留，但 winner 字段改为天平驱动。

---

## 2. 脱口秀 Open Mic

### 2.1 一句话核心幻想
**你站在开放麦舞台上，三波笑声在你手里——每讲一个段子，你都在赌下一个包袱能不能炸。**

### 2.2 现状诊断

```
局面：AI 主持热身 → 玩家连讲 3 个笑话 → AI 观众每个打 0-100。
可见信息：上一个段子的分数 + reaction + comment。
可选动作：自由写一个段子。
代价：无。3 个段子之间没有资源、没有连续关系。
规则结算：scorePlayerJoke 返回单值 score + reaction。
反馈：一个数字 + 一句吐槽。玩家不知道"铺垫太长/反转不够/节奏太慢"。
下一次选择：再写一个段子。
```

**断链点**：评分黑盒（R2）；3 个段子彼此独立，没有"callback 回扣"这种脱口秀真正的乐趣；没有节奏压力。

### 2.3 重构核心循环（100 秒走读）

```
T+0s   主持人热身 2 个段子（自动播，10s）。屏幕左侧出现"话题票"：
       [① 职场吐槽] [② 恋爱翻车] [③ 我妈/我爸] [④ 当代生活]
       玩家选 1 个作为今晚主题。
T+12s  第 1 个段子输入框出现，旁边 60 秒倒计时。
T+40s  玩家提交。系统拆 3 个维度打分（不是单值）：
       笑点 Punchline: 72 ｜ 节奏 Pacing: 55 ｜ 共鸣 Resonance: 68
       观众反应：笑声爆发（可视化音浪条）+ 一句吐槽："铺垫再短 5 秒就炸了。"
       屏幕弹出 2 个"下一招"选项卡：
       [✍ 顺着这个话题继续] [🔁 Call back 第 1 段] [🎭 换个话题]
T+55s  玩家选【Call back】。第 2 个段子输入框上方出现灰色提示：
       "回扣你刚才提到的'老板凌晨发消息'那个梗。"
T+85s  第 2 个段子提交。系统识别到 callback → 共鸣维度 +15 加成。
       观众反应：爆笑，音浪顶满。
T+95s  第 3 个段子（自由发挥）。
T+100s 结算：3 个段子平均分 → 段位（冷场/尚可/炸场/今日之星）+ 主持人毒舌总评。
```

### 2.4 四要素

| 要素 | 设计 |
|---|---|
| 目标 | 3 个段子总分 ≥ 200（满分 300）拿"炸场"段位。 |
| 冲突 | 每个段子 60 秒限时；选"换话题"会失去 callback 加成；讲越久越容易冷场。 |
| 反馈 | 三维度雷达条 + 音浪可视化 + 主持人/观众具体吐槽指向可改进项。 |
| 奖励 | 段位 + 金句自动剪辑（最高分那个段子）+ 可发布广场。 |

### 2.5 需要新增/修改的机制

**状态改造**：
```ts
interface OpenMicState {
  stage: "warmup" | "picking_topic" | "performing" | "results";
  topic: string | null;
  currentJokeIndex: 0 | 1 | 2;
  jokeTimeLimit: 60_000;
  jokes: Array<{
    text: string;
    topic: string;
    callbackTo?: number;        // 回扣第几个段子
    scores: { punchline: number; pacing: number; resonance: number };
    audienceReaction: "roast" | "applaud" | "mixed" | "silence";
    note: string;
  }>;
  // 旧的 scores: PlayerJokeScore[] 替换为上面结构
}
```

**LLM 评分 Prompt 改造**（`scorePlayerJoke`）：
```
返回 JSON：
{
  "punchline": 0-40,      // 包袱强度
  "pacing": 0-30,         // 节奏/铺垫是否过长
  "resonance": 0-30,      // 共鸣/代入感
  "reaction": "applaud|mixed|roast|silence",
  "note": "一句具体吐槽，指向最该改的那一项"
}
total = punchline + pacing + resonance (满分 100)
```

**Callback 加成规则**：
- 玩家在第 2/3 个段子选择"回扣第 N 段"，提交文本中 LLM 识别是否真的引用了第 N 段的关键词。
- 真引用 → `resonance += 15`，观众 reaction 强制升一档。
- 假引用（点了回扣但文本没回扣）→ `note = "你说要 call back 但我没听到那个梗啊"`，resonance 不加成。

**新增事件**：
- `talkshow_topic_picked({topic})`
- `talkshow_joke_scored({index, scores, reaction, note, callbackEligible})`
- `talkshow_time_warning({secondsLeft})`

**UI 组件新增**：
- `JokeScoreRadar.tsx`：三维度雷达条，不是单个数字。
- `AudienceWave.tsx`：观众音浪/笑声柱形动画（reaction 映射高度）。
- `CallbackChooser.tsx`：提交后弹出"下一招"三选卡。
- `JokeTimer.tsx`：60 秒倒计时，最后 10 秒变红。

### 2.6 时长 / 复玩
- 单局：热身 10s + 选话题 5s + 3 × 60s = **约 3-4 分钟**。
- 复玩：每日话题池更新；段位累积（开放麦之星等级）；最高分段子自动成"金句卡"。

### 2.7 可复用资产
- `createOpenMicSession` / `computeOpenMicTier` / `reactionFromScore` 保留。
- `withRetry` / `extractJson` / `cleanJoke` 保留。
- 评分维度拆分是新逻辑，但外壳沿用。

---

## 3. 狼人杀 Werewolf

### 3.1 一句话核心幻想
**9 人局里你是唯一知道部分真相的人——每一次白天发言都在赌别人信不信你。**

### 3.2 现状诊断

```
局面：9 人局，3 狼/预言家/女巫/猎人/3 村民，夜间行动→白天发言→投票。
可见信息：自己身份 + 私密信息（狼队友/查验结果/药水）+ 公共 log。
可选动作：夜间刀人/查验/用药；白天 20s 内自由发言；投票。
代价：超时自动 fallback（AI 代打）。
规则结算：白天依次发言（每人 20s），最后投票平票则无人出局。
反馈：夜间结果次日公布；白天发言是 1-2 句话的 LLM 短文本。
下一次选择：下一夜。
```

**断链点**：
- R5：单局 10-20 分钟，玩家出局后 `alive=false` 干等。
- AI 发言只有 1-2 句（`aiSpeech` 限制 120 字），没有"读人/抿身份"的信息量，玩家无法从发言推断身份。
- 玩家白天发言是自由文本，没有"起跳预言家/报查验/打某人"这种预制动作，导致 LLM AI 也接不住。

### 3.3 重构核心循环（原子循环 = 一个昼夜 ~120 秒走读；整局 3-4 个昼夜）

```
T+0s    第 N 夜开始。狼人 15s 刀人，预言家 8s 查验，女巫 12s 用药。
        （真人行动期对应角色，AI 自动补位；超时自动 fallback）
T+35s   天亮。公布昨晚死讯。死者留遗言 30s。
T+45s   白天发言窗口 90s（不再依次每人 20s）：
        屏幕左侧"发言动作条"常驻：
        [起跳身份] [报查验结果] [怀疑某人] [划水过]
        玩家点"怀疑 3 号"→ 3 号头像挂【被怀疑】标签，所有玩家可见。
        玩家点"起跳预言家"→ 公开宣告；若真预言家已起跳则形成对跳。
T+90s   发言窗口关闭。投票 20s。
T+110s  公布投票结果。若有人出局 → 翻身份 → 猎人可开枪 15s。
T+125s  本昼夜结束。检查胜负：狼=0 好人胜；狼≥好人 狼胜；否则进入下一昼夜。
```

整局 = 3-4 个上述循环。玩家若中途出局，从下一昼夜起变"幽灵观众"看完全程，结束统一进复盘。

### 3.4 四要素

| 要素 | 设计 |
|---|---|
| 目标 | 好人阵营：4 天内放逐所有狼；狼阵营：存活数 ≥ 好人。 |
| 冲突 | 信息不对称：你知道的别人不知道；对跳预言家时谁是真的。 |
| 反馈 | 发言动作条把"你怀疑谁/你跳什么身份"结构化，所有玩家头像上出现标记；投票结果实时公布。 |
| 奖励 | 阵营胜负 + MVP 评选（玩家每局获得"推理分"，按是否投对狼/是否被正确识别）+ 复盘。 |

### 3.5 需要新增/修改的机制

**时长压缩**：
- `SPEECH_TIMEOUT` 从"每人依次 20s"改为"全体 90s 自由发言窗口"。
- `MAX_DAYS = 4`（新增），第 4 天结束强制进入"最终投票"，避免无限局。
- 玩家出局后，从第 2 天起变成"幽灵观众"：可以看全场，但不能发言；第 4 天结束自动进复盘。

**发言动作结构化**（新增 `day_action`）：
```ts
type DayAction =
  | { kind: "claim_role"; role: "seer" | "witch" | "hunter" | "villager" }
  | { kind: "report_check"; seat: number; isWolf: boolean }   // 仅预言家可用
  | { kind: "suspect"; seat: number; reason?: string }
  | { kind: "defend"; seat: number }
  | { kind: "pass" };
```
- 动作通过 WS `day_action` 广播，前端在对应玩家头像上挂标签（【被怀疑】【跳预言家】【报查验：3 号好人】）。
- 自由文本发言仍然保留，但动作标签是所有 AI 决策的输入：AI 现在能看到"谁怀疑了谁"，而不是只看 120 字短文本。

**AI 发言升级**：
- `aiSpeech` 的 system prompt 注入当前可见的 `day_actions` 列表，让 AI 能针对性反驳（"3 号你凭什么怀疑我？"）。
- 发言长度从 120 字放宽到 200 字。

**复盘界面**（新增 `WerewolfReport`）：
```ts
interface WerewolfReport {
  winner: "wolf" | "good";
  myRole: WerewolfRole;
  myKeyActions: Array<{ day: number; action: string; outcome: string }>;
  reasoningScore: number;   // 0-100，按投对狼/被正确识别计算
  mvpSeat: number;
  highlights: string[];
}
```

**UI 组件新增**：
- `DayActionBar.tsx`：90s 窗口内的动作按钮，点人选择目标。
- `PlayerTagOverlay.tsx`：头像上的【怀疑】【跳身份】标签。
- `SpectatorMode.tsx`：出局后的幽灵视角，顶部"你已出局，第 X 天复活观战"。
- `WerewolfRecap.tsx`：结束后的复盘页。

### 3.6 时长 / 复玩
- 单局：**6-8 分钟**（旧版 10-20 分钟）。
- 复玩：排位分（推理分累积）；角色池解锁（新增"白痴"或"守卫"需段位解锁）；每日身份挑战。

### 3.7 可复用资产
- 整个 night/day 状态机、`waitForReal*` 超时模式、`getSnapshotForPlayer` 私密视图、AI 决策外壳全部保留。
- 只改：发言阶段结构 + AI prompt 输入 + 加 MAX_DAYS + 复盘。

---

## 4. 酒吧辩论 Bar

### 4.1 一句话核心幻想
**酒过三巡，你和一位名人在吧台唇枪舌战——你选的每一个角度，都在撬动对方的立场。**

### 4.2 现状诊断（重构后但仍有问题）

```
局面：玩家选边 → 3 回合 → 玩家发言 → LLM 打 0-10 → ±5 强度 → AI 反驳固定 +2。
可见信息：argumentStrength 双向条。
可选动作：自由写一段发言。
代价：无（每回合都能写）。
规则结算：scorePlayerArgument 返回单值 0-10，映射 (score-5) 强度变化；AI 固定 +2。
反馈：强度条滑动。
下一次选择：再写一段。
```

**断链点**：
- R2：评分黑盒（0-10 单值）。
- R3：没有战术选择——玩家不知道该"举数据/打感情/戳逻辑漏洞"哪个角度。
- AI 固定 +2 是写死的，玩家永远在挨打。

### 4.3 重构核心循环（75 秒走读）

```
T+0s   话题卡："年轻人该先攒钱还是先享受？" 玩家选边 pro/con。
T+5s   对面名人选定（苏格拉底/马斯克/李白风格）。
T+10s  第 1 回合。玩家面前出现 3 个"攻击角度"卡：
       [📊 摆事实/数据] [❤️ 打情感/故事] [🔍 戳对方逻辑漏洞]
       每回合只能选 1 个角度。AI 对手有一个"防御倾向"（开场随机：偏理性/偏感性）。
T+25s  玩家选【🔍 戳逻辑漏洞】并写一句话。
       系统结算：
       - 角度克制（戳漏洞 vs AI 偏理性 → 克制！）→ 强度 +8，AI 下轮 -3。
       - 角度被克（打情感 vs AI 偏感性 → 同属性）→ 强度 +2。
       - LLM 同时评"内容质量" 0-10，再 ±3。
       合计强度变化 -3 ~ +11 浮动。
T+40s  AI 针对性反驳（引用玩家刚说的那句）。
T+50s  第 2 回合。AI 换了一个防御倾向（屏幕提示："他开始打感情牌了"）。
T+75s  3 回合结束，苏格拉底裁决。
```

### 4.4 四要素

| 要素 | 设计 |
|---|---|
| 目标 | 3 回合后强度条停在你方 ≥55。 |
| 冲突 | 属性克制三角：数据→情感→逻辑→数据。猜对方下回合倾向。 |
| 反馈 | 克制时金色"克制！"飘字 + 强度大滑动；被克时灰色"同属性，效果减半"。 |
| 奖励 | 胜负 + 金句（最高强度那回合的发言）+ 酒保共识小结。 |

### 4.5 需要新增/修改的机制

**状态扩展**：
```ts
type ArgumentAngle = "data" | "emotion" | "logic";
type StanceTendency = "rational" | "emotional" | "mixed";

interface DebateState {
  // ...保留原有
  playerAngle?: ArgumentAngle;        // 本回合玩家选的角度
  aiTendency: StanceTendency;         // AI 当前防御倾向，每回合随机换
  angleEffectiveness: "counter" | "neutral" | "same";  // 克制关系
}
```

**克制关系表**（纯函数）：
```
玩家 data    vs AI rational → same（+2）
玩家 data    vs AI emotional → counter（+8）
玩家 emotion vs AI emotional → same（+2）
玩家 emotion vs AI rational → counter（+8）
玩家 logic   vs AI mixed     → counter（+8）
玩家 logic   vs AI 任意      → neutral（+5）
```
（具体数值在 P0 平衡时调，但规则结构定死。）

**LLM 评分改为双维度**：
```ts
{ content_quality: 0-10, relevance: 0-10 }
// 最终 delta = angleDelta + (content_quality - 5) + (relevance - 5) * 0.5
```

**AI 反驳不再固定 +2**：
- AI 也根据自己选的角度 + LLM 评分算 delta，与玩家对称。
- 这样玩家不会永远挨打。

**新增事件**：
- `bar_angle_picked({angle, aiTendency, effectiveness})`
- `bar_turn_resolved({playerDelta, aiDelta, balance})`

**UI 组件新增**：
- `AngleChooser.tsx`：3 张角度卡，点选后输入框才解锁。
- `TendencyMeter.tsx`：显示 AI 当前倾向（理性/感性/混合），上回合结束时揭示。
- `CounterPopup.tsx`：克制/被克的飘字动画。

### 4.6 时长 / 复玩
- 单局：**约 1.5 分钟**（3 回合 × 25s）。
- 复玩：话题库每日更新；段位（酒客→辩神）；不同名人对手有不同倾向组合。

### 4.7 可复用资产
- `createDebateSession` / `applyStrengthDelta` / `decideWinner` / `debateSpeech` / `bartenderSummary` 全部保留。
- 只是把"自由文本 + 单值评分"升级为"角度选择 + 双维度评分 + 克制表"。

---

## 5. 健身房 Gym（从零设计核心循环）

### 5.1 一句话核心幻想
**你不是在打卡——你在 90 秒内连闯三关，每一关都是一个手眼协调的小挑战，名人教练在旁边看着你爆不爆杆。**

### 5.2 现状诊断（真实代码走读）

```
局面：选目标/等级/时长 → 生成静态模板计划 → 点"开始一组"。
可见信息：动作名、组数、次数目标。
可选动作：点"开始"。
代价：无。
规则结算：setInterval 每 280ms reps+1，或每 1s time-1。玩家全程零输入。
反馈：数字 tick 到 0 自动打卡。
下一次选择：点下一个动作。
```

**断链点**：这不是游戏，是一个定时器。`GymShell.tsx` L261-293 的 `step()` 函数自己在 tick，玩家可以去喝杯水回来就完成了。

### 5.3 重构核心循环（100 秒走读 · 三关电路）

```
T+0s   进门。名人教练（选的那位）说："今天给你排了三关，过完算你赢。"
       屏幕显示今日电路：[反应关 30s] → [节奏关 45s] → [力量关 20s]
T+5s   第 1 关 · 反应力（Reaction Tap）：
       屏幕中央随机位置出现一个绿色圆圈。玩家必须在 1.5 秒内点击。
       点中 → 圆圈爆掉，+100 分，显示反应毫秒数。
       错过 / 点空 → -1 滴血（共 3 滴）。
       30 秒内出现 12 个圆圈。
T+35s  第 2 关结束。结算：命中 10/12，平均反应 380ms，得分 920。
       名人教练 LLM 点评："反应不错，就是最后两个慢了。"
T+40s  第 2 关 · 节奏点击（Rhythm Tap）：
       一条 8 拍的轨道从右往左滚，到达中线时点击空格键/屏幕。
       Perfect(±50ms) = +30，Good(±150ms) = +15，Miss = 0。
       连击中 combo ×2。
T+85s  第 2 关结束。结算：Perfect 5 / Good 8 / Miss 3，最高 combo 7，得分 1480。
T+90s  第 3 关 · 力量爆发（Power Hold）：
       一个蓄力条从 0 涨，玩家按住鼠标/空格，在条进入绿色区域（80-90%）时松开。
       松早了/松晚了 → 力量值低。
       重复 3 次，取最好一次。
T+105s 三关结束。总分 = 反应分 + 节奏分 + 力量分。
       段位：青铜（<2000）/白银（2000-3000）/黄金（3000-4000）/爆杆（>4000）。
       自动打卡 + 名人教练 LLM 总结金句。
```

### 5.4 四要素

| 要素 | 设计 |
|---|---|
| 目标 | 90 秒内三关总分超过今日基线（昨日分数 ×1.05）。 |
| 冲突 | 3 滴血限制失误；节奏关 combo 会断；力量关要赌时机。 |
| 反馈 | 每关即时分数 + 名人教练每关结束 LLM 一句点评（不打断流程）。 |
| 奖励 | 段位徽章（保留现有成就系统）+ 连续打卡天数保留 + 金句卡可发布。 |

### 5.5 需要新增/修改的机制

**新状态机**（替换现有 `WorkoutSession`）：
```ts
type MiniGameKind = "reaction" | "rhythm" | "power";

interface CircuitState {
  stage: "intro" | "playing" | "between" | "results";
  celebrityId: string;
  stations: MiniGameKind[];           // 今日三关，按 goal 加权
  currentStationIndex: 0 | 1 | 2;
  lives: 3;
  score: number;
  stationResults: Array<{
    kind: MiniGameKind;
    hits: number;
    misses: number;
    bestMs?: number;                  // reaction
    maxCombo?: number;                 // rhythm
    bestPower?: number;                // power
    score: number;
    coachNote: string;                 // LLM 点评
  }>;
  tier: "bronze" | "silver" | "gold" | "explosive";
}
```

**三关具体规则**（纯函数，前端权威即可，不需要服务端）：

1. **反应关 ReactionTap（30s）**
   - 圆圈在 200×200 区域内随机位置出现，存活 1500ms。
   - 间隔随机 600-1200ms。
   - 命中：score += `Math.max(50, 200 - reactionMs)`；miss：lives -= 1。
   - lives=0 → 本关提前结束，按已完成数计分。

2. **节奏关 RhythmTap（45s，8 拍/分钟 × 3 轮 = 24 拍）**
   - 轨道音符以 800ms 间隔生成，滚动到中线 600ms。
   - 判定窗口：Perfect ±50ms / Good ±150ms / Miss 其他。
   - combo 连续 Perfect 时 score ×(1 + combo*0.1)。

3. **力量关 PowerHold（20s，3 次尝试）**
   - 蓄力条 0→100 用 1.2 秒匀速上涨。
   - 目标区绿色 [80, 90]。松开时落入 → power = 100 - |release - 85|。
   - 3 次取最大值，score = bestPower × 10。

**名人教练点评**（复用 LLM）：
- 每关结束后，把该关结果（命中数/反应 ms/combo）发给 `celebritySpeak`，system prompt："你是这位名人健身教练，用他的口吻给一句 20 字以内的点评。"
- 不阻塞下一关：点评异步显示在侧边栏，玩家可以直接进入下一关。

**保留的旧资产**：
- `calculateStreak` / `checkAchievements` / `PLAN_TEMPLATES`（作为"看计划"tab 保留，但不再是主玩法）。
- 打卡 API `/api/gym/checkins` 复用，把三关总分写到 `note` 字段。
- WS presence / cheer 广播保留。

**UI 组件新增**：
- `CircuitSelector.tsx`：今日三关预览。
- `ReactionGame.tsx`：绿色圆圈随机出现/消失。
- `RhythmGame.tsx`：音符轨道 + 中线判定。
- `PowerGame.tsx`：蓄力条 + 绿色目标区。
- `CoachSidebar.tsx`：名人头像 + 点评异步飘入。
- `CircuitResults.tsx`：三关总分 + 段位 + 打卡按钮。

**删除/降级**：
- 旧的"自动 tick 训练 session"（`GymShell.tsx` L259-293）从主流程移除，挪到"自主训练"次级 tab，保留给真的想自己计时的用户。

### 5.6 时长 / 复玩
- 单局：**约 100 秒**（三关连闯）。
- 复玩：每日电路组合不同（按 goal 加权）；昨日分数作为今日基线；段位徽章；名人教练金句解锁。

### 5.7 可复用资产
- `celebritySpeak` / `resolveCharacter` / `calculateStreak` / `checkAchievements` / 打卡 API / WS presence 全部复用。
- 三关 mini-game 本身是新前端组件，不需要新 LLM 调用。

---

## 6. 图书馆 Library（从零设计核心循环）

### 6.1 一句话核心幻想
**你不是在和名人聊天——你在知识擂台赛上抢答，和 AI 名人比谁懂得多。**

### 6.2 现状诊断

```
局面：三个 tab（读书会/深度问答/AI 馆员），全是自由文本聊天。
可见信息：上一轮 AI 回复。
可选动作：输入框打字。
代价：无。
规则结算：LLM 返回一段 200-400 字回复。
反馈：一段文字。
下一次选择：再问一个问题。
```

**断链点**：没有对错、没有计时、没有分数、没有对手。这是 ChatGPT 套皮，不是游戏。

### 6.3 重构核心循环（90 秒走读 · 知识擂台赛）

```
T+0s   进图书馆。中央出现擂台台。选领域：
       [科学] [文学] [哲学] [历史] [艺术]
T+5s   选定"文学"。3 位 AI 名人对手就座（鲁迅/钱锺书/海明威风格）。
       规则：共 8 题，每题 10 秒，3 条命。
T+10s  第 1 题弹出：
       "《红楼梦》的作者是？"
       A. 罗贯中  B. 曹雪芹  C. 施耐庵  D. 蒲松龄
       4 个选项卡在屏幕上，10 秒倒计时。
T+18s  玩家点 B。
       - 答对：+100 分，combo+1；正确选项绿色亮起。
       - AI 对手抢答：有 30% 概率某 AI 比你快（显示"鲁迅抢答成功 +50"）。
       - 答错/超时：-1 命，正确答案红色揭示。
T+25s  第 2 题（著作解谜模式）：
       "「生存还是毁灭，这是一个问题」出自哪部作品？"
       A. 《李尔王》 B. 《哈姆雷特》 C. 《麦克白》 D. 《奥赛罗》
T+50s  第 4 题后进入"连击加成"：连对 3 题，下一题分数 ×2。
T+80s  8 题结束。结算：
       你答对 6/8，combo 最高 4，总分 780。
       对手鲁迅 720、钱锺书 650、海明威 540。
       你赢！段位：文学学霸。
T+90s  名人败者 LLM 一句调侃："年轻人不错，下次聊《资本论》试试。"
```

### 6.4 四要素

| 要素 | 设计 |
|---|---|
| 目标 | 8 题总分超过 3 位 AI 对手中的 2 位。 |
| 冲突 | 10 秒限时；AI 会抢答抢分；连对有加成但答错断 combo。 |
| 反馈 | 每题对错即时揭示 + combo 飘字 + 对手分数条实时变化。 |
| 奖励 | 段位（门外汉→学霸→宗师）+ 败者名人金句 + 可发布广场。 |

### 6.5 需要新增/修改的机制

**新状态机**（替换现有三个 tab 的自由聊天为主入口）：
```ts
type QuizPhase = "lobby" | "question" | "reveal" | "between" | "results";

interface QuizState {
  phase: QuizPhase;
  domain: "science" | "literature" | "philosophy" | "history" | "art";
  players: Array<{
    id: string;          // "you" 或 celebrityId
    name: string;
    score: number;
    isCeleb: boolean;
  }>;
  lives: 3;
  combo: number;
  currentQuestionIndex: 0..7;
  questions: Array<{
    prompt: string;
    options: string[];      // 4 个
    correctIndex: number;
    explanation: string;    // LLM 生成的一句话解析
  }>;
  questionTimeLimit: 10_000;
}
```

**题目生成**（开局一次 LLM 调用，或本地题库兜底）：
```ts
// POST /api/library/quiz/start { domain, count: 8 }
// LLM 返回 JSON：
// { "questions": [{ "prompt": "...", "options": ["A","B","C","D"], "correctIndex": 0-3, "explanation": "..." }] }
```
- 失败时用本地 fallback 题库（每个领域预置 20 题硬编码，跟 `DRAFT_FALLBACKS` 一个套路）。
- 题目一旦生成，整局不再调 LLM，避免延迟。

**AI 对手抢答规则**：
- 每题在 2-8 秒之间随机触发 1-2 位 AI 抢答，抢答正确率 60-80%（按名人领域加权：文学题鲁迅答对率 90%，海明威 70%）。
- AI 抢答成功：从该题总分中切走 50 分；玩家答对仍然得 100 分（不互斥，只是同一起跑线）。
- AI 答错：正确答案揭示，AI 扣分 -20。

**计分**：
- 答对：base 100 × (combo >= 3 ? 2 : 1)
- 答错/超时：lives -1，combo 归零
- lives=0 提前结束

**保留旧功能**：
- 读书会 / 深度问答 / AI 馆员三个 tab 不删，降级为"擂台赛结束后想深聊？"入口。
- `celebrityDeepChat` / `bookRecommendation` / `bookClubOpening` / `librarianAnswer` 全部保留。

**新增事件**：
- `library_quiz_started({domain, questions, opponents})`
- `library_question_show({index, prompt, options, timeLimit})`
- `library_answered({playerId, choice, correct, delta, combo})`
- `library_celebbuzzed({celebrityId, correct, delta})`
- `library_results({scores, winner, rank})`

**UI 组件新增**：
- `QuizArena.tsx`：主擂台，题目卡片 + 4 选项。
- `OpponentScoreboard.tsx`：3 位名人头像 + 实时分数条。
- `ComboMeter.tsx`：combo 倍数显示。
- `LivesMeter.tsx`：3 颗心。
- `QuizResults.tsx`：段位 + 败者金句。
- 旧的三个 chat tab 收进"深聊"次级入口。

### 6.6 时长 / 复玩
- 单局：**约 90 秒**（8 题 × 10s + 过渡）。
- 复玩：每日领域轮播；段位（门外汉→学霸→宗师）；败者名人金句收藏；答错的题进入"错题本"次日再考。

### 6.7 可复用资产
- `celebrityDeepChat` / `resolveCharacter` / LLM 外壳 `withRetry`/`extractJson` 保留。
- 题目生成复用 LLM 调用模式；fallback 题库沿用 `DRAFT_FALLBACKS` 套路。
- 擂台赛本身是新状态机，但外壳与脱口秀 open-mic session 几乎同构（`createOpenMicSession` 模式可直接套用）。

---

## 7. 跨场景统一规格

### 7.1 统一评分外壳
所有场景的"评分"必须拆成 ≥2 个维度，不允许单值黑盒：

| 场景 | 维度 1 | 维度 2 | 维度 3 |
|---|---|---|---|
| 法庭 | 命中 unresolved | 论点质量 | — |
| 脱口秀 | Punchline | Pacing | Resonance |
| 酒吧 | 角度克制 | content_quality | relevance |
| 健身房 | 反应 ms | combo | power |
| 图书馆 | 答对速度 | combo | 对手压制 |

### 7.2 统一段位模板
所有场景结算时用同一组文案档位：
- 失败/冷场（<30%）
- 尚可（30-60%）
- 出色（60-85%）
- 大师（>85%）

文案按场景换壳（法庭=菜鸟律师→金牌大状；脱口秀=冷场→今日之星；酒吧=酒客→辩神；健身房=青铜→爆杆；图书馆=门外汉→宗师），但阈值统一。

### 7.3 统一事件流
所有场景 orchestrator 必须导出：
```ts
interface SceneSession {
  start(): Promise<State>;
  // 玩家动作
  act(action: ...): Promise<{ event; state }>;
  // 结算
  finish(): Promise<{ result; state }>;
  getState(): State;
}
```
事件通过 WS 广播，私有信息（狼人身份、女巫药水）走 `sendToUser`。

### 7.4 P0 / P1 范围

| 优先级 | 内容 |
|---|---|
| P0 | 健身房三关电路（5.3-5.5）、图书馆知识擂台（6.3-6.5）——这两个是从零到一，玩家最痛 |
| P0 | 法庭玩家出牌牌组（1.5）、酒吧角度克制（4.5）——把现有"打字"升级为"选择" |
| P1 | 脱口秀三维度评分 + callback（2.5）、狼人杀发言动作结构化（3.5） |
| P1 | 跨场景段位累积系统、每日挑战 |
| 非目标 | 多人联机对战（当前全是单人 vs AI）、3D 场景升级、语音识别输入 |

### 7.5 验收检查单
- [ ] 每个场景都有 60-120 秒可走读的核心循环（本文档 1.3/2.3/3.3/4.3/5.3/6.3）。
- [ ] 健身房不再是自动 tick；图书馆不再是纯聊天。
- [ ] 所有评分拆成 ≥2 维度。
- [ ] 所有场景单局 ≤ 5 分钟。
- [ ] 所有新 orchestrator 复用 §0.3 的资产清单，不重写 LLM 外壳 / 名人解析 / 状态机。
- [ ] 狼人杀玩家出局后有观战 + 复盘，不再干等。
