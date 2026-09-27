# R5 发布说明（发布域 · 安全 / 部署 / 演示 / 门面）

R5 是上线前最后一片：补齐安全审核闭环、公网部署方案、3 分钟演示脚本与门面文档。
分支 `feat/r5-launch`，自验全绿，未合并 main、未 push。

## 一、九域交付清单

| 域 | 交付 |
|---|---|
| 安全（本域） | shared 敏感词纯函数 + 四类词表 + 名人合规校验；服务端命中累计禁言 5 分钟 + `.data/mutes/` 持久化 + WS `mute_status` 下发；举报结构化 `.data/reports/` + admin 列表/处置；UGC 发布 pending_review |
| 部署（本域） | `docker/`：Dockerfile.api/web、docker-compose(api/web/nginx/coturn)、nginx HTTPS/WSS 模板、coturn 模板、.env.example；`docs/DEPLOYMENT.md` |
| 演示（本域） | `docs/DEMO_SCRIPT.md`（分秒级 3 分钟）、`docs/DEMO_CHECKLIST.md` |
| UGC | `POST /api/scenes` 包装接入审核，命中即 pending_review 不公开 |
| 社交 | 聊天/喊话命中计数 + 禁言拒收时回推 mute_status；前端 toast/倒计时浮标 |
| 性能 | WebRTC TURN 经 coturn 容器配置（模板） |
| 名人 | `isCelebrityNameSafe` 防冒充/诽谤校验 |
| IA | 三主页路由未改（additive），about.html 独立页 |
| 门面 | README R5 卖点/架构图/快速启动、about.html、本说明 |

## 二、测试

- **api vitest：557 passed / 41 files**（本域新增 19：moderation.r5 14 + scene-moderation 5）
- **web vitest：368 passed / 28 files**（本域新增 17：moderation.shared 14 + moderation-bus 3）
- 本域新增合计 **36** 个测试，全部通过。

## 三、自验结果

- api `tsc --noEmit`：零错误
- web `tsc -b --noEmit`：零错误
- api `vitest run`：557 全绿
- web `vitest run`：368 全绿
- web `vite build`：成功（about.html 已入 dist）
- docker：本环境无 docker，已用 python yaml 校验 `docker-compose.yml`（api/web/nginx/coturn 四服务）语法通过；Dockerfile 为模板，需真机构建

## 四、已知限制

- admin 举报后台（`/api/admin/reports`）当前未接鉴权，公网须 nginx 层加白名单/Basic Auth。
- 敏感词为本地词表（中文子串 / 英文边界匹配），准确率需灰度运营调词表。
- 禁言为单实例内存 + JSON 持久化，重启从 `.data/mutes/` 恢复；未做多实例同步。
- Dockerfile 用 npm workspaces（仓库现状）；任务提到 pnpm，已在注释说明可替换。

## 五、需真机/真环境确认项

- HTTPS/WSS 端到端连通（证书链完整、`/api/ws` 101）
- coturn 在对称 NAT / 移动网络下的 TURN 中继成功率
- 敏感词过滤命中率与误伤（灰度）
- PWA 在真实 HTTPS 域名下可安装、可录音
- 上游 AI 网关（StepFun/Tripo）密钥配置后的首 token 延迟
