# GDD · 酒吧辩论 Bar（叽里呱啦玩法深化专项）

> 本文件是 `apps/api/src/bar-engine.ts` 的设计依据。引擎 `BarEngine extends BaseOrchestrator`（共享编排基类）。

## 1. 一句话核心幻想
**酒过三巡，你和一位名人在吧台唇枪舌战——你选的每一个角度，都在撬动对方的立场。**

## 2. 单局规格
| 项 | 值 |
|---|---|
| 真人位 | slot-0 = 玩家辩手；AI = 对手名人 + 酒保裁判（苏格拉底） |
| 回合 | 3 回合，单局 ≈1.5 分钟（每回合约 25s） |
| 强度条 | 0–100 双向互补（pro + con = 100），初值 50:50 |
| 终局判胜 | 三回合后玩家方强度 **≥55** 判玩家胜；否则判对手胜（tie 落在 50 附近） |

## 3. 核心循环（每回合）
```
选角度（每回合限 1 张）
  [📊 摆数据 data] [❤️ 打情感 emotion] [🔍 戳逻辑漏洞 logic]
写一句话发言
结算（纯规则 + 双维 LLM 评分）
  ├─ 角度克制：resolveAngleCounter(playerAngle, aiTendency) → angleDelta
  ├─ 双维评分：scoreArgument → { content_quality 0-10, relevance 0-10 }
  ├─ playerDelta = angleDelta + (content_quality-5) + (relevance-5)*0.5
  ├─ applyStrengthDelta(playerSide, playerDelta)
  └─ AI 对称：AI 自选角度，对玩家角度做克制 + 同样双维评分 → aiDelta
揭示下一回合 AI 倾向（屏幕提示「他开始打感情牌了」）
```

## 4. 角度克制三角（纯函数 `counterEffect`）
| 玩家角度 \ AI 倾向 | rational 理性 | emotional 感性 | mixed 混合 |
|---|---|---|---|
| **data 数据** | same +2 | **counter +8** | neutral +5 |
| **emotion 情感** | **counter +8** | same +2 | neutral +5 |
| **logic 逻辑** | neutral +5 | neutral +5 | **counter +8** |

- counter = 克制（金色飘字「克制！」，强度大滑）
- same = 同属性（灰色「效果减半」，+2）
- neutral = 中性（+5）
- AI 倾向每回合随机换，玩家要猜下回合它换什么。

## 5. 双维度评分（不再是单值黑盒）
```ts
{ content_quality: 0-10, relevance: 0-10 }
turnDelta = angleDelta + (content_quality - 5) + (relevance - 5) * 0.5
```
玩家与 AI 对称使用同一评分函数；AI 反驳不再写死 +2。

## 6. 槽位 / 超时
- slot-0 真人辩手；其余 AI 填充。
- 真人在每回合发言窗口内不操作 → `startTimer` 超时 fallback：AI 用默认角度（data）+ 占位发言自动结算，对局继续。

## 7. 新手引导（首局，可跳过）
选边（pro/con）→ 选角度卡（先选角度才解锁输入框）→ 理解克制三角（屏幕提示 AI 倾向）→ 看双向强度条滑动 → 看裁判裁决。`TutorialEngine` 支持 skip。

## 8. 每日挑战
`getDailyChallenge('bar')`，池含：至少打出一次克制取胜 / 三回合每回合强度都领先 / 单回合作答 ≤15s / 首回合落后反超 / 达到 master。
