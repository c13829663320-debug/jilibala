# Round 4 · 20轮迭代计划（第四轮）

> 启动时间：2026-09-27 | 基线：API 368 / Web 206 测试全绿，tsc 零错误，HEAD=651ae1a
> 策略：独立 worktree 分片并行 → 分批合并 main → 全量测试 → 推送

## 提交规范
- 格式：`feat(scope): Round4 模块名 — 简述`
- 每个子模块独立 commit，合并前 rebase 到最新 main
- 必须附带测试，测试数净增

## Wave 1 · P0 核心稳定性（4路并行）
| 迭代 | 模块 | 负责文件域 |
|------|------|-----------|
| R4-01 | 断线重连+会话恢复+在途消息补发+掉线平滑移除+位置插值防抖 | api/ws.ts, web/useReconnectingWebSocket.ts, web/multiplayer/ |
| R4-02 | 房间权限：踢人/转移房主/锁房/私密/密码/人数上限 | api/room-routes.ts, api/ws.ts, shared/, web/MultiplayerLobby.tsx |
| R4-03 | 化身安全：屏蔽/静音/举报 + 预览/换装分层/LOD距离裁剪 | web/avatar/, web/safety/, web/Plaza3D.tsx |
| R4-04 | WebRTC容错：语音回落文字/TURN模板/麦克风引导 + 全局错误边界 | web/voice/, web/error-boundary/, api/ |

## Wave 2 · P0 玩法与基础设施（2路并行）
| R4-05 | 玩法多人适配：法庭/狼人杀/酒吧真人混入AI+AI填充 | api/*-orchestrator.ts, api/ws.ts, web/*/ |
| R4-06 | 性能治理+会话持久化+本地存档+多人新手引导 | web/performance/, web/onboarding/, api/db.ts |

## Wave 3 · P1 社交生态（2路并行）
| R4-07 | 好友系统+私聊+房间内@+消息历史缓存 | api/friends.ts, api/chat.ts, api/ws.ts, web/social/ |
| R4-08 | 排行榜+Emote扩充+主题房间+内容治理(关键词/举报/屏蔽) | api/leaderboard.ts, api/moderation.ts, web/ |

## Wave 4 · P2 UGC增强（2路并行）
| R4-09 | 场景工作室：模板市场/保存分享链接/私有公开权限 + CC0道具可拾取 | api/scene-studio*, web/scene-studio/, shared/ |
| R4-10 | 人物生成流水线(Tripo批量/GLB绑定/导入校验脚本) + 102名人TTS映射/开场白/离线知识库 | scripts/, tools/, apps/api/data/, shared/character-voices.ts |

## Wave 5 · P3 部署与文档（1路）
| R4-11 | Docker一键部署+环境变量文档+HTTPS指南+备份迁移 + 完整文档(API/产品设计/演示脚本/积分原型) | Dockerfile, docker-compose.yml, docs/, README.md |

## 验收门
1. 每波合并后：`apps/api` vitest + `apps/web` vitest 全绿
2. 两端 tsc --noEmit 零错误
3. `npm run build` 生产构建通过（PWA）
4. 裸 node 客户端验证 WS 逻辑（云端无GPU，浏览器端标注需真机确认）
5. 分批 push origin main
