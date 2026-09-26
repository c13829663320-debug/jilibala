# 化身 GLB 绑定规范（Avatar GLB Binding Spec）

> 版本：1.0 · 适用范围：`apps/web` 广场/人物馆可动化身、`apps/api` 自定义人物 finalize 入库。
> 本文是 **产出方**（美术 / Tripo 云端 / 导入脚本）与 **消费方**（Three.js 运行时 `avatar-rig.ts` / 校验器 `glb-validator.ts`）之间的契约。
> 所有入库 GLB 必须通过 `scripts/windows/validate-glb.mjs` 与服务端 `validateGlb()`；校验失败由 `POST /api/custom-characters/finalize` 返回 **422**。

---

## 1. 容器与编码

| 项 | 规范 | 强制 |
|---|---|---|
| 格式 | 单个二进制 `.glb`（glTF 2.0），禁止 `.gltf + 外部 .bin/.png` 散文件 | 是 |
| magic | `0x46546C67`（"glTF"） | 是（校验 `BAD_MAGIC`） |
| version | `2` | 是（校验 `BAD_VERSION`） |
| chunk | JSON chunk 在前、BIN chunk 在后；长度 4 字节对齐 | 是（校验 `CHUNK_OVERFLOW`） |
| 压缩 | 允许 Draco / Meshopt 扩展（运行时已注册 decoder）；新模型优先 Meshopt | 建议 |
| 大小 | 单个 LOD0 化身 ≤ 8 MB（含贴图） | 建议 |

---

## 2. 单位 / 朝向 / 缩放

运行时约定（与 `normalize-character-model.ts`、`CharacterGallery3D.tsx` 对齐）：

- **单位：米**。归一化后身高 **1.75 m**（`NORMALIZE_TARGET_HEIGHT`），脚落在 `y = 0`。
- **朝向：+Z 为正面**（面朝相机 / 交互对象方向），Y 轴向上，右手系。
  - Tripo 导出常朝 +X，入库前统一绕 Y 轴 **−90°**（见 `CharacterGallery3D.BoothModel`）。
- **居中：根节点在 x=0, z=0**（`normalize-character-model.ts` 用 wrapper node 做无损平移）。
- **缩放：均匀**，禁止非均匀拉伸；wrapper 节点名 `character-wrapper`。
- **世界原点即脚底**：不要把模型原点放在胯部或中心；归一化器会自动算 bbox。

> 不满足以上三点会被归一化器修正，但 **骨骼动画需要正确的 Hips 高度**，因此产出方仍应尽量按此建模。

---

## 3. 骨骼命名约定（Mixamo / VRM 兼容）

若化身需要可动（走路 / 手势 / 口型），GLB 必须包含 **skin 蒙皮**，且 joint 节点名命中下表。
校验器 `missingCoreBoneGroups()` 做大小写不敏感 + 去符号匹配；**核心三组缺一即报 `MISSING_CORE_BONES` error**。

### 3.1 核心骨（必填，缺即拒绝入库）

| 语义 | 规范名（首选） | 接受的别名 |
|---|---|---|
| 骨盆 | `Hips` | `hip`, `pelvis`, `hipSpine`, `root` |
| 脊柱 | `Spine` | `spine1`, `spine2`, `spine0`, `chest`, `upperChest`, `torso` |
| 头部 | `Head` | `neck`, `neck1` |

> 运行时 `avatar-rig.ts` 还会按别名探测 `head` / `jaw` / `armL` / `armR` / `body`，用于程序化姿势叠加。

### 3.2 推荐完整骨架（Mixamo 命名，左/右对称）

```
Hips
├─ Spine
│  ├─ Spine1
│  │  ├─ Spine2
│  │  │  ├─ Neck
│  │  │  │  └─ Head
│  │  │  ├─ ShoulderL ─ UpperArmL ─ LowerArmL ─ HandL
│  │  │  └─ ShoulderR ─ UpperArmR ─ LowerArmR ─ HandR
├─ UpperLegL ─ LowerLegL ─ FootL ─ ToBaseL
└─ UpperLegR ─ LowerLegR ─ FootR ─ ToBaseR
```

