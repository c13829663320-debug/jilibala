/**
 * 场景资产构建器（Scene Studio）。
 *
 * 职责：
 *  1. 内置资产库映射：把常见 kind 映射到 apps/web/public/models/ 下已有的 GLB。
 *  2. Tripo 文生 3D：库未命中时调用 Tripo 文生模型，轮询、下载、归一化后落盘。
 *  3. 模型归一化：场景物按「最大边」缩放到目标尺寸（默认 3 米），落地 + x/z 居中。
 *
 * 库命中的资产直接复用现有 GLB，不做归一化（normalized=false）；
 * Tripo 生成的资产归一化后保存到 /models/scenes/<sceneId>/ 下。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SceneAssetLibraryItem } from '@balabala/shared'
import { createTextTask, getTask, findAssetUrl, TripoError } from '../tripo.js'
import { createCharacterIO } from '../normalize-character-model.js'

// ===== 对外结果类型 =====

export interface SceneAssetBuildResult {
  /** 可直接被前端加载的 URL（/models/... 或 /models/scenes/...） */
  url: string
  /** Tripo 任务 id（库命中时为空串） */
  tripoTaskId: string
  source: 'library' | 'tripo' | 'parametric'
  /** 是否经过归一化处理 */
  normalized: boolean
}

// ===== 内置资产库 =====

/**
 * 内置资产库：kind -> 现有 GLB 的映射。
 *
 * path 相对 /models/（即 apps/web/public/models/）。
 * 仅收录「磁盘上确实存在 GLB」的 kind；tree/rock/bridge/well/tower/statue/fountain
 * 等常见场景物暂无现成模型，resolveLibraryAsset 会返回 null，走 Tripo 生成。
 *
 * 建筑类体量大，defaultScale 用 [2,2,2] 并标记 landmark。
 */
const SCENE_ASSET_LIBRARY: SceneAssetLibraryItem[] = [
  // 酒馆 / 酒吧
  { kind: 'tavern', label: '酒馆', path: 'buildings/bar.glb', defaultScale: [2, 2, 2], landmark: true },
  { kind: 'bar', label: '酒吧', path: 'buildings/bar.glb', defaultScale: [2, 2, 2], landmark: true },
  // 房屋 / 庭院（复用 court.glb）
  { kind: 'house', label: '房屋', path: 'buildings/court.glb', defaultScale: [2, 2, 2], landmark: true },
  { kind: 'court', label: '庭院', path: 'buildings/court.glb', defaultScale: [2, 2, 2], landmark: true },
  // 健身房
  { kind: 'gym', label: '健身房', path: 'buildings/gym.glb', defaultScale: [2, 2, 2], landmark: true },
  // 图书馆
  { kind: 'library', label: '图书馆', path: 'buildings/library.glb', defaultScale: [2, 2, 2], landmark: true },
  // 剧场 / 舞台（复用 talkshow.glb）
  { kind: 'theater', label: '剧场', path: 'buildings/talkshow.glb', defaultScale: [2, 2, 2], landmark: true },
  { kind: 'stage', label: '舞台', path: 'buildings/talkshow.glb', defaultScale: [2, 2, 2], landmark: true },
  // 小屋 / 狼人场景（复用 werewolf.glb）
  { kind: 'lodge', label: '小屋', path: 'buildings/werewolf.glb', defaultScale: [2, 2, 2], landmark: true },
]

/** 返回内置资产库（防御性拷贝，避免外部修改内部数组）。 */
export function getSceneAssetLibrary(): SceneAssetLibraryItem[] {
  return SCENE_ASSET_LIBRARY.map((item) => ({
    ...item,
    defaultScale: [...item.defaultScale] as [number, number, number],
  }))
}

function normalizeKind(kind: string): string {
  return kind.trim().toLowerCase().replace(/[\s_\-]+/g, '')
}

/**
 * 模糊匹配 kind 到资产库条目。
 * 匹配规则：精确 kind 相等 > 双向包含（库 kind 是输入 kind 的子串，或反之）。
 * 找不到（含 tree/rock/bridge/well/tower/statue/fountain 等无现成 GLB 的 kind）返回 null。
 */
