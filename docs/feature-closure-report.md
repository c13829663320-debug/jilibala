# 五大功能闭环走查与修复报告

- 分支：`feat/round2-gameplay-revamp`
- 日期：2026-09-26
- 范围：照片→全身3D、TTS 语音、AI 帮写、Seedance 视频、自定义场景工作室
- 验收：两端 `tsc --noEmit` 零错误；API vitest **360 passed**（+7），Web vitest **188 passed**（+3）；新增测试 10 个。

---

## 走查结论总览

| 功能 | 走查前状态 | 走查后 |
|---|---|---|
| 1 照片→全身3D | Tripo 不可达时卡死在 step2，无法保存 | 有占位模特降级，可保存并带入场景 |
| 2 TTS 语音播放 | 健康（单例并发控制、白名单、默认兜底） | 健康，补回归确认 |
| 3 AI 帮写 | 脱口秀后端有接口、前端无按钮；法庭/场景已有 | 脱口秀按钮已接入，结果可编辑/直接讲 |
| 4 Seedance 视频 | 后端只建 queued 任务，前端无限轮询永久转圈 | 90s 超时优雅降级为「功能开发中」 |
| 5 自定义场景工作室 | SSE 不下发 sceneId，生成后无法保存/发布 | SSE 下发 sceneId，创建→保存→发布→游玩闭环 |

---

## 功能 1：照片 → 全身 3D

**走查清单**：上传照片 → `/api/avatars/generate-from-image` → 轮询任务 → 预览 → `/api/custom-characters/finalize` 保存 → 人物列表出现 → 带入法庭/广场。

**原问题**
- Tripo 云端已知不可达。`startGenerate` 抛错后 `task=null`，而 step2 的「下一步」要求 `modelReady`（= `Boolean(task.assetUrl)`），保存要求 `task.taskId` + `modelReady`。用户被永久卡在 step2，整个闭环断裂。
- 服务端 `finalize` 强依赖 `getTask(tripoTaskId)` + 下载 GLB，Tripo 不可达即 502。

**修复方案**
- 前端 `CustomCharacterStudio.tsx`：Tripo 失败时保留 `failed` 任务态，展示「Tripo 连不上？先用占位模特创建人物 →」入口；点击后写入本地降级任务号 `local-fallback-<ts>`，`usingPlaceholder=true`，预览区显示占位说明，可继续填人设并保存。保存时带 `usePlaceholder:true`。
- 服务端 `custom-character-routes.ts`：抽出纯函数 `shouldUsePlaceholderFinalize({usePlaceholder, tripoTaskId})`；命中降级时跳过 Tripo 查询/下载/全身判定，`modelPath=""`（前端 `customToUi` 对空 model 回退占位胶囊/NeutralMannequin），头像仍落盘。

**验证**
- 新测试 `custom-character-fallback.test.ts`（4 例）：显式占位 / `local-fallback-*` / 真实任务号 / 空号 四种分支。
- 降级人物 `modelPath=""` → 场景 NPC 渲染自动回退占位胶囊（`SceneRunner` 已有 `url ? <NpcModel/> : <capsule/>`）。

## 功能 2：TTS 语音播放

**走查清单**：名人发言 → `/api/tts` → 播放 → 音色与气质匹配。

**走查结果（无需改码，已健康）**
- `tts.ts`：单例 `currentAudio`，全局同时只播一段；同文本再点即停；失败 `reject` 由调用方 catch，不崩溃。
- `TtsPlayButton.tsx`：`try/catch/finally`，错误写入 `title`，loading/playing 态正确。
- `character-voices.ts`：100 个名人全部有 `voice` 字段，且取值全部落在 `VOICE_WHITELIST`（去重后 11 个音色均在白名单）；`resolveCharacterVoice` 对 custom-/法庭角色/未知 id 均有兜底 `DEFAULT_VOICE`。
- 服务端 `/api/tts`：非法/越权音色自动回退默认音色重试一次。

## 功能 3：AI 帮写