- 命名 **左 `L` / 右 `R` 后缀**（Mixamo 风格）；VRM 用小写 `_l`/`_r` 亦可。
- 根骨骼 `Hips` 应为 scene 下唯一蒙皮根；禁止把多个蒙皮根平铺。
- 静态展示模型（人物馆 C 位摆件）**允许无 skin**，校验器仅 warning（`NO_SKELETON`）。

---

## 4. Blendshape（Morph Target）命名表

面部表情 / 口型由 morph target 驱动。运行时 `avatar-rig.ts` 按下表别名做小写匹配；产出方 **至少提供 `jawOpen`** 以支持说话口型。

| 语义 key | 推荐名 | 接受别名 | 用途 |
|---|---|---|---|
| `jawOpen` | `jawOpen` | `jaw_open`, `mouthOpen`, `mouth_open` | 说话张嘴（主） |
| `mouthOpen` | `mouthOpen` | `mouth_open` | 备用口型 |
| `eyeBlinkLeft` | `eyeBlinkLeft` | `eye_blink_left`, `blinkLeft` | 眨眼 |
| `eyeBlinkRight` | `eyeBlinkRight` | `eye_blink_right`, `blinkRight` | 眨眼 |
| `browUpLeft` | `browUpLeft` | `brow_up_left`, `browInnerUpLeft` | 惊讶/笑抬眉 |
| `browUpRight` | `browUpRight` | `brow_up_right`, `browInnerUpRight` | 惊讶/笑抬眉 |

建议（非强制）：`smile`, `sad`, `angry`, `puff`。所有 morph target 权重范围 **0.0 ~ 1.0**。

---

## 5. 材质 slot 约定

每个可换装部位应是 **独立 material / mesh primitive**，命名以 slot 前缀开头，便于后续换装系统按名替换贴图：

| slot 名 | 部位 | 必需 | PBR 要求 |
|---|---|---|---|
| `body` | 皮肤（脸/颈/手/腿） | 是 | `baseColorFactor` RGBA ∈ [0,1]；建议带 `normalTexture` |
| `hair` | 头发 | 否 | `metallicFactor=0`, `roughnessFactor≈0.6` |
| `top` | 上衣 | 否 | 织物，`roughnessFactor≈0.9` |
| `bottom` | 下装 | 否 | 同上 |
| `shoes` | 鞋 | 否 | 皮革/鞋底，`roughnessFactor≈0.5` |
| `accessory` | 眼镜/帽子/饰品 | 否 | 金属件可 `metallicFactor≈1` |

- **PBR 规范**：必须使用 `pbrMetallicRoughness`；`baseColorFactor` 为 4 分量 RGBA 且每分量 ∈ [0,1]；`metallicFactor` / `roughnessFactor` ∈ [0,1]。越界报 error（`BASECOLOR_OUT_OF_RANGE` / `METALLIC_OUT_OF_RANGE` / `ROUGHNESS_OUT_OF_RANGE`）。
- 非 PBR（缺 `pbrMetallicRoughness`）仅 warning，但新模型不允许。
- 材质名即 slot：如 `body.skin`, `top.tshirt`。运行时按前缀匹配。

### 5.1 贴图引用完整性

- 所有 `texture.source` → `image` → `bufferView` → `buffer` 链路必须闭合。
- 内嵌贴图用 bufferView；禁止外部相对路径 URI 在 GLB 内（入库只收单文件）。
- 任一段越界报 error（`TEXTURE_MISSING_IMAGE` / `IMAGE_NO_SOURCE` / `IMAGE_BUFFERVIEW_MISSING` / `IMAGE_BUFFER_MISSING`）。
- 推荐贴图：baseColor（≤1024²）、normal、OR(metallic-roughness 合一)；sRGB 仅用于 baseColor。

---

## 6. LOD 命名约定

化身按相机距离分四级（见 `apps/web/src/avatar/avatar-lod.ts`）。多 LOD 模型命名：

| 层级 | 文件名后缀 | 三角面预算 | 动画更新 | 阴影 | 用途 |
|---|---|---|---|---|---|
| LOD0 近 | `*.glb`（主文件） | ≤ 150k | 每帧 | 开 | 名人 GLB / 对话特写 |
| LOD1 中 | `*.lod1.glb` | ≤ 40k | 每 2 帧 | 开 | 广场中距离 |
| LOD2 远 | `*.lod2.glb` | ≤ 5k（或胶囊体） | 每 4 帧 | 关 | 广场远处 |
| Culled | — | 0 | 停更 | 关 | 超 `maxRenderDistance` 完全不渲染 |

