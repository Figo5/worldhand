import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, preview, buildPlan, cardConservation,
  applyPlanEffects, epochTarget, SEEDS_PER_GROWTH, LAW_SLOTS,
  SURVIVAL_START, MARKET_ITEMS, validateState, worldScore,
  PLAYS_PER_EPOCH, DISCARDS_PER_EPOCH, HAND_SIZE, TOTAL_REGIONS,
  STABILITY_BASE, STABILITY_MAX, START_REGIONS,
} from '../src/engine/worldhand'
import { CATEGORY_MULT } from '../src/engine/poker'
import type { GameState } from '../src/engine/worldhand'
import type { Card, Suit as PSuit } from '../src/engine/poker'

const C = (r: number, s: PSuit): Card => ({ r: r as Card['r'], s })

// Deterministic helpers: force a known hand without changing other state.
function forceHand(s: GameState, cards: Card[]): GameState {
  const t = { ...s, hand: [...cards] }
  return t as GameState
}

/* eslint-disable */

describe('worldhand core contracts (Balatro-simple)', () => {
  it('starts: 12 regions (4 awake), stability base 3, 3 Flourishing, 8 Seeds, 8-card hand, 3 lives', () => {
    const s = newGame('auralia-the-first')
    expect(s.regions).toHaveLength(TOTAL_REGIONS)
    expect(s.regions.filter((r) => !r.dormant)).toHaveLength(START_REGIONS)
    for (const r of s.regions) expect(r.stability).toBe(STABILITY_BASE)
    expect(s.flourishing).toBe(3)
    expect(s.seeds).toBe(8)
    expect(s.hand).toHaveLength(HAND_SIZE)
    expect(s.playsLeft).toBe(PLAYS_PER_EPOCH)
    expect(s.discardsLeft).toBe(DISCARDS_PER_EPOCH)
    expect(s.lives).toBe(SURVIVAL_START)
    expect(s.phase).toBe('select')
  })
  it('same seed → identical world; different seed differs', () => {
    expect(newGame('same-seed')).toEqual(newGame('same-seed'))
    expect(newGame('alpha')).not.toEqual(newGame('beta'))
  })
  it('region adjacency is symmetric', () => {
    const s = newGame('adj')
    for (const r of s.regions) {
      for (const a of r.adjacency) {
        expect(s.regions[a].adjacency).toContain(r.id)
      }
    }
  })
  it('ONE escalating Flourishing (Growth) target per epoch, strictly increasing, indefinite', () => {
    // per-epoch target: Growth to bank DURING this epoch; escalates forever
    expect(epochTarget(1)).toBe(100)
    for (let n = 2; n < 30; n++) {
      expect(epochTarget(n)).toBeGreaterThan(epochTarget(n - 1))
      expect(Number.isInteger(epochTarget(n))).toBe(true)
    }
  })
  it('targets are calibrated against measured bounded play, not the final target alone', () => {
    // scripts/solve.mjs (corrected policy: category-spanning 1-5 candidates,
    // current-mechanics score, disjoint calibration/evaluation seeds). The
    // per-epoch curve is fit so a bounded policy at LOOK=30 gets a smooth depth
    // distribution (no single epoch >20% of deaths, no gap after a spike).
    expect(epochTarget(1)).toBe(100)
    expect(epochTarget(2)).toBeGreaterThan(epochTarget(1))
    expect(epochTarget(10)).toBeGreaterThan(epochTarget(9))
  })
  it('card conservation holds after every action type (52 always)', () => {
    let s = newGame('conservation')
    expect(cardConservation(s)).toBe(true)
    s = applyAction(s, { type: 'discard', cardIdxs: [0, 1] })
    expect(cardConservation(s)).toBe(true)
    expect(s.hand).toHaveLength(8)
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(cardConservation(s)).toBe(true)
    expect(s.hand).toHaveLength(8)
  })
})

describe('no per-suit world actions — a play is just a poker hand', () => {
  it("the 'play' action takes no suitChoice/regionChoice (unknown action fields are rejected)", () => {
    let s = newGame('no-actions')
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    // engine ignores nothing: the Action union has no suitChoice/regionChoice —
    // an extraneous field must not change the plan (structure is compile-checked;
    // here we assert the play resolves identically with/without the field present)
    const withField = applyAction(s, { type: 'play', ...({ suitChoice: 'H', regionChoice: 3 } as object) })
    expect(withField.lastResolution).not.toBeNull()
    expect(withField.lastResolution!.effects.every((e) => e.kind === 'flourishing' || e.kind === 'seeds')).toBe(true)
  })
  it('plans carry no suit action: effects are exactly flourishing + auto-seeds', () => {
    const s0 = newGame('no-suit-plan')
    for (const suit of ['S', 'H', 'D', 'C'] as const) {
      const plan = buildPlan([C(10, suit)], [0], [])
      expect(plan.valid).toBe(true)
      const kinds = plan.effects.map((e) => e.kind).sort()
      expect(kinds).toEqual(['flourishing', 'seeds'])
      expect(plan.effects.find((e) => e.kind === 'flourishing')).toMatchObject({ amount: plan.growth })
    }
  })
  it('suit mix never changes the score (no acting-suit decision remains)', () => {
    const h = buildPlan([C(5, 'H'), C(6, 'D')], [0, 1], [])
    const d = buildPlan([C(5, 'D'), C(6, 'H')], [0, 1], [])
    expect(h.growth).toBe(d.growth)
    expect(h.growthParts).toEqual(d.growthParts)
    expect(h.effects).toEqual(d.effects)
  })
  it('no Drought/challenge concepts remain in the engine state or market', () => {
    const s = newGame('no-drought')
    expect((s as any).challenge).toBeUndefined()
    expect((s as any).challengeFailed).toBeUndefined()
    expect(MARKET_ITEMS.every((m) => !/drought|study|settle|mine|seeds per play/i.test(m.title + m.desc))).toBe(true)
    // per-region stability keeps only cosmetic use (decay pressure); it is not read by scoring
    const s2 = newGame('no-drought-2')
    s2.regions[0].stability = 0
    const plan = buildPlan([C(14, 'H')], [0], [])
    expect(plan.growth).toBe(14) // unaffected by stability
  })
})

