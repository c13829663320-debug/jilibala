// ===== R5: 断线重连 / 丢包恢复策略（纯函数，无 DOM，可在 Node 单测）=====
//
// 把「指数退避」「presence 序号跳跃检测」「请求重传」三处逻辑收敛为纯函数，
// 供 useReconnectingWebSocket 与 Plaza3D 内联 WS 共用，并可独立单测。
//
// 约定：
//   - 退避：1s -> 2s -> 4s -> 8s -> ... 封顶 maxDelayMs（默认 30s）；成功后重置。
//   - 序号跳跃：presence 里某玩家的 seq 比上次大了不止 1，中间包丢了。
//   - 重传：向服务端请求补发 [fromSeq, toSeq] 窗口内的消息。

/**
 * 计算第 attempt 次重连应等待的退避毫秒数。
 * @param attempt        第几次重连（从 1 开始）
 * @param initialDelayMs 初始延迟（默认 1000）
 * @param maxDelayMs     封顶（默认 30000）
 */
export function nextBackoffDelay(
  attempt: number,
  initialDelayMs = 1000,
  maxDelayMs = 30000,
): number {
  const n = Math.max(0, Math.floor(attempt) - 1)
  const exp = initialDelayMs * Math.pow(2, n)
  const capped = Math.min(exp, maxDelayMs)
  return Number.isFinite(capped) ? capped : maxDelayMs
}

/**
 * 检测 presence 序号跳跃（丢包）。
 * @returns 丢失的包数（>0 表示有缺口）；新序号 <= 旧序号视为乱序/重复，返回 0。
 */
export function detectSeqGap(prevSeq: number | undefined, newSeq: number): number {
  if (typeof prevSeq !== 'number' || !Number.isFinite(prevSeq)) return 0
  if (!Number.isFinite(newSeq)) return 0
  const expected = prevSeq + 1
  if (newSeq <= prevSeq) return 0 // 乱序/重复
  return Math.max(0, newSeq - expected)
}

/**
 * 构造一条「请求补发最近窗口消息」的 WS 消息载荷。
 * 服务端收到后补发 (fromSeq, toSeq] 区间内缓冲的广播。
 */
export function buildRetransmitRequest(
  lastAckedSeq: number,
  window = 10,
): { type: 'request_replay'; fromSeq: number; toSeq: number } {
  const from = Math.max(0, lastAckedSeq - Math.max(0, Math.floor(window)) + 1)
  return { type: 'request_replay', fromSeq: from, toSeq: lastAckedSeq }
}

/**
 * 位置速度外推：给定上两帧位置与时间差，预测 now 时刻位置。
 * （与 position-interpolator 同思路的纯函数版，便于测试/复用。）
 */
export function extrapolatePosition(
  prev: { x: number; z: number; t: number },
  last: { x: number; z: number; t: number },
  now: number,
): { x: number; z: number } {
  const dtSec = (last.t - prev.t) / 1000
  if (dtSec <= 0) return { x: last.x, z: last.z }
  const vx = (last.x - prev.x) / dtSec
  const vz = (last.z - prev.z) / dtSec
  const ahead = (now - last.t) / 1000
  return { x: last.x + vx * ahead, z: last.z + vz * ahead }
}
