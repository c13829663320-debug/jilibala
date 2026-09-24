// ===== 口型同步纯逻辑（可单测）=====
// 与浏览器 API / three.js 解耦：电平 → 口部张开度的映射、指数平滑。
// 依赖 AnalyserNode 的部分（intensityFromAnalyser）放在文件末尾，
// 单测时通过 mock 或直接跳过该函数即可。

/**
 * 将 0~1 的音频电平映射为 0~1 的口部张开度。
 * - 低于 threshold 的电平视为静默（呼吸噪声、环境底噪），直接返回 0，避免嘴唇微颤。
 * - 超过 threshold 后做非线性映射（幂次 < 1）：让中等电平也有明显口型，
 *   说话时口型变化更鲜活，而不是只有大喊时才张嘴。
 *
 * @param level     0~1 的归一化电平（通常来自 RMS）
 * @param threshold 静默阈值，默认 0.02
 */
export function levelToMouthOpen(level: number, threshold = 0.02): number {
  // 钳制输入，防止越界
  const l = Math.min(1, Math.max(0, level))
  if (l <= threshold) return 0
  // 把 [threshold, 1] 重映射到 [0, 1]
  const normalized = (l - threshold) / (1 - threshold)
  // 非线性：幂次 0.65 抬升中小电平的开口幅度
  const shaped = Math.pow(normalized, 0.65)
  return Math.min(1, Math.max(0, shaped))
}

/**
 * 指数平滑（一阶低通）。
 * @param prev  上一帧平滑后的值
 * @param next  当前帧原始值
 * @param alpha 平滑系数 0~1：越大跟随越快（=1 完全不滤波），越小越平滑（=0 完全不变）
 */
export function smoothIntensity(prev: number, next: number, alpha: number): number {
  const a = Math.min(1, Math.max(0, alpha))
  return prev + (next - prev) * a
}

/**
 * 从 AnalyserNode 取时域数据计算 RMS 电平，归一化到 0~1。
 * 依赖浏览器 Web Audio API，单测环境跳过（可传入 mock analyser）。
 *
 * @param analyser  Web Audio AnalyserNode
 * @param fftSize   可选，分析帧大小；不传则用 analyser.fftSize
 */
export function intensityFromAnalyser(analyser: AnalyserNode, fftSize?: number): number {
  const size = fftSize ?? analyser.fftSize
  const buf = new Float32Array(size)
  // getFloatTimeDomainData 是标准 API；旧浏览器退化到 byte 版本
  if (typeof analyser.getFloatTimeDomainData === 'function') {
    analyser.getFloatTimeDomainData(buf)
  } else {
    const byteBuf = new Uint8Array(size)
    analyser.getByteTimeDomainData(byteBuf)
    for (let i = 0; i < size; i++) buf[i] = (byteBuf[i] - 128) / 128
  }
  let sumSq = 0
  for (let i = 0; i < size; i++) sumSq += buf[i] * buf[i]
  // RMS：根均方值。人声峰值通常在 0.1~0.5，乘以增益便于归一化
  const rms = Math.sqrt(sumSq / size)
  return Math.min(1, rms * 2.5)
}
