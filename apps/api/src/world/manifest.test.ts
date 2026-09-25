import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeManifest, readManifest } from './manifest.js';
import type { WorldAsset } from './types.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-manifest-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('manifest write/read', () => {
  const assets: WorldAsset[] = [
    {
      id: 'test-building',
      category: 'buildings',
      name: '测试建筑',
      path: 'buildings/test.glb',
      spec: 'high',
      credits: 70,
      size: 1024000,
      dimensions: { width: 10, height: 12, depth: 8 },
      inLibrary: false,
      tags: ['test'],
    },
    {
      id: 'test-tree',
      category: 'nature',
      name: '测试树',
      path: 'nature/tree.glb',
      spec: 'standard',
      credits: 20,
      size: 200000,
      dimensions: { width: 3, height: 8, depth: 3 },
      inLibrary: true,
    },
  ];

  it('writes and reads back a manifest', async () => {
    const manifestPath = await writeManifest(tmpDir, assets, 21210, 100);
    expect(manifestPath).toContain('world-manifest.json');

    const read = await readManifest(tmpDir);
    expect(read).not.toBeNull();
    expect(read!.version).toBe('1.0.0');
    expect(read!.startingBalance).toBe(21210);
    expect(read!.endingBalance).toBe(100);
    expect(read!.totalCredits).toBe(90);
    expect(read!.assets).toHaveLength(2);
    expect(read!.assets[0].id).toBe('test-building');
    expect(read!.assets[1].inLibrary).toBe(true);
  });

  it('returns null for missing manifest', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-'));
    const result = await readManifest(emptyDir);
    expect(result).toBeNull();
    await fs.rm(emptyDir, { recursive: true, force: true });
  });

  it('totalCredits sums all asset credits', async () => {
    await writeManifest(tmpDir, assets, 1000, 50);
    const read = await readManifest(tmpDir);
    expect(read!.totalCredits).toBe(assets.reduce((s, a) => s + a.credits, 0));
  });
});
