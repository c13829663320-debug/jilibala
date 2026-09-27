import { describe, it, expect } from 'vitest'
import {
  buildCrashSnapshot,
  recordCrashSnapshot,
  loadCrashSnapshot,
  clearCrashSnapshot,
  resolveSafeReturn,
  memoryStorage,
} from './crash-recovery'

describe('crash-recovery', () => {
  it('round-trips a snapshot', () => {
    const s = memoryStorage()
    const snap = buildCrashSnapshot('/court', 'court')
    recordCrashSnapshot(snap, s)
    const loaded = loadCrashSnapshot(s)
    expect(loaded?.route).toBe('/court')
    expect(loaded?.scene).toBe('court')
  })

  it('returns null when empty', () => {
    expect(loadCrashSnapshot(memoryStorage())).toBeNull()
  })

  it('ignores corrupt JSON', () => {
    const s = memoryStorage({ 'balabala.crash-snapshot-v1': '{{{not json' })
    expect(loadCrashSnapshot(s)).toBeNull()
  })

  it('expires snapshots older than 10 minutes', () => {
    const old = buildCrashSnapshot('/plaza', 'plaza')
    old.at = Date.now() - 11 * 60 * 1000
    const s = memoryStorage({ 'balabala.crash-snapshot-v1': JSON.stringify(old) })
    expect(loadCrashSnapshot(s)).toBeNull()
  })

  it('clear removes the snapshot', () => {
    const s = memoryStorage()
    recordCrashSnapshot(buildCrashSnapshot('/x', null), s)
    clearCrashSnapshot(s)
    expect(loadCrashSnapshot(s)).toBeNull()
  })

  it('resolveSafeReturn defaults to plaza', () => {
    expect(resolveSafeReturn(null)).toBe('/')
    expect(resolveSafeReturn(buildCrashSnapshot('/court', 'court'))).toBe('/')
  })
})
