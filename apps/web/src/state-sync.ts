// ===== 实时状态同步 · 客户端插值/外推/裁剪纯逻辑模块 =====
// 本模块【不依赖 Three.js / DOM / WebSocket】，全部为纯类与纯函数，
// 可在 vitest(node) 环境直接单测。
//
// 时间模型：所有 serverTs / sample(nowMs) 都使用【同一时间线】。
// 真实集成时，客户端先通过 welcome / RTT 估算出 client→server 的时钟偏移，
// 把本地渲染时钟换算到 server 时间线后再调用 sample()：
//   const serverNow = clientNow + clockOffsetMs
//   const rendered = buffer.sample(serverNow)
// 单测中直接使用与 serverTs 一致的伪时钟即可。
//
// 渲染策略（与需求一一对应）：
//  - 插值(Interpolation)：渲染时刻 rt = now - interpolationDelayMs，
//    在 rt 两侧的两个快照之间对位置/旋转做线性插值；说话强度平滑过渡，
//    动画/表情/头部注视等离散状态即时切换到较新快照。
//  - 外推(Extrapolation)：当 rt 超前于最新快照（丢包/超时），用最近两帧
//    速度继续外推位置；超过 maxExtrapolationMs 未收到新快照则冻结并标记 stale。
//  - 裁剪(Clipping)：新到达快照与当前外推位置差距超过 positionClipThreshold，
//    判定为瞬移/传送，直接 snap 到新位置（清空旧队列，不做插值动画）。

/** 远端玩家的一个服务端状态快照（与 shared PlayerState 对齐，serverTs 必填）。 */
export interface RemoteSnapshot {
  x: number;
  z: number;
  rotation: number;
  talkingIntensity?: number;
  animation?: string;
  expression?: string;
  headTarget?: { x: number; z: number } | null;
  /** 服务端时间戳（ms），本时间线基准。 */
  serverTs: number;
}

/** sample() 输出：当前应渲染的远端玩家姿态。 */
export interface RenderedState {
  x: number;
  z: number;
  rotation: number;
  talkingIntensity: number;
  animation?: string;
  expression?: string;
  headTarget?: { x: number; z: number } | null;
  /** 是否处于外推中（尚未超时）。 */
  extrapolating: boolean;
  /** 是否已超过 maxExtrapolationMs 冻结（数据陈旧）。 */
  stale: boolean;
}

/** RemotePlayerBuffer 可配置项（缺省值与服务端 StateSyncConfig 默认值一致）。 */
export interface RemotePlayerBufferConfig {
  /** 插值延迟（ms），默认 100。 */
  interpolationDelayMs: number;
  /** 外推最大时长（ms），超时冻结，默认 250。 */
  maxExtrapolationMs: number;
  /** 位置裁剪阈值（世界单位），超过则 snap，默认 50。 */
  positionClipThreshold: number;
}

export const DEFAULT_BUFFER_CONFIG: RemotePlayerBufferConfig = {
  interpolationDelayMs: 100,
  maxExtrapolationMs: 250,
  positionClipThreshold: 50,
};

/** push() 结果。 */
export interface PushResult {
  /** 本次是否因距离过大而 snap（瞬移纠正）。 */
  snapped: boolean;
  /** 与上一已知快照的时间间隔（ms），用于上层观测丢包间隔。 */
  gapMs: number;
  /** push 后队列中保留的快照数。 */
  queueLength: number;
}

// ---------------------------------------------------------------------------
// 纯函数工具
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** 标量线性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 两平面坐标欧氏距离。 */
export function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

/** 把角度归一化到 (-PI, PI]。 */
export function normalizeAngle(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r <= -Math.PI) r += TAU;
  return r;
}

/** 最短路径角度插值（避免 -179° → +179° 绕远路）。 */
export function lerpAngle(a: number, b: number, t: number): number {
  const delta = normalizeAngle(b - a);
  return a + delta * t;
}

/**
 * 裁剪判定：新位置与（外推）当前位置距离是否超过阈值，需要 snap。
 * 纯函数，便于直接单测。
 */
export function shouldSnap(
  prevX: number,
  prevZ: number,
  nextX: number,
  nextZ: number,
  threshold: number,
): boolean {
  return distance(prevX, prevZ, nextX, nextZ) > threshold;
}

/**
 * 在两个快照之间插值，返回渲染态（discrete 字段取较新快照 b，即时切换）。
 * 纯函数。t 应为 [0,1]，调用方负责 clamp。
 */
export function interpolateSnapshots(a: RemoteSnapshot, b: RemoteSnapshot, t: number): RenderedState {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: lerp(a.x, b.x, clamped),
    z: lerp(a.z, b.z, clamped),
    rotation: lerpAngle(a.rotation, b.rotation, clamped),
    // 说话强度做短平滑过渡
    talkingIntensity: lerp(a.talkingIntensity ?? 0, b.talkingIntensity ?? 0, clamped),
    // 离散状态即时切换到较新快照
    animation: b.animation ?? a.animation,
    expression: b.expression ?? a.expression,
    headTarget: b.headTarget !== undefined ? b.headTarget : a.headTarget,
    extrapolating: false,
    stale: false,
  };
}

// ---------------------------------------------------------------------------
// RemotePlayerBuffer：单个远端玩家的状态快照队列
// ---------------------------------------------------------------------------

