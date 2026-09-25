/**
 * Manifest writer for the open-world asset pipeline.
 * Writes world-manifest.json to the output directory.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorldAsset, WorldManifest } from './types.js';

export async function writeManifest(
  outputDir: string,
  assets: WorldAsset[],
  startingBalance: number,
  endingBalance: number,
): Promise<string> {
  const manifest: WorldManifest = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    totalCredits: assets.reduce((sum, a) => sum + a.credits, 0),
    startingBalance,
    endingBalance,
    assets,
  };

  const manifestPath = path.join(outputDir, 'world-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifestPath;
}

export async function readManifest(outputDir: string): Promise<WorldManifest | null> {
  const manifestPath = path.join(outputDir, 'world-manifest.json');
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as WorldManifest;
  } catch {
    return null;
  }
}
