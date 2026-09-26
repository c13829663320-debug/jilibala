import { describe, it, expect } from 'vitest';
import { ALL_ASSETS, ASSET_COUNT } from './asset-spec.js';
import { SPEC_CREDITS } from './types.js';

describe('asset-spec', () => {
  it('has assets', () => {
    expect(ALL_ASSETS.length).toBeGreaterThan(100);
    expect(ASSET_COUNT).toBe(ALL_ASSETS.length);
  });

  it('is sorted by priority ascending', () => {
    for (let i = 1; i < ALL_ASSETS.length; i++) {
      expect(ALL_ASSETS[i].priority).toBeGreaterThanOrEqual(ALL_ASSETS[i - 1].priority);
    }
  });

  it('has unique ids', () => {
    const ids = ALL_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every asset has required fields', () => {
    for (const a of ALL_ASSETS) {
      expect(a.id).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.prompt).toBeTruthy();
      expect(a.prompt.length).toBeGreaterThan(10);
      expect(['buildings', 'plaza', 'nature', 'props', 'npc']).toContain(a.category);
      expect(['high', 'standard']).toContain(a.spec);
      expect(a.targetHeight).toBeGreaterThan(0);
      expect(a.priority).toBeGreaterThanOrEqual(0);
    }
  });

  it('has all 6 landmark buildings with highest priority', () => {
    const landmarks = ALL_ASSETS.filter((a) => a.tags?.includes('landmark') && a.category === 'buildings');
    const buildingIds = ['building-court', 'building-talkshow', 'building-werewolf', 'building-bar', 'building-gym', 'building-library'];
    for (const id of buildingIds) {
      const found = ALL_ASSETS.find((a) => a.id === id);
      expect(found, `missing ${id}`).toBeTruthy();
      expect(found!.priority).toBe(0);
      expect(found!.spec).toBe('high');
    }
  });

  it('has assets in all categories', () => {
    const categories = new Set(ALL_ASSETS.map((a) => a.category));
    expect(categories.has('buildings')).toBe(true);
    expect(categories.has('plaza')).toBe(true);
    expect(categories.has('nature')).toBe(true);
    expect(categories.has('props')).toBe(true);
    expect(categories.has('npc')).toBe(true);
  });

  it('estimated total credits is substantial (>10000)', () => {
    const total = ALL_ASSETS.reduce((s, a) => s + SPEC_CREDITS[a.spec], 0);
    expect(total).toBeGreaterThan(10000);
  });

  it('has NPC placeholders', () => {
    const npcs = ALL_ASSETS.filter((a) => a.category === 'npc');
    expect(npcs.length).toBeGreaterThanOrEqual(3);
  });

  it('has teleport waypoints', () => {
    const waypoints = ALL_ASSETS.filter((a) => a.tags?.includes('teleport'));
    expect(waypoints.length).toBeGreaterThanOrEqual(1);
  });
});
