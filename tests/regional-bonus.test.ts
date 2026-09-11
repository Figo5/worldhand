// Regional-bonus system (TDD — written FIRST, red before the implementation).
// Design contract (declared before coding, exact numbers pinned here AND in
// RULES.md):
//   - Region.specialization: null | 'pair' | 'twopair' | 'flush' — an EXACT
//     evaluated poker category; a dormant region contributes ZERO.
//   - regionBonus = base + min(DEV_BONUS_CAP, floor(development / DEV_STEP))
//     with PAIR_BASE=3, TWOPAIR_BASE=4, FLUSH_BASE=6, DEV_STEP=2, DEV_BONUS_CAP=4.
//   - Deterministic mapping: Auralia (id 0) = pair (STARTS AWAKE); Pellucid
//     (id 6) = twopair (starts dormant); Vantage (id 11) = flush (starts
//     dormant). Same seed -> same mapping; terrain identity unchanged.
//   - Stacking: additive across ALL awake matching regions; applied ONCE,
//     AFTER the law-adjusted Growth:
//     Growth = max(0, round(pokerBase x lawMult) + lawFlat + totalRegionBonus).
//     growthParts = { poker, laws, regions } with poker + laws + regions == growth.
//   - Shop: wake-pellucid / wake-vantage expansions (cost 12, matching the
//     existing wake-* convention) awaken the advertised region and its bonus.
//   - SAVE_VERSION 3 -> 4: v3 saves are REJECTED and preserved as legacy.
//     SCHEMA_VERSION stays 3 (envelope layout unchanged).
import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, preview, buildPlan, validateState,
  PAIR_BASE, TWOPAIR_BASE, FLUSH_BASE, DEV_STEP, DEV_BONUS_CAP,
  MARKET_ITEMS, SAVE_VERSION, epochTarget,
  type GameState, type Region,
} from '../src/engine/worldhand'
import type { Card, Suit as PSuit } from '../engine/poker'

const C = (r: number, s: PSuit): Card => ({ r: r as Card['r'], s })

/** conservation-legal hand swap (same helper pattern as the fix regressions). */
function forceHand(s: GameState, cards: Card[]): GameState {
  return { ...s, hand: [...cards], deckRest: [...s.hand, ...s.deckRest.slice(cards.length)] } as GameState
}

/** Craft a region list with given specialization/dev/dormant per id. */
function withRegions(s: GameState, mutate: (rs: Region[]) => void): GameState {
  s = { ...s, regions: s.regions.map((r) => ({ ...r })) } as GameState
  mutate(s.regions)
  return s
}

/** The three specialization-bearing regions, by the deterministic map. */
const PAIR_REGION = 0 // Auralia
const TWOPAIR_REGION = 6 // Pellucid
const FLUSH_REGION = 11 // Vantage

describe('declared constants + deterministic mapping', () => {
  it('exports the exact declared constants', () => {
    expect(PAIR_BASE).toBe(3)
    expect(TWOPAIR_BASE).toBe(4)
    expect(FLUSH_BASE).toBe(6)
    expect(DEV_STEP).toBe(2)
    expect(DEV_BONUS_CAP).toBe(4)
  })

  it('every new game carries the deterministic specialization map (same seed -> same map)', () => {
    for (const seed of ['reg-map-1', 'reg-map-2', 'reg-map-1']) {
      const s = newGame(seed)
      expect(s.regions[PAIR_REGION].name).toBe('Auralia')
      expect(s.regions[PAIR_REGION].specialization).toBe('pair')
      expect(s.regions[PAIR_REGION].dormant).toBe(false) // pair region STARTS AWAKE
      expect(s.regions[TWOPAIR_REGION].name).toBe('Pellucid')
      expect(s.regions[TWOPAIR_REGION].specialization).toBe('twopair')
      expect(s.regions[TWOPAIR_REGION].dormant).toBe(true) // starts dormant
      expect(s.regions[FLUSH_REGION].name).toBe('Vantage')
      expect(s.regions[FLUSH_REGION].specialization).toBe('flush')
      expect(s.regions[FLUSH_REGION].dormant).toBe(true) // starts dormant
      const specd = s.regions.filter((r) => r.specialization !== null)
      expect(specd).toHaveLength(3) // exactly three specializations exist
      expect(new Set(specd.map((r) => r.specialization))).toEqual(new Set(['pair', 'twopair', 'flush']))
      // terrain identity untouched by the mapping
      expect(s.regions.map((r) => r.terrain)).toEqual([
        'meadow', 'coast', 'highland', 'forest', 'steppe', 'wetland',
        'meadow', 'coast', 'highland', 'forest', 'steppe', 'wetland',
      ])
    }
  })
})

