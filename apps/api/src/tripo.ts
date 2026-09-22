import { ProxyAgent, setGlobalDispatcher } from 'undici';

const TRIPO_BASE_URL = (process.env.TRIPO_API_BASE_URL ?? 'https://api.tripo3d.ai/v2/openapi').replace(/\/$/, '');
const TRIPO_TIMEOUT_MS = Number(process.env.TRIPO_API_TIMEOUT_MS ?? 30000);

// Node fetch does not read the Windows Internet Settings proxy automatically.
// Local development on this machine uses 127.0.0.1:12450; deployments can
// provide TRIPO_HTTPS_PROXY explicitly or leave this disabled.
let configuredProxy = '';
function ensureProxyDispatcher() {
  const proxyUrl = process.env.TRIPO_HTTPS_PROXY?.trim() || process.env.HTTPS_PROXY?.trim() || process.env.https_proxy?.trim() || '';
  if (proxyUrl && proxyUrl !== configuredProxy) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    configuredProxy = proxyUrl;
  }
}

export type TripoTaskType = 'text_to_model' | 'image_to_model';

export type TripoTask = {
  task_id?: string;
  type?: string;
  status?: string;
  progress?: number;
  output?: Record<string, unknown>;
  [key: string]: unknown;
};

export class TripoError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, statusCode = 502, details?: unknown) {
    super(message);
    this.name = 'TripoError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function getToken(): string {
  const token = process.env.TRIPO_API_KEY?.trim();
  if (!token) {
    throw new TripoError('Tripo API 未配置。请在服务端设置 TRIPO_API_KEY。', 503);
  }
  return token;
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    const message = typeof data.message === 'string' ? data.message : `Tripo API 请求失败（${response.status}）`;
    throw new TripoError(message, response.status, data);
  }
  // Tripo wraps successful responses in { code, data }. Keep the wrapper out
  // of the rest of the application while preserving unexpected fields.
  const wrapped = data.data;
  return wrapped && typeof wrapped === 'object' ? wrapped as Record<string, unknown> : data;
}

async function tripoFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  // The API server loads .env after ESM imports are evaluated, so configure
  // the proxy lazily on the first request rather than at module import time.
  ensureProxyDispatcher();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${getToken()}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRIPO_TIMEOUT_MS);
    try {
      response = await fetch(`${TRIPO_BASE_URL}${path}`, { ...init, headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const cause = error && typeof error === 'object' && 'cause' in error
      ? (error as { cause?: { code?: string; message?: string } }).cause
      : undefined;
    const reason = error instanceof Error && error.name === 'AbortError'
      ? `请求超时（${Math.round(TRIPO_TIMEOUT_MS / 1000)} 秒）`
      : `${error instanceof Error ? error.message : String(error)}${cause?.code ? `（${cause.code}）` : ''}`;
    throw new TripoError(`无法连接 Tripo API：${reason}。请检查服务端网络、TRIPO_API_BASE_URL 和密钥。`);
  }
  return parseResponse(response);
}

export async function createTextTask(prompt: string, options: { modelVersion?: string; faceLimit?: number } = {}): Promise<TripoTask> {
  const body: Record<string, unknown> = { type: 'text_to_model', prompt };
  if (options.modelVersion) body.model_version = options.modelVersion;
  if (Number.isFinite(options.faceLimit)) body.face_limit = options.faceLimit;
  return tripoFetch('/task', { method: 'POST', body: JSON.stringify(body) }) as Promise<TripoTask>;
}

/** Upload an image URL to Tripo and return its file token. */
export async function uploadImageUrl(imageUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new TripoError('imageUrl 必须是有效的 http(s) URL。', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TripoError('imageUrl 只支持 http(s) URL。', 400);
  }

  let imageResponse: Response;
  try {
    imageResponse = await fetch(parsed);
  } catch (error) {
    throw new TripoError(`无法读取图片：${error instanceof Error ? error.message : String(error)}`, 400);
  }
  if (!imageResponse.ok) throw new TripoError(`图片下载失败（${imageResponse.status}）。`, 400);
  const contentType = imageResponse.headers.get('content-type') ?? 'application/octet-stream';
  if (!contentType.startsWith('image/')) throw new TripoError('imageUrl 指向的资源不是图片。', 400);
  const contentLength = Number(imageResponse.headers.get('content-length') ?? 0);
  if (contentLength > 15 * 1024 * 1024) throw new TripoError('图片不能超过 15 MB。', 413);
  const bytes = await imageResponse.arrayBuffer();
  if (bytes.byteLength > 15 * 1024 * 1024) throw new TripoError('图片不能超过 15 MB。', 413);

  const form = new FormData();
  const extension = contentType.split('/')[1]?.split(';')[0] || 'bin';
  form.append('file', new Blob([bytes], { type: contentType }), `upload.${extension}`);
  const uploaded = await tripoFetch('/upload/sts', { method: 'POST', body: form });
  const token = uploaded.image_token ?? uploaded.file_token;
  if (typeof token !== 'string' || !token) throw new TripoError('Tripo 上传成功但未返回图片 token。', 502, uploaded);
  return token;
}

export async function createImageTask(fileToken: string, options: { modelVersion?: string; faceLimit?: number } = {}): Promise<TripoTask> {
  const body: Record<string, unknown> = { type: 'image_to_model', file: { type: 'image', file_token: fileToken } };
  if (options.modelVersion) body.model_version = options.modelVersion;
  if (Number.isFinite(options.faceLimit)) body.face_limit = options.faceLimit;
  return tripoFetch('/task', { method: 'POST', body: JSON.stringify(body) }) as Promise<TripoTask>;
}

export async function getTask(taskId: string): Promise<TripoTask> {
  return tripoFetch(`/task/${encodeURIComponent(taskId)}`) as Promise<TripoTask>;
}

const ASSET_KEYS = ['model', 'pbr_model', 'base_model', 'rendered_image', 'thumbnail', 'url'];

/** Finds a downloadable URL in Tripo's task output, regardless of API version. */
export function findAssetUrl(task: TripoTask, requestedAsset?: string): string | undefined {
  const output = task.output;
  if (!output || typeof output !== 'object') return undefined;
  const keys = requestedAsset ? [requestedAsset] : ASSET_KEYS;
  for (const key of keys) {
    const value = output[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    if (value && typeof value === 'object') {
      const candidate = (value as Record<string, unknown>).url ?? (value as Record<string, unknown>).download_url;
      if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
    }
  }
  return undefined;
}
