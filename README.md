# BalaBala 趣味法庭 MVP

当前目标是先跑通单人 Web 闭环：输入一件生活小事 → 6 步庭审事件流 → 3D 法庭 → 结构化判决书。多人联机、WebRTC、社区和付费功能后置。

## 本地启动

在项目根目录复制 `.env.example` 为 `.env`，填入服务端密钥。密钥只给 API 服务使用，前端不会读取 `VITE_*` 之外的环境变量。

```powershell
npm install
npm run dev:api   # Fastify API: http://localhost:8787
npm run dev:web   # Vite Web: http://localhost:5173
```

如果当前网络无法访问 npm registry，安装会失败；恢复网络后重新运行即可。

## 当前接口

- `GET /health`：检查 API 以及 StepFun、EvoMap、Tripo 配置状态
- `POST /api/cases`：创建案件，body 为 `{ "input": "..." }`
- `GET /api/cases/:id/trial/stream`：SSE 庭审事件流
- `POST /api/tripo/tasks`：提交 Tripo 文字或图片生成任务
- `GET /api/tripo/tasks/:taskId`：查询 Tripo 任务
- `GET /api/tripo/tasks/:taskId/download`：重定向到模型资产
- `POST /api/avatars/generate`：前端使用的文字生成分身兼容接口

## 模型路由

庭审生成使用统一的结构化 JSON 协议。服务端按以下顺序调用：

1. StepFun：`https://api.stepfun.com/v1`
2. EvoMap：`https://api.evomap.ai/v1`
3. 本地 Mock：外部模型不可用时仍能完成演示

这样切换模型只需要修改 `.env`，不需要改庭审流程。输出会经过 JSON 提取和字段校验，失败自动进入下一路由。

## Tripo3D

Tripo 使用异步任务：提交文字描述或图片 URL，得到 `taskId`，前端轮询任务状态，完成后读取模型资产地址。MVP 先把模型生成作为独立流程，不阻塞快速开庭；后续再将完成的 GLB/VRM 绑定到法庭角色。

## 3D 场景制作

平台入口和趣味法庭目前使用 Three.js + React Three Fiber 实时渲染，法庭场景按暖木色法庭参考图搭建了法官高台、原被告席、陪审团席、旁听排、徽章、吊灯和暖色体积层次。仓库同时提供 Blender 5.2 场景生成脚本，安装 Blender 后可运行：

```powershell
blender -b --python tools/blender/courtroom_scene.py
```

脚本会生成 `balabala_courtroom.blend` 和 `balabala_courtroom.glb`，后续可替换前端 `Courtroom` 组件中的程序化几何，作为平台的高质量场景资产。

## 下一步开发顺序

1. 安装依赖并在浏览器验收当前 3D 法庭和庭审流。
2. 加 PostgreSQL 持久化用户、Avatar、案件、庭审事件和判决书。
3. 加 Avatar 选择页和 Tripo 图片上传任务。
4. 将 GLB/VRM 资产接入 R3F，加入表情、动作和说话高亮。
5. 生成判决书分享图和案卷库。
6. 增加输入/输出审核、隐私删除和心理风险分级。