- 单文件多 LOD 用 glTF `MSFT_lod` 扩展；当前管线允许 **运行时程序化降级**（LOD1/2 用简化几何体，见 `LodAvatar.tsx`），不强制出三套文件。
- 三角面数硬上限 **500,000**（`DEFAULT_MAX_TRIANGLES`），超出报 `TOO_MANY_TRIANGLES`。

---

## 7. 校验规则 ↔ 错误码对照表

| 维度 | 错误码 | 级别 | 触发条件 |
|---|---|---|---|
| 文件完整性 | `FILE_TOO_SMALL` | error | < 12 字节 |
| 容器 | `BAD_MAGIC` / `BAD_VERSION` | error | 非 glTF / 非 v2 |
| chunk | `CHUNK_OVERFLOW` / `MISSING_JSON_CHUNK` / `FIRST_CHUNK_NOT_JSON` | error | chunk 结构损坏 |
| chunk | `MISSING_BIN_CHUNK` / `LENGTH_MISMATCH` | warning | 无 BIN / 长度不一致 |
| 几何 | `NO_GEOMETRY` | error | 零 primitive |
| 性能 | `TOO_MANY_TRIANGLES` | error | 三角面 > 500k |
| 骨骼 | `MISSING_CORE_BONES` | error | 有 skin 但缺 Hips/Spine/Head |
| 骨骼 | `NO_SKELETON` | warning | 无 skin（静态摆件） |
| 材质 | `NO_MATERIAL` / `NON_PBR_MATERIAL` | warning | 缺材质 / 非 PBR |
| 材质 | `BAD_BASECOLOR_FACTOR` / `BASECOLOR_OUT_OF_RANGE` / `METALLIC_OUT_OF_RANGE` / `ROUGHNESS_OUT_OF_RANGE` | error | PBR 因子非法 |
| 贴图 | `TEXTURE_MISSING_IMAGE` / `IMAGE_NO_SOURCE` / `IMAGE_BUFFERVIEW_MISSING` / `IMAGE_BUFFER_MISSING` | error | 引用断链 |

> 另有 **全身比例** 校验在 `normalize-character-model.ts`：半身/头像（H/W < 1.4 等）报 `NOT_FULL_BODY`，与本规范的 `INVALID_GLB` 并列返回 422。

---

## 8. 离线占位（云端 Tripo 不可达时）

本项目云端 Tripo 在开发环境不可达，**严禁伪造云端成功结果**。离线策略：

- 前端生成 `local-fallback-*` 任务号，服务端 `shouldUsePlaceholderFinalize()` 识别后跳过 Tripo 下载，写入占位人形（不落盘 GLB，`modelPath=""`）。
- Windows 脚本 `scripts/windows/photo-to-3d.ps1` 在无 `TRIPO_API_KEY` / 网络失败 / 任务失败时 **如实报错退出**，绝不产出假 GLB。
- 需要真实模型时：配置 `TRIPO_API_KEY` 后运行该脚本 → 自动调用 `validate-glb.mjs` 校验 → 通过后再入库。

---

## 9. 自检清单（交付前）

- [ ] 单文件 `.glb`，`glTF 2.0`，能被 `gltf-transform readBinary` 打开。
- [ ] 身高 ≈ 1.75 m，脚 y=0，正面朝 +Z。
- [ ] 可动化身含 skin，且 joint 名命中 Hips/Spine/Head（建议完整 Mixamo 骨架）。
- [ ] 至少有 `jawOpen` blendshape。
- [ ] 材质按 body/hair/top/bottom/shoes/accessory 分 slot，PBR 因子 ∈ [0,1]。
- [ ] 贴图全部内嵌、引用闭合，baseColor ≤ 1024²。
- [ ] 三角面 ≤ 500k（LOD0 建议 ≤ 150k）。
- [ ] `node scripts/windows/validate-glb.mjs model.glb --pretty` 输出 `PASS ✓`。
