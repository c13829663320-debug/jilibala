# 人物 GLB 绑定规范（R4-10）

本规范约束所有名人半身像 GLB（`apps/web/public/models/characters/<id>.glb`）在
**建模/导出（Blender）→ Tripo 批量生成 → Three.js 运行时加载** 三个环节的一致性，
确保导入后骨骼、材质、动画可被前端正确识别。

校验工具：`scripts/glb-validate.ts`（纯 Node 二进制解析，零三方依赖）。

---

## 1. 文件与命名

| 项 | 规范 |
|---|---|
| 格式 | glTF 2.0，二进制容器 **.glb**（单文件，内嵌 BIN chunk） |
| 路径 | `apps/web/public/models/characters/<id>.glb` |
| 文件名 | 与 `packages/shared/src/celebrities.ts` 的 `id` 完全一致（小写、`-` 连接） |
| 坐标 | Y-up，角色朝向 +Z，脚底/骨盆原点位于 (0,0,0)，身高约 1.6~1.8 个单位 |

## 2. 骨骼（Armature）规范

- 骨骼根节点必须命名为 **`Armature`**（glTF `nodes[].name === "Armature"`）。
- 至少包含一个 `skin`，`skin.joints` 数量 **> 0**（半身像建议 ≥ 15 根）。
- 骨骼命名约定：
  - 躯干：`Hips` → `Spine` → `Spine1` → `Spine2` → `Neck` → `Head`
  - 左臂：`LeftShoulder` → `LeftArm` → `LeftForeArm` → `LeftHand`
  - 右臂：`RightShoulder` → `RightArm` → `RightForeArm` → `RightHand`
  - 手指可选：`LeftHandIndex1` …（左撇子人物不强制）
- `Armature` 下的网格节点统一挂在 `Body` 节点下，便于整体显隐。

## 3. 材质规范（PBR）

- 必须使用 **PBR Metallic-Roughness**（`pbrMetallicRoughness`）。
- 必备通道：
  - `baseColorFactor` 或 `baseColorTexture`（基础色，sRGB）
  - `metallicFactor`（金属度，0~1；皮肤/布料 = 0）
  - `roughnessFactor`（粗糙度，0~1；皮肤 ≈ 0.6）
- 纹理尺寸建议：**1024×1024**（手机端），最多 2048×2048。
- 禁止依赖外部贴图文件（`images[].uri` 指向 `*.png`），所有纹理必须内嵌为
  `bufferView`，保证单 .glb 可独立部署。
- 材质数量建议 ≤ 4（皮肤、头发、外衣、配饰）。

## 4. 动画规范

`animations` 中**至少包含**以下三个片段，命名严格一致：

| 动画名 | 用途 | 时长建议 |
|---|---|---|
| `Idle` | 待机呼吸/轻微晃动 | 2~3 s，可循环 |
| `Wave` | 挥手打招呼（开场白/入场） | 1.5~2 s，单次 |
| `Talk` | 说话时的口型/上身微动 | 1~2 s，可循环 |

> 运行时按 `animations[].name` 检索 clip；缺省会回退到 `Idle`。

## 5. 面数与性能

| 指标 | 建议 | 告警阈值 |
|---|---|---|
| 三角面数 | ≤ 20,000（半身像） | > 50,000 时 `glb-validate` 给 warning |
| 顶点数 | ≤ 10,000 | — |
| 总文件大小 | ≤ 8 MB | > 15 MB 需压缩 |
| Draw call | ≤ 3（合并网格） | — |

## 6. Three.js 加载示例

```ts
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const glb = await loader.loadAsync("/models/characters/confucius.glb");

const root = glb.scene;
// 1. 找骨骼根
const armature = root.getObjectByName("Armature");
// 2. 动画：用名字取 clip
const mixer = new THREE.AnimationMixer(root);
const clips = glb.animations; // [{ name: "Idle" }, { name: "Wave" }, { name: "Talk" }]
const play = (name: string) => {
  const clip = clips.find((c) => c.name === name) ?? clips[0];
  mixer.clipAction(clip).reset().play();
};
play("Idle");
// 3. PBR 材质已在 GLB 内，无需额外设置；如需换色遍历 mesh.material
```

## 7. 本地校验命令

```bash
# dry-run 批量生成（无 API key 也能跑）
npx tsx scripts/tripo-batch.ts input.json --dry-run --out apps/web/public/models/characters

# 校验单个 GLB
npx tsx scripts/glb-validate.ts apps/web/public/models/characters/confucius.glb
```

退出码：`0` = 通过；`1` = 有 error；`2` = 用法错误。
