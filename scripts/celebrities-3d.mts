/* 名人图生 3D 脚本（严格串行：一次一个，提交自动退避重试）
 * 用法：
 *   npx tsx scripts/celebrities-3d.mts --id=li-bai
 *   npx tsx scripts/celebrities-3d.mts --ids=li-bai,su-shi
 *   npx tsx scripts/celebrities-3d.mts --all
 * 已存在的 GLB 自动跳过。
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { uploadImageBuffer, createImageTask, getTask, findAssetUrl } from '../apps/api/src/tripo.js'
import { CELEBRITIES } from '../packages/shared/src/index.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const PORTRAIT_DIR = resolve(ROOT, 'apps/web/public/portraits/celebrities')
const MODEL_DIR = resolve(ROOT, 'apps/web/public/models/celebrities')
const TERMINAL = ['success', 'failed', 'banned', 'unknown', 'skipped']

type Job = { id: string; taskId?: string; status: string; modelUrl?: string; size?: number; error?: string }

function parseArgs(): string[] {
  let ids: string[] = []
  for (const a of process.argv.slice(2)) {
    if (a === '--all') ids = CELEBRITIES.map((c) => c.id)
    else if (a.startsWith('--id=')) ids.push(a.slice('--id='.length))
    else if (a.startsWith('--ids=')) ids = ids.concat(a.slice('--ids='.length).split(','))
  }
  return [...new Set(ids.map((s) => s.trim()).filter(Boolean))]
}

async function submitJob(id: string): Promise<Job> {
  const glbPath = resolve(MODEL_DIR, `${id}.glb`)
  if (existsSync(glbPath) && statSync(glbPath).size > 1000) return { id, status: 'skipped' }
  const portraitPath = resolve(PORTRAIT_DIR, `${id}.jpg`)
  if (!existsSync(portraitPath)) return { id, status: 'unknown', error: '肖像不存在' }
  const bytes = readFileSync(portraitPath)
  let lastErr: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fileToken = await uploadImageBuffer(bytes, 'image/jpeg', `${id}.jpg`)
      const task = await createImageTask(fileToken)
      if (!task.task_id) throw new Error('未返回 task_id')
      return { id, taskId: task.task_id, status: task.status ?? 'queued' }
    } catch (e) {
      lastErr = e
      const wait = 15000 * (attempt + 1)
      process.stdout.write(`提交 ${id} 第 ${attempt + 1} 次失败（${(e as Error)?.message ?? e}），${wait / 1000}s 后重试\n`)
      await sleep(wait)
    }
  }
  return { id, status: 'unknown', error: String((lastErr as Error)?.message ?? lastErr) }
}

async function runOne(id: string): Promise<Job> {
  const job = await submitJob(id)
  if (job.status === 'skipped' || !job.taskId) return job
  let guard = 0
  while (!TERMINAL.includes(job.status) && guard++ < 80) {
    await sleep(6000)
    try {
      const t = await getTask(job.taskId)
      job.status = t.status ?? job.status
      if (job.status === 'success') job.modelUrl = findAssetUrl(t)
      if (['failed', 'banned', 'unknown'].includes(job.status)) job.error = `建模失败 status=${job.status}`
    } catch (e) {
      process.stdout.write(`轮询 ${job.id} 临时错误（${(e as Error)?.message ?? e}），12s 后继续\n`)
      await sleep(12000)
    }
  }
  if (job.status === 'success' && job.modelUrl) {
    let bytes: Uint8Array | null = null
    for (let attempt = 0; attempt < 4 && !bytes; attempt++) {
      try {
        const res = await fetch(job.modelUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        bytes = new Uint8Array(await res.arrayBuffer())
      } catch (e) {
        process.stdout.write(`下载 ${job.id} 第 ${attempt + 1} 次失败（${(e as Error)?.message ?? e}），12s 后重试\n`)
        await sleep(12000)
      }
    }
    if (!bytes) { job.status = 'failed'; job.error = '下载失败（已重试）'; return job }
    writeFileSync(resolve(MODEL_DIR, `${id}.glb`), bytes)
    job.size = bytes.byteLength
  }
  return job
}

const ids = parseArgs()
if (ids.length === 0) {
  console.error('用法: npx tsx scripts/celebrities-3d.mts --id=li-bai | --ids=a,b | --all')
  process.exit(1)
}
const jobs: Job[] = []
for (let i = 0; i < ids.length; i++) {
  const job = await runOne(ids[i])
  jobs.push(job)
  process.stdout.write(`[${i + 1}/${ids.length}] ${job.id} -> ${job.status}${job.size ? ' ' + (job.size / 1024).toFixed(0) + 'KB' : ''}${job.error ? ' ' + job.error : ''}\n`)
}
const skipped = jobs.filter((j) => j.status === 'skipped').length
const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'banned' || j.status === 'unknown')
console.log(`结束：成功/就绪 ${jobs.length - failed.length}（含跳过 ${skipped}），失败 ${failed.length}`)
process.exit(failed.length ? 1 : 0)
