# 内容安全合规 · 闭环演示脚本（R5）

本脚本演示「叽里呱啦」内容安全分片的完整闭环：敏感词分级 → 自动替换/拦截 → 自动禁言/封禁 → 用户举报 → 管理员处置 → 未成年人保护 → 名人合规。

> 敏感词库全部使用安全示例/占位词，不包含真实极端违禁词。演示中命中的词为内置示例词：
> - L1（替换）：`加我微信`
> - L2（拦截）：`fakeinsult`
> - L3（拦截+自动禁言）：`fakesevere`

## 启动与鉴权

```bash
# 在工程根目录
npm install --no-audit --no-fund
npm run dev          # API: http://localhost:8787  Web: vite dev

# 管理员 token（默认 dev-admin-token，可用环境变量覆盖）
export ADMIN_TOKEN=dev-admin-token
```

- WebSocket：`ws://localhost:8787/api/ws?userId=<uid>&room=plaza`
- 管理员请求头：`X-Admin-Token: dev-admin-token`

## 演示步骤

| 步骤 | 操作 / 输入 | 预期结果 | 演示要点 |
|---|---|---|---|
| 1 | 正常对话：WS 发 `{type:"chat", text:"你好，今天天气不错"}` | 房间广播同条消息，正常显示 | `moderateText` 返回 `allow`，不替换不拦截 |
| 2 | 发 L1 敏感词：`{type:"chat", text:"加我微信 abc"}` | 消息发出，但正文变为 `加我*** abc`（广播给房间） | L1 命中 → `action:"replace"`，命中词替换为 `***` 后放行 |
| 3 | 发 L2 敏感词：`{type:"chat", text:"fakeinsult 你这人"}` | 发送者收到 `moderation_notice{kind:"blocked"}`，**不广播**给房间 | L2 命中 → `action:"block"`，记录违规事件+警告 |
| 4 | 连续再发 2 次 L2（共 3 次） | 第 3 次后该用户被**自动禁言 10 分钟**；再发消息返回 `moderation_notice{kind:"muted", remainingSeconds}` | L2 累计 3 次 → 自动禁言 10 分钟（`recordViolation` 阈值） |
| 5 | 另一个用户调用 `POST /api/reports`：`{reporterId:"uA", targetUserId:"uB", category:"abuse", reason:"辱骂"}` | 返回 201，举报状态 `pending` | 公开举报路由，无需管理员 token |
| 6 | 管理员调用 `POST /api/admin/reports/:id/handle`，body `{action:"mute", adminNote:"核实"}` | 举报状态变 `muted`，目标用户被禁言；`GET /api/admin/reports` 可见台账 | ADMIN_TOKEN 鉴权 + 举报处置联动禁言 |
| 7 | 首次进入前端，年龄弹窗选「未满 14 岁」 | 写入 localStorage + `POST /api/age-gate/declare`；UGC 发布按钮禁用，显示「青少年模式」标识 | under14 硬禁止 UGC（`isMinorBlockedFromUGC`） |
| 8 | 进入名人对话页（人物馆） | 聊天区顶部显示免责声明横幅；服务端 system prompt 注入「虚拟角色，不代表真实人物观点」 | `ComplianceBanner` + `COMPLIANCE_BOUNDARY` 注入 |

## 管理员处置 API 速查

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/reports?status=pending` | 举报列表（可按状态过滤） |
| POST | `/api/admin/reports/:id/handle` | 处置：`{action:"dismiss"\|"mute"\|"ban", adminNote}` |
| POST | `/api/admin/users/:id/mute` | 手动禁言：`{minutes, reason}` |
| POST | `/api/admin/users/:id/unmute` | 解除禁言 |
| POST | `/api/admin/users/:id/ban` | 封禁：`{reason}` |
| POST | `/api/admin/users/:id/unban` | 解封 |
| GET | `/api/admin/moderation/stats` | 今日拦截/替换数、生效中禁言/封禁数、待处理举报数 |

## 规则汇总

- **L1 轻度**：自动替换为 `***`，放行（广告导流、轻微不文明用语）。
- **L2 中度**：拦截 + 警告 + 记录；累计 3 次 → 自动禁言 10 分钟。
- **L3 重度**：拦截 + 自动禁言 30 分钟（首次）；累计 2 次 → 自动封禁。
- **被禁言用户**：WS 发消息返回 `{kind:"muted", remainingSeconds}`；HTTP 发布返回 403 `{error:"muted", remainingSeconds}`。
- **被封禁用户**：WS 直接拒绝连接；HTTP 返回 403。
- **未成年人**：<14 岁仅浏览不可发 UGC；14-17 岁夜间（默认 22:00-06:00，可用 `MINOR_NIGHT_START`/`MINOR_NIGHT_END` 配置）提示休息。不收集真实姓名/手机号。
- **名人合规**：system prompt 注入虚拟角色声明；前端对话页挂免责声明横幅。

## 自动化验证

```bash
npm test          # API 392 + Web 206 = 598 个用例全绿
npm run build     # tsc + vite build 通过
```

新增测试：`apps/api/src/moderation.test.ts`（14）、`apps/api/src/age-gate.test.ts`（10）。
