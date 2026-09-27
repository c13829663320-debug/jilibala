# GDD · 狼人杀 Werewolf（叽里呱啦玩法深化专项）

> 本文件是 `apps/api/src/werewolf-engine.ts` 的设计依据。引擎 `WerewolfEngine extends BaseOrchestrator`（共享编排基类）。

## 1. 一句话核心幻想
**9 人局里你是唯一知道部分真相的人——每一次白天发言都在赌别人信不信你。**

## 2. 单局规格
| 项 | 值 |
|---|---|
| 人数 | 9（真人恒占 slot-0/1 号，AI 名人填充其余 8 席） |
| 身份 | 3 狼人 / 1 预言家 / 1 女巫 / 1 猎人 / 3 村民 |
| 单局时长 | 6–8 分钟，3–4 个昼夜 |
| 昼夜上限 | MAX_DAYS = 4，第 4 天结束强制终局裁定 |
| 出局处理 | 出局即变「幽灵观众」，可看全场、不能发言，撑到复盘 |

## 3. 核心循环（一个昼夜 ≈120s）
```
夜晚 night（round 子阶段）
  ├─ wolf   狼队睁眼刀人（真人狼 15s 内选目标，AI 自动；超时 AI 代打）
  ├─ seer   预言家查验一人阵营（8s）
  └─ witch  女巫用药：解药救人 / 毒药毒人，二选一（12s）
白天 day_announce
  └─ 公布昨夜死讯；死者若含猎人 → 猎人开枪窗口 15s
白天 speech（90s 全体自由窗口）
  ├─ 左侧动作牌常驻：[起跳身份][报查验][怀疑某人][辩护][划水]
  ├─ 点「怀疑 X 号」→ X 号头像挂【被怀疑】标签，全员可见
  └─ 自由文本发言保留，动作牌是 AI 决策输入
投票 vote（20s）
  └─ 计票放逐；平票无人出局；被票者若为猎人可开枪
胜负检查（每个昼夜结束）
  ├─ 狼 = 0        → 好人胜 good
  ├─ 狼 ≥ 好人      → 狼胜 wolf
  └─ 否则进入下一昼夜
```

## 4. 动作牌（结构化发言）
```ts
type DayAction =
  | { kind: "claim_role"; role: "seer"|"witch"|"hunter"|"villager" }
  | { kind: "report_check"; seat: number; isWolf: boolean }  // 仅预言家，且只能报真实验人结果
  | { kind: "suspect"; seat: number; reason?: string }
  | { kind: "defend"; seat: number }
  | { kind: "pass" };
```
动作牌通过 `day_action` 广播，前端 `PlayerTagOverlay` 在头像上挂标签；同时写入动作日志，作为 AI 发言/投票的公开输入。

## 5. 推理分（计分外壳，BaseOrchestrator.addScore）
| 行为 | 分值 |
|---|---|
| 投票放逐真狼 | +10 / 次 |
| 自己被放逐且自己是狼（被好人正确识别） | −5 |
| 存活到终局 | +20 |

推理分 0–100 归一后映射统一段位（novice<30% / adept 30–60% / expert 60–85% / master>85%），文案：旁观者→入门神探→推理大师→读心者。

## 6. 隐私边界（强制）
- 广播事件 `emit` 只带公开信息（座位、昵称、存活、动作牌标签、日志）。
- 私密信息（自己身份、狼队友、查验记录、女巫药水/今晚刀位）通过 `getSnapshotForPlayer(seat)` 按视角过滤，只发给本人；旁观者与其他玩家一律为 `undefined`。
- 单测 `私密信息不泄露` 校验：A 玩家快照里不出现 B 的身份与查验结果。

## 7. 超时兜底
真人在任一行动窗口内不操作 → 超时触发 `BaseOrchestrator.startTimer` 的 `onTimeout`，由注入的 AI 决策钩子代打（选目标/查验/用药/投票），局面永不卡死。AI 钩子可注入，测试用确定性桩，线上接 LLM。

## 8. 新手引导（首局，可跳过）
看身份 → 夜间行动（刀人/查验/用药按角色出现）→ 白天动作牌打标签 → 投票 → 理解胜负（狼=0 好人胜 / 狼≥好人狼胜）。`TutorialEngine` 支持 skip，复玩不再触发。

## 9. 每日挑战
`getDailyChallenge('werewolf')`，池含：好人阵营获胜 / 达到 expert+ / 存活到终局 / 预言家验人全对 / 狼人阵营获胜。同一天同种子全员同挑战。
