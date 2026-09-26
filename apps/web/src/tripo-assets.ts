/** Utilities for normalising the several response shapes used by Tripo. */
export type TripoTaskView = {
  status?: string
  progress?: number
  output?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * Tripo has returned both `{ data: { ... } }` and `{ result: { ... } }` over
 * time. Keep the UI independent from that wrapper while retaining output.
 */
export function readTripoTask(data: unknown): TripoTaskView {
  const root = asRecord(data)
  if (!root) return {}
  const nested = asRecord(root.data) ?? asRecord(root.result) ?? root
  const output = asRecord(nested.output) ?? asRecord(nested.result) ?? asRecord(root.output)
  return {
    status: typeof nested.status === 'string' ? nested.status : typeof root.status === 'string' ? root.status : undefined,
    progress: typeof nested.progress === 'number' ? nested.progress : typeof root.progress === 'number' ? root.progress : undefined,
    output,
  }
}

const MODEL_KEYS = new Set(['model', 'pbr_model', 'base_model', 'mesh', 'glb', 'glb_model', 'model_url', 'download_url', 'url'])
const NESTED_KEYS = new Set(['output', 'result', 'model', 'pbr_model', 'base_model', 'mesh', 'files', 'assets', 'models'])

function isLikelyModelUrl(value: string, key: string) {
  if (!/^https?:\/\//i.test(value)) return false
  // Explicit model keys are authoritative even when the CDN URL has no suffix.
  if (MODEL_KEYS.has(key.toLowerCase())) return true
  return /\.(glb|gltf|fbx|obj|stl|usd|usdz)(?:[?#].*)?$/i.test(value)
}

/** Find a GLB/model URL in nested `output`, `result`, or file objects. */
export function findTripoAssetUrl(data: unknown): string {
  const root = asRecord(data)
  if (!root) return ''
  const visited = new Set<object>()
  const walk = (value: unknown, parentKey = '', depth = 0): string => {
    if (depth > 8 || value == null) return ''
    if (typeof value === 'string') return isLikelyModelUrl(value, parentKey) ? value : ''
    if (typeof value !== 'object') return ''
    if (visited.has(value)) return ''
    visited.add(value)
    const record = asRecord(value)
    if (!record) return ''
    // Prefer model fields regardless of insertion order (thumbnail/rendered_image
    // must never win over an actual GLB).
    for (const key of ['pbr_model', 'model', 'base_model', 'glb', 'glb_model', 'mesh', 'model_url', 'download_url', 'url']) {
      if (key in record) {
        const found = walk(record[key], key, depth + 1)
        if (found) return found
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'thumbnail' || key === 'rendered_image' || key === 'image' || key === 'preview') continue
      if (NESTED_KEYS.has(key.toLowerCase()) || typeof child === 'object') {
        const found = walk(child, key, depth + 1)
        if (found) return found
      }
    }
    return ''
  }
  return walk(root)
}