**走查清单**：脱口秀「AI 帮写段子」→ 生成 → 可编辑/直接讲；法庭 AI 帮写案情；场景工作室 AI 优化描述。

**原问题**
- 脱口秀后端 `aiWriteJoke` + 路由 `POST /api/talkshow/ai-write` 均存在，但 `TalkshowShell.tsx` 表演面板没有任何按钮调用它——闭环缺最后一公里。
- 法庭 `draftStory`（AI 帮写案情）、场景 `polishSceneDescription`（AI 智能优化）按钮均已存在且带本地兜底，无需改动。

**修复方案**
- `TalkshowShell.tsx`：表演阶段输入框上方新增「✨ AI 帮写一段（可再编辑）」按钮 → `POST /api/talkshow/ai-write`（带当前话题）→ 结果填入 `myJoke` 文本框，玩家可继续编辑或直接「讲出去」。

**验证**
- 新测试 `talkshow-aiwrite.test.ts`（3 例）：LLM 成功返回清洗文本；LLM 抛错时回退本地兜底段子且回显主题、不 reject；缺省主题可用。

## 功能 4：Seedance 视频生成

**走查清单**：`VideoStudio.tsx` 提交 → 轮询 → 出片播放。

**原问题**
- 后端 `/api/video/generate` 仅把任务置 `queued`，没有真实视频 API 接入（桥接 `/result` 靠运行环境注入）。前端轮询无超时，`busy` 永久为 true，界面停在「正在排队生成…」。

**修复方案**
- `VideoStudio.tsx`：轮询加入 90s 总超时；超时后 `setBusy(false)` 并提示「视频生成服务暂未开放（功能开发中）。你的描述已保留」；网络异常分支同样在超时后优雅退出。不再无限转圈、不崩溃。

## 功能 5：自定义场景工作室

**走查清单**：自然语言 → SSE 蓝图 → 放置 NPC → 进入游玩 → 保存/分享。

**原问题（核心断点）**
- 后端 `POST /api/scenes/generate` 的 SSE 事件（stage/asset/blueprint/done）**从不携带 sceneId**。前端 `generateScene` 靠 SSE 事件捕获 sceneId，结果恒为 `undefined` → 生成后 `record=null` → step3 「保存/发布」一律提示「场景尚未持久化，无法保存」；摆放 NPC/结构也静默退化为仅本地。

**修复方案**
- shared `SceneGenerateEvent` 的 `stage` 事件增加可选 `sceneId?: string`。
- 后端 `scene-routes.ts`：首个 `planning` stage 事件与末尾 `done` stage 事件都带上 `scene.id`。
- 前端 `captureId` 已兼容 `event.sceneId`，无需改动；生成完成即 `getScene(sceneId)` 回填 record，保存/发布/进游玩全部打通。

**验证**
- 新测试 `sse-sceneid.test.ts`（3 例）：planning/done stage 事件携带 sceneId 可解析；非法 JSON 返回 null 不抛错。

---

## 无法修复项的降级说明
- **Tripo 云端不可达**（已知死路）：不强行接通，改为「占位模特」降级——人物可完整创建、入库、出现在人物馆、被带入法庭/广场/场景（3D 用占位胶囊/mannequin 渲染），后续 Tripo 恢复后可重新生成。
- **Seedance 未接入**：保留提交/轮询 UI，但以 90s 超时明确告知「功能开发中」，不再假排队。

## 变更文件
- `packages/shared/src/scene-studio.ts`
- `apps/api/src/scene-studio/scene-routes.ts`
- `apps/api/src/custom-character-routes.ts`
- `apps/web/src/CustomCharacterStudio.tsx`
- `apps/web/src/TalkshowShell.tsx`
- `apps/web/src/VideoStudio.tsx`
- 新增测试：`apps/api/src/custom-character-fallback.test.ts`、`apps/api/src/talkshow-aiwrite.test.ts`、`apps/web/src/scene-studio/sse-sceneid.test.ts`
