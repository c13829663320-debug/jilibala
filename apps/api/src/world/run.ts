/**
 * Open-world asset generation pipeline.
 *
 * Usage: npx tsx apps/api/src/world/run.ts
 *
 * Generates assets from asset-spec.ts in priority order, normalizes them,
 * and writes them to apps/web/public/models/world/.
 * Stops when Tripo balance <= STOP_BALANCE.
 */
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_ASSETS } from './asset-spec.js';
import { getBalance, createTextToModelTask, pollTask, findModelUrl, downloadModel, TripoClientError } from './tripo-client.js';
import { normalizeGlb } from './normalize.js';
import { writeManifest } from './manifest.js';
import type { WorldAsset, AssetRequest } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'apps', 'web', 'public', 'models', 'world');
const LIBRARY_DIR = path.join(OUTPUT_DIR, '_library');
const TEMP_DIR = path.join(PROJECT_ROOT, '.tmp-world-gen');
const STOP_BALANCE = 100;
const MAX_CONCURRENCY = 3;
const RETRY_DELAY_MS = 15000;
const MAX_RETRIES = 3;

// ─── .env loading (manual, no extra deps) ───────────────────────────────────
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env optional */ }
}

// ─── Progress logging ───────────────────────────────────────────────────────
interface GenStats {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  creditsSpent: number;
  startTime: number;
}

function logStats(stats: GenStats, balance: number, current: string) {
  const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
  const rate = stats.completed > 0 ? (elapsed / stats.completed).toFixed(1) : '?';
  console.log(`[${new Date().toISOString()}] ` +
    `done=${stats.completed}/${stats.total} failed=${stats.failed} skip=${stats.skipped} ` +
    `credits=${stats.creditsSpent} balance=${balance} ` +
    `avg=${rate}s/asset current=${current}`);
}

