# 叽里呱啦 PWA 与离线能力说明

本文档说明 `apps/web` 的 PWA 配置、缓存策略、离线降级行为，以及如何在浏览器与移动端验证。

技术栈：Vite 5 + React 18 + Three.js，PWA 由 `vite-plugin-pwa@^1.3.0`（Workbox `generateSW` 模式）驱动。

---

## 1. PWA 功能清单

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 可安装（Add to Home Screen） | ✅ 已启用 | `display: standalone`，含 any/maskable 双套图标，manifest 字段完整 |
| 离线访问 App Shell | ✅ 已启用 | 构建产物 JS/CSS/HTML 与小图标走 precache + NetworkFirst |
| 离线降级页 | ✅ 已启用 | 导航失败时回退到 `/offline.html`（黑底 + 明黄 + 青绿） |
| SW 自动更新 + 用户提示 | ✅ 已启用 | `registerType: 'autoUpdate'`，更新就绪时弹出明黄提示条 |
| 推送通知（Push） | 🟡 预留 | SW 已就位，后续可接入 Push API + 后端推送，当前未启用 |
| 后台同步（Background Sync） | 🟡 预留 | 离线时写操作暂存待恢复，当前未启用 |

manifest 关键字段：
`name=叽里呱啦 · BalaBala`、`short_name=叽里呱啦`、`display=standalone`、
`orientation=any`、`lang=zh-CN`、`theme_color/background_color=#000000`、
`categories=[entertainment, social, games]`、`screenshots`（主视觉 / 开庭）。

---

## 2. 缓存策略说明

### 2.1 Precache（构建时预缓存）

由 `workbox.globPatterns = ['**/*.{html,js,css,ico,jpg,png,svg,woff,woff2}']` 决定，
把 Vite 产出的全部 JS/CSS/HTML、以及 `public/` 下的小图标/头像/场景缩略图等纳入预缓存。

- `globIgnores = ['**/*.glb', '**/models/**', '**/promo/**']`：3D 大模型与推广图不进 precache。
- `maximumFileSizeToCacheInBytes = 8 MiB`：单文件超过 8MB 不预缓存。
- `includeAssets`：额外预缓存 `brand/balabala-logo.jpg` 与四枚图标。
- `cleanupOutdatedCaches = true`：新版本 SW 激活时自动清理旧缓存。

构建实测：`precache 145 entries`（约 17MB），产物含 `dist/sw.js`、`dist/workbox-*.js`、
`dist/manifest.webmanifest`、`dist/offline.html`。

### 2.2 Runtime Caching（运行时缓存）

| 资源 | 策略 | cacheName | 理由 |
| --- | --- | --- | --- |
| `*.glb` / `/models/**` | **NetworkOnly** | — | 3D 模型体积大、版本更新频繁，永不缓存，避免占用磁盘且保证更新及时 |
| `/brand/**` | **NetworkFirst**（3s 超时） | brand-assets | 品牌 logo 改版后立即生效，离线时回退缓存 |
| `request.destination === 'image'` | **StaleWhileRevalidate** | images | 头像/缩略图优先秒开，后台静默更新 |
| `request.destination === 'font'` | **CacheFirst** | fonts | 字体稳定，长期缓存（30 天），省流量 |
| script / style / navigate | **NetworkFirst**（3s 超时） | static-resources | 保证 JS/CSS/HTML 拿到新版本，离线时回退缓存 |

### 2.3 导航离线兜底

`workbox.navigateFallback = '/offline.html'`，并通过 `navigateFallbackDenylist`
排除 `/api/`、`/models/`、`/brand/`、`/icons/`、`/portraits/`、`/videos/`、`/skills/`，
避免这些路径被错误替换成离线页。`offline.html` 已被 precache，断网时可直接返回。

---

## 3. 离线降级行为

- **可离线使用**：App 外壳、已缓存的 JS/CSS、图标、头像、场景缩略图、品牌图。
  再次打开应用时，界面框架与静态资源可在无网时渲染。
