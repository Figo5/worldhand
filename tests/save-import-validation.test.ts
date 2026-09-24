// Imported saves are untrusted input: a hand-edited file must not be able to
// put NaN into Growth. Every owned or offered item has to be a copy of a
// current catalog entry, planet levels and region development have to be sane
// numbers, and anything else is rejected (import: not written; load: preserved
// as legacy). Genuine saves, including every state of the recorded Classic
// replays, must still load exactly as before.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  newGame, applyAction, preview, validateState, SAVE_VERSION, SCHEMA_VERSION,
  type GameState,
} from '../src/engine/worldhand'
import { saveGame, loadGame, loadGameDetailed, listLegacySaves, importSave } from '../src/ui/save'
import { decodeAction } from '../scripts/lib/replay-codec.mjs'
import fixture from './fixtures/classic-replays.json'

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

/** JSON cannot carry Infinity, but a hand-edited file can: `1e999` parses as
 *  Infinity. These sentinels become that literal in the blob. */
const INF = '__inf__'
const NEG_INF = '__neg_inf__'
const blobOf = (state: unknown) =>
  JSON.stringify({ schema: SCHEMA_VERSION, version: SAVE_VERSION, savedAt: 'test', state })
    .replaceAll(`"${INF}"`, '1e999')
    .replaceAll(`"${NEG_INF}"`, '-1e999')

/** A genuine run in its first market after buying one of everything, so every
 *  owned list and every offer list is non-empty. */
function stocked(): GameState {
  let s = newGame('save-import-validation')
  while (s.phase === 'select') {
    for (let i = 0; i < Math.min(5, s.hand.length); i++) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    s = applyAction(s, { type: 'play' })
  }
  s = { ...s, seeds: 1000 }
  s = applyAction(s, { type: 'buyJoker', jokerId: s.jokerMarket[0].id })
  s = applyAction(s, { type: 'buyPlanet', planetId: s.planetMarket[0].id })
  s = applyAction(s, { type: 'buyConsumable', consumableId: s.consumableMarket[0].id })
  s = applyAction(s, { type: 'buyVoucher', voucherId: s.voucherMarket[0].id })
  s = applyAction(s, { type: 'buyProject', projectId: s.projectMarket[0].id })
  s = applyAction(s, { type: 'buy', itemId: s.market[0].id })
  return s
}

/** Owned and offered item lists. Offers matter too: buying one copies it into
 *  the owned list as-is. */
const ITEM_LISTS = [
  'jokers', 'vouchers', 'consumables', 'projects', 'laws',
  'jokerMarket', 'planetMarket', 'consumableMarket', 'voucherMarket', 'projectMarket', 'market',
] as const
type ItemList = typeof ITEM_LISTS[number]
const itemsOf = (s: GameState, list: ItemList) => s[list] as unknown as Record<string, unknown>[]

/** Values no genuine save contains in a mechanical field. -1e308 is finite but
 *  can still overflow Growth (-Infinity + Infinity is NaN). */
const BAD_VALUES: unknown[] = ['x', null, true, {}, [], INF, NEG_INF, -1e308]
/** Mechanical fields some items lack; injecting one must not slip through. */
const INJECTED_FIELDS = ['mult', 'jokerMult', 'xNext', 'growthFlat', 'growthMult', 'boost']

/** Every Growth the run can preview in its next hand: all 1-5 card subsets. */
function everyGrowth(state: GameState): number[] {
  let s = state
  if (s.phase === 'market') s = applyAction(s, { type: 'endMarket' })
  if (s.phase === 'epoch-end') s = applyAction(s, { type: 'closeEpoch' })
  const out: number[] = []
  const n = s.hand.length
  for (let mask = 1; mask < 1 << n; mask++) {
    const sel = [...Array(n).keys()].filter((i) => mask & (1 << i))
    if (sel.length <= 5) out.push(preview({ ...s, selected: sel }).growth)
  }
  return out
}