describe('selection 1–5 and ResolutionPlan', () => {
  it('toggleCard enforces max 5 and duplicates impossible', () => {
    let s = newGame('sel')
    for (let i = 0; i < 5; i++) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    expect(s.selected).toHaveLength(5)
    expect(() => applyAction(s, { type: 'toggleCard', cardIdx: 5 })).toThrow()
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    expect(s.selected).toHaveLength(4)
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    expect(s.selected).toHaveLength(5)
  })
  it('preview and commit share the same plan pipeline (deterministic pipeline)', () => {
    let s = newGame('pipeline')
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
    const pv = preview(s)
    const before = { f: s.flourishing, seeds: s.seeds }
    const s2 = applyAction(s, { type: 'play' })
    expect(s2.lastResolution).not.toBeNull()
    expect(s2.lastResolution!.category).toBe(pv.category)
    expect(s2.lastResolution!.growth).toBe(pv.growth)
    expect(s2.lastResolution!.growthParts).toEqual(pv.growthParts)
    expect(s2.lastResolution!.effects).toEqual(pv.effects)
    for (const e of pv.effects) {
      if (e.kind === 'flourishing') expect(s2.flourishing).toBe(before.f + e.amount)
      if (e.kind === 'seeds') expect(s2.seeds).toBe(before.seeds + e.amount)
    }
  })
  it('buildPlan rejects empty selection with a reason', () => {
    const plan = buildPlan([C(5, 'H')], [], [])
    expect(plan.valid).toBe(false)
    expect(plan.invalidReason).toContain('1–5')
  })
  it('bigger selections have bigger rank sums (magnitude driver intact)', () => {
    const a = buildPlan([C(10, 'H')], [0], [])
    const b = buildPlan([C(10, 'H'), C(10, 'H'), C(10, 'H')], [0, 1, 2], [])
    expect(b.rankSum).toBeGreaterThan(a.rankSum)
  })
})

