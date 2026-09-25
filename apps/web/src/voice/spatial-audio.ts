// ===== 社交临场感：空间音频纯逻辑层（无浏览器依赖，可在 Node 单测）=====
//
// 设计要点：
// 1. 距离衰减采用 Web Audio PannerNode 的 inverse 模型等价公式，便于与
//    PannerNode 的 distanceModel='inverse' 对齐，避免两套衰减听感不一致。
// 2. 订阅裁剪（pickSubscribers）只做"按距离排序 + 截断"的纯计算，
//    真正的 PeerConnection 建链/拆链由 useSpatialVoice 完成。
// 3. 方位角 computeStereoPan 假设本地玩家面向 -Z 轴（three.js 默认相机朝向），
//    X 正方向为右。返回值 -1（全左）~ 1（全右），可直接喂给 StereoPannerNode.pan。

export type Vec2 = { x: number; z: number }

/**
 * 反距离衰减增益。
 *
 * 公式（与 Web Audio PannerNode distanceModel='inverse' 对齐）：
 *   - distance <= 0                 → 1（贴脸最大声）
 *   - 0 < distance <= refDistance   → 1（参考距离内不衰减）
 *   - refDistance < distance < maxDistance → refDistance / (refDistance + rolloff*(distance-refDistance))
 *   - distance >= maxDistance       → 0（超出可听范围，直接静音）
 *
 * @param distance    本地与对端的水平距离（米/世界单位）
 * @param refDistance  参考距离，该距离内音量保持 1
 * @param maxDistance  最大可听距离，超出返回 0
 * @param rolloff      衰减系数，越大衰减越快（Web Audio 默认 1）
 */
export function computeDistanceGain(
  distance: number,
  refDistance: number,
  maxDistance: number,
  rolloff: number,
): number {
  // 边界防御：非法输入退化为最保守行为
  if (!Number.isFinite(distance)) return 0
  if (!Number.isFinite(refDistance) || refDistance <= 0) refDistance = 1
  if (!Number.isFinite(maxDistance) || maxDistance <= refDistance) maxDistance = refDistance
  if (!Number.isFinite(rolloff) || rolloff <= 0) rolloff = 1

  // 负值/零距视为贴脸
  if (distance <= 0) return 1
  // 超出最大距离直接静音（含边界）
  if (distance >= maxDistance) return 0
  // 参考距离内不衰减
  if (distance <= refDistance) return 1

  const gain = refDistance / (refDistance + rolloff * (distance - refDistance))
  // 钳制到 [0,1]，数值误差兜底
  return Math.min(1, Math.max(0, gain))
}

/**
 * 距离订阅裁剪：按距离升序，取最近 maxCount 个且距离 <= maxDistance 的 userId。
 *
 * @param localPos 本地玩家位置 {x,z}
 * @param peers    远端玩家位置表（key 为 userId）
 * @param maxCount 最多订阅多少个近端玩家
 * @param maxDistance 最大可听距离
 */
export function pickSubscribers(
  localPos: Vec2,
  peers: Map<string, Vec2>,
  maxCount: number,
  maxDistance: number,
): string[] {
  if (!peers || peers.size === 0) return []
  if (!Number.isFinite(maxCount) || maxCount <= 0) return []
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return []

  const dx = (a: Vec2, b: Vec2) => a.x - b.x
  const dz = (a: Vec2, b: Vec2) => a.z - b.z

  const candidates: Array<{ id: string; dist: number }> = []
  for (const [id, pos] of peers) {
    if (!pos) continue
    const d2 = dx(localPos, pos) ** 2 + dz(localPos, pos) ** 2
    const dist = Math.sqrt(d2)
    if (dist <= maxDistance) {
      candidates.push({ id, dist })
    }
  }
  // 距离升序，距离相同则按 userId 字典序，保证结果稳定可测
  candidates.sort((a, b) => (a.dist === b.dist ? a.id.localeCompare(b.id) : a.dist - b.dist))
  return candidates.slice(0, maxCount).map((c) => c.id)
}

/**
 * 计算远端相对本地的立体声方位（-1 全左 ~ 1 全右）。
 *
 * 约定（three.js 默认）：本地面向 -Z，+X 为右。
 *   - peer 在正前方（dx=0, dz<local.z）→ pan=0
 *   - peer 在正右方（dx>0, dz=local.z）→ pan=1
 *   - peer 在正左方（dx<0, dz=local.z）→ pan=-1
 *
 * 注意：纯立体声只有左右声道，没有前后信息；正后方会被钳到 ±1。
 * 真 3D 场景应优先使用 PannerNode，本函数仅作 StereoPannerNode 降级。
 */
export function computeStereoPan(localPos: Vec2, peerPos: Vec2): number {
  const dx = peerPos.x - localPos.x
  const dz = peerPos.z - localPos.z
  // atan2(右分量, 前分量)，前方 = -z，故前分量取 -dz
  const angle = Math.atan2(dx, -dz) // -π ~ π
  // 把 ±π/2（正侧方）映射到 ±1
  const pan = angle / (Math.PI / 2)
  return Math.min(1, Math.max(-1, pan))
}
