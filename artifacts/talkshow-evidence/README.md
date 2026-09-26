# 脱口秀真机走查证据

## 方式
API + Web dev server 已启动。通过 `engine-routes.ts` 确定性单局 API：

```
POST /api/engine/talkshow/new          → 热身 + 话题票
POST /api/engine/talkshow/:id/topic    → 选话题
POST /api/engine/talkshow/:id/joke    → 讲一段（可带 callbackTo）
```

## 正常一局（职场吐槽，3 段）
- 段1：`punchline=19 pacing=25 resonance=17 total=61 reaction=mixed`
- 段2：声明 callback 段0，真引用「老板凌晨在吗」关键词 → `callbackHit=true`，resonance 17→30(+15)，reaction mixed→applaud，total=74
- 段3：total=61
- 终局 `game_result`：平均 65，tier=`炸场(expert, 65%)`，金句卡=段2（74 分），高光「成功回扣 1 次」
- 事件流：`talkshow_warmup / talkshow_topic_options / talkshow_topic_picked / talkshow_joke_start / talkshow_joke_scored / feedback:joke / game_result`
- 原始报文：`full-game.json`

## AI 观众填充
单测 `TalkshowOrchestrator 槽位`：slot-0=真人演员，slot-1=主持人 AI，slot-2..4=三位观众 AI。

## 超时局
单测 `60s 超时自动提交空段子记冷场`（fake timer 推进 65s）：reaction=silence，流程不卡死。

## 数值复算
callback 命中：17+15=30（钳到 30 上限）；平均 (61+74+61)/3=65，与 `game_result.scores.slot-0=65` 一致。
