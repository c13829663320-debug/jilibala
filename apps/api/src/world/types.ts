/**
 * Shared types for the open-world asset pipeline.
 * This file is the source of truth for the manifest schema.
 * The frontend (apps/web/src/world/manifest.ts) mirrors these types.
 */

export type AssetCategory = 'buildings' | 'plaza' | 'nature' | 'props' | 'npc';

export type AssetSpec = 'high' | 'standard';

export interface WorldAsset {
  /** Unique kebab-case id, e.g. "building-court", "tree-sakura-01" */
  id: string;
  category: AssetCategory;
  /** Human-readable Chinese name */
  name: string;
  /** Path relative to /models/world/, e.g. "buildings/court.glb" */
  path: string;
  /** high = detailed geometry + HD texture + PBR + quad; standard = base */
  spec: AssetSpec;
  /** Actual Tripo credits consumed for this asset */
  credits: number;
  /** File size in bytes after normalization */
  size: number;
  /** Bounding dimensions in meters (after normalization) */
  dimensions: { width: number; height: number; depth: number };
  /** True if stored in _library/ (gitignored, generated for credit consumption) */
  inLibrary: boolean;
  /** Tripo task id for traceability */
  taskId?: string;
  /** Generation prompt used */
  prompt?: string;
  tags?: string[];
}

export interface WorldManifest {
  version: string;
  generatedAt: string;
  /** Total credits consumed across all generated assets */
  totalCredits: number;
  /** Tripo balance before generation started */
  startingBalance: number;
  /** Tripo balance after generation finished */
  endingBalance: number;
  assets: WorldAsset[];
}

/** Specification for one asset to be generated, before it exists. */
export interface AssetRequest {
  id: string;
  category: AssetCategory;
  name: string;
  /** English prompt for Tripo text_to_model */
  prompt: string;
  spec: AssetSpec;
  /** Target bounding height in meters (normalizer scales to this) */
  targetHeight: number;
  /** Priority: lower = generated first. 0 = critical path. */
  priority: number;
  tags?: string[];
}

/** Estimated credits per spec tier (actual may vary; pipeline verifies via balance). */
export const SPEC_CREDITS: Record<AssetSpec, number> = {
  high: 70,     // base 20 + detailed geometry 30 + pbr 5 + detailed texture 10 + quad 5
  standard: 20, // base 20 only
};
