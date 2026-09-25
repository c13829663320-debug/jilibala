/**
 * Self-contained Tripo API client for the open-world asset pipeline.
 * Does NOT import or modify apps/api/src/tripo.ts.
 * Reads TRIPO_API_KEY and TRIPO_HTTPS_PROXY from process.env / .env.
 */
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const TRIPO_BASE_URL = (process.env.TRIPO_API_BASE_URL ?? 'https://api.tripo3d.ai/v2/openapi').replace(/\/$/, '');
const TRIPO_TIMEOUT_MS = Number(process.env.TRIPO_API_TIMEOUT_MS ?? 120000);

let configuredProxy = '';
function ensureProxyDispatcher() {
  const proxyUrl = process.env.TRIPO_HTTPS_PROXY?.trim() || process.env.HTTPS_PROXY?.trim() || process.env.https_proxy?.trim() || '';
  if (proxyUrl && proxyUrl !== configuredProxy) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    configuredProxy = proxyUrl;
  }
}

export interface TripoTask {
  task_id?: string;
  type?: string;
  status?: string;
  progress?: number;
  output?: Record<string, unknown>;
  [key: string]: unknown;
}

export class TripoClientError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  constructor(message: string, statusCode = 502, details?: unknown) {
    super(message);
    this.name = 'TripoClientError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function getToken(): string {
  const token = process.env.TRIPO_API_KEY?.trim();
  if (!token) throw new TripoClientError('TRIPO_API_KEY not set', 503);
  return token;
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) as Record<string, unknown> : {} } catch { data = { raw } }
  if (!response.ok) {
    const message = typeof data.message === 'string' ? data.message : `Tripo API error (${response.status})`;
    throw new TripoClientError(message, response.status, data);
  }
  const wrapped = data.data;
  return wrapped && typeof wrapped === 'object' ? wrapped as Record<string, unknown> : data;
}

async function tripoFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  ensureProxyDispatcher();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${getToken()}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRIPO_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${TRIPO_BASE_URL}${path}`, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  return parseResponse(response);
}

export interface BalanceInfo {
  balance: number;
  frozen: number;
}

export async function getBalance(): Promise<BalanceInfo> {
  const data = await tripoFetch('/user/balance');
  return {
    balance: Number(data.balance ?? 0),
    frozen: Number(data.frozen ?? 0),
  };
}

export interface TextToModelOptions {
  modelVersion?: string;
  texture?: boolean;
  pbr?: boolean;
  textureQuality?: 'standard' | 'detailed';
  geometryQuality?: 'standard' | 'detailed';
  quad?: boolean;
  faceLimit?: number;
}

export async function createTextToModelTask(prompt: string, opts: TextToModelOptions = {}): Promise<TripoTask> {
  const body: Record<string, unknown> = { type: 'text_to_model', prompt };
  if (opts.modelVersion) body.model_version = opts.modelVersion;
  if (opts.texture !== undefined) body.texture = opts.texture;
  if (opts.pbr !== undefined) body.pbr = opts.pbr;
  if (opts.textureQuality) body.texture_quality = opts.textureQuality;
  if (opts.geometryQuality) body.geometry_quality = opts.geometryQuality;
  if (opts.quad !== undefined) body.quad = opts.quad;
  if (Number.isFinite(opts.faceLimit)) body.face_limit = opts.faceLimit;
  return tripoFetch('/task', { method: 'POST', body: JSON.stringify(body) }) as Promise<TripoTask>;
}

export async function getTask(taskId: string): Promise<TripoTask> {
  return tripoFetch(`/task/${encodeURIComponent(taskId)}`) as Promise<TripoTask>;
}

const ASSET_KEYS = ['model', 'pbr_model', 'base_model', 'rendered_image', 'thumbnail', 'url'];

export function findModelUrl(task: TripoTask): string | undefined {
  const output = task.output;
  if (!output || typeof output !== 'object') return undefined;
  for (const key of ASSET_KEYS) {
    const value = output[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    if (value && typeof value === 'object') {
      const candidate = (value as Record<string, unknown>).url ?? (value as Record<string, unknown>).download_url;
      if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Poll a task until it reaches a terminal state. Returns the final task. */
export async function pollTask(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (progress: number) => void } = {},
): Promise<TripoTask> {
  const intervalMs = opts.intervalMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 600000; // 10 min
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await getTask(taskId);
    const status = task.status;
    if (status === 'success') return task;
    if (status === 'failed' || status === 'cancelled') {
      throw new TripoClientError(`Task ${taskId} ended with status ${status}`, 502, task);
    }
    if (opts.onProgress && typeof task.progress === 'number') {
      opts.onProgress(task.progress);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new TripoClientError(`Task ${taskId} timed out after ${timeoutMs}ms`, 504);
}

/** Download a model URL to a local file path. Returns the byte count. */
export async function downloadModel(url: string, destPath: string): Promise<number> {
  ensureProxyDispatcher();
  const response = await fetch(url);
  if (!response.ok) throw new TripoClientError(`Download failed (${response.status})`, response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  await import('node:fs/promises').then((fs) => fs.writeFile(destPath, buffer));
  return buffer.length;
}
