# R5 法庭招牌模式（Celebrity Court Signature Mode）

## 1. 设计理念：为什么法庭是招牌

法庭是叽里呱啦最具戏剧张力的舞台——它天然具备 **对抗双方、裁决者、证据链、翻盘可能** 四要素，与「名人宿怨/历史公案」题材高度咬合。普通牌面对决（Classic Court）是机制骨架，招牌模式（Signature Mode）则把这副骨架装进 **名人名案** 的剧场外壳：

- **角色即冲突**：牛顿 vs 莱布尼茨、特斯拉 vs 爱迪生——玩家不是审理抽象邻里纠纷，而是「代表」一段家喻户晓的历史公案，代入感即传播点。
- **戏剧化节奏**：开庭陈述 → 3 轮举证 → 结案陈词 → 陪审团裁决，比普通模式多了「结案陈词」与「陪审团情绪」两个情绪放大器。
- **名场面可回放**：每局自动沉淀 3 个预设/触发名场面，结算页做成「高光回放」，天然适合截图分享。
- **关系钩子**：胜诉后与「对方名人」好感度上升，配合 R5 关系系统把单次对局沉淀为长期角色关系，驱动再来一局。

招牌模式是独立模式，通过 `?signature=1` 或「招牌模式」入口按钮进入，**不改动普通牌面模式的既有流程**。

## 2. 名人案件库

`apps/api/src/court-signature-cases.ts`，确定性数据（不调 LLM），共 6 案：

| 案件 id | 标题 | 原告 | 被告 | 主题 | 陪审团初始倾向 |
|---|---|---|---|---|---|
| `newton-vs-leibniz` | 世纪知识产权之争：牛顿 vs 莱布尼茨 | 莱布尼茨 | 牛顿 | 微积分发明权 | 偏被告 |
| `musk-vs-jobs` | 产品理念之战：马斯克 vs 乔布斯 | 马斯克 | 乔布斯 | 物理本质 vs 人文品味 | 偏原告 |
| `socrates-vs-athens` | 思想自由审判：苏格拉底 vs 雅典城邦 | 苏格拉底 | 雅典城邦 | 追问是否腐蚀青年 | 偏被告 |
| `tesla-vs-edison` | 电流之战：特斯拉 vs 爱迪生 | 特斯拉 | 爱迪生 | 交直流公开刑秀 | 偏原告 |
| `wu-zetian-vs-rites` | 女性权力之辩：武则天 vs 传统礼法 | 武则天 | 传统礼法 | 女子为何不能称帝 | 偏被告 |
| `picasso-vs-dali` | 艺术风格之争：毕加索 vs 达利 | 毕加索 | 达利 | 几何切面 vs 融化时钟 | 中立 |

每案含：`facts[]`（3–5 条戏剧化事实）、`disputePoints[]`（3 个争议焦点）、`evidence[]`（带 `side` 与 `power` 的证据卡）、`dramaticMoments[]`（3–5 个预设名场面）、`juryBias`（-50~50，正偏原告）。

## 3. 陪审团情绪机制

`juryMood` 取值 0–100，起点 50（中立），每轮出牌后纯函数更新：

- 玩家出牌 **命中争议焦点** → juryMood **+5**
- 被对方律师 **针对性反驳** → juryMood **−3**
- 玩家打 **mock（幽默嘲讽）** → juryMood **+2** 但天平 **−2**（调动气氛但不推进事实）

陪审团情绪是「气氛分」，与天平分并列展示（黄色情绪条），在最终裁决时按 `(juryMood-50)/5` 折入综合裁断。

## 4. 结案陈词算法

`evaluateClosingStatement(text, balance, juryMood)` 为纯函数，输出 0–15 加成：

- **长度分**：陈词字数落在 40–120 字区间得满分（太短敷衍、太长啰嗦均扣分）。
- **关键词分**：命中争议焦点词 / 「正义、真相、恳请、铁证」等法庭词，每个 +1，封顶。
- **天平修正**：当前天平越接近临界线（50 附近），陈词的边际作用越大；已大幅领先或落后则加成打折。

最终 `verdictScore = balance + (juryMood - 50)/5 + closingScore`；`≥52` 胜诉、`≤48` 败诉、中间为平局。

## 5. 名场面类型

名场面在 `captureHighlight` 中标记，结算时按权重筛选 top 3 回放：

- `key_evidence`：关键证据命中（单牌 `delta ≥ 8`）——复用 shared `detectHighlight` 规则。
- `dramatic_moment`：案件预设名场面，在关键节点自动触发（如牛顿拍桌、莱布尼茨掏手稿、法官宣布调查报告不予采信）。
- `comeback`：翻盘——复用 shared `detectComeback`（开局 <30% 而终局 >50%）。
- `jury_swing`：陪审团倒戈（juryMood 单轮大幅摆动）。

## 6. REST 路由

`apps/api/src/engine-routes.ts`（注册于 server）：

- `POST /api/engine/court-signature/new` — 创建招牌对局（可选 `caseId`，不传随机）
- `POST /api/engine/court-signature/:id/act` — 出牌 / 提交结案陈词
- `GET  /api/engine/court-signature/:id` — 对局快照
- `GET  /api/engine/court-signature/cases` — 列出名人案件库

## 7. 与普通模式的区别

| 维度 | 普通牌面模式 | 招牌模式 |
|---|---|---|
| 对手 | 系统生成邻里纠纷 | 名人历史公案（确定性案件库） |
| 阶段 | 3 轮出牌即结算 | 3 轮出牌 + 结案陈词 + 陪审团裁决 |
| 情绪系统 | 无 | juryMood 0–100 陪审团情绪条 |
| 结案陈词 | 无 | 玩家自由文本，纯函数算 0–15 加成 |
| 名场面 | 高光 highlights | 预设名场面 + 高光，top3 回放 |
| 入口 | 默认 CourtroomShell | `?signature=1` / 「招牌模式」按钮 |
| 关系/连胜/战果卡 | 已接入（R5） | 同样接入，settle 时落盘 |

## 8. 普通法庭 R5 钩子接入

普通法庭（`court-engine.ts`）在出牌结算后调用 `detectHighlight` → `captureHighlight`；每轮推 `scoreHistory` 供翻盘检测；`settle()` 返回 `metadata`（outcome / comeback / opponentCelebrity / relationshipDelta / highlights）。路由层在结算时调用 `applyRelationshipChange` 持久化，并 `buildResultCard` 生成战果卡。前端结算页展示高光回放、关系 ±、连胜、战果卡（复制文案 / 分享）与「再来一局（指名同一对手）」。

## 9. 测试与验证

- 单测：`court-signature-cases.test.ts`（6 案完整性）、`court-signature-engine.test.ts`（整局/情绪/陈词/名场面/翻盘）、`court-engine.test.ts` 追加 R5 钩子用例。
- 全量 `npm test`：385 passed；`npm run build` 通过。
- 真机（Chromium headless + CDP）：招牌模式一局（案件选择 → 天平+情绪条 → 结案陈词 → 裁决名场面+关系+战果卡）与普通法庭一局钩子链路，证据存 `artifacts/court-signature-evidence/`。