describe('imported saves: owned and offered items must match the catalog', () => {
  beforeEach(() => { store.clear() })

  it('rejects a joker with a non-numeric mult (the reported NaN Growth save)', () => {
    const mine = stocked()
    saveGame(mine)
    const bad = structuredClone(mine)
    itemsOf(bad, 'jokers')[0].mult = 'x'
    const res = importSave(blobOf(bad))
    expect(res.state).toBeNull()
    expect(res.rejectedReason).toMatch(/jokers/)
    expect(res.rejectedReason).toMatch(/mult/)
    expect(loadGame()).toEqual(mine) // the save already on this device is untouched
  })

  it('rejects every non-cosmetic edit to owned/offered items, planet levels and development; accepted edits never preview NaN', () => {
    const base = stocked()
    const variants: { label: string; state: GameState; cosmetic: boolean }[] = []
    for (const list of ITEM_LISTS) {
      const fields = [...new Set([...Object.keys(itemsOf(base, list)[0]), ...INJECTED_FIELDS])]
      for (const field of fields) {
        for (const value of [...BAD_VALUES, 'x-renamed']) {
          const state = structuredClone(base)
          itemsOf(state, list)[0][field] = value
          const cosmetic = (field === 'title' || field === 'desc') && typeof value === 'string' && value !== INF && value !== NEG_INF
          variants.push({ label: `${list}[0].${field} = ${JSON.stringify(value)}`, state, cosmetic })
        }
      }
    }
    for (const value of [...BAD_VALUES, -0.5]) {
      const state = structuredClone(base)
      const [cat] = Object.keys(state.planetLevels) as (keyof GameState['planetLevels'])[]
      ;(state.planetLevels as Record<string, unknown>)[cat] = value
      variants.push({ label: `planetLevels.${cat} = ${JSON.stringify(value)}`, state, cosmetic: false })
    }
    for (const cat of ['high', 'straight-flush', 'made-up']) {
      const state = structuredClone(base)
      ;(state.planetLevels as Record<string, unknown>)[cat] = 0.5
      variants.push({ label: `planetLevels["${cat}"] = 0.5`, state, cosmetic: false })
    }
    for (const value of [...BAD_VALUES, -1, 1.5]) {
      const state = structuredClone(base)
      ;(state.regions[0] as unknown as Record<string, unknown>).development = value
      variants.push({ label: `regions[0].development = ${JSON.stringify(value)}`, state, cosmetic: false })
    }

    const wronglyAccepted: string[] = []
    for (const v of variants) {
      const res = importSave(blobOf(v.state))
      if (res.state === null) {
        expect(v.cosmetic, `${v.label} is only cosmetic and should load`).toBe(false)
        expect(res.rejectedReason, v.label).toBeTruthy()
        continue
      }
      if (!v.cosmetic) wronglyAccepted.push(v.label)
      expect(everyGrowth(res.state).some(Number.isNaN), `${v.label} previews NaN Growth`).toBe(false)
    }
    expect(wronglyAccepted).toEqual([])
    expect(variants.filter((v) => !v.cosmetic).length).toBeGreaterThan(400)
  })

  it('rejects unknown ids in every owned and offered list', () => {
    const base = stocked()
    for (const list of ITEM_LISTS) {
      for (const id of ['made-up-id', 42, null]) {
        const bad = structuredClone(base)
        itemsOf(bad, list)[0].id = id
        const res = importSave(blobOf(bad))
        expect(res.state, `${list} id ${JSON.stringify(id)}`).toBeNull()
        expect(res.rejectedReason).toMatch(new RegExp(list))
      }
    }
  })

  it('a malformed save already in storage is rejected and preserved verbatim as legacy data', () => {
    const bad = structuredClone(stocked())
    itemsOf(bad, 'vouchers')[0].jokerMult = INF
    const raw = blobOf(bad)
    store.setItem('worldhand.save', raw)
    const res = loadGameDetailed()
    expect(res.state).toBeNull()
    expect(res.rejectedReason).toMatch(/vouchers/)
    expect(res.legacyKey).not.toBeNull()
    expect(store.getItem(res.legacyKey as string)).toBe(raw)
    expect(listLegacySaves()).toHaveLength(1)
    expect(store.getItem('worldhand.save')).toBe(raw) // never erased
  })
})

describe('imported saves: genuine saves still load unchanged', () => {
  beforeEach(() => { store.clear() })

  it('a run owning one of everything round-trips through import and load', () => {
    const s = stocked()
    expect(validateState(s)).toBeNull()
    const res = importSave(blobOf(s))
    expect(res.rejectedReason).toBeNull()
    expect(res.state).toEqual(s)
    expect(loadGameDetailed().state).toEqual(s)
    expect(everyGrowth(s).every(Number.isFinite)).toBe(true)
  })

  it('every state of every recorded Classic replay passes validation after a JSON round trip', () => {
    let checked = 0
    for (const run of fixture.runs) {
      let s: GameState = newGame(run.seed)
      for (const code of run.actions.split(' ')) {
        s = applyAction(s, decodeAction(code))
        const reason = validateState(JSON.parse(JSON.stringify(s)))
        if (reason !== null) expect(reason, `${run.policy} ${run.seed} after "${code}"`).toBeNull()
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })
})