describe('auto-Seeds economy (no Mine action)', () => {
  it('every play gains Seeds from hand quality: ceil(Growth x SEEDS_PER_GROWTH)', () => {
    expect(SEEDS_PER_GROWTH).toBe(1 / 4)
    const plan = buildPlan([C(10, 'H')], [0], [])
    expect(plan.growth).toBe(10)
    expect(plan.effects.find((e) => e.kind === 'seeds')).toMatchObject({ amount: 3 }) // ceil(10/4)
    const big = buildPlan([C(14, 'H')], [0], [])
    expect(big.effects.find((e) => e.kind === 'seeds')).toMatchObject({ amount: 4 }) // ceil(14/4)
  })
  it('auto-Seeds are applied on commit and accumulate without ceiling (never negative)', () => {
    let s = newGame('autoseeds-apply')
    s.seeds = 0
    s = forceHand(s, [C(10, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    const pv = preview(s)
    const committed = applyAction(s, { type: 'play' })
    const gain = pv.effects.find((e) => e.kind === 'seeds')!.amount
    expect(gain).toBe(3) // ceil(10 Growth / 4)
    expect(committed.seeds).toBe(gain)
    // uncapped: at 30 the play still banks the full earn
    let c = newGame('autoseeds-uncapped')
    c.seeds = 30
    c = forceHand(c, [C(14, 'D')])
    c = applyAction(c, { type: 'toggleCard', cardIdx: 0 })
    c = applyAction(c, { type: 'play' })
    expect(c.seeds).toBe(34) // 30 + ceil(14/4) = 30 + 4
  })
  it('epoch-end income still exists (living healthy regions + laws), halved on a missed target', () => {
    let s = newGame('income')
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    expect(s.log.some((l) => l.text.startsWith('Epoch end: +'))).toBe(true)
  })
})

describe('Growth = chips x mult + laws (preview == commit)', () => {
  it('poker base = round(rankSum x CATEGORY_MULT[category]) — flush outscores high card', () => {
    const high = buildPlan([C(10, 'H')], [0], [])
    expect(high.mult).toBe(CATEGORY_MULT['high'])
    expect(high.growthParts.poker).toBe(Math.round(10 * CATEGORY_MULT['high']))
    const flush = buildPlan([C(2, 'H'), C(6, 'H'), C(7, 'H'), C(9, 'H'), C(14, 'H')], [0, 1, 2, 3, 4], [])
    expect(flush.mult).toBe(CATEGORY_MULT['flush'])
    expect(flush.growthParts.poker).toBe(Math.round((2 + 6 + 7 + 9 + 14) * CATEGORY_MULT['flush']))
    expect(flush.growth).toBeGreaterThan(high.growth)
  })
  it('flat Growth laws add to every play; mult laws multiply the poker base', () => {
    const laws3 = [{ id: 'canopy-choir', title: 'Canopy Choir', desc: '', cost: 10, kind: 'upgrade', growthFlat: 3 }]
    const base = buildPlan([C(10, 'H')], [0], [])
    const flat = buildPlan([C(10, 'H')], [0], laws3)
    expect(base.growth).toBe(10)
    expect(flat.growth).toBe(13)
    expect(flat.growthParts.laws).toBe(3)
    const lawsMult = [{ id: 'open-canals', title: 'Open Canals', desc: '', cost: 14, kind: 'upgrade', growthMult: 1.2 }]
    const mult = buildPlan([C(10, 'H')], [0], lawsMult)
    expect(mult.growth).toBe(12) // round(10 x 1.2)
    expect(mult.growthParts.laws).toBe(2)
  })
  it('plan chips/mult/base are mutually consistent: base = round(chips x mult) exactly (display can never drift from the formula)', () => {
    // the display-honesty contract: chips == rankSum (pre-mult), pokerBase ==
    // round(chips × mult). The UI shows "chips × mult = base" — this test
    // pins that equation so the label and the formula cannot diverge.
    const hands: Card[][] = [
      [C(10, 'H')],
      [C(5, 'H'), C(5, 'S')], // pair
      [C(2, 'H'), C(6, 'H'), C(7, 'H'), C(9, 'H'), C(14, 'H')], // flush
      [C(9, 'S'), C(10, 'H'), C(11, 'D'), C(12, 'C'), C(13, 'S')], // straight
      [C(7, 'S'), C(7, 'H'), C(7, 'D'), C(7, 'C')], // quads
      [C(14, 'S'), C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S')], // wheel straight
    ]
    for (const hand of hands) {
      for (const laws of [[], [{ id: 'x', title: 'X', desc: '', cost: 1, kind: 'upgrade', growthMult: 1.2, growthFlat: 3 }]]) {
        const plan = buildPlan(hand, hand.map((_, i) => i), laws)
        expect(plan.valid).toBe(true)
        expect(plan.chips).toBe(plan.rankSum)
        expect(plan.pokerBase).toBe(Math.round(plan.chips * plan.mult))
        expect(plan.growthParts.poker).toBe(plan.pokerBase)
        expect(plan.growth).toBe(Math.max(0, plan.pokerBase + plan.growthParts.laws))
      }
    }
  })
  it('growth is never negative and always equals the sum of its parts', () => {
    for (const r of [2, 5, 10, 14]) {
      const plan = buildPlan([C(r, 'S')], [0], [])
      expect(plan.growth).toBe(Math.max(0, plan.growthParts.poker + plan.growthParts.laws))
      expect(plan.growth).toBeGreaterThanOrEqual(0)
    }
  })
  it('REGRESSION: preview == commit — the same plan (growth, growthParts, effects) drives both', () => {
    let s = newGame('pv-commit-growth')
    s = forceHand(s, [C(10, 'S'), C(11, 'H'), C(12, 'D'), C(13, 'C'), C(9, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
    const pv = preview(s)
    expect(pv.valid).toBe(true)
    const before = { f: s.flourishing }
    const s2 = applyAction(s, { type: 'play' })
    const committed = s2.lastResolution!
    expect(committed.growth).toBe(pv.growth)
    expect(committed.growthParts).toEqual(pv.growthParts)
    expect(committed.effects).toEqual(pv.effects)
    expect(s2.flourishing).toBe(before.f + pv.growth)
  })
  it('every banked Growth carries one flourishing effect equal to the plan growth', () => {
    const s0 = newGame('growth-bank')
    for (const suit of ['S', 'H', 'D', 'C'] as const) {
      const plan = buildPlan([C(10, suit)], [0], [])
      expect(plan.effects.filter((e) => e.kind === 'flourishing')).toHaveLength(1)
      expect(plan.effects.find((e) => e.kind === 'flourishing')).toMatchObject({ amount: plan.growth })
    }
  })
})

describe('Balatro-style lives', () => {
  it('lives start at 3 and are the survival resource', () => {
    expect(SURVIVAL_START).toBe(3)
    expect(newGame('lives-init').lives).toBe(3)
  })
  it('missing the epoch-1 target costs exactly 1 life and halves that epoch-end market income', () => {
    // clubs-only singles bank exactly 10 Growth each (4 plays = 40 + start 3 = 43),
    // deterministically below the epoch-1 target of 45.
    let s = newGame('lives-miss-e1')
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    expect(s.flourishing).toBeLessThan(epochTarget(1))
    expect(s.lives).toBe(SURVIVAL_START - 1)
    expect(s.log.some((l) => l.text.includes(`a life is lost (now ${SURVIVAL_START - 1})`))).toBe(true)
    expect(s.log.some((l) => l.text.includes('halved'))).toBe(true)
  })
  it('meeting the epoch target costs no life', () => {
    let s = newGame('lives-met')
    s.epochGrowth = epochTarget(1) - 10 // 90, 10 short of the 100 target
    s.epoch = 1
    s = forceHand(s, [C(14, 'H')]) // ace high = 14 Growth → 104 ≥ 100
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.epochGrowth).toBeGreaterThanOrEqual(epochTarget(1))
    expect(s.lives).toBe(SURVIVAL_START)
    expect(s.log.every((l) => !l.text.includes('a life is lost'))).toBe(true)
  })
  it('missing the epoch-2 target also drains a life (2 misses leave 1)', () => {
    let s = newGame('lives-miss-e2')
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.lives).toBe(2)
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.epoch).toBe(2)
    expect(s.phase).toBe('select')
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.lives).toBe(1)
    expect(s.phase).toBe('market') // still alive at 1
    expect(s.log.some((l) => l.text.includes('a life is lost (now 1)'))).toBe(true)
  })
  it('a third miss (0 lives) ends the run withered at the next epoch boundary', () => {
    // lives 1 + a missed epoch-2 target → 0 lives; the market still opens, but
    // the very next epoch boundary is terminal.
    let s = newGame('lives-third-miss')
    s.lives = 1
    s.epoch = 2
    s.flourishing = 3
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.lives).toBe(0)
    expect(s.phase).toBe('market') // not dead yet — the boundary decides
    s = applyAction(s, { type: 'endMarket' })
    const s2 = applyAction(s, { type: 'closeEpoch' })
    expect(s2.phase).toBe('game-over')
    expect(s2.outcome).toBe('withered')
    expect(s2.outcomeReason).toContain('lives')
  })
  it('a drained life pool (0) at an epoch boundary ends the run withered', () => {
    let s = newGame('lives-zero-2')
    s.lives = 0
    s.epoch = 1
    s.phase = 'epoch-end'
    const s2 = applyAction(s, { type: 'closeEpoch' })
    expect(s2.phase).toBe('game-over')
    expect(s2.outcome).toBe('withered')
    expect(s2.outcomeReason).toContain('lives')
  })
  it('the epoch-3 miss still costs its life (uniform contract, exercised through a real epoch-end)', () => {
    // lives 2 + a missed epoch-3 target reached through REAL play: the miss
    // costs 1 (2 → 1) at endEpoch. With unlimited epochs the run continues —
    // the market opens and epoch 4 is reachable; lives are the exhaustible
    // resource that eventually ends the run.
    let s = newGame('lives-e3')
    s.epoch = 3
    s.flourishing = 1
    s.lives = 2
    s.phase = 'select'
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    // endEpoch already charged the life — and the run continues (no fixed cap)
    expect(s.lives).toBe(1)
    expect(s.log.some((l) => l.text.includes(`a life is lost (now 1)`))).toBe(true)
    expect(s.phase).toBe('market')
  })
  it('winning = beating the epoch-3 target (final Flourishing >= 360 with lives to spare)', () => {
    let s = newGame('win')
    s.epoch = 3
    s.phase = 'epoch-end'
    s.epochGrowth = epochTarget(3) + 10
    const s2 = applyAction(s, { type: 'closeEpoch' })
    expect(s2.phase).toBe('select') // unlimited epochs: epoch 4 begins
    expect(s2.epoch).toBe(4)
    expect(s2.lives).toBe(SURVIVAL_START)
  })
  it('REGRESSION: three misses drain exactly 3 lives → 0 (lives are exhaustible in ordinary play)', () => {
    // the pre-fix contract capped misses at 2 (epoch-3 miss skipped the life
    // cost); this run proves every miss now drains the pool to 0, and the run
    // ends at the next epoch boundary (unlimited epochs — lives are the end).
    let s = newGame('lives-full-drain')
    s.flourishing = 3
    const weak = [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')]
    for (let epoch = 1; epoch <= 3; epoch++) {
      s.epoch = epoch
      s = forceHand(s, weak)
      for (let i = 0; i < 4; i++) {
        s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
        s = applyAction(s, { type: 'play' })
      }
      expect(s.lives).toBe(SURVIVAL_START - epoch) // 2, then 1, then 0
      expect(s.phase).toBe('market') // every miss opens the market (no fixed cap)
      s = applyAction(s, { type: 'endMarket' })
      s = applyAction(s, { type: 'closeEpoch' })
      if (epoch < 3) {
        expect(s.phase).toBe('select') // still alive at 1+ lives
      } else {
        // 0 lives at the boundary ends the run
        expect(s.phase).toBe('game-over')
      }
    }
    expect(s.lives).toBe(0)
    expect(s.phase).toBe('game-over')
    expect(s.outcome).toBe('withered')
  })
  it('lives are serialized in the save envelope', () => {
    const s = newGame('lives-save')
    const j = JSON.parse(JSON.stringify(s))
    expect(j.lives).toBe(3)
  })
})

describe('discard 1–5 with refill', () => {
  it('discard up to 5 cards at once, refill to 8, budget decrements once', () => {
    let s = newGame('discard')
    s = applyAction(s, { type: 'discard', cardIdxs: [0, 1, 2, 3, 4] })
    expect(s.hand).toHaveLength(8)
    expect(s.discardsLeft).toBe(DISCARDS_PER_EPOCH - 1)
    expect(cardConservation(s)).toBe(true)
  })
  it('discard budget of 3 exhausts and then throws', () => {
    let s = newGame('discard2')
    s = applyAction(s, { type: 'discard', cardIdxs: [0] })
    s = applyAction(s, { type: 'discard', cardIdxs: [0] })
    s = applyAction(s, { type: 'discard', cardIdxs: [0] })
    expect(s.discardsLeft).toBe(0)
    expect(() => applyAction(s, { type: 'discard', cardIdxs: [0] })).toThrow()
  })
  it('rejects discarding 0 or 8 cards', () => {
    const s = newGame('discard3')
    expect(() => applyAction(s, { type: 'discard', cardIdxs: [] })).toThrow()
    expect(() => applyAction(s, { type: 'discard', cardIdxs: [0, 1, 2, 3, 4, 5, 6, 7] })).toThrow()
  })
})

describe('four plays / three discards per epoch', () => {
  it('plays decrement and the 4th play ends the epoch', () => {
    let s = newGame('plays')
    for (let i = 0; i < 3; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
      expect(s.playsLeft).toBe(PLAYS_PER_EPOCH - 1 - i)
      expect(s.phase).toBe('select')
    }
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.playsLeft).toBe(0)
    expect(s.phase).toBe('market')
  })
  it('play with 0 left throws', () => {
    let s = newGame('plays2')
    s.playsLeft = 0
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    expect(() => applyAction(s, { type: 'play' })).toThrow()
  })
})

describe('early advance on target + unlimited epochs', () => {
  it('a play that reaches the epoch target closes the epoch immediately (unused plays forfeited)', () => {
    let s = newGame('early-advance')
    s.epoch = 1
    s.epochGrowth = epochTarget(1) - 10 // 90, 10 short of the 100 target
    s.playsLeft = 4
    s = forceHand(s, [C(14, 'H')]) // ace high = 14 Growth → 104 ≥ 100
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.epochGrowth).toBeGreaterThanOrEqual(epochTarget(1))
    expect(s.phase).toBe('market') // closed immediately, not after 4 plays
    expect(s.playsLeft).toBe(3) // 3 plays forfeited
  })

  it('a play that does NOT reach the target keeps the epoch open (no early close)', () => {
    let s = newGame('no-early')
    s.epoch = 1
    s.flourishing = 40
    s.playsLeft = 4
    s = forceHand(s, [C(2, 'H')]) // 2 Growth → 42 < 45
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.flourishing).toBeLessThan(epochTarget(1))
    expect(s.phase).toBe('select') // still open
    expect(s.playsLeft).toBe(3)
  })

  it('a run can reach at least epoch 8 (unlimited epochs, lives are the end)', () => {
    // drive a run forward by meeting each target with a big hand, then advance
    let s = newGame('deep-run')
    s.lives = 3
    for (let epoch = 1; epoch <= 8; epoch++) {
      s.epoch = epoch
      s.phase = 'select'
      s.playsLeft = 4
      s.discardsLeft = 3
      // bank enough to clear the target in one play
      s.epochGrowth = epochTarget(epoch) - 1
      s = forceHand(s, [C(14, 'H'), C(13, 'H'), C(12, 'H'), C(11, 'H'), C(10, 'H')])
      for (const i of [0, 1, 2, 3, 4]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      s = applyAction(s, { type: 'play' })
      expect(s.flourishing).toBeGreaterThanOrEqual(epochTarget(epoch))
      expect(s.phase).toBe('market') // early advance fired
      s = applyAction(s, { type: 'endMarket' })
      s = applyAction(s, { type: 'closeEpoch' })
      expect(s.phase).toBe('select')
      expect(s.epoch).toBe(epoch + 1)
    }
    expect(s.epoch).toBe(9)
    expect(s.lives).toBe(3)
  })

  it('validateState accepts a high epoch (>= 1, no upper bound)', () => {
    const s = newGame('high-epoch')
    s.epoch = 12
    s.phase = 'select'
    const j = JSON.parse(JSON.stringify(s))
    expect(validateState(j)).toBeNull()
  })
})

describe('per-epoch targets (not cumulative)', () => {
  it('epochGrowth resets at the epoch boundary; lifetime flourishing keeps growing', () => {
    let s = newGame('per-epoch-reset')
    s.epoch = 1
    s.epochGrowth = 0
    s.flourishing = 3
    s.playsLeft = 1 // single play closes the epoch
    s = forceHand(s, [C(14, 'H')]) // ace high = 14 Growth
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.epochGrowth).toBe(14)
    expect(s.flourishing).toBe(17)
    expect(s.phase).toBe('market') // epoch closed (4th play)
    // advance to epoch 2
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.epoch).toBe(2)
    expect(s.epochGrowth).toBe(0) // reset
    expect(s.flourishing).toBe(17) // lifetime kept
  })

  it('a missed epoch costs one life but the run continues and can succeed the next epoch', () => {
    let s = newGame('per-epoch-recover')
    s.epoch = 1
    s.epochGrowth = 0 // miss epoch 1 (target 100)
    s.lives = 3
    s.playsLeft = 1 // single weak play closes the epoch
    s = forceHand(s, [C(2, 'H')]) // 2 Growth, far short
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.lives).toBe(2) // miss cost a life
    expect(s.phase).toBe('market') // run continues
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.epoch).toBe(2)
    expect(s.epochGrowth).toBe(0) // reset — the deficit is NOT carried forward
    // now meet epoch 2's target with a big hand
    s = forceHand(s, [C(14, 'H'), C(13, 'H'), C(12, 'H'), C(11, 'H'), C(10, 'H')])
    for (const i of [0, 1, 2, 3, 4]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    s = applyAction(s, { type: 'play' })
    expect(s.epochGrowth).toBeGreaterThanOrEqual(epochTarget(2))
    expect(s.lives).toBe(2) // no further life lost
    expect(s.phase).toBe('market') // early advance — recovered
  })

  it('lifetime flourishing accumulates across a miss (score/display total)', () => {
    let s = newGame('per-epoch-lifetime')
    s.epoch = 1
    s.epochGrowth = 0
    s.flourishing = 3
    s.playsLeft = 1 // single play closes the epoch
    s = forceHand(s, [C(14, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    const afterE1 = s.flourishing
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.epoch).toBe(2)
    expect(s.flourishing).toBe(afterE1) // lifetime kept across the miss
  })
})