describe('exact-category matching (dormant vs awake, no hidden contains-a-pair logic)', () => {
  it('awake pair region pays its base on an EXACT pair only', () => {
    const s = withRegions(newGame('pair-exact'), (rs) => { rs[PAIR_REGION].dormant = false })
    const plan = buildPlan([C(13, 'S'), C(13, 'H'), C(9, 'D')], [0, 1, 2], [], s.regions)
    expect(plan.category).toBe('pair')
    expect(plan.growthParts.regions).toBe(PAIR_BASE)
    expect(plan.growth).toBe(Math.round(35 * 1.5) + PAIR_BASE) // 53 + 3
  })

  it('trips do NOT match a pair specialization (exact category, not contains-a-pair)', () => {
    const s = withRegions(newGame('trips-nomatch'), (rs) => { rs[PAIR_REGION].dormant = false })
    const plan = buildPlan([C(9, 'S'), C(9, 'H'), C(9, 'D')], [0, 1, 2], [], s.regions)
    expect(plan.category).toBe('trips')
    expect(plan.growthParts.regions).toBe(0)
    expect(plan.growth).toBe(Math.round(27 * 2.5)) // 68 — no bonus
  })

  it('high card pays no regional bonus anywhere', () => {
    const s = withRegions(newGame('high-nobonus'), (rs) => {
      rs[0].dormant = false
      rs[6].dormant = false
      rs[11].dormant = false
    })
    const plan = buildPlan([C(14, 'H')], [0], [], s.regions)
    expect(plan.category).toBe('high')
    expect(plan.growthParts.regions).toBe(0)
    expect(plan.growth).toBe(14)
  })

  it('a DORMANT specialized region contributes exactly zero (preview AND commit)', () => {
    let s = withRegions(newGame('dormant-zero'), (rs) => {
      rs[PAIR_REGION].specialization = 'pair'; rs[PAIR_REGION].dormant = true
    })
    s = forceHand(s, [C(13, 'S'), C(13, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
    const pv = preview(s)
    expect(pv.category).toBe('pair')
    expect(pv.growthParts.regions).toBe(0)
    expect(pv.growth).toBe(39) // round(26 x 1.5) — dormant pays nothing
    const committed = applyAction(s, { type: 'play' })
    expect(committed.lastResolution!.growth).toBe(39)
    expect(committed.lastResolution!.growthParts.regions).toBe(0)
    expect(committed.flourishing).toBe(newGame('dormant-zero').flourishing + 39)
  })

  it('a flush only pays the FLUSH-specialized region (and vice versa)', () => {
    const flush = [C(14, 'H'), C(2, 'H'), C(6, 'H'), C(7, 'H'), C(9, 'H')] // chips 38
    const dormantOnly = buildPlan(flush, [0, 1, 2, 3, 4], [], newGame('flush-dormant').regions)
    expect(dormantOnly.category).toBe('flush')
    expect(dormantOnly.growthParts.regions).toBe(0) // Vantage starts dormant
    const s = withRegions(newGame('flush-match'), (rs) => { rs[FLUSH_REGION].dormant = false })
    const plan = buildPlan(flush, [0, 1, 2, 3, 4], [], s.regions)
    expect(plan.growthParts.regions).toBe(FLUSH_BASE)
    expect(plan.growth).toBe(Math.round(38 * 4) + FLUSH_BASE) // 152 + 6
  })
})

describe('development scaling + DEV_BONUS_CAP', () => {
  it('regionBonus = base + min(CAP, floor(dev / STEP)) — the declared table', () => {
    const table: [number, number, number][] = [
      // [development, expected pair bonus, expected flush bonus]
      [0, 3, 6],
      [1, 3, 6],
      [2, 4, 7],
      [4, 5, 8], // the design brief's worked example: Pair region dev 4 -> 3+2=5
      [6, 6, 9],
      [8, 7, 10],
      [10, 7, 10], // capped: floor(10/2)=5 -> min(4,5)=4
      [100, 7, 10], // far past the cap
    ]
    for (const [dev, pairExp, flushExp] of table) {
      const s = withRegions(newGame('dev-table'), (rs) => {
        rs[PAIR_REGION].dormant = false; rs[PAIR_REGION].development = dev
        rs[FLUSH_REGION].dormant = false; rs[FLUSH_REGION].development = dev
      })
      const pairPlan = buildPlan([C(13, 'S'), C(13, 'H')], [0, 1], [], s.regions)
      expect(pairPlan.category).toBe('pair')
      expect(pairPlan.growthParts.regions).toBe(pairExp)
      const flushPlan = buildPlan(
        [C(14, 'H'), C(2, 'H'), C(6, 'H'), C(7, 'H'), C(9, 'H')], [0, 1, 2, 3, 4], [], s.regions,
      )
      expect(flushPlan.growthParts.regions).toBe(flushExp)
    }
  })

  it('the worked example from the design brief: Pair region dev 4 grants exactly 5', () => {
    const s = withRegions(newGame('dev4'), (rs) => {
      rs[PAIR_REGION].development = 4; rs[PAIR_REGION].dormant = false
    })
    const plan = buildPlan([C(13, 'S'), C(13, 'H')], [0, 1], [], s.regions)
    expect(plan.growthParts.regions).toBe(5)
  })
})

describe('additive stacking across multiple matching regions', () => {
  it('two awake pair-specialized regions ADD (never multiply)', () => {
    const s = withRegions(newGame('stack2'), (rs) => {
      rs[0].specialization = 'pair'; rs[0].dormant = false; rs[0].development = 2
      rs[1].specialization = 'pair'; rs[1].dormant = false; rs[1].development = 4
    })
    const plan = buildPlan([C(13, 'S'), C(13, 'H')], [0, 1], [], s.regions)
    // (3 + floor(2/2)) + (3 + floor(4/2)) = 4 + 5 = 9 — additive, not 3*3 or any product
    expect(plan.growthParts.regions).toBe(9)
    expect(plan.growth).toBe(Math.round(26 * 1.5) + 9)
  })

  it('mixed specializations: only the matching category pays', () => {
    const s = withRegions(newGame('stack-mixed'), (rs) => {
      rs[0].dormant = false // Auralia: pair, dev 0
      rs[6].dormant = false // Pellucid: twopair, dev 0
    })
    const tp = [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')]
    const plan = buildPlan(tp, [0, 1, 2, 3], [], s.regions)
    expect(plan.category).toBe('two-pair')
    expect(plan.growthParts.regions).toBe(TWOPAIR_BASE) // 4 — only Pellucid matches
    expect(plan.growth).toBe(64 + 4)
  })
})

describe('no double application with existing laws', () => {
  it('Open Canals multiplies ONLY pokerBase; the region bonus is added once after', () => {
    const s = withRegions(newGame('canals'), (rs) => { rs[PAIR_REGION].dormant = false })
    const canals = [{ id: 'open-canals', title: 'Open Canals', desc: '', cost: 14, kind: 'upgrade' as const, growthMult: 1.2 }]
    const plan = buildPlan([C(14, 'S'), C(14, 'H'), C(13, 'D'), C(12, 'C'), C(11, 'H')], [0, 1, 2, 3, 4], canals, s.regions)
    expect(plan.category).toBe('pair')
    const pokerBase = Math.round(64 * 1.5) // 96
    expect(plan.growthParts.poker).toBe(pokerBase)
    expect(plan.growthParts.laws).toBe(Math.round(pokerBase * 1.2) - pokerBase) // +19
    expect(plan.growthParts.regions).toBe(PAIR_BASE) // NOT re-multiplied (that would be round((96+3)*1.2)=119)
    expect(plan.growth).toBe(Math.round(pokerBase * 1.2) + PAIR_BASE) // 115 + 3
  })

  it('Canopy Choir flat + region bonus each apply exactly once', () => {
    const s = withRegions(newGame('choir'), (rs) => { rs[PAIR_REGION].dormant = false })
    const choir = [{ id: 'canopy-choir', title: 'Canopy Choir', desc: '', cost: 10, kind: 'upgrade' as const, growthFlat: 3 }]
    const plan = buildPlan([C(13, 'S'), C(13, 'H')], [0, 1], choir, s.regions)
    expect(plan.growth).toBe(39 + 3 + PAIR_BASE)
    expect(plan.growthParts).toEqual({ poker: 39, laws: 3, regions: PAIR_BASE, world: 0 })
  })

  it('laws alone (no matching region) keep the exact pre-change numbers', () => {
    const plan = buildPlan([C(10, 'H')], [0], [{ id: 'open-canals', title: 'Open Canals', desc: '', cost: 14, kind: 'upgrade' as const, growthMult: 1.2 }], [])
    expect(plan.growth).toBe(12)
    expect(plan.growthParts).toEqual({ poker: 10, laws: 2, regions: 0, world: 0 })
  })
})

describe('shared scoring contract: parts reconcile + preview == commit', () => {
  it('growthParts sums EXACTLY to growth across a selection sweep', () => {
    const s = withRegions(newGame('parts-sweep'), (rs) => {
      rs[0].dormant = false; rs[0].development = 5
      rs[6].dormant = false; rs[6].development = 3
      rs[11].dormant = false; rs[11].development = 7
    })
    const laws = [
      { id: 'open-canals', title: 'Open Canals', desc: '', cost: 14, kind: 'upgrade' as const, growthMult: 1.2 },
      { id: 'canopy-choir', title: 'Canopy Choir', desc: '', cost: 10, kind: 'upgrade' as const, growthFlat: 3 },
    ]
    const hand = [
      C(13, 'S'), C(13, 'H'), C(9, 'D'), C(9, 'C'), C(7, 'H'),
      C(2, 'S'), C(3, 'S'), C(4, 'S'),
    ]
    for (const sel of [[0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [5, 6, 7], [5, 6, 7, 2], [4, 5, 6, 7]]) {
      const plan = buildPlan(hand, sel, laws, s.regions)
      expect(plan.valid).toBe(true)
      expect(plan.growth).toBe(Math.max(0, plan.growthParts.poker + plan.growthParts.laws + plan.growthParts.regions))
    }
  })

  it('preview == commit for the FULL pipeline (plan fields, balance, flourishing, summary, log)', () => {
    let s = withRegions(newGame('pv-commit-reg'), (rs) => {
      rs[0].dormant = false; rs[0].development = 4 // Auralia (pair) — no match below
      rs[6].dormant = false; rs[6].development = 6 // Pellucid (twopair): 4 + 3 = 7
    })
    s.epoch = 20 // high target so early-advance never fires
    s.seeds = 24
    s = forceHand(s, [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')])
    for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    const pv = preview(s)
    expect(pv.category).toBe('two-pair')
    expect(pv.growthParts).toEqual({ poker: 64, laws: 0, regions: 7, world: 0 })
    expect(pv.growth).toBe(71)
    const committed = applyAction(s, { type: 'play' })
    expect(committed.lastResolution!.growth).toBe(pv.growth)
    expect(committed.lastResolution!.growthParts).toEqual(pv.growthParts)
    expect(committed.lastResolution!.effects).toEqual(pv.effects)
    expect(committed.lastResolution!.summary).toBe(pv.summary)
    expect(committed.flourishing).toBe(newGame('pv-commit-reg').flourishing + 71)
    // uncapped Seed earn against the CURRENT balance 24: ceil(71/4) = 18
    const fx = pv.effects.find((e) => e.kind === 'seeds') as { amount: number }
    expect(fx.amount).toBe(18)
    expect(pv.summary).toContain('Gains 18 Seeds')
    expect(pv.summary).not.toContain('overflow')
    expect(committed.seeds).toBe(42)
  })

  it('Seed rewards stay truthful after a regional bonus (balance 30 -> 44, uncapped)', () => {
    let s = withRegions(newGame('cap-reg'), (rs) => { rs[PAIR_REGION].dormant = false })
    s.epoch = 20 // high target so early-advance never fires
    s.seeds = 30
    s = forceHand(s, [C(13, 'S'), C(13, 'H'), C(9, 'D')])
    for (const i of [0, 1, 2]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    const pv = preview(s)
    expect(pv.growth).toBe(56) // 53 base + 3 region
    const fx = pv.effects.find((e) => e.kind === 'seeds') as { amount: number }
    expect(fx.amount).toBe(14)
    const committed = applyAction(s, { type: 'play' })
    expect(committed.seeds).toBe(44)
    expect(committed.log.at(-1)!.text).toContain('Gains 14 Seeds')
    expect(committed.log.at(-1)!.text).not.toContain('overflow')
  })
})

describe('expansion shop surfaces two specializations (existing mechanism + price convention)', () => {
  it('wake-pellucid / wake-vantage exist at the 12-Seed wake-* convention and advertise their category', () => {
    const wakeP = MARKET_ITEMS.find((m) => m.id === 'wake-pellucid')
    const wakeV = MARKET_ITEMS.find((m) => m.id === 'wake-vantage')
    expect(wakeP).toBeTruthy()
    expect(wakeV).toBeTruthy()
    expect(wakeP!.cost).toBe(12)
    expect(wakeV!.cost).toBe(12)
    expect(wakeP!.kind).toBe('expansion')
    expect(wakeV!.kind).toBe('expansion')
    expect(wakeP!.wakeRegionId).toBe(TWOPAIR_REGION)
    expect(wakeV!.wakeRegionId).toBe(FLUSH_REGION)
    expect(wakeP!.desc).toContain('Two Pair')
    expect(wakeV!.desc).toContain('Flush')
    // the existing wake items are unchanged (same price, same regions)
    expect(MARKET_ITEMS.find((m) => m.id === 'wake-laguna')).toMatchObject({ cost: 12, wakeRegionId: 4 })
    expect(MARKET_ITEMS.find((m) => m.id === 'wake-brumal')).toMatchObject({ cost: 12, wakeRegionId: 9 })
  })

  it('buying wake-vantage through a REAL epoch market awakens Vantage and its flush bonus', () => {
    let s = newGame('wake-vantage-run')
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    s.seeds = 30
    s.market = [MARKET_ITEMS.find((m) => m.id === 'wake-vantage')!]
    s = applyAction(s, { type: 'buy', itemId: 'wake-vantage' })
    expect(s.regions[FLUSH_REGION].dormant).toBe(false)
    expect(s.laws.some((l) => l.id === 'wake-vantage')).toBe(true)
    // the advertised bonus is live on an exact flush
    const flush = [C(14, 'H'), C(2, 'H'), C(6, 'H'), C(7, 'H'), C(9, 'H')]
    const plan = buildPlan(flush, [0, 1, 2, 3, 4], [], s.regions)
    expect(plan.category).toBe('flush')
    expect(plan.growthParts.regions).toBe(FLUSH_BASE)
    // and it scales with development as epochs advance (dev 2 -> +1)
    const dev2 = withRegions(s, (rs) => { rs[FLUSH_REGION].development = 2 })
    const plan2 = buildPlan(flush, [0, 1, 2, 3, 4], [], dev2.regions)
    expect(plan2.growthParts.regions).toBe(FLUSH_BASE + Math.floor(2 / DEV_STEP))
  })
})

describe('SAVE_VERSION 8 + validation + legacy preservation', () => {
  it('SAVE_VERSION is 8 (bounded economy: capped play income, one-time vouchers, per-visit shop limits); the schema layout is 4', () => {
    expect(SAVE_VERSION).toBe(8)
  })

  it('a fresh v7 state passes validateState (specializations legal)', () => {
    expect(validateState(JSON.parse(JSON.stringify(newGame('validate-7'))))).toBeNull()
  })

  it('an illegal specialization value is rejected', () => {
    const s = JSON.parse(JSON.stringify(newGame('bad-spec'))) as any
    s.regions[3].specialization = 'quads'
    expect(validateState(s)).toMatch(/specialization/)
    const s2 = JSON.parse(JSON.stringify(newGame('bad-spec2'))) as any
    s2.regions[3].specialization = 7
    expect(validateState(s2)).toMatch(/specialization/)
  })

  it('a v3 state (pre-regional scoring) is REJECTED, never reinterpreted', () => {
    const s = JSON.parse(JSON.stringify(newGame('v3-state'))) as any
    s.version = 3
    expect(validateState(s)).toMatch(/version 3/)
  })

  it('loadGameDetailed preserves a v3 blob verbatim under a legacy key', async () => {
    const mod = await import('../src/ui/save')
    const store = new Map<string, string>()
    const g = globalThis as any
    const prev = { getItem: g.localStorage?.getItem, setItem: g.localStorage?.setItem, removeItem: g.localStorage?.removeItem, length: g.localStorage?.length, key: g.localStorage?.key }
    g.localStorage = {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      get length() { return store.size },
      key: (i: number) => [...store.keys()][i] ?? null,
    }
    try {
      // a REAL v3 save: version-3 envelope + state with version 3 and NO
      // specialization fields (the pre-regional-bonus engine)
      const v3state = JSON.parse(JSON.stringify(newGame('legacy-v3')))
      v3state.version = 3
      for (const r of v3state.regions) delete r.specialization
      const legacyV3 = JSON.stringify({ schema: 3, version: 3, savedAt: '2026-01-04T00:00:00.000Z', state: v3state })
      store.set('worldhand.save', legacyV3)
      const res = mod.loadGameDetailed()
      expect(res.state).toBeNull()
      expect(res.rejectedReason).toMatch(/version 3/)
      expect(res.legacyKey).toMatch(/^worldhand\.save\.legacy\./)
      // byte-for-byte preservation; the original key is untouched
      expect(store.get(res.legacyKey!)).toBe(legacyV3)
      expect(store.get('worldhand.save')).toBe(legacyV3)
      expect(mod.listLegacySaves().some((l) => l.key === res.legacyKey)).toBe(true)
      // and a valid v7 save still loads
      store.set('worldhand.save', JSON.stringify({ schema: 4, version: 8, savedAt: '2026-01-05T00:00:00.000Z', state: JSON.parse(JSON.stringify(newGame('v8-fresh'))) }))
      const res4 = mod.loadGameDetailed()
      expect(res4.state).not.toBeNull()
      expect(res4.rejectedReason).toBeNull()
    } finally {
      g.localStorage = prev ? Object.assign({}, prev) : undefined
      if (!prev) delete g.localStorage
    }
  })
})

// ---------------------------------------------------------------------------
// STRATEGIC ACCEPTANCE: two labeled controlled fixtures. SAME cards, SAME laws,
// DIFFERENT regional builds; a genuine CHOICE REVERSAL in each. Design tests,
// not ordinary playtests — the hands are crafted fixtures, not live play.
// ---------------------------------------------------------------------------

// BUILD A: awake maxed Pair region (dev 8 -> bonus 7); Two-Pair + Flush dormant.
// BUILD B: awake maxed Flush/Two-Pair region (dev 8 -> bonus 10/8); Pair dormant.
function buildA(): Region[] {
  return withRegions(newGame('reversal-A'), (rs) => {
    rs[PAIR_REGION].dormant = false; rs[PAIR_REGION].development = 8
    rs[TWOPAIR_REGION].dormant = true; rs[TWOPAIR_REGION].development = 0
    rs[FLUSH_REGION].dormant = true; rs[FLUSH_REGION].development = 0
  }).regions
}
function buildB(spec: 'twopair' | 'flush'): Region[] {
  return withRegions(newGame('reversal-B'), (rs) => {
    rs[PAIR_REGION].dormant = true; rs[PAIR_REGION].development = 0
    if (spec === 'twopair') { rs[TWOPAIR_REGION].dormant = false; rs[TWOPAIR_REGION].development = 8 }
    else { rs[TWOPAIR_REGION].dormant = true; rs[TWOPAIR_REGION].development = 0 }
    if (spec === 'flush') { rs[FLUSH_REGION].dormant = false; rs[FLUSH_REGION].development = 8 }
    else { rs[FLUSH_REGION].dormant = true; rs[FLUSH_REGION].development = 0 }
  }).regions
}

describe('CHOICE REVERSAL fixture 1 (pair vs two-pair, exact tie broken by the region)', () => {
  // SAME 10 dealt cards in both builds; SAME laws (none). Two legal selections:
  //   pair      A♠A♥K♦Q♣J♥ -> chips 64 x 1.5 = 96
  //   two-pair  A♠9♠9♥8♦8♣ -> chips 48 x 2   = 96  (an EXACT tie)
  const HAND = [C(14, 'S'), C(14, 'H'), C(13, 'D'), C(12, 'C'), C(11, 'H'), C(9, 'S'), C(9, 'H'), C(8, 'D'), C(8, 'C'), C(2, 'D')]
  const PAIR_SEL = [0, 1, 2, 3, 4]
  const TWOPAIR_SEL = [0, 5, 6, 7, 8]

  it('build A (awake maxed Pair region): the PAIR is favored', () => {
    const aPair = buildPlan(HAND, PAIR_SEL, [], buildA())
    const aTwopair = buildPlan(HAND, TWOPAIR_SEL, [], buildA())
    expect(aPair.category).toBe('pair')
    expect(aTwopair.category).toBe('two-pair')
    expect(aPair.growth).toBe(96 + 7) // 103 — pair region bonus
    expect(aTwopair.growth).toBe(96) // no matching awake region
    expect(aPair.growth).toBeGreaterThan(aTwopair.growth)
  })

  it('build B (awake maxed Two-Pair region, no Pair): the TWO-PAIR is favored — REVERSAL', () => {
    const regions = buildB('twopair')
    const bPair = buildPlan(HAND, PAIR_SEL, [], regions)
    const bTwopair = buildPlan(HAND, TWOPAIR_SEL, [], regions)
    expect(bPair.growth).toBe(96) // pair region dormant — no bonus
    expect(bTwopair.growth).toBe(96 + 8) // 104 — twopair region bonus
    expect(bTwopair.growth).toBeGreaterThan(bPair.growth)
    // the SAME cards + SAME laws rank pair>twopair in A and twopair>pair in B
    expect(bTwopair.growth - bPair.growth).toBe(8)
  })
})

describe('CHOICE REVERSAL fixture 2 (flush vs pair under Open Canals, laws identical in both builds)', () => {
  // SAME 10 dealt cards in both builds; SAME laws (Open Canals x1.2 in both):
  //   pair  A♠A♥K♦Q♣J♥ -> chips 64 x 1.5 = 96 -> x1.2 = round(115.2) = 115
  //   flush 2♥3♥4♥5♥9♥ -> chips 23 x 4   = 92 -> x1.2 = round(110.4) = 110
  const HAND = [C(14, 'S'), C(14, 'H'), C(13, 'D'), C(12, 'C'), C(11, 'H'), C(2, 'H'), C(3, 'H'), C(4, 'H'), C(5, 'H'), C(9, 'H')]
  const PAIR_SEL = [0, 1, 2, 3, 4]
  const FLUSH_SEL = [5, 6, 7, 8, 9]
  const LAWS = [{ id: 'open-canals', title: 'Open Canals', desc: '', cost: 14, kind: 'upgrade' as const, growthMult: 1.2 }]

  it('build A (awake maxed Pair region): the PAIR is favored', () => {
    const aPair = buildPlan(HAND, PAIR_SEL, LAWS, buildA())
    const aFlush = buildPlan(HAND, FLUSH_SEL, LAWS, buildA())
    expect(aPair.category).toBe('pair')
    expect(aFlush.category).toBe('flush')
    expect(aPair.growth).toBe(115 + 7) // 122
    expect(aFlush.growth).toBe(110) // no bonus — and NOT re-multiplied with any bonus
    expect(aPair.growth).toBeGreaterThan(aFlush.growth)
  })

  it('build B (awake maxed Flush region, no Pair): the FLUSH is favored — REVERSAL', () => {
    const regions = buildB('flush')
    const bPair = buildPlan(HAND, PAIR_SEL, LAWS, regions)
    const bFlush = buildPlan(HAND, FLUSH_SEL, LAWS, regions)
    expect(bPair.growth).toBe(115)
    expect(bFlush.growth).toBe(110 + 10) // 120 — flush region bonus added AFTER the law mult
    expect(bFlush.growth).toBeGreaterThan(bPair.growth)
    // documented provenance of the flip: flush gained exactly its +10 bonus
    expect(bFlush.growth - 110).toBe(FLUSH_BASE + DEV_BONUS_CAP)
  })
})

describe('final-epoch outcome + reload idempotency with regional bonuses', () => {
  /** 4 two-pair plays from a fixed hand; Pellucid (twopair) awake at dev 2 -> +5 each.
   *  The hand is re-forced before EVERY play: after each play the hand refills
   *  from the deck, so indices 0-3 would otherwise be fresh random cards. */
  function finalRun(pellucidAwake: boolean) {
    let s = withRegions(newGame('final-reg'), (rs) => {
      rs[TWOPAIR_REGION].dormant = !pellucidAwake
      rs[TWOPAIR_REGION].development = 2 // bonus 4 + 1 = 5
    })
    s.epoch = 3
    s.phase = 'select'
    // start so the target is reached only on the 4th play WITH the bonus, and
    // falls just short WITHOUT it (per-epoch target ~103)
    s.epochGrowth = epochTarget(3) - 4 * 64 - 1
    s.lives = 2
    const tp = [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')]
    for (let i = 0; i < 4; i++) {
      s = forceHand(s, tp)
      for (const k of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: k })
      s = applyAction(s, { type: 'play' })
    }
    return s
  }

  it('the region bonus TIPS the epoch-3 target: 4x69 = 276 clears it where 4x64 = 256 falls short', () => {
    const withBonus = finalRun(true)
    // the bonus lets the run clear the per-epoch target (early advance fires on
    // the 4th play) — the run continues into the market, no life lost
    expect(withBonus.epochGrowth).toBeGreaterThanOrEqual(epochTarget(3))
    expect(withBonus.phase).toBe('market') // unlimited epochs: run continues
    expect(withBonus.lives).toBe(2) // target met — no life lost
    expect(withBonus.log.filter((l) => l.text.includes('a life is lost'))).toHaveLength(0)
    expect(withBonus.log.filter((l) => l.text.startsWith('Epoch end: +'))).toHaveLength(1)

    // counterfactual: the SAME cards/plays with the region dormant fall short
    const without = finalRun(false)
    expect(without.epochGrowth).toBeLessThan(epochTarget(3))
    expect(without.lives).toBe(1) // the miss still cost its life
    expect(without.log.filter((l) => l.text.includes('a life is lost'))).toHaveLength(1)
  })

  it('the committed state survives a reload with nothing double-applied', () => {
    const s = finalRun(true)
    const j = JSON.parse(JSON.stringify(s))
    expect(validateState(j)).toBeNull()
    const after = applyAction(j as GameState, { type: 'endMarket' })
    expect(after.log.length).toBe((j as GameState).log.length)
    expect(after.flourishing).toBe((j as GameState).flourishing)
    expect(after.seeds).toBe((j as GameState).seeds)
    expect(after.lives).toBe((j as GameState).lives)
    expect(after.outcome).toBe((j as GameState).outcome)
  })
})

describe('deterministic specialization assignment', () => {
  it('identical seeds produce identical region maps; the map is the declared fixed mapping', () => {
    const mapOf = (seed: string) =>
      newGame(seed).regions.map((r) => [r.name, r.terrain, r.specialization, r.dormant])
    expect(mapOf('det-reg-a')).toEqual(mapOf('det-reg-a'))
    expect(mapOf('det-reg-a')).toEqual(mapOf('det-reg-a')) // same seed -> same map
    // the map is FIXED data (not rerolled per seed): different seeds, same map
    expect(mapOf('det-reg-a')).toEqual(mapOf('det-reg-b'))
  })
})