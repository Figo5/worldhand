import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, epochTarget, SAVE_VERSION, SCHEMA_VERSION,
  JOKERS, PLANET_CARDS, CONSUMABLES, VOUCHERS, MARKET_ITEMS,
  type GameState,
} from '../src/engine/worldhand'
import type { Card, Suit as PSuit } from '../src/engine/poker'

const C = (r: number, s: PSuit): Card => ({ r: r as Card['r'], s })

function forceHand(s: GameState, cards: Card[]): GameState {
  return { ...s, hand: [...cards], deckRest: [...s.hand, ...s.deckRest.slice(cards.length)] }
}

function snapshotScoreInventory(s: GameState) {
  return JSON.stringify({
    lives: s.lives,
    seeds: s.seeds,
    worldLevel: s.worldLevel,
    flourishing: s.flourishing,
    epochGrowth: s.epochGrowth,
    laws: s.laws,
    projects: s.projects,
    jokers: s.jokers,
    planetLevels: s.planetLevels,
    consumables: s.consumables,
    vouchers: s.vouchers,
  })
}

function staleDeadMarket(seed = 'stale-dead-market'): GameState {
  const s = newGame(seed)
  return {
    ...s,
    phase: 'market',
    lives: 0,
    seeds: 1_000,
    market: [{ ...MARKET_ITEMS[0] }],
    projectMarket: [{ id: 'proj-growth', title: 'Fertile Soil', desc: '+2 Growth on every play.', baseCost: 15, costGrowth: 8, growthFlat: 2 }],
    jokerMarket: [{ ...JOKERS[0] }],
    planetMarket: [{ ...PLANET_CARDS[0] }],
    consumableMarket: [{ ...CONSUMABLES[0] }],
    voucherMarket: [{ ...VOUCHERS[0] }],
  }
}

describe('zero-life death boundary', () => {
  it('the final missed target transitions directly to game-over without opening a spendable market', () => {
    let s = newGame('death-final-miss')
    s = {
      ...s,
      epoch: 9,
      lives: 1,
      seeds: 50,
      epochGrowth: 0,
      playsLeft: 1,
      phase: 'select',
    }
    s = forceHand(s, [C(2, 'C')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    const after = applyAction(s, { type: 'play' })

    expect(after.epochGrowth).toBeLessThan(epochTarget(9))
    expect(after.lives).toBe(0)
    expect(after.phase).toBe('game-over')
    expect(after.outcome).toBe('withered')
    expect(after.outcomeReason).toMatch(/out of lives/i)
    expect(after.market).toHaveLength(0)
    expect(after.projectMarket).toHaveLength(0)
    expect(after.jokerMarket).toHaveLength(0)
    expect(after.planetMarket).toHaveLength(0)
    expect(after.consumableMarket).toHaveLength(0)
    expect(after.voucherMarket).toHaveLength(0)
    expect(after.log.at(-1)!.text).toMatch(/world withers|game over/i)
    expect(after.log.map((l) => l.text).join('\n')).not.toMatch(/next epoch's market opens/i)
  })

  it('a miss that leaves at least one life still opens the normal recoverable market', () => {
    let s = newGame('death-still-alive-miss')
    s = { ...s, epoch: 6, lives: 2, epochGrowth: 0, playsLeft: 1, phase: 'select' }
    s = forceHand(s, [C(2, 'C')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    const after = applyAction(s, { type: 'play' })

    expect(after.lives).toBe(1)
    expect(after.phase).toBe('market')
    expect(after.outcome).toBeNull()
    expect(after.market.length + after.projectMarket.length + after.jokerMarket.length).toBeGreaterThan(0)
    expect(after.log.map((l) => l.text).join('\n')).toMatch(/next epoch's market opens/i)
  })

  it('stale or malicious market purchases cannot mutate a 0-life run', () => {
    for (const action of [
      { type: 'buy', itemId: MARKET_ITEMS[0].id },
      { type: 'buyProject', projectId: 'proj-growth' },
      { type: 'buyJoker', jokerId: JOKERS[0].id },
      { type: 'buyPlanet', planetId: PLANET_CARDS[0].id },
      { type: 'buyConsumable', consumableId: CONSUMABLES[0].id },
      { type: 'buyVoucher', voucherId: VOUCHERS[0].id },
      { type: 'boostWorld' },
      { type: 'removeLaw', lawId: MARKET_ITEMS[0].id },
      { type: 'endMarket' },
    ] as const) {
      const s = staleDeadMarket(`dead-${action.type}`)
      const before = snapshotScoreInventory(s)
      const after = applyAction(s, action as any)
      expect(after.phase).toBe('game-over')
      expect(after.outcome).toBe('withered')
      expect(snapshotScoreInventory(after)).toBe(before)
    }
  })

  it('loading a valid-version stale dead-market save returns a non-spendable game-over state without legacy rejection', async () => {
    const mod = await import('../src/ui/save')
    const store = new Map<string, string>()
    const g = globalThis as any
    const prev = g.localStorage
    g.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      get length() { return store.size },
      key: (i: number) => [...store.keys()][i] ?? null,
    }
    try {
      const rawState = staleDeadMarket('load-stale-dead')
      store.set('worldhand.save', JSON.stringify({
        schema: SCHEMA_VERSION,
        version: SAVE_VERSION,
        savedAt: '2026-09-11T00:00:00.000Z',
        state: rawState,
      }))
      const res = mod.loadGameDetailed()
      expect(res.rejectedReason).toBeNull()
      expect(res.legacyKey).toBeNull()
      expect(res.state).not.toBeNull()
      expect(res.state!.phase).toBe('game-over')
      expect(res.state!.outcome).toBe('withered')
      expect(res.state!.seeds).toBe(rawState.seeds)
      expect(res.state!.laws).toHaveLength(0)
    } finally {
      g.localStorage = prev
      if (!prev) delete g.localStorage
    }
  })
})
