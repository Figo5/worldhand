// Portable save transfer: export the current save as a blob a player can carry
// to another machine (the portable single-file build has no backend), and
// import it back through the SAME version+structure gate `loadGameDetailed`
// uses. A rejected import must never damage the save already on this device.
import { describe, it, expect, beforeEach } from 'vitest'
import { newGame, applyAction, SAVE_VERSION, SCHEMA_VERSION } from '../src/engine/worldhand'
import { saveGame, loadGame, exportSave, importSave } from '../src/ui/save'

class MemStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null }
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
const store = new MemStorage()
;(globalThis as unknown as { localStorage: MemStorage }).localStorage = store

function played() {
  let s = newGame('portable-save-seed')
  s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
  s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
  s = applyAction(s, { type: 'play' })
  return s
}

describe('portable save export/import', () => {
  beforeEach(() => { store.clear() })

  it('exports null when there is nothing saved', () => {
    expect(exportSave()).toBeNull()
  })

  it('exports a versioned envelope that round-trips onto a clean device', () => {
    const s = played()
    saveGame(s)
    const blob = exportSave()
    expect(blob).not.toBeNull()
    const env = JSON.parse(blob as string)
    expect(env.schema).toBe(SCHEMA_VERSION)
    expect(env.version).toBe(SAVE_VERSION)
    expect(env.state.seed).toBe(s.seed)

    store.clear() // the "other device"
    const res = importSave(blob as string)
    expect(res.rejectedReason).toBeNull()
    expect(res.state).not.toBeNull()
    expect(loadGame()).toEqual(s)
  })

  it('rejects a foreign-engine blob and leaves the local save intact', () => {
    const mine = played()
    saveGame(mine)
    const foreign = JSON.stringify({ schema: SCHEMA_VERSION, version: SAVE_VERSION - 1, savedAt: 'x', state: mine })
    const res = importSave(foreign)
    expect(res.state).toBeNull()
    expect(res.rejectedReason).toMatch(/version/i)
    expect(loadGame()).toEqual(mine)
  })

  it('rejects a structurally invalid blob and leaves the local save intact', () => {
    const mine = played()
    saveGame(mine)
    const broken = JSON.parse(JSON.stringify({ schema: SCHEMA_VERSION, version: SAVE_VERSION, savedAt: 'x', state: mine }))
    broken.state.lives = 'three'
    const res = importSave(JSON.stringify(broken))
    expect(res.state).toBeNull()
    expect(res.rejectedReason).not.toBeNull()
    expect(loadGame()).toEqual(mine)
  })

  it('rejects non-JSON garbage and leaves the local save intact', () => {
    const mine = played()
    saveGame(mine)
    const res = importSave('not a save file')
    expect(res.state).toBeNull()
    expect(res.rejectedReason).toMatch(/JSON|corrupt/i)
    expect(loadGame()).toEqual(mine)
  })
})
