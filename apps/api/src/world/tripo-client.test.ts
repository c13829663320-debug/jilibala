import { describe, it, expect } from 'vitest';
import { findModelUrl, type TripoTask } from './tripo-client.js';

describe('tripo-client findModelUrl', () => {
  it('extracts model URL from output.model', () => {
    const task: TripoTask = {
      status: 'success',
      output: { model: 'https://cdn.tripo3d.ai/model.glb' },
    };
    expect(findModelUrl(task)).toBe('https://cdn.tripo3d.ai/model.glb');
  });

  it('extracts pbr_model URL when model is absent', () => {
    const task: TripoTask = {
      status: 'success',
      output: { pbr_model: 'https://cdn.tripo3d.ai/pbr.glb' },
    };
    expect(findModelUrl(task)).toBe('https://cdn.tripo3d.ai/pbr.glb');
  });

  it('extracts URL from object with url property', () => {
    const task: TripoTask = {
      status: 'success',
      output: { model: { url: 'https://cdn.tripo3d.ai/obj.glb' } },
    };
    expect(findModelUrl(task)).toBe('https://cdn.tripo3d.ai/obj.glb');
  });

  it('returns undefined for empty output', () => {
    expect(findModelUrl({})).toBeUndefined();
    expect(findModelUrl({ output: {} })).toBeUndefined();
  });

  it('returns undefined for non-URL strings', () => {
    const task: TripoTask = { output: { model: 'not-a-url' } };
    expect(findModelUrl(task)).toBeUndefined();
  });

  it('prefers model over pbr_model', () => {
    const task: TripoTask = {
      output: {
        model: 'https://cdn.tripo3d.ai/first.glb',
        pbr_model: 'https://cdn.tripo3d.ai/second.glb',
      },
    };
    expect(findModelUrl(task)).toBe('https://cdn.tripo3d.ai/first.glb');
  });
});