export function resolveLibraryAsset(kind: string): SceneAssetLibraryItem | null {
  if (!kind || typeof kind !== 'string') return null
  const input = normalizeKind(kind)
  if (!input) return null

  // 1) 精确匹配
  for (const item of SCENE_ASSET_LIBRARY) {
    if (normalizeKind(item.kind) === input) return item
  }
  // 2) 双向包含模糊匹配
  for (const item of SCENE_ASSET_LIBRARY) {
    const k = normalizeKind(item.kind)
    if (input.includes(k) || k.includes(input)) return item
  }
  return null
}

// ===== 模型归一化（纯函数部分，便于单测） =====

export type SceneBBox = {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
}

/**
 * 计算缩放系数 k = targetMaxDim / max(W, H, D)。
 * 场景物按最大边归一化（不像角色按身高）。零尺寸/空模型保护。
 */
export function computeSceneScale(bbox: SceneBBox, targetMaxDim = 3): number {
  const w = bbox.maxX - bbox.minX
  const h = bbox.maxY - bbox.minY
  const d = bbox.maxZ - bbox.minZ
  const maxDim = Math.max(w, h, d)
  if (!isFinite(maxDim) || maxDim <= 0) return 1
  return targetMaxDim / maxDim
}

/**
 * 计算 wrapper node 的平移：y 落地（-k*minY），x/z 居中。
 */
export function computeSceneTranslation(bbox: SceneBBox, scale: number): [number, number, number] {
  return [
    -scale * (bbox.minX + bbox.maxX) / 2,
    -scale * bbox.minY,
    -scale * (bbox.minZ + bbox.maxZ) / 2,
  ]
}

// ===== 模型归一化（gltf-transform） =====

type RawBBox = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

const EMPTY_BBOX: RawBBox = {
  minX: Infinity, minY: Infinity, minZ: Infinity,
  maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
}

/** 列主序 mat4 × 点（含透视除 w）。 */
function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]
  const invW = w !== 0 ? 1 / w : 1
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) * invW,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * invW,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * invW,
  ]
}

/** 遍历所有 node，用世界矩阵变换 POSITION 顶点，求世界 bbox。 */
function computeWorldBBox(doc: import('@gltf-transform/core').Document): RawBBox {
  const bbox: RawBBox = { ...EMPTY_BBOX }
  const nodes = doc.getRoot().listNodes()
  if (nodes.length === 0) return bbox
  for (const node of nodes) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const worldMatrix = node.getWorldMatrix()
    if (!worldMatrix || worldMatrix.length < 16) continue
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION')
      if (!position) continue
      const arr = position.getArray()
      if (!arr) continue
      const count = position.getCount()
      for (let i = 0; i < count; i++) {
        const [wx, wy, wz] = transformPoint(worldMatrix, arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])
        if (wx < bbox.minX) bbox.minX = wx
        if (wy < bbox.minY) bbox.minY = wy
        if (wz < bbox.minZ) bbox.minZ = wz
        if (wx > bbox.maxX) bbox.maxX = wx
        if (wy > bbox.maxY) bbox.maxY = wy
        if (wz > bbox.maxZ) bbox.maxZ = wz
      }
    }
  }
  return bbox
}

export type SceneNormalizeResult = { glb: Uint8Array; scale: number }

/**
 * 读取 GLB binary，计算世界 bbox，用 wrapper node 包裹所有 root nodes 做无损变换：
 *   scale = k（k = targetMaxDim / max(W,H,D)）
 *   translation.y = -k * minY（落地），x/z 居中
 * 不做全身判定（场景物不需要）。复用 createCharacterIO() 的扩展/解码器配置。
 */
export async function normalizeSceneModel(
  glbBytes: Uint8Array,
  targetMaxDim = 3,
): Promise<SceneNormalizeResult> {
  const io = await createCharacterIO()
  const doc = await io.readBinary(new Uint8Array(glbBytes))

  const bbox = computeWorldBBox(doc)
  if (!isFinite(bbox.minX) || !isFinite(bbox.maxX)) {
    throw new Error('场景模型几何为空：未找到任何 POSITION 顶点。')
  }

  const scale = computeSceneScale(bbox, targetMaxDim)

  const root = doc.getRoot()
  const scene = root.listScenes()[0] ?? root.getDefaultScene() ?? doc.createScene()
  const wrapper = doc.createNode('scene-asset-wrapper')
  wrapper.setScale([scale, scale, scale])
  wrapper.setTranslation(computeSceneTranslation(bbox, scale))

  // 把 scene 下原有 root children 移到 wrapper 下
  for (const child of scene.listChildren()) {
    scene.removeChild(child)
    wrapper.addChild(child)
  }
  scene.addChild(wrapper)

  const glb = await io.writeBinary(doc)
  return { glb, scale }
}