// ─── Single asset generation ────────────────────────────────────────────────
async function generateAsset(
  asset: AssetRequest,
  stats: GenStats,
): Promise<WorldAsset | null> {
  const isHigh = asset.spec === 'high';
  const tempPath = path.join(TEMP_DIR, `${asset.id}.glb`);

  // Submit task with retries for concurrency errors
  let taskId: string | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // NOTE: pbr=true and quad=true both cause Tripo to return FBX format
      // which gltf-transform cannot read. Use pbr=false, quad=false for GLB.
      // High quality via detailed geometry + detailed texture.
      const task = await createTextToModelTask(asset.prompt, {
        texture: true,
        pbr: false,
        textureQuality: isHigh ? 'detailed' : 'standard',
        geometryQuality: isHigh ? 'detailed' : 'standard',
        faceLimit: isHigh ? 80000 : 40000,
      });
      taskId = task.task_id;
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('concurrent') || msg.includes('queue') || msg.includes('429') || msg.includes('limit')) {
        console.log(`  [${asset.id}] concurrency/rate limit, waiting ${RETRY_DELAY_MS / 1000}s (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }

  if (!taskId) {
    throw new Error(`Failed to submit task for ${asset.id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  // Poll until done
  const task = await pollTask(taskId, { intervalMs: 5000, timeoutMs: 900000 });
  const modelUrl = findModelUrl(task);
  if (!modelUrl) {
    throw new Error(`Task ${taskId} for ${asset.id} succeeded but no model URL in output`);
  }

  // Download
  await fs.mkdir(TEMP_DIR, { recursive: true });
  await downloadModel(modelUrl, tempPath);

  // Determine output path: if total output would exceed size budget, put in _library
  const inLibrary = shouldUseLibrary(asset);
  const categoryDir = inLibrary ? LIBRARY_DIR : path.join(OUTPUT_DIR, asset.category);
  await fs.mkdir(categoryDir, { recursive: true });
  const outPath = path.join(categoryDir, `${asset.id}.glb`);

  // Normalize
  const normResult = await normalizeGlb(tempPath, outPath, {
    targetHeight: asset.targetHeight,
    maxFaces: isHigh ? 60000 : 30000,
    draco: true,
    meshopt: false,
    textureSize: isHigh ? 1024 : 512,
  });

  // Clean temp
  try { await fs.unlink(tempPath); } catch { /* noop */ }

  // Estimate credits (actual balance delta is tracked globally)
  const estimatedCredits = isHigh ? 70 : 20;

  return {
    id: asset.id,
    category: asset.category,
    name: asset.name,
    path: inLibrary ? `_library/${asset.id}.glb` : `${asset.category}/${asset.id}.glb`,
    spec: asset.spec,
    credits: estimatedCredits,
    size: normResult.outputBytes,
    dimensions: normResult.dimensions,
    inLibrary,
    taskId,
    prompt: asset.prompt,
    tags: asset.tags,
  };
}

// ─── Library routing (size budget) ──────────────────────────────────────────
const MAIN_DIR_BUDGET_BYTES = 750 * 1024 * 1024; // 750 MB for main dirs
let mainDirUsedBytes = 0;

function shouldUseLibrary(asset: AssetRequest): boolean {
  // High-priority critical assets always go to main dirs
  if (asset.priority < 100) return false;
  // Estimate output size ~1.5MB for high, ~0.8MB for standard
  const estSize = asset.spec === 'high' ? 1.5 * 1024 * 1024 : 0.8 * 1024 * 1024;
  if (mainDirUsedBytes + estSize > MAIN_DIR_BUDGET_BYTES) return true;
  mainDirUsedBytes += estSize;
  return false;
}

// ─── Worker pool ────────────────────────────────────────────────────────────
async function runPipeline() {
  loadEnv();

  console.log('=== Open-World Asset Generation Pipeline ===');
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Output dir: ${OUTPUT_DIR}`);
  console.log(`Total assets in spec: ${ALL_ASSETS.length}`);

  // Check starting balance
  const startBalance = await getBalance();
  console.log(`Starting balance: ${startBalance.balance} (frozen: ${startBalance.frozen})`);

  if (startBalance.balance <= STOP_BALANCE) {
    console.log('Balance already at/below stop threshold. Nothing to do.');
    return;
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const stats: GenStats = {
    total: ALL_ASSETS.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    creditsSpent: 0,
    startTime: Date.now(),
  };

  const generated: WorldAsset[] = [];
  let currentBalance = startBalance.balance;
  let assetIndex = 0;

  // Worker pool
  const workers: Promise<void>[] = [];

  async function worker() {
    while (assetIndex < ALL_ASSETS.length && currentBalance > STOP_BALANCE) {
      const idx = assetIndex++;
      const asset = ALL_ASSETS[idx];

      // Skip if already exists (resume support)
      const mainPath = path.join(OUTPUT_DIR, asset.category, `${asset.id}.glb`);
      const libPath = path.join(LIBRARY_DIR, `${asset.id}.glb`);
      try {
        if (await fs.stat(mainPath)) { stats.skipped++; continue; }
      } catch { /* not found */ }
      try {
        if (await fs.stat(libPath)) { stats.skipped++; continue; }
      } catch { /* not found */ }

      try {
        const result = await generateAsset(asset, stats);
        if (result) {
          generated.push(result);
          stats.completed++;
          stats.creditsSpent += result.credits;
        }
      } catch (err) {
        stats.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [FAIL] ${asset.id}: ${msg}`);
        // If balance-related, recheck
        if (msg.includes('balance') || msg.includes('insufficient')) {
          const bal = await getBalance();
          currentBalance = bal.balance;
          console.log(`  Balance recheck: ${currentBalance}`);
        }
      }

      // Periodic balance check
      if (stats.completed % 10 === 0 && stats.completed > 0) {
        try {
          const bal = await getBalance();
          currentBalance = bal.balance;
        } catch { /* ignore */ }
        logStats(stats, currentBalance, asset.id);
        // Write intermediate manifest
        await writeManifest(OUTPUT_DIR, generated, startBalance.balance, currentBalance);
      } else if (stats.completed % 3 === 0) {
        logStats(stats, currentBalance, asset.id);
      }
    }
  }

  // Launch workers
  for (let i = 0; i < MAX_CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Final balance
  const endBalance = await getBalance();
  console.log(`\n=== Pipeline Complete ===`);
  console.log(`Completed: ${stats.completed}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Skipped (already exist): ${stats.skipped}`);
  console.log(`Estimated credits spent: ${stats.creditsSpent}`);
  console.log(`Starting balance: ${startBalance.balance}`);
  console.log(`Ending balance: ${endBalance.balance}`);
  console.log(`Elapsed: ${Math.round((Date.now() - stats.startTime) / 1000)}s`);

  // Write final manifest
  const manifestPath = await writeManifest(OUTPUT_DIR, generated, startBalance.balance, endBalance.balance);
  console.log(`Manifest written: ${manifestPath}`);

  // Cleanup temp
  try { await fs.rm(TEMP_DIR, { recursive: true, force: true }); } catch { /* noop */ }
}

runPipeline().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