- **受限功能（需联网）**：
  - 3D 场景加载：`/models/**` 全部 NetworkOnly，断网时模型无法加载，3D 广场/法庭会停留在加载态或错误态。
  - 实时联机：WebSocket（`/api` 的 `ws: true`）断网即断开，连麦/多人法庭不可用。
  - LLM / AI 对话：调用后端 API，需联网。
  - 发布、个人资料、战绩等所有 `/api/**` 请求需联网。
- **3D 模型不缓存的原因**：`.glb` 文件数量多、单文件可达数 MB~数十 MB，全集体积巨大；
  且模型会随内容迭代更新，缓存反而会导致旧模型长期驻留。因此一律 NetworkOnly，
  既节省用户磁盘，又保证下次联网时拿到最新模型。
- 当导航请求完全失败且无缓存 HTML 时，浏览器展示 `/offline.html`：
  黑底 `#000000`、标题与按钮用明黄 `#FFD700`、徽标用青绿 `#00CED1`，
  文案「当前离线，部分功能不可用」，提供「重新连接」按钮（点击刷新）；
  监听 `online` 事件，网络恢复后自动刷新。

---

## 4. 浏览器验证步骤（Chrome / Edge）

1. `npm run build --workspace apps/web` 后，用静态服务器预览 `apps/web/dist`
   （如 `npx serve dist`），必须通过 **HTTPS 或 localhost** 访问（SW 要求安全上下文）。
2. 打开 DevTools → **Application** 面板：
   - **Manifest**：确认名称、图标、display、orientation、categories、screenshots 均被识别，无报错。
   - **Service Workers**：确认 `sw.js` 已注册且状态为 `activated and is running`。
3. 勾选 **Network → Offline**，保持 DevTools 打开。
4. 刷新页面：
   - App Shell 应能从缓存加载；
   - 直接访问一个未缓存的深层路由时，应看到黑底明黄的 `/offline.html` 离线提示页。
5. 取消 Offline 勾选，刷新恢复正常。

## 5. 移动端「添加到主屏幕」验证

### Android Chrome
- 通过 HTTPS 打开站点 → 浏览器菜单（⋮）→ **添加到主屏幕 / 安装应用**。
- 安装后桌面出现「叽里呱啦」图标，启动后为 standalone 全屏（无地址栏）。
- DevTools 的 **Application → Manifest** 中 Lighthouse PWA 审计应为可安装。

### iOS Safari
- Safari 打开站点 → 分享按钮 → **添加到主屏幕**。
- 桌面图标启动后为独立窗口；iOS 对 manifest 支持有限，依赖 `apple-touch-icon`
  与 `apple-mobile-web-app-*` meta（已在 `index.html` 配置）。
- 注意：iOS 的后台离线缓存能力弱于 Android，复杂 3D 体验仍需联网。

---

## 6. SW 更新机制（autoUpdate）

- `registerType: 'autoUpdate'`：每次加载页面时，SW 在后台检查新 SW；
  一旦新 SW 下载并就绪，自动 `skipWaiting` 并接管，无需用户手动点。
- 用户提示：`src/pwa-update.tsx` 通过 `useRegisterSW` 监听 `needRefresh`，
  检测到新版本时屏幕底部弹出明黄提示条「有新版本可用，点击刷新」；
  点击后调用 `updateServiceWorker(true)` 激活新 SW 并刷新页面。
- 注册统一在该组件内完成（`main.tsx` 不再重复注册），避免重复注册问题。

---

## 7. 已知限制

- **3D 大模型不缓存**：`/models/**` 全部 NetworkOnly，弱网/离线无法进入 3D 场景。
- **WebSocket 离线不可用**：实时法庭/连麦依赖 `/api` 的 WebSocket，断网即中断。
- **LLM / 后端 API 需联网**：所有 `/api/**` 请求不做离线兜底。
- **推送通知未启用**：SW 已就位，但后端 Push 服务与订阅流程尚未接入。
- **首包体积**：three/r3f chunk 较大（>500KB），已通过 manualChunks 拆分，
  首屏仍建议在弱网下观察加载体验。
- **iOS 离线能力受限**：iOS Safari 的 SW 缓存上限与生命周期与 Android 不同，
  离线降级页可用，但完整离线体验以 Android Chrome 为准。