// ===== Tripo 资产生成 =====

const TRIPO_PROMPT_SUFFIX = '，游戏道具，简洁低多边形风格，孤立物体，白色背景'
const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Tripo 资产落盘根目录（apps/api cwd -> ../web/public/models/scenes）。 */
function scenesRootDir(): string {
  return path.resolve(process.cwd(), '..', 'web', 'public', 'models', 'scenes')
}

/**
 * 构建场景结构资产：
 *  1. 先查内置资产库，命中直接返回库路径（不归一化）。
 *  2. 未命中：Tripo 文生 -> 轮询 -> 下载 GLB -> 归一化 -> 落盘。
 *
 * 下载失败/超时/任务失败均抛带明确消息的 Error，调用方捕获后 SSE 推送 asset failed。
 */
export async function buildSceneStructureAsset(opts: {
  prompt: string
  kind: string
  sceneId: string
  onProgress?: (msg: string) => void
}): Promise<SceneAssetBuildResult> {
  const { prompt, kind, sceneId, onProgress } = opts

  // 1) 内置库命中
  const library = resolveLibraryAsset(kind)
  if (library) {
    onProgress?.(`命中内置资产库：${library.label}（${library.path}）`)
    return {
      url: `/models/${library.path}`,
      tripoTaskId: '',
      source: 'library',
      normalized: false,
    }
  }

  // 2) Tripo 文生任务
  onProgress?.(`内置库未命中「${kind}」，提交 Tripo 文生任务…`)
  const task = await createTextTask(`${prompt}${TRIPO_PROMPT_SUFFIX}`)
  const taskId = task.task_id
  if (!taskId) {
    throw new TripoError('Tripo 任务创建成功但未返回 task_id。', 502, task)
  }

  // 3) 轮询
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let finalTask = task
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    let current: typeof task
    try {
      current = await getTask(taskId)
    } catch (err) {
      throw new TripoError(`轮询 Tripo 任务失败：${err instanceof Error ? err.message : String(err)}`)
    }
    finalTask = current
    const status = String(current.status ?? '')
    const progress = typeof current.progress === 'number' ? current.progress : 0
    onProgress?.(`Tripo 生成中：status=${status} progress=${progress}%`)
    if (status === 'success') break
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      throw new TripoError(`Tripo 模型生成失败（status=${status}）。`, 502, current)
    }
  }

  if (String(finalTask.status ?? '') !== 'success') {
    throw new TripoError(`Tripo 模型生成超时（${POLL_TIMEOUT_MS / 1000} 秒未完成，status=${String(finalTask.status ?? '')}）。`)
  }

  // 4) 取下载 URL
  const downloadUrl = findAssetUrl(finalTask)
  if (!downloadUrl) {
    throw new TripoError('Tripo 任务成功但未找到可下载的模型 URL。', 502, finalTask)
  }

  // 5) 下载 GLB binary
  onProgress?.('下载 Tripo 模型 GLB…')
  let resp: Response
  try {
    resp = await fetch(downloadUrl)
  } catch (err) {
    throw new Error(`下载 Tripo 模型失败：${err instanceof Error ? err.message : String(err)}`)
  }
  if (!resp.ok) {
    throw new Error(`下载 Tripo 模型失败：HTTP ${resp.status} ${resp.statusText}`)
  }
  const buf = await resp.arrayBuffer()
  const glbBytes = new Uint8Array(buf)

  // 6) 归一化（最大边 3 米）
  onProgress?.('归一化场景模型（最大边 3 米）…')
  const { glb } = await normalizeSceneModel(glbBytes, 3)

  // 7) 落盘
  const dir = path.join(scenesRootDir(), sceneId)
  mkdirSync(dir, { recursive: true })
  const filename = `${kind}-${taskId.slice(0, 8)}.glb`
  writeFileSync(path.join(dir, filename), glb)

  onProgress?.(`场景资产已保存：${filename}`)
  return {
    url: `/models/scenes/${sceneId}/${filename}`,
    tripoTaskId: taskId,
    source: 'tripo',
    normalized: true,
  }
}
