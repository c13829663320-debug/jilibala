/**
 * World asset normalizer.
 * Scales model to target height, centers horizontally, grounds at y=0,
 * compresses with Draco/Meshopt, and limits face count.
 *
 * Different from character normalization: world assets use real-world meters,
 * bottom-grounded, xz-centered. Does NOT touch normalize-character-model.ts.
 */
import { NodeIO, Logger, type Document } from '@gltf-transform/core';
import { KHRDracoMeshCompression, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, quantize, simplify, textureCompress, weld, draco, meshopt } from '@gltf-transform/functions';
import * as draco3d from 'draco3d';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import path from 'node:path';
import fs from 'node:fs/promises';

export interface NormalizeOptions {
  targetHeight: number;
  maxFaces?: number;
  draco?: boolean;
  meshopt?: boolean;
  textureSize?: number;
}

export interface NormalizeResult {
  inputBytes: number;
  outputBytes: number;
  dimensions: { width: number; height: number; depth: number };
  faces: number;
}

let dracoEncoder: unknown | null = null;
let dracoDecoder: unknown | null = null;
let meshoptReady = false;

async function ensureEncoders() {
  if (!dracoEncoder) {
    const d = draco3d as unknown as { createEncoder?: () => unknown; createDecoder?: () => unknown };
    dracoEncoder = d.createEncoder?.() ?? null;
    dracoDecoder = d.createDecoder?.() ?? null;
  }
  if (!meshoptReady) {
    try { await MeshoptEncoder.ready; meshoptReady = true; } catch { meshoptReady = false; }
  }
}

function countFaces(doc: Document): number {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) total += indices.getCount() / 3;
      else {
        const pos = prim.getAttribute('POSITION');
        if (pos) total += pos.getCount() / 3;
      }
    }
  }
  return total;
}

export async function normalizeGlb(
  inputPath: string,
  outputPath: string,
  opts: NormalizeOptions,
): Promise<NormalizeResult> {
  await ensureEncoders();

  const io = new NodeIO(fs)
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions([KHRDracoMeshCompression, EXTMeshoptCompression])
    .registerDependencies({
      'draco3d.encoder': dracoEncoder,
      'draco3d.decoder': dracoDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });

  const inputBytes = (await fs.stat(inputPath)).size;
  const doc = await io.read(inputPath);

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const data = pos.getArray();
      if (!data) continue;
      for (let i = 0; i < data.length; i += 3) {
        const x = data[i], y = data[i + 1], z = data[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
  }

  if (!isFinite(minX)) {
    minX = minY = minZ = -1;
    maxX = maxY = maxZ = 1;
  }

  const origHeight = maxY - minY || 1;
  const scale = opts.targetHeight / origHeight;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  // Apply transform to all nodes
  for (const node of doc.getRoot().listNodes()) {
    const t = node.getTranslation();
    node.setTranslation([
      (t[0] - centerX) * scale,
      (t[1] - minY) * scale,
      (t[2] - centerZ) * scale,
    ]);
    const s = node.getScale();
    node.setScale([s[0] * scale, s[1] * scale, s[2] * scale]);
  }

  // Weld vertices
  await doc.transform(weld());

  // Simplify if over face limit
  const maxFaces = opts.maxFaces ?? 50000;
  if (maxFaces > 0) {
    const totalFaces = countFaces(doc);
    if (totalFaces > maxFaces) {
      const ratio = Math.max(0.2, maxFaces / totalFaces);
      await doc.transform(simplify({ ratio, error: 0.01, simplifier: MeshoptSimplifier }));
    }
  }

  // Dedup and quantize
  await doc.transform(dedup());
  await doc.transform(quantize());

  // Texture compression (resize handled by limitInputPixels; no explicit size in v4)
  try {
    await doc.transform(textureCompress({ lossless: false }));
  } catch { /* optional */ }

  // Meshopt compression
  if (opts.meshopt && meshoptReady) {
    try { await doc.transform(meshopt({ encoder: MeshoptEncoder })); } catch { /* optional */ }
  }

  // Draco compression
  if (opts.draco && dracoEncoder) {
    try { await doc.transform(draco({})); } catch { /* optional */ }
  }

  // Ensure output directory
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Write
  await io.write(outputPath, doc);
  const outputBytes = (await fs.stat(outputPath)).size;
  const outFaces = countFaces(doc);

  return {
    inputBytes,
    outputBytes,
    dimensions: {
      width: (maxX - minX) * scale,
      height: opts.targetHeight,
      depth: (maxZ - minZ) * scale,
    },
    faces: Math.round(outFaces),
  };
}