export class RemotePlayerBuffer {
  private readonly cfg: RemotePlayerBufferConfig;
  private readonly queue: RemoteSnapshot[] = [];

  constructor(config?: Partial<RemotePlayerBufferConfig>) {
    this.cfg = { ...DEFAULT_BUFFER_CONFIG, ...config };
  }

  /** 当前队列长度（测试/调试用）。 */
  get size(): number {
    return this.queue.length;
  }

  /** 清空队列（玩家离开/换房间时调用）。 */
  clear(): void {
    this.queue.length = 0;
  }

  /**
   *  ingest 一个服务端快照。
   * @param snap 服务端下发的玩家状态（必须含 serverTs）。
   * @param arrivalNow 本快照到达时的【服务端时间线】当前时刻，用于在到达瞬间
   *        评估外推位置以决定是否 snap；缺省取 snap.serverTs。
   */
  push(snap: RemoteSnapshot, arrivalNow: number = snap.serverTs): PushResult {
    const last = this.queue[this.queue.length - 1];
    const gapMs = last ? snap.serverTs - last.serverTs : 0;

    // 先丢弃乱序/重复旧包（serverTs 不大于最新快照），再做裁剪判定，
    // 避免一个迟到的旧包因其位置差异被误判为瞬移而 snap。
    if (last && snap.serverTs <= last.serverTs) {
      return { snapped: false, gapMs: 0, queueLength: this.queue.length };
    }

    // 裁剪：若到达瞬间的（外推）渲染位置与新位置差距过大 → 瞬移，直接 snap。
    if (last) {
      const cur = this.sample(arrivalNow);
      if (shouldSnap(cur.x, cur.z, snap.x, snap.z, this.cfg.positionClipThreshold)) {
        this.queue.length = 0;
        this.queue.push(snap);
        return { snapped: true, gapMs, queueLength: 1 };
      }
    }

    this.queue.push(snap);
    this.prune(arrivalNow);
    return { snapped: false, gapMs, queueLength: this.queue.length };
  }

  /**
   * 计算 shouldRender 的姿态。
   * @param nowMs 当前服务端时间线时刻（见文件头时间模型说明）。
   */
  sample(nowMs: number): RenderedState {
    if (this.queue.length === 0) {
      // 无数据：返回一个静止零位（上层应隐藏 avatar）。
      return {
        x: 0, z: 0, rotation: 0, talkingIntensity: 0,
        extrapolating: false, stale: true,
      };
    }

    const rt = nowMs - this.cfg.interpolationDelayMs;
    const first = this.queue[0];
    const last = this.queue[this.queue.length - 1];

    // 渲染时刻早于最早快照：直接停在最早快照，不前瞻。
    if (rt <= first.serverTs) {
      return {
        x: first.x, z: first.z, rotation: first.rotation,
        talkingIntensity: first.talkingIntensity ?? 0,
        animation: first.animation, expression: first.expression, headTarget: first.headTarget,
        extrapolating: false, stale: false,
      };
    }

    // 正常插值：找到 rt 两侧的快照对。
    if (rt < last.serverTs) {
      for (let i = 0; i < this.queue.length - 1; i++) {
        const a = this.queue[i];
        const b = this.queue[i + 1];
        if (rt >= a.serverTs && rt <= b.serverTs) {
          const span = b.serverTs - a.serverTs;
          const t = span > 0 ? (rt - a.serverTs) / span : 1;
          return interpolateSnapshots(a, b, t);
        }
      }
    }

    // rt >= last.serverTs：外推区。
    const dt = rt - last.serverTs;
    if (dt <= this.cfg.maxExtrapolationMs) {
      // 速度来自最近两帧（单位/ms）；只有一帧时速度为 0。
      let vx = 0;
      let vz = 0;
      let vRot = 0;
      if (this.queue.length >= 2) {
        const prev = this.queue[this.queue.length - 2];
        const span = last.serverTs - prev.serverTs;
        if (span > 0) {
          vx = (last.x - prev.x) / span;
          vz = (last.z - prev.z) / span;
          vRot = normalizeAngle(last.rotation - prev.rotation) / span;
        }
      }
      return {
        x: last.x + vx * dt,
        z: last.z + vz * dt,
        rotation: last.rotation + vRot * dt,
        talkingIntensity: last.talkingIntensity ?? 0,
        animation: last.animation,
        expression: last.expression,
        headTarget: last.headTarget,
        extrapolating: true,
        stale: false,
      };
    }

    // 超过最大外推时长：冻结在最后已知位置，标记 stale。
    return {
      x: last.x, z: last.z, rotation: last.rotation,
      talkingIntensity: last.talkingIntensity ?? 0,
      animation: last.animation, expression: last.expression, headTarget: last.headTarget,
      extrapolating: false,
      stale: true,
    };
  }

  /** 修剪过老的快照，控制队列内存（保留插值/外推所需的最少帧）。 */
  private prune(nowMs: number): void {
    const rt = nowMs - this.cfg.interpolationDelayMs;
    // 删除早于 rt 之前、且其后仍至少留 2 帧的旧快照。
    while (this.queue.length > 2 && this.queue[0].serverTs < rt && this.queue[1].serverTs <= rt) {
      this.queue.shift();
    }
    // 硬上限保护，避免极端情况下无限增长。
    while (this.queue.length > 32) this.queue.shift();
  }
}
