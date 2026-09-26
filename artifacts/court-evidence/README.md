# 法庭真机走查证据

## 方式
API（tsx dev, :8787）+ Web（vite dev, :5173）均已启动。
通过 `apps/api/src/engine-routes.ts` 暴露的确定性单局 API 端到端走查（无需 LLM）：

```
POST /api/engine/court/new            → 开庭（真人=律师 slot-0，AI 填对方律师/法官/当事人）
POST /api/engine/court/:id/act        → 出牌 / pass
```

## 正常一局（ plaintiff 连出 3 张证据牌命中 3 个争议点 ）
- 终局天平：`{ plaintiff: 62, defendant: 38 }`
- `game_result`：`winner=slot-0`，tier=`王牌律师(expert, 62%)`，rankPoints=25
- 高光：3 轮【出示证据】全部「此点已查明」
- 事件流完整：`court_balance_update / court_player_turn / court_card_resolved / court_round_recap / feedback:court_hit / game_result`
- 原始报文：`full-game.json`
- 截图：`court-landing.png`（Web 入口身份创建页，证明前端壳正常渲染）

## AI 补位局
单测 `court-engine.test.ts > 真人恒占 slot-0，其余由 AI 填充`：
slots[0].isHuman=true，slot-1..3 全部 !isHuman 且带 aiPersona。

## 玩家超时局
单测 `court-engine.test.ts > 玩家回合超时自动 pass`（vi.useFakeTimers 推进 1.5s）：
超时兜底自动 pass 并进入第 2 轮，局面不卡死。

## 数值复算
每轮 +8（证据命中）-4（对手反驳）= 净 +4；50→54→58→62，与 `game_result.scores.slot-0=62` 一致。
