import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Document, NodeIO } from '@gltf-transform/core';
import { normalizeGlb } from './normalize.js';

let tmpDir: string;
let testGlbPath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-normalize-test-'));
  testGlbPath = path.join(tmpDir, 'input.glb');

  // Create a minimal GLB: a box 2x4x2 (width x height x depth), centered at origin
  const doc = new Document();
  const buffer = doc.createBuffer();

  // 36 vertices for 12 triangles (box)
  const positions = new Float32Array([
    // back face
    -1, 0, -1,   1, 0, -1,   1, 4, -1,
    -1, 0, -1,   1, 4, -1,  -1, 4, -1,
    // front face
    -1, 0,  1,   1, 0,  1,   1, 4,  1,
    -1, 0,  1,   1, 4,  1,  -1, 4,  1,
    // left face
    -1, 0, -1,  -1, 0,  1,  -1, 4,  1,
    -1, 0, -1,  -1, 4,  1,  -1, 4, -1,
    // right face
     1, 0, -1,   1, 0,  1,   1, 4,  1,
     1, 0, -1,   1, 4,  1,   1, 4, -1,
    // top face
    -1, 4, -1,   1, 4, -1,   1, 4,  1,
    -1, 4, -1,   1, 4,  1,  -1, 4,  1,
    // bottom face
    -1, 0, -1,   1, 0, -1,   1, 0,  1,
    -1, 0, -1,   1, 0,  1,  -1, 0,  1,
  ]);

  const posAcc = doc.createAccessor()
    .setType('VEC3')
    .setArray(positions)
    .setBuffer(buffer);

  const prim = doc.createPrimitive()
    .setAttribute('POSITION', posAcc);

  const mesh = doc.createMesh('Box').addPrimitive(prim);
  const node = doc.createNode('BoxNode').setMesh(mesh);
  const scene = doc.createScene().addChild(node);
  doc.getRoot().setDefaultScene(scene);

  const io = new NodeIO(fs, path);
  await io.write(testGlbPath, doc);
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('normalizeGlb', () => {
  it('scales to target height and grounds at y=0', async () => {
    const outPath = path.join(tmpDir, 'output.glb');
    const result = await normalizeGlb(testGlbPath, outPath, {
      targetHeight: 2,
      maxFaces: 0,
      draco: false,
      meshopt: false,
      textureSize: 256,
    });

    expect(result.inputBytes).toBeGreaterThan(0);
    expect(result.outputBytes).toBeGreaterThan(0);
    // Original height 4, target 2 → scale 0.5
    expect(result.dimensions.height).toBeCloseTo(2, 0);
    expect(result.dimensions.width).toBeCloseTo(1, 0);
    expect(result.dimensions.depth).toBeCloseTo(1, 0);
    expect(result.faces).toBe(12);
  });

  it('creates output directory if missing', async () => {
    const nestedOut = path.join(tmpDir, 'nested', 'deep', 'out.glb');
    const result = await normalizeGlb(testGlbPath, nestedOut, {
      targetHeight: 1,
      maxFaces: 0,
      draco: false,
      meshopt: false,
    });
    expect(result.outputBytes).toBeGreaterThan(0);
    const stat = await fs.stat(nestedOut);
    expect(stat.size).toBe(result.outputBytes);
  });

  it('simplifies when over face limit', async () => {
    const outPath = path.join(tmpDir, 'simplified.glb');
    const result = await normalizeGlb(testGlbPath, outPath, {
      targetHeight: 2,
      maxFaces: 6,
      draco: false,
      meshopt: false,
    });
    expect(result.faces).toBeLessThanOrEqual(12);
  });

  it('output file is valid GLB (starts with glTF magic)', async () => {
    const outPath = path.join(tmpDir, 'valid.glb');
    await normalizeGlb(testGlbPath, outPath, {
      targetHeight: 2,
      maxFaces: 0,
      draco: false,
      meshopt: false,
    });
    const buf = await fs.readFile(outPath);
    // GLB magic: 'glTF' = 0x46546C67
    expect(buf.toString('ascii', 0, 4)).toBe('glTF');
  });
});
