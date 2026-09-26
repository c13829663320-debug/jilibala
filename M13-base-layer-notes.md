# M13 基础层交付说明（供后续页面合并子代理复用）

## 1. CSS 设计 Token
- 文件：`apps/web/src/design-tokens.css`（已在 `main.tsx` 中于 `styles.css` 之前引入）
- 关键变量：`--bg #0A0A0A`；高程 `--s1..--s4`；墨色 `--ink / --ink-100/70/48/30`；
  结构线 `--hair / --hair-2`；accent 青绿 `--accent #4fb3a5` / `--accent-soft` / `--accent-line`；
  玻璃三档 `--glass-hairline / --glass-frost / --solid`；圆角 `--r-xs..--r-xl`。
- 玻璃通用类：`.glass-hairline` / `.glass-frost` / `.glass-solid`，含 `@supports` 降级。

## 2. 明黄 → 青绿替换
- 全局把 `#FFD600/#FFD60A/#ffd60a` 及陪衬 `#FDE047`、`rgba(255,214,0,*)` 替换为
  `#4fb3a5` / `rgba(79,179,165,*)`。共改 25 个 CSS/TSX + `character-gallery.ts`。
- **有意保留金色**（特殊语义，勿当残留）：
  - `styles.css` `.certificate` 块（证书）
  - `MyPage.tsx` 证书/印章 SVG（98–122 行）
  - `identity.tsx:83` `capsuleColors` 玩家多色调色板（世界层内容色）
  - 暖 parchment 系（`#e8c53a/#f6c468` 等，法庭暖调，留给后续主题子代理）

## 3. 场景物件模型（已压缩，位于 `apps/web/public/models/`）
| 文件 | 压缩前 MB | 压缩后 MB | tripo_part 节点数 |
| --- | --- | --- | --- |
| home-court.glb | 58.37 | 2.81 | 4 |
| home-talk.glb | 57.71 | 2.50 | 8 |
| home-werewolf.glb | 56.41 | 2.99 | 16 |
| home-bar-neon.glb | 52.58 | 2.61 | 15 |
| home-gym.glb | 55.65 | 2.82 | 7 |
| home-library.glb | 56.64 | 2.59 | 15 |

- 管线：`EXT_meshopt_compression + EXT_texture_webp + KHR_mesh_quantization`，
  `--flatten false --join false` 以保留 `tripo_part_N` 节点名（RoomEntry 待机动画
  bob/slide/swing/spin/glow 直接按此名查找）。
- 场景映射（供 RoomEntry 接线）：court→home-court, talkshow→home-talk,
  werewolf→home-werewolf, bar→home-bar-neon, gym→home-gym, library→home-library。
  当前 RoomEntry 仍引用 `/models/buildings/*.glb` 小占位，换模型由后续子代理负责。

## 4. 名人模型
- 路径两边一致：`/models/celebrities/<name>.glb`（20 个）。
- 当前工程版本普遍比 upload-dist 更小（0.51–1.42MB vs 0.9–2.37MB），**择优保留当前工程版**，
  无需拷贝、无需改动引用。