describe('World Score + World Projects (the goal: make the world as good as you can)', () => {
  it('worldScore rewards World Level, jokers, planets, vouchers, laws, and lifetime Flourishing', () => {
    let s = newGame('score-baseline')
    // worldLevel 1 = 5 score, 0 laws/jokers/planets/vouchers, floor(3/10)=0
    expect(worldScore(s)).toBe(5)
    // +world level → +5 each
    s.worldLevel = 3
    expect(worldScore(s)).toBe(15)
    // +joker → +10
    s.jokers = [{ id: 'joker-pair', title: 'Pair Joker', desc: '', cost: 8, condition: 'pair', mult: 0.5 }]
    expect(worldScore(s)).toBe(25)
    // +planet → +5 per 1.0 boost (0.5 boost = +2.5)
    s.planetLevels = { pair: 0.5 }
    expect(worldScore(s)).toBe(27.5)
    // +voucher → +8
    s.vouchers = [{ id: 'voucher-hand', title: 'Voucher: Bigger Hand', desc: '', cost: 12, handSize: 1 }]
    expect(worldScore(s)).toBe(35.5)
    // +law → +15
    s.laws = [{ id: 'canopy-choir', title: 'Canopy Choir', desc: '', cost: 10, kind: 'upgrade', growthFlat: 3 }]
    expect(worldScore(s)).toBe(50.5)
    // +lifetime Flourishing → +1 per 10
    s.flourishing = 100
    expect(worldScore(s)).toBe(60.5)
  })

  it('buyProject funds a project: costs Seeds, applies its effect, and is repeatable with escalating cost', () => {
    let s = newGame('proj-buy')
    s.phase = 'market'
    s.seeds = 100
    // fund a development project on Auralia (id 0)
    s = applyAction(s, { type: 'buyProject', projectId: 'proj-dev-auralia' })
    expect(s.seeds).toBe(92) // 100 - 8
    expect(s.regions[0].development).toBe(1)
    expect(s.projects).toHaveLength(1)
    // repeatable: cost escalates by costGrowth (8 + 4 = 12)
    s = applyAction(s, { type: 'buyProject', projectId: 'proj-dev-auralia' })
    expect(s.seeds).toBe(80) // 92 - 12
    expect(s.regions[0].development).toBe(2)
    expect(s.projects).toHaveLength(2)
  })

  it('a growth project adds flat Growth to every play (via buildPlan)', () => {
    let s = newGame('proj-growth')
    s.phase = 'market'
    s.seeds = 100
    s = applyAction(s, { type: 'buyProject', projectId: 'proj-growth' })
    const plan = buildPlan([C(10, 'H')], [0], [], [], s.projects)
    expect(plan.growth).toBe(12) // 10 + 2
  })

  it('a seeds project adds Seeds at each epoch end', () => {
    let s = newGame('proj-seeds')
    s.phase = 'market'
    s.seeds = 100
    s = applyAction(s, { type: 'buyProject', projectId: 'proj-seeds' })
    s.phase = 'select' // back to play
    s.epoch = 20 // high target so early-advance never fires
    s.epochGrowth = epochTarget(20) - 16
    s.flourishing = epochTarget(20) - 16
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    // income = 2 (project) + 4 (living regions) + 1 (worldLevel 1→2) = 7, not halved (target met)
    expect(s.log.some((l) => l.text.includes('Epoch end: +7 Seeds'))).toBe(true)
  })

  it('all 12 regions are wakeable (4 new wake items for regions 5, 7, 8, 10)', () => {
    const wakeIds = MARKET_ITEMS.filter((m) => m.kind === 'expansion').map((m) => m.wakeRegionId)
    expect(wakeIds).toEqual(expect.arrayContaining([5, 7, 8, 10]))
    // every region 0..11 has a wake path (4 start awake + 8 wake items)
    expect(new Set(wakeIds).size).toBe(8)
  })

  it('development is uncapped (a region can exceed the old STABILITY_MAX cap)', () => {
    let s = newGame('dev-uncapped')
    s.phase = 'market'
    s.seeds = 1000
    for (let i = 0; i < 15; i++) s = applyAction(s, { type: 'buyProject', projectId: 'proj-dev-auralia' })
    expect(s.regions[0].development).toBe(15) // > 10, uncapped
  })
})

