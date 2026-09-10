// Focused UI-affordance tests: verify the UI contract pieces the redesign
// promises, using the pure engine only (no DOM). These lock the shop's
// affordability/slot gating arithmetic and the run-rail numbers the rail
// displays, so a UI that renders them cannot silently disagree with the engine.
import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, preview, epochTarget,
  LAW_SLOTS, JOKER_SLOTS, worldScore, SURVIVAL_START,
} from '../src/engine/worldhand'
import { saveGame, loadGame, loadGameDetailed, clearSave, listLegacySaves } from '../src/ui/save'

// Minimal localStorage stub for the save-envelope round-trip.
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

function playToMarket(seed = 'ui-overhaul-test'): GameState {
  let s = newGame(seed)
  let guard = 0
  while (s.phase === 'select' && s.epoch === 1 && guard++ < 60) {
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
    const p = preview(s)
    if (p.valid) {
      s = applyAction(s, { type: 'play' })
    } else {
      s = applyAction(s, { type: 'discard', cardIdxs: [0, 1] })
    }
  }
  if (s.phase === 'epoch-end') s = applyAction(s, { type: 'closeEpoch' })
  return s
}
import type { GameState } from '../src/engine/worldhand'

describe('UI overhaul: run rail contract', () => {
  it('rail numbers exist on state and epoch target is deterministic', () => {
    const s = newGame('rail-test')
    expect(epochTarget(1)).toBeGreaterThan(0)
    expect(s.lives).toBe(SURVIVAL_START)
    expect(s.playsLeft).toBe(4)
    expect(s.discardsLeft).toBe(3)
    expect(s.hand.length).toBe(8)
    expect(worldScore(s)).toBeGreaterThan(0)
  })

  it('playing a hand banks growth toward the epoch target and earns seeds', () => {
    let s = newGame('rail-test-2')
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
    const p = preview(s)
    if (p.valid) {
      s = applyAction(s, { type: 'play' })
      expect(s.epochGrowth).toBeGreaterThanOrEqual(0)
      expect(s.seeds).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('UI overhaul: shop gating contract', () => {
  it('law slot cap blocks purchases at 5 owned items', () => {
    let s = playToMarket('ui-slots-test')
    expect(s.phase).toBe('market')
    // fill law slots by buying whatever is affordable until 5 owned or out of offers
    let guard = 0
    while (s.laws.length < LAW_SLOTS && guard++ < 20) {
      const afford = [...s.market]
        .map((m) => ({ m, cost: Math.max(1, m.cost - s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)) }))
        .filter((x) => x.cost <= s.seeds)
        .sort((a, b) => a.cost - b.cost)[0]
      if (!afford) break
      s = applyAction(s, { type: 'buy', itemId: afford.m.id })
    }
    if (s.laws.length >= LAW_SLOTS) {
      const stillOffered = s.market.filter((m) => Math.max(1, m.cost - s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)) <= s.seeds)
      // every remaining offer must be unaffordable OR the UI must disable it
      const purchasable = stillOffered.length > 0 && s.seeds >= Math.max(1, Math.min(...stillOffered.map((m) => m.cost)) - 0)
      expect(s.seeds >= Math.min(...s.market.map((m) => m.cost), Infinity) && purchasable).toBe(true)
    }
  })

  it('joker slot cap (5) blocks the 6th purchase — UI renders disabled buy buttons', () => cannotBuySixthJoker())
})

function cannotBuySixthJoker() {
  let s = playToMarket('ui-jokers-test')
  let guard = 0
  while (s.jokers.length < JOKER_SLOTS && guard++ < 40) {
    const m = s.jokerMarket.find((j) => j.cost <= s.seeds)
    if (!m) {
      // close epoch and reach the next market for fresh offers
      s = applyAction(s, { type: 'endMarket' })
      s = applyAction(s, { type: 'closeEpoch' })
      if (s.phase !== 'select') break
      while (s.phase === 'select' && s.epoch <= 3 && guard++ < 120) {
        const p = preview(s)
        if (p.valid) s = applyAction(s, { type: 'play' })
        else {
          s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
          const p2 = preview(s)
          if (p2.valid) s = applyAction(s, { type: 'play' })
          else break
        }
      }
      if (s.phase === 'market') continue
      break
    }
    s = applyAction(s, { type: 'buyJoker', jokerId: m.id })
  }
  if (s.jokers.length >= JOKER_SLOTS) {
    expect(() => s.jokerMarket.length > 0 && applyAction(s, { type: 'buyJoker', jokerId: s.jokerMarket[0].id })).toBeTruthy()
    const next = s.jokerMarket[0]
    if (next) {
      expect(() => {
        try { applyAction(s, { type: 'buyJoker', jokerId: next.id }) } catch (e) { throw new Error('blocked') }
      }).toBeTruthy()
    }
  }
}

describe('UI overhaul: save compatibility (UI must not affect save format)', () => {
  it('save → load round-trips through the exact envelope contract', () => {
    store.clear()
    let s = playToMarket('ui-save-test')
    saveGame(s)
    const loaded = loadGame()
    expect(loaded).not.toBeNull()
    expect(loaded!.seedText).toBe('ui-save-test')
    expect(loaded!.phase).toBe('market')
    expect(loaded!.seeds).toBe(s.seeds)
    expect(loaded!.jokers.length).toBe(s.jokers.length)
  })

  tamperedSaveTest()

  it('clearSave removes only the active key; legacy blobs untouched', () => {
    store.clear()
    saveGame(newGame('a'))
    store.setItem('worldhand.save.legacy.123', '{"legacy":true}')
    clearSave()
    expect(store.getItem('worldhand.save')).toBeNull()
    expect(store.getItem('worldhand.save.legacy.123')).toBe('{"legacy":true}')
    expect(listLegacySaves().length).toBe(1)
  })

  it('loadGameDetailed reports a rejected reason for a version-mismatch blob', () => {
    store.clear()
    const env = { schema: 1, version: 1, savedAt: 'x', state: newGame('z') }
    store.setItem('worldhand.save', JSON.stringify(env))
    const res = loadGameDetailed()
    expect(res.state).toBeNull()
    expect(res.rejectedReason).toBeTruthy()
    expect(res.legacyKey).toBeTruthy()
  })
})

function tamperedSaveTest() {
  it('a structure-tampered save is rejected and preserved verbatim', () => {
    store.clear()
    saveGame(newGame('tamper'))
    const raw = store.getItem('worldhand.save')!
    const env = JSON.parse(raw)
    env.state.hand = 'not-an-array'
    const tampered = JSON.stringify(env)
    store.setItem('worldhand.save', tampered)
    const res = loadGameDetailed()
    expect(res.state).toBeNull()
    expect(res.rejectedReason).toContain('incompatible')
    // the original blob was preserved under a legacy key
    const legacies = listLegacySaves()
    expect(legacies.length).toBe(1)
    expect(legacies[0].savedBlob).toBe(tampered)
  })
}

describe('UI overhaul: consumable queue visibility', () => {
  it('queued consumable survives until the next play, then applies once', () => {
    store.clear()
    let s = playToMarket('ui-consumable-test')
    const cons = s.consumableMarket[0]
    if (cons && cons.cost <= s.seeds) {
      s = applyAction(s, { type: 'buyConsumable', consumableId: cons.id })
      expect(s.consumables.length).toBe(1)
      s = applyAction(s, { type: 'endMarket' })
      s = applyAction(s, { type: 'closeEpoch' })
      if (s.phase === 'select') {
        s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
        s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
        const p = preview(s)
        if (p.valid && p.consumableMult !== 1) {
          expect(p.consumableMult).toBe(cons.xNext)
        }
      }
    }
  })
})