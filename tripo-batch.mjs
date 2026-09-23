/**
 * Tripo image-to-model batch pipeline (strictly serial).
 * Reads .env from project root, uploads each portrait, polls Tripo, downloads GLB.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const require = createRequire(import.meta.url);
const ROOT = 'C:\\Users\\13829\\OneDrive\\Desktop\\叽里吧啦';
const PORTRAIT_DIR = join(ROOT, 'apps', 'web', 'public', 'portraits', 'celebrities-full');
const TEMP_DIR = join(ROOT, 'temp-models');

const IDS = [
  'elon-musk','steve-jobs','alan-turing','warren-buffett','albert-einstein',
  'isaac-newton','nikola-tesla','marie-curie','li-bai','su-shi',
  'lu-xun','zhuge-liang','shakespeare','leonardo','van-gogh',
  'confucius','socrates','laozi','nietzsche','maoxuan-scholar'
];

// --- .env loader ---
(function loadEnv() {
  const txt = require('fs').readFileSync(join(ROOT, '.env'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
})();

const BASE = (process.env.TRIPO_API_BASE_URL || 'https://api.tripo3d.ai/v2/openapi').replace(/\/$/, '');
const TOKEN = (process.env.TRIPO_API_KEY || '').trim();
const PROXY = (process.env.TRIPO_HTTPS_PROXY || '').trim();

if (!TOKEN) { console.error('ERROR: TRIPO_API_KEY not set'); process.exit(1); }
console.log('Tripo base:', BASE);
if (PROXY) {
  console.log('Using proxy:', PROXY);
  setGlobalDispatcher(new ProxyAgent(PROXY));
}

async function tripoFetch(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${TOKEN}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  let resp;
  try {
    resp = await fetch(`${BASE}${path}`, { ...init, headers, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
  const raw = await resp.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!resp.ok) {
    const msg = typeof data.message === 'string' ? data.message : `HTTP ${resp.status}`;
    throw new Error(`Tripo ${path}: ${msg}`);
  }
  return data.data && typeof data.data === 'object' ? data.data : data;
}

async function uploadImage(buf, filename) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/jpeg' }), filename);
  const r = await tripoFetch('/upload/sts', { method: 'POST', body: form });
  const tok = r.image_token || r.file_token;
  if (!tok) throw new Error('No image_token in upload response');
  return tok;
}

async function createTask(fileToken) {
  const body = JSON.stringify({
    type: 'image_to_model',
    file: { type: 'image', file_token: fileToken },
  });
  return tripoFetch('/task', { method: 'POST', body });
}

async function getTask(id) {
  return tripoFetch(`/task/${encodeURIComponent(id)}`);
}

function findAssetUrl(task) {
  const out = task.output;
  if (!out || typeof out !== 'object') return undefined;
  for (const key of ['model', 'pbr_model', 'base_model', 'rendered_image', 'thumbnail', 'url']) {
    const v = out[key];
    if (typeof v === 'string' && /^https?:/i.test(v)) return v;
    if (v && typeof v === 'object') {
      const c = v.url || v.download_url;
      if (typeof c === 'string' && /^https?:/i.test(c)) return c;
    }
  }
  return undefined;
}

async function downloadFile(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const ab = await resp.arrayBuffer();
  await writeFile(dest, Buffer.from(ab));
  return ab.byteLength;
}

async function processOne(id, idx) {
  const imgPath = join(PORTRAIT_DIR, `${id}.jpg`);
  const glbPath = join(TEMP_DIR, `${id}.glb`);
  const t0 = Date.now();
  console.log(`\n[${idx}/${IDS.length}] ${id}: uploading...`);
  const buf = await readFile(imgPath);
  const fileToken = await uploadImage(buf, `${id}.jpg`);
  console.log(`  upload ok, token=${String(fileToken).slice(0, 12)}...`);

  const task = await createTask(fileToken);
  const taskId = task.task_id;
  if (!taskId) throw new Error('No task_id in response: ' + JSON.stringify(task));
  console.log(`  task_id=${taskId}, polling...`);

  let status = task.status || 'queued';
  let tries = 0;
  const MAX_TRIES = 120;
  while (status !== 'success' && status !== 'failed' && tries < MAX_TRIES) {
    await new Promise(r => setTimeout(r, 5000));
    tries++;
    const t = await getTask(taskId);
    status = t.status;
    const progress = t.progress || 0;
    if (tries % 6 === 0 || status === 'success' || status === 'failed') {
      console.log(`  [${tries}] status=${status} progress=${progress}% elapsed=${Math.round((Date.now()-t0)/1000)}s`);
    }
  }

  if (status !== 'success') {
    throw new Error(`Tripo task ended: status=${status} after ${tries*5}s`);
  }

  const finalTask = await getTask(taskId);
  const assetUrl = findAssetUrl(finalTask);
  if (!assetUrl) throw new Error('No asset URL in output');
  console.log(`  asset url: ${assetUrl.slice(0, 80)}...`);
  const size = await downloadFile(assetUrl, glbPath);
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`  OK: downloaded ${(size/1024).toFixed(0)} KB in ${elapsed}s`);
  return { id, status: 'success', size, elapsed, taskId };
}

async function main() {
  await mkdir(TEMP_DIR, { recursive: true });
  const results = [];
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    const idx = i + 1;
    const glbPath = join(TEMP_DIR, `${id}.glb`);
    if (existsSync(glbPath)) {
      try {
        const st = await stat(glbPath);
        if (st.size > 100000) {
          console.log(`\n[skip] ${id}: already exists (${(st.size/1024).toFixed(0)} KB)`);
          results.push({ id, status: 'skipped', size: st.size, elapsed: 0 });
          continue;
        }
      } catch {}
    }

    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      try {
        const r = await processOne(id, idx);
        results.push(r);
        done = true;
      } catch (e) {
        console.error(`  attempt ${attempt} failed: ${e.message}`);
        if (attempt === 2) {
          results.push({ id, status: 'failed', error: e.message });
        } else {
          console.log(`  retrying in 10s...`);
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }
  }
  console.log('\n\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
  await writeFile(join(ROOT, 'tripo-results.json'), JSON.stringify(results, null, 2));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