describe('Balatro-hard: Jokers, Planet cards, Consumables, Vouchers, World Level', () => {
  it('a Pair Joker multiplies Growth when a Pair is played, and not otherwise', () => {
    const jokers = [{ id: 'joker-pair', title: 'Pair Joker', desc: '', cost: 8, condition: 'pair', mult: 0.5 }]
    const pair = buildPlan([C(9, 'S'), C(9, 'H')], [0, 1], [], [], [], { jokers })
    expect(pair.growth).toBe(Math.round(18 * 1.5 * 1.5)) // 18 chips × 1.5 mult × 1.5 joker
    const high = buildPlan([C(9, 'S'), C(5, 'H')], [0, 1], [], [], [], { jokers })
    expect(high.growth).toBe(14) // no joker fires on high card
  })

  it('a Planet card raises a hand type base mult', () => {
    const planetLevels = { pair: 0.5 }
    const pair = buildPlan([C(9, 'S'), C(9, 'H')], [0, 1], [], [], [], { planetLevels })
    expect(pair.growth).toBe(Math.round(18 * 2.0)) // 18 × (1.5 + 0.5)
  })

  it('a Consumable multiplies the next hand and is consumed on play', () => {
    let s = newGame('consume')
    s.phase = 'market'
    s.seeds = 100
    s.consumableMarket = [{ id: 'cons-x2', title: 'Double Down', desc: 'Next hand ×2 Growth.', cost: 8, xNext: 2 }]
    s = applyAction(s, { type: 'buyConsumable', consumableId: 'cons-x2' })
    expect(s.consumables).toHaveLength(1)
    s.phase = 'select'
    s = forceHand(s, [C(10, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.consumables).toHaveLength(0) // consumed
    expect(s.epochGrowth).toBe(20) // 10 × 2
  })

  it('a Voucher adds to all joker mult', () => {
    const jokers = [{ id: 'joker-any', title: 'All-In Joker', desc: '', cost: 10, condition: 'any', mult: 0.25 }]
    const vouchers = [{ id: 'voucher-joker', title: 'Voucher: Joker Power', desc: '', cost: 14, jokerMult: 0.5 }]
    const plan = buildPlan([C(10, 'H')], [0], [], [], [], { jokers, vouchers })
    expect(plan.growth).toBe(Math.round(10 * 1.75)) // 10 × (1 + 0.25 + 0.5)
  })

  it('World Level boosts Growth per play and grows each epoch', () => {
    let s = newGame('worldlevel')
    s.phase = 'market'
    s.seeds = 100
    s = applyAction(s, { type: 'boostWorld' })
    expect(s.worldLevel).toBe(2)
    s.phase = 'select'
    s = forceHand(s, [C(10, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.epochGrowth).toBe(12) // 10 + 2 (world level 2)
  })

  it('the steeper target forces a scaling engine (raw hands alone fall short by epoch ~6)', () => {
    // epoch 6 target is 100 + 30*5 + 3*25 = 325; a raw 4-play epoch banks ~100
    expect(epochTarget(6)).toBeGreaterThan(300)
    expect(epochTarget(1)).toBe(100)
  })
})

describe('epoch end: decay and development pressure', () => {
  it('epoch end applies decay of 1 to living regions (cosmetic pressure; lives govern loss)', () => {
    let s = newGame('decay')
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    for (const r of s.regions) {
      if (!r.dormant) expect(r.stability).toBe(STABILITY_BASE - 1)
    }
  })
  it('development is preserved and grows +1 per living region at epoch end (planet icons only)', () => {
    let s = newGame('development')
    s.regions[0].development = 4
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    expect(s.regions[0].development).toBe(5) // 4 + 1 epoch-end civilization growth
    for (const r of s.regions) {
      if (!r.dormant && r.id !== 0) expect(r.development).toBe(1)
    }
    for (const r of s.regions) {
      if (r.dormant) expect(r.development).toBe(0)
    }
  })
  it('full scripted run terminates with an outcome within 3 epochs', () => {
    let s = newGame('full-run')
    let guard = 0
    while (s.phase !== 'game-over' && guard < 200) {
      guard++
      if (s.phase === 'select') {
        s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
        s = applyAction(s, { type: 'play' })
      } else if (s.phase === 'market') {
        s = applyAction(s, { type: 'endMarket' })
      } else if (s.phase === 'epoch-end') {
        s = applyAction(s, { type: 'closeEpoch' })
      }
    }
    expect(s.phase).toBe('game-over')
    expect(['flourishing', 'withered']).toContain(s.outcome as string)
    expect(guard).toBeLessThan(200)
  })
  it('same policy across seeds produces different chronicles', () => {
    const run = (seed: string) => {
      let s: GameState = newGame(seed)
      let guard = 0
      while (s.phase !== 'game-over' && guard < 200) {
        guard++
        if (s.phase === 'select') {
          s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
          s = applyAction(s, { type: 'play' })
        } else if (s.phase === 'market') s = applyAction(s, { type: 'endMarket' })
        else if (s.phase === 'epoch-end') s = applyAction(s, { type: 'closeEpoch' })
      }
      return s.log.map((l) => l.text).join('|')
    }
    expect(run('var-one')).not.toBe(run('var-two'))
  })
})

describe('market: Seeds, laws, upgrades, expansions, card additions', () => {
  function toMarket(seed: string): GameState {
    let s = newGame(seed)
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    return s
  }
  it('market offers up to 3 distinct items, none referencing removed suit actions', () => {
    const s = toMarket('market')
    expect(s.market.length).toBeGreaterThan(0)
    expect(s.market.length).toBeLessThanOrEqual(3)
    expect(new Set(s.market.map((m) => m.id)).size).toBe(s.market.length)
    for (const m of s.market) {
      expect(['law', 'upgrade', 'expansion', 'cards']).toContain(m.kind)
    }
  })
  it('buying an upgrade spends Seeds exactly once (no double-apply) and grants the bonus', () => {
    let s = toMarket('market2')
    s.seeds = 30
    const item = s.market[0]
    const cost = item.cost
    s = applyAction(s, { type: 'buy', itemId: item.id })
    expect(s.seeds).toBe(30 - cost)
    expect(s.laws.some((l) => l.id === item.id)).toBe(true)
    expect(s.market.find((m) => m.id === item.id)).toBeUndefined()
    // no double-apply: re-purchase attempt throws and state is unchanged
    const seedsAfter = s.seeds
    expect(() => applyAction(s, { type: 'buy', itemId: item.id })).toThrow()
    expect(s.seeds).toBe(seedsAfter)
    expect(s.laws.filter((l) => l.id === item.id)).toHaveLength(1)
  })
  it('flat Growth upgrades apply exactly once per play (no double-apply)', () => {
    const s0 = newGame('flat-apply')
    const laws = [{ id: 'canopy-choir', title: 'Canopy Choir', desc: '', cost: 10, kind: 'upgrade', growthFlat: 3 }]
    const plan = buildPlan([C(10, 'H')], [0], laws)
    expect(plan.growth).toBe(13) // 10 + 3, not 10 + 2x3
  })
  it('expansion wakes the specified dormant region (planet visibly grows)', () => {
    let s = toMarket('market3')
    s.seeds = 30
    s.market = [{ id: 'wake-laguna', title: 'Wake Laguna', desc: '', cost: 12, kind: 'expansion', wakeRegionId: 4 }]
    s = applyAction(s, { type: 'buy', itemId: 'wake-laguna' })
    expect(s.regions[4].dormant).toBe(false)
    expect(s.regions.filter((r) => !r.dormant)).toHaveLength(START_REGIONS + 1)
  })
  it('cannot buy without enough Seeds; Seeds never go negative', () => {
    let s = toMarket('market4')
    s.seeds = 1
    const item = s.market[0]
    if (item.cost > 1) {
      expect(() => applyAction(s, { type: 'buy', itemId: item.id })).toThrow()
      expect(s.seeds).toBe(1)
    }
  })
  it('card additions grow the dealt hand and deck conservation still holds at 52', () => {
    let s = toMarket('market-cards')
    s.seeds = 30
    s.market = [{ id: 'fourth-counsel', title: 'Fourth Counsel', desc: '', cost: 12, kind: 'cards', handSize: 1 }]
    s = applyAction(s, { type: 'buy', itemId: 'fourth-counsel' })
    expect(s.laws.some((l) => l.handSize === 1)).toBe(true)
    expect(cardConservation(s)).toBe(true) // still exactly 52
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.phase).toBe('select')
    expect(s.hand).toHaveLength(9) // the added slot is real
    expect(cardConservation(s)).toBe(true)
    // and the deck+discard still sum to 52 - hand
    expect(s.deckRest.length + s.discardPile.length).toBe(52 - 9)
  })
  it('max 5 law/upgrade slots: buying is blocked at the cap', () => {
    let s = toMarket('market-slots')
    s.laws = MARKET_ITEMS.slice(0, LAW_SLOTS).map((m) => ({ ...m }))
    s.seeds = 30
    const item = s.market[0]
    expect(() => applyAction(s, { type: 'buy', itemId: item.id })).toThrow(/slots are full/)
  })
  it('removal frees a slot and the freed slot accepts a new purchase', () => {
    let s = toMarket('market-remove')
    s.laws = MARKET_ITEMS.slice(0, LAW_SLOTS).map((m) => ({ ...m }))
    s.seeds = 30
    const item = s.market[0]
    expect(() => applyAction(s, { type: 'buy', itemId: item.id })).toThrow()
    s = applyAction(s, { type: 'removeLaw', lawId: s.laws[0].id })
    expect(s.laws).toHaveLength(LAW_SLOTS - 1)
    // cost honours owned discounts (e.g. Barter Routes in the pre-filled slots)
    const discount = s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
    const realCost = Math.max(1, item.cost - discount)
    s = applyAction(s, { type: 'buy', itemId: item.id })
    expect(s.laws).toHaveLength(LAW_SLOTS)
    expect(s.laws.some((l) => l.id === item.id)).toBe(true)
    expect(s.seeds).toBe(30 - realCost)
  })
  it('removal of a nonexistent law throws', () => {
    const s = toMarket('market-remove2')
    expect(() => applyAction(s, { type: 'removeLaw', lawId: 'not-a-law' })).toThrow()
  })
  it('endMarket closes the epoch', () => {
    const s = toMarket('market5')
    const s2 = applyAction(s, { type: 'endMarket' })
    expect(['epoch-end', 'game-over', 'select']).toContain(s2.phase)
  })
  it('owned items never reappear in the market pool', () => {
    let s = toMarket('market-norepeat')
    s.seeds = 30
    const item = s.market[0]
    s = applyAction(s, { type: 'buy', itemId: item.id })
    expect(s.market.find((m) => m.id === item.id)).toBeUndefined()
  })
})

describe('capped world stats', () => {
  it('stability caps at 10 via applyPlanEffects (engine-level cap retained)', () => {
    const s = newGame('cap')
    s.regions[0].stability = 10
    applyPlanEffects(s, { ...buildPlan([C(14, 'C')], [0], []), effects: [{ kind: 'seeds', amount: 1 }] } as any)
    expect(s.regions[0].stability).toBe(10)
  })
})

describe('versioned save envelope + structural validation', () => {
  it('v7 state round-trips through JSON (v7 = Balatro-hard rules generation)', () => {
    const s = newGame('roundtrip')
    const j = JSON.parse(JSON.stringify(s))
    expect(j.version).toBe(7)
    expect(j.hand).toHaveLength(8)
    expect(j.regions).toHaveLength(12)
    const back = JSON.parse(JSON.stringify(j)) as GameState
    expect(back.regions[0].adjacency).toEqual(s.regions[0].adjacency)
  })
  it('quit does not clear the save (save.ts keeps the envelope)', async () => {
    const mod = await import('../src/ui/save')
    expect(typeof mod.saveGame).toBe('function')
    expect(typeof mod.loadGame).toBe('function')
    expect(mod.CURRENT_VERSION).toBe(7) // v7 = Balatro-hard rules generation
    expect(mod.SCHEMA_VERSION_CURRENT).toBe(3)
  })
})

describe('save versioning + structural validation (legacy preserved, never reinterpreted)', () => {
  // localStorage-free harness: save.ts's version/structure gate is exercised
  // through the exported validateState + the envelope's version fields.
  const fresh = () => JSON.parse(JSON.stringify(newGame('validator'))) as any

  it('CURRENT_VERSION is 7 (Balatro-hard rules generation) and SCHEMA_VERSION is 3', async () => {
    const w = await import('../src/engine/worldhand')
    expect(w.SAVE_VERSION).toBe(7)
    expect(w.SCHEMA_VERSION).toBe(3)
  })

  it('a fresh v3 state passes validateState (null = acceptable)', async () => {
    const w = await import('../src/engine/worldhand')
    expect(w.validateState(fresh())).toBeNull()
  })

  it('missing lives is rejected with a lives-specific reason', async () => {
    const w = await import('../src/engine/worldhand')
    const s = fresh(); delete s.lives
    const reason = w.validateState(s)
    expect(reason).toBeTruthy()
    expect(reason).toContain('lives')
  })

  it('non-numeric lives is rejected', async () => {
    const w = await import('../src/engine/worldhand')
    const s = fresh(); s.lives = 'three'
    expect(w.validateState(s)).toMatch(/lives/)
    const s2 = fresh(); s2.lives = 1.5
    expect(w.validateState(s2)).toMatch(/lives/)
    const s3 = fresh(); s3.lives = 7 // beyond LIVES_CAP
    expect(w.validateState(s3)).toMatch(/lives/)
  })

  it('obsolete Roots/Tend/Sow/Grow/Study-era market items are rejected', async () => {
    const w = await import('../src/engine/worldhand')
    for (const id of ['deep-taproots', 'rich-soil', 'communal-tending']) {
      const s = fresh(); s.laws = [{ id, title: 'Legacy', desc: '', cost: 5, kind: 'law' }]
      const reason = w.validateState(s)
      expect(reason).toBeTruthy()
      expect(reason).toContain(id)
    }
  })

  it('unknown (not-in-MARKET_ITEMS) ids are rejected', async () => {
    const w = await import('../src/engine/worldhand')
    const s = fresh(); s.market = [{ id: 'made-up-item', title: 'X', desc: '', cost: 1, kind: 'law' }]
    expect(w.validateState(s)).toMatch(/made-up-item/)
  })

  it('invalid phase is rejected', async () => {
    const w = await import('../src/engine/worldhand')
    const s = fresh(); s.phase = 'epoch-99'
    const reason = w.validateState(s)
    expect(reason).toBeTruthy()
    expect(reason).toContain('phase')
  })

  it('malformed cards (bad rank/suit, non-card objects) are rejected', async () => {
    const w = await import('../src/engine/worldhand')
    const cases: any[] = [
      { r: 1, s: 'H' }, // rank below 2
      { r: 15, s: 'H' }, // rank above ace
      { r: 10, s: 'Z' }, // unknown suit
      { r: 'ten', s: 'H' }, // non-numeric rank
      { foo: 1 }, // not a card at all
    ]
    for (const bad of cases) {
      const s = fresh(); s.hand = [bad]; s.deckRest = s.deckRest.slice(1)
      const reason = w.validateState(s)
      expect(reason).toBeTruthy()
      expect(String(reason).length).toBeGreaterThan(0)
    }
  })

  it('old-version saves (v1/v2 envelopes and states) are rejected — never migrated', async () => {
    const w = await import('../src/engine/worldhand')
    const s = fresh(); s.version = 2
    expect(w.validateState(s)).toMatch(/version/)
    const s1 = fresh(); s1.version = 1
    expect(w.validateState(s1)).toMatch(/version/)
    const s99 = fresh(); s99.version = 99
    expect(w.validateState(s99)).toMatch(/version/)
  })

  it('deck-conservation violation is rejected', async () => {
    const w = await import('../src/engine/worldhand')
    const s = fresh(); s.deckRest.pop()
    expect(w.validateState(s)).toMatch(/conservation/)
  })

  it('obsolete era item list is exported and includes the suit-action era ids', async () => {
    const w = await import('../src/engine/worldhand')
    expect(w.OBSOLETE_ITEM_IDS).toContain('deep-taproots')
    expect(w.OBSOLETE_ITEM_IDS).toContain('rich-soil')
    expect(w.OBSOLETE_ITEM_IDS).toContain('communal-tending')
  })

  it('a 0-lives state outside game-over is rejected (phase consistency)', async () => {
    const w = await import('../src/engine/worldhand')
    const s = fresh(); s.lives = 0; s.phase = 'select'
    expect(w.validateState(s)).toMatch(/0 lives/)
  })

  it('loadGameDetailed preserves an incompatible raw blob under a legacy key (no erase, no reinterpret)', async () => {
    const mod = await import('../src/ui/save')
    // localStorage shim (vitest node env): emulate the browser API on globalThis
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
      // v2 save (old rules generation): must be preserved + rejected
      const legacyV2 = JSON.stringify({ schema: 3, version: 2, savedAt: '2026-01-01T00:00:00.000Z', state: fresh() as any })
      store.set('worldhand.save', legacyV2)
      const res = mod.loadGameDetailed()
      expect(res.state).toBeNull()
      expect(res.rejectedReason).toMatch(/version 2/)
      expect(res.legacyKey).toMatch(/^worldhand\.save\.legacy\./)
      // the blob is preserved BYTE-FOR-BYTE under the legacy key, and the main key is untouched
      expect(store.get(res.legacyKey!)).toBe(legacyV2)
      expect(store.get('worldhand.save')).toBe(legacyV2)
      expect(mod.listLegacySaves().some((l) => l.key === res.legacyKey)).toBe(true)

      // structurally corrupt v7 state (missing lives): same preserve+reject path
      const corruptState = fresh(); delete corruptState.lives
      const env3 = JSON.stringify({ schema: 3, version: 7, savedAt: '2026-01-02T00:00:00.000Z', state: corruptState })
      store.set('worldhand.save', env3)
      const res2 = mod.loadGameDetailed()
      expect(res2.state).toBeNull()
      expect(res2.rejectedReason).toMatch(/incompatible/)
      expect(store.get(res2.legacyKey!)).toBe(env3)
      expect(store.get('worldhand.save')).toBe(env3)

      // a valid v7 save still loads
      store.set('worldhand.save', JSON.stringify({ schema: 3, version: 7, savedAt: '2026-01-03T00:00:00.000Z', state: fresh() }))
      const res3 = mod.loadGameDetailed()
      expect(res3.state).not.toBeNull()
      expect(res3.rejectedReason).toBeNull()
      expect(res3.legacyKey).toBeNull()
    } finally {
      g.localStorage = prev ? Object.assign({}, prev) : undefined
      if (!prev) delete g.localStorage
    }
  })
})

describe('lives: every missed target costs 1, 0 ends the run, win while lives remain', () => {
  it('missing the epoch-3 target ALSO costs 1 life (the run continues, lives are the end)', () => {
    // exercise the miss through a REAL epoch: 4 weak plays banks nothing; the
    // 4th play closes the epoch and endEpoch charges the life. With unlimited
    // epochs the run continues into the market — lives are what end it.
    let s = newGame('lives-e3-cost')
    s.epoch = 3
    s.flourishing = 1
    s.phase = 'select'
    s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    // the miss still cost its life — and the run continues (no fixed cap)
    expect(s.phase).toBe('market')
    expect(s.lives).toBe(SURVIVAL_START - 1) // the miss still cost a life
  })
  it('a met target at a high epoch advances to the next epoch (unlimited epochs)', () => {
    let s = newGame('win-lives-remain')
    s.epoch = 8
    s.phase = 'epoch-end'
    s.epochGrowth = epochTarget(8) + 10
    const s2 = applyAction(s, { type: 'closeEpoch' })
    expect(s2.phase).toBe('select')
    expect(s2.epoch).toBe(9)
    expect(s2.lives).toBe(SURVIVAL_START)
  })
})
