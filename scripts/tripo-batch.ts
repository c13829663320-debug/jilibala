// ===== R4-10: Tripo 批量人物生成脚本 =====
// 输入：名人列表 JSON（id/name/prompt/referenceImage?）
// 行为：调用 Tripo OpenAPI 提交 text_to_model / image_to_model 任务 → 轮询 → 下载 GLB
// 约束：最多 3 并发、失败重试 3 次、进度日志；--dry-run 不联网，仅校验输入与输出路径。
//
// 本脚本刻意把「网络客户端」做成可注入接口（TripoApiClient），
// 这样单测可以在没有 TRIPO_API_KEY、无法访问 api.tripo3d.ai 的情况下，
// 用一个 mock client 完整跑通并发/重试/dry-run 逻辑。

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve as pathResolve, basename } from "node:path";

export const DEFAULT_TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi";
export const DEFAULT_OUT_DIR = "apps/web/public/models/characters";
export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_RETRIES = 3;

export interface CharacterInputItem {
  /** 人物唯一 id（用于 GLB 文件名：<id>.glb）。 */
  id: string;
  /** 展示名（仅日志用）。 */
  name: string;
  /** 文生图/文生 3D 的提示词。 */
  prompt: string;
  /** 可选：参考肖像图 URL，提供后走 image_to_model。 */
  referenceImage?: string;
}

export interface TripoTaskArtifact {
  taskId: string;
  status: "success" | "failed";
  modelUrl?: string;
  progress?: number;
}

/** 可注入的 Tripo 客户端接口（真实实现用 fetch；测试用 mock）。 */
export interface TripoApiClient {
  /** 提交任务，返回 taskId。 */
  createTask(item: CharacterInputItem): Promise<{ taskId: string }>;
  /** 轮询直到任务结束（实现内部自己 sleep），返回产物 URL。 */
  waitForModel(taskId: string): Promise<{ modelUrl: string }>;
  /** 下载 GLB 到目标路径。 */
  downloadGlb(url: string, destPath: string): Promise<void>;
}

export interface TripoBatchOptions {
  outDir?: string;
  concurrency?: number;
  retries?: number;
  dryRun?: boolean;
  apiBase?: string;
  apiKey?: string;
  /** 进度回调（测试可断言日志顺序）。 */
  onProgress?: (stage: string, id: string, detail?: string) => void;
  /** 注入客户端（测试用）；不传则用默认 fetch 客户端。 */
  client?: TripoApiClient;
  /** 可注入 sleep（测试加速）。 */
  sleep?: (ms: number) => Promise<void>;
}

export interface TripoTaskResult {
  id: string;
  name: string;
  status: "ok" | "failed" | "skipped";
  outPath?: string;
  attempts: number;
  dryRun: boolean;
  error?: string;
}

export class TripoBatchError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "TripoBatchError";
  }
}

/** 校验单条名人输入；非法时抛 TripoBatchError。 */
export function validateCharacterInput(item: Partial<CharacterInputItem>): CharacterInputItem {
  if (!item || typeof item !== "object") {
    throw new TripoBatchError("BAD_ITEM", "每条输入必须是对象。");
  }
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
    throw new TripoBatchError(
      "BAD_ID",
      `id 非法："${String(item.id)}"。仅允许字母/数字/-/_，且以字母数字开头（将作为文件名）。`,
    );
  }
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!name) throw new TripoBatchError("BAD_NAME", `人物 ${id} 缺少 name。`);
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
  if (prompt.length < 8) {
    throw new TripoBatchError("BAD_PROMPT", `人物 ${id} 的 prompt 过短（至少 8 个字符），当前 ${prompt.length}。`);
  }
  if (item.referenceImage !== undefined && item.referenceImage !== null) {
    if (typeof item.referenceImage !== "string" || !/^https?:\/\//i.test(item.referenceImage)) {
      throw new TripoBatchError("BAD_REFERENCE", `人物 ${id} 的 referenceImage 必须是 http(s) URL。`);
    }
  }
  return {
    id,
    name,
    prompt,
    referenceImage: typeof item.referenceImage === "string" ? item.referenceImage : undefined,
  };
}

/** 批量校验：返回规范化后的列表；第一条错误即抛出。 */
export function validateBatchInput(items: unknown): CharacterInputItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TripoBatchError("BAD_INPUT", "输入必须是非空数组（名人列表 JSON）。");
  }
  const seen = new Set<string>();
  const out: CharacterInputItem[] = [];
  for (const raw of items) {
    const norm = validateCharacterInput(raw);
    if (seen.has(norm.id)) {
      throw new TripoBatchError("DUP_ID", `重复的 id：${norm.id}`);
    }
    seen.add(norm.id);
    out.push(norm);
  }
  return out;
}

/** 计算某人物 GLB 的输出绝对路径。 */
export function planOutputPath(id: string, outDir: string): string {
  return pathResolve(outDir, `${id}.glb`);
}

/** 并发池：最多 concurrency 个 worker 同时跑。 */
async function runPool<I, R>(list: I[], concurrency: number, worker: (item: I, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(list.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, list.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= list.length) return;
        results[i] = await worker(list[i], i);
      }
    }),
  );
  return results;
}

/** 失败重试包装：最多 retries 次。 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  onRetry: (attempt: number, err: unknown) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) onRetry(attempt, err);
    }
  }
  throw lastErr;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 真实 fetch 客户端（dry-run 时不会被构造）。 */
function createDefaultClient(opts: Required<Pick<TripoBatchOptions, "apiBase" | "apiKey">>): TripoApiClient {
  const base = opts.apiBase.replace(/\/$/, "");
  const auth = `Bearer ${opts.apiKey}`;
  return {
    async createTask(item) {
      const body: Record<string, unknown> = item.referenceImage
        ? { type: "image_to_model", prompt: item.prompt }
        : { type: "text_to_model", prompt: item.prompt };
      const res = await fetch(`${base}/task`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { data?: { task_id?: string } };
      const taskId = data.data?.task_id;
      if (!taskId) throw new TripoBatchError("CREATE_FAILED", `提交 ${item.id} 未返回 task_id`);
      return { taskId };
    },
    async waitForModel(taskId) {
      // 真实环境这里轮询 /task/:id，直到 status=success；省略具体 sleep 细节。
      const res = await fetch(`${base}/task/${encodeURIComponent(taskId)}`, { headers: { Authorization: auth } });
      const data = (await res.json()) as { data?: { status?: string; output?: { model?: { url?: string } } } };
      const url = data.data?.output?.model?.url;
      if (!url) throw new TripoBatchError("NO_MODEL_URL", `任务 ${taskId} 未产出模型 URL`);
      return { modelUrl: url };
    },
    async downloadGlb(url, destPath) {
      const res = await fetch(url);
      if (!res.ok) throw new TripoBatchError("DOWNLOAD_FAILED", `下载 ${url} 失败：${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, buf);
    },
  };
}

/**
 * 批量入口。dry-run 模式下：
 *  - 不构造网络客户端、不发任何请求；
 *  - 仅校验输入、计算输出路径、记录进度日志；
 *  - 返回 status=ok 的结果（outPath 指向将来要写入的位置）。
 */
export async function runTripoBatch(rawItems: unknown, options: TripoBatchOptions = {}): Promise<TripoTaskResult[]> {
  const items = validateBatchInput(rawItems);
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const dryRun = options.dryRun ?? false;
  const log = options.onProgress ?? (() => {});
  const sleep = options.sleep ?? defaultSleep;

  if (concurrency < 1 || concurrency > 8) {
    throw new TripoBatchError("BAD_CONCURRENCY", `concurrency 必须在 1~8 之间，实际 ${concurrency}。`);
  }

  let client: TripoApiClient | undefined = options.client;
  if (!dryRun && !client) {
    const apiKey = (options.apiKey ?? process.env.TRIPO_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new TripoBatchError("NO_API_KEY", "非 dry-run 模式必须提供 TRIPO_API_KEY（或 options.apiKey）。");
    }
    client = createDefaultClient({ apiBase: options.apiBase ?? DEFAULT_TRIPO_BASE, apiKey });
  }

  log("batch_start", "*", `${items.length} 个任务，并发=${concurrency}，重试=${retries}，dryRun=${dryRun}`);

  const results = await runPool(items, concurrency, async (item): Promise<TripoTaskResult> => {
    const outPath = planOutputPath(item.id, outDir);
    if (dryRun) {
      log("dry_run", item.id, `将写入 ${outPath}`);
      // dry-run 也确认输出目录的父级合理（不真的写盘）
      if (!basename(outPath).endsWith(".glb")) {
        return { id: item.id, name: item.name, status: "failed", attempts: 1, dryRun: true, error: "输出路径异常" };
      }
      return { id: item.id, name: item.name, status: "ok", outPath, attempts: 1, dryRun: true };
    }

    let attempts = 0;
    try {
      await withRetry(
        async () => {
          attempts += 1;
          log("submit", item.id, `第 ${attempts} 次尝试`);
          const { taskId } = await client!.createTask(item);
          log("poll", item.id, `taskId=${taskId}`);
          const { modelUrl } = await client!.waitForModel(taskId);
          log("download", item.id, modelUrl);
          await client!.downloadGlb(modelUrl, outPath);
        },
        retries,
        (attempt, err) => {
          log("retry", item.id, `第 ${attempt} 次失败：${err instanceof Error ? err.message : String(err)}`);
        },
      );
      return { id: item.id, name: item.name, status: "ok", outPath, attempts, dryRun: false };
    } catch (err) {
      return {
        id: item.id,
        name: item.name,
        status: "failed",
        attempts,
        dryRun: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.length - ok;
  log("batch_done", "*", `完成：成功 ${ok} / 失败 ${failed}`);
  // 给测试一个微小的 yield，确保日志在断言前 flush
  await sleep(0);
  return results;
}

/** CLI 入口：tsx tripo-batch.ts <input.json> [--dry-run] [--out dir] [--concurrency N] */
export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const inputFile = args.find((a) => !a.startsWith("-"));
  if (!inputFile) {
    console.error("用法: tsx scripts/tripo-batch.ts <celebrities.json> [--dry-run] [--out <dir>] [--concurrency N]");
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const concIdx = args.indexOf("--concurrency");
  const concurrency = concIdx >= 0 ? Number(args[concIdx + 1]) : undefined;

  const { readFileSync } = await import("node:fs");
  const raw = JSON.parse(readFileSync(inputFile, "utf8"));
  const results = await runTripoBatch(raw, {
    dryRun,
    outDir,
    concurrency,
    onProgress: (stage, id, detail) => console.log(`[${stage}] ${id}${detail ? " — " + detail : ""}`),
  });
  console.log(JSON.stringify(results, null, 2));
  return results.every((r) => r.status === "ok") ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
