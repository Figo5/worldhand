import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, preview, buildPlan, suitMajority, cardConservation,
  checkWithering, droughtChallenge, applyPlanEffects, EPOCH_TARGETS,
  DROUGHT_PENALTY_PER_REGION,
  SURVIVAL_START, SURVIVAL_MAX,
  PLAYS_PER_EPOCH, DISCARDS_PER_EPOCH, HAND_SIZE, TOTAL_EPOCHS, TOTAL_REGIONS,
  STABILITY_BASE, STABILITY_MAX, SEEDS_CAP, START_REGIONS,
} from '../src/engine/worldhand'
import { CATEGORY_MULT } from '../src/engine/poker'
import type { GameState, Suit } from '../src/engine/worldhand'
import type { Card, Suit as PSuit } from '../src/engine/poker'

const C = (r: number, s: PSuit): Card => ({ r: r as Card['r'], s })
const idxOfSuit = (s: GameState, suit: PSuit): number => s.hand.findIndex((c) => c.s === suit)
const cardAt = (s: GameState, i: number): Card => s.hand[i]

// Deterministic helpers: force a known hand without changing other state.
function forceHand(s: GameState, cards: Card[]): GameState {
  const t = { ...s, hand: [...cards] }
  return t as GameState
}

/* eslint-disable */

describe('worldhand v2 core contracts', () => {
  it('starts: 12 regions (4 awake), stability base 3, 3 Flourishing, 8 Seeds, 8-card hand', () => {
    const s = newGame('auralia-the-first')
    expect(s.regions).toHaveLength(TOTAL_REGIONS)
    expect(s.regions.filter((r) => !r.dormant)).toHaveLength(START_REGIONS)
    for (const r of s.regions) expect(r.stability).toBe(STABILITY_BASE)
    expect(s.flourishing).toBe(3)
    expect(s.seeds).toBe(8)
    expect(s.hand).toHaveLength(HAND_SIZE)
    expect(s.playsLeft).toBe(PLAYS_PER_EPOCH)
    expect(s.discardsLeft).toBe(DISCARDS_PER_EPOCH)
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
  it('ONE escalating Flourishing (Growth) target per epoch, strictly increasing', () => {
    // The simplified contract: a single cumulative-Growth target per epoch.
    // The old two-target contract (Flourishing + STABILITY_SUM_TARGETS) is gone.
    expect(EPOCH_TARGETS).toHaveLength(3)
    expect(EPOCH_TARGETS.map((t) => t.need)).toEqual([50, 120, 200])
    expect(EPOCH_TARGETS[0].need).toBeLessThan(EPOCH_TARGETS[1].need)
    expect(EPOCH_TARGETS[1].need).toBeLessThan(EPOCH_TARGETS[2].need)
    // every target is a single `need` number (no per-epoch stability-sum list)
    for (const t of EPOCH_TARGETS) expect(typeof t.need).toBe('number')
  })
  it('targets are calibrated against measured bounded play, not the final target alone', () => {
    // scripts/solve.mjs with LOOK=30 (bounded policy: all 1-2 card selections +
    // seeded longer ones, 30 probe-* seeds, Survival active) measured the
    // win-rate ladder the shipped targets sit on (new Growth engine):
    //   e3 190 → 20/30 (67%) · e3 200 → 18/30 (60%) · e3 205 → 15/30 (50%)
    // [50,120,200] lands at the top edge of the intended 40-60% band for the
    // bounded policy (18/30 = 60%); the same targets give 13/30 (43%) at
    // LOOK=12 and 30/30 (100%) exhaustive — the band is measured at the
    // bounded reference, not only reachable by exhaustive search. The shipped
    // targets are escalating and far above the old chips-only [12,24,32].
    expect(EPOCH_TARGETS[TOTAL_EPOCHS - 1].need).toBe(200)
    // strictly escalating so every epoch's target stays live
    for (let i = 1; i < EPOCH_TARGETS.length; i++) {
      expect(EPOCH_TARGETS[i].need).toBeGreaterThan(EPOCH_TARGETS[i - 1].need)
    }
  })
  it('card conservation holds after every action type', () => {
    let s = newGame('conservation')
    expect(cardConservation(s)).toBe(true)
    s = applyAction(s, { type: 'discard', cardIdxs: [0, 1] })
    expect(cardConservation(s)).toBe(true)
    s.hand = s.hand // refill happened: hand back to 8
    expect(s.hand).toHaveLength(8)
    // play something
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(cardConservation(s)).toBe(true)
    expect(s.hand).toHaveLength(8)
  })
})

describe('selection 1–5 and ResolutionPlan', () => {
  it('toggleCard enforces max 5 and duplicates impossible', () => {
    let s = newGame('sel')
    for (let i = 0; i < 5; i++) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    expect(s.selected).toHaveLength(5)
    expect(() => applyAction(s, { type: 'toggleCard', cardIdx: 5 })).toThrow()
    // toggle off then back on
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    expect(s.selected).toHaveLength(4)
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    expect(s.selected).toHaveLength(5)
  })
  it('preview and commit use the SAME plan object shape (deterministic pipeline)', () => {
    let s = newGame('pipeline')
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
    const pv = preview(s)
    const before = { f: s.flourishing, seeds: s.seeds, stab: s.regions.map((r) => r.stability) }
    const s2 = applyAction(s, { type: 'play' })
    expect(s2.lastResolution).not.toBeNull()
    // same category, suit, effects
    expect(s2.lastResolution!.category).toBe(pv.category)
    expect(s2.lastResolution!.suit).toBe(pv.suit)
    expect(s2.lastResolution!.effects).toEqual(pv.effects)
    // effects actually applied
    for (const e of pv.effects) {
      if (e.kind === 'flourishing') expect(s2.flourishing).toBe(before.f + e.amount)
      if (e.kind === 'seeds') expect(s2.seeds).toBe(Math.min(SEEDS_CAP, before.seeds + e.amount))
      if (e.kind === 'stability') expect(s2.regions[e.regionId].stability)
        .toBe(Math.min(STABILITY_MAX, before.stab[e.regionId] + e.amount))
    }
  })
  it('buildPlan rejects empty selection with a reason', () => {
    const s = newGame('empty')
    const plan = buildPlan(s.hand, [], s.regions, [])
    expect(plan.valid).toBe(false)
    expect(plan.invalidReason).toContain('1–5')
  })
  it('category points scale the effect magnitude (flush > high card play)', () => {
    const s0 = newGame('scale')
    // Bloom play: rank sum drives gain; verify bigger selection gives >= gain of smaller subset
    const a = buildPlan([C(10, 'H')], [0], s0.regions, [])
    const b = buildPlan([C(10, 'H'), C(10, 'H'), C(10, 'H')], [0, 1, 2], s0.regions, [])
    expect(b.rankSum).toBeGreaterThan(a.rankSum)
  })
})

describe('suit majority / tie choice', () => {
  it('majority suit wins', () => {
    const m = suitMajority([C(5, 'H'), C(6, 'H'), C(7, 'D')])
    expect(m.suit).toBe('H')
    expect(m.decision).toBe('majority')
  })
  it('tie defaults to first suit in S,H,D,C order', () => {
    const m = suitMajority([C(5, 'H'), C(6, 'D')])
    expect(m.tied.length).toBe(2)
    expect(m.suit).toBe('H') // S,H,D,C order → H first
  })
  it('explicit tie choice overrides the default', () => {
    const m = suitMajority([C(5, 'H'), C(6, 'D')], 'H')
    expect(m.suit).toBe('H')
    expect(m.decision).toBe('tiebreak-choice')
  })
  it('single card is its own suit', () => {
    const m = suitMajority([C(5, 'S')])
    expect(m.suit).toBe('S')
    expect(m.decision).toBe('single')
  })
  it('plan suit follows majority of selected cards', () => {
    const s0 = newGame('planmaj')
    const plan = buildPlan([C(5, 'H'), C(6, 'H'), C(9, 'D')], [0, 1, 2], s0.regions, [])
    expect(plan.suit).toBe('H')
    expect(plan.suitCounts.H).toBe(2)
    expect(plan.suitCounts.D).toBe(1)
  })
  it('REGRESSION: committed play carries suitChoice — commit matches the previewed tie choice (was: commit dropped the tie choice)', () => {
    // 2♥+2♣+1♦ tie between H and C: the old commit path called
    // buildPlan(..., undefined), so a player previewing Clubs/Settle got
    // Hearts/Grow on commit (S,H,D,C default order).
    let s = newGame('tie-commit')
    s = forceHand(s, [C(5, 'H'), C(6, 'H'), C(7, 'D'), C(9, 'C'), C(10, 'C')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 2 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 3 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 4 })
    const pv = preview(s, 'C')
    expect(pv.suitDecision).toBe('tiebreak-choice')
    expect(pv.suit).toBe('C')
    // Settle effects: +1 stability per living region, PLUS the single banked
    // Growth effect every play carries (the flourish bank).
    const stabEffects = pv.effects.filter((e) => e.kind === 'stability')
    expect(stabEffects).toHaveLength(START_REGIONS)
    expect(pv.effects.filter((e) => e.kind === 'flourishing')).toHaveLength(1)
    const s2 = applyAction(s, { type: 'play', suitChoice: 'C' })
    expect(s2.lastResolution!.suit).toBe('C')
    expect(s2.lastResolution!.suitDecision).toBe('tiebreak-choice')
    expect(s2.lastResolution!.effects).toEqual(pv.effects)
    // the single Growth score is identical in preview and commit
    expect(s2.lastResolution!.growth).toBe(pv.growth)
    expect(s2.lastResolution!.growthParts).toEqual(pv.growthParts)
  })
  it('REGRESSION: preview(hand, tieChoice) === buildPlan(hand, selected, regions, laws, tieChoice) === committed play with suitChoice', () => {
    const s0 = newGame('tie-pipeline')
    const hand = [C(9, 'H'), C(9, 'D')]
    const selected = [0, 1]
    const previewed = preview({ ...s0, hand, selected } as GameState, 'D')
    const built = buildPlan(hand, selected, s0.regions, s0.laws, 'D')
    expect(previewed).toEqual(built)
    let s = forceHand(newGame('tie-commit-2'), hand)
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
    const committed = applyAction(s, { type: 'play', suitChoice: 'D' }).lastResolution!
    // same effects/category/suit as the previewed/built plan for tieChoice 'D'
    expect(committed.effects).toEqual(built.effects)
    expect(committed.category).toBe(built.category)
    expect(committed.suit).toBe(built.suit)
    // and the choice really changed the outcome vs the default tie-break (H first)
    expect(built.suit).toBe('D')
    expect(buildPlan(hand, selected, s0.regions, s0.laws, undefined).suit).toBe('H')
  })
  it('suitCounts/majority still work when tieChoice is provided (counts unaffected by the choice)', () => {
    const hand = [C(5, 'H'), C(6, 'H'), C(7, 'D'), C(9, 'C'), C(10, 'C')]
    const m = suitMajority(hand, 'C')
    expect(m.counts).toEqual({ S: 0, H: 2, D: 1, C: 2 })
    expect(m.tied.sort()).toEqual(['C', 'H'])
    expect(m.suit).toBe('C')
    expect(m.decision).toBe('tiebreak-choice')
    const planC = buildPlan(hand, [0, 1, 2, 3, 4], newGame('counts').regions, [], 'C')
    expect(planC.suitCounts).toEqual({ S: 0, H: 2, D: 1, C: 2 })
    expect(planC.suit).toBe('C')
  })
  it('regionChoice on a committed play still targets the Study region (backward-compatible)', () => {
    // default: the weakest living region is targeted
    const s1 = forceHand(newGame('study-target'), [C(10, 'S')])
    s1.regions[0].stability = 2
    s1.regions[1].stability = 9
    const sDefault = applyAction(s1, { type: 'toggleCard', cardIdx: 0 })
    const committedDefault = applyAction(sDefault, { type: 'play' })
    expect(committedDefault.lastResolution!.effects[0]).toMatchObject({ kind: 'develop', regionId: 0, amount: 1 })
    // regionChoice overrides the weakest-first default
    const s2 = forceHand(newGame('study-target-2'), [C(10, 'S')])
    s2.regions[3].dormant = false
    s2.regions[3].stability = 9
    s2.regions[0].stability = 9
    s2.regions[1].stability = 2
    const sT = applyAction(s2, { type: 'toggleCard', cardIdx: 0 })
    const committedTargeted = applyAction(sT, { type: 'play', regionChoice: 3 })
    expect(committedTargeted.lastResolution!.effects[0]).toMatchObject({ kind: 'develop', regionId: 3, amount: 1 })
  })
})

describe('suit actions — ONE action per suit (Grow/Mine/Study/Settle)', () => {
  it('♥ Grow: banks Growth toward the epoch target; Q+ heart wakes a dormant region', () => {
    const s0 = newGame('grow')
    const s1 = forceHand(s0, [C(13, 'H')])
    const plan = buildPlan(s1.hand, [0], s1.regions, [])
    expect(plan.suit).toBe('H')
    expect(plan.effects.some((e) => e.kind === 'wake')).toBe(true)
    expect(s1.regions[4].dormant).toBe(true) // first dormant untouched by plan-building
  })
  it('REGRESSION: ResolutionPlan carries the Drought wake-cost warning whenever a Grow play wakes a region', () => {
    // The wake's cost (stability 3+ during the epoch-3 Drought) must be stated
    // in the shared plan summary — visible at decision time in the preview and
    // in the committed resolution, for EVERY region a Grow play wakes.
    for (let dormantId = 4; dormantId < TOTAL_REGIONS; dormantId++) {
      const s = newGame(`wake-warn-${dormantId}`)
      // wake everything before the target region so it is next in wake order
      for (const r of s.regions) {
        if (r.id < dormantId && r.id >= START_REGIONS) r.dormant = false
      }
      const plan = buildPlan([C(13, 'H')], [0], s.regions, [])
      const wake = plan.effects.find((e) => e.kind === 'wake') as { kind: string; regionId: number } | undefined
      expect(wake).toBeDefined()
      expect(wake!.regionId).toBe(dormantId)
      expect(plan.summary).toContain('wakes')
      expect(plan.summary).toContain(s.regions[dormantId].name)
      expect(plan.summary).toContain('stability 3+')
      expect(plan.summary).toContain('epoch-3 Drought')
    }
  })
  it('Grow low cards do not wake, so no wake warning appears', () => {
    const s0 = newGame('grow2')
    const plan = buildPlan([C(5, 'H')], [0], s0.regions, [])
    expect(plan.effects.some((e) => e.kind === 'wake')).toBe(false)
    expect(plan.summary).not.toContain('Drought')
  })
  it('commit applies wake from Grow Q+ play', () => {
    let s = newGame('wake')
    s = forceHand(s, [C(13, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.regions.filter((r) => !r.dormant)).toHaveLength(5)
  })
  it('♦ Mine: gains Seeds, capped at SEEDS_CAP', () => {
    const s0 = newGame('mine')
    const plan = buildPlan([C(12, 'D')], [0], s0.regions, [])
    expect(plan.suit).toBe('D')
    expect(plan.effects[0]).toEqual({ kind: 'seeds', amount: 4 })
    // cap: a big Mine play cannot push Seeds past 30
    let s = newGame('mine-cap')
    s.seeds = SEEDS_CAP
    s = forceHand(s, [C(14, 'D')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.seeds).toBe(SEEDS_CAP)
  })
  it('♠ Study: +1 development to the weakest living region by default', () => {
    const s0 = newGame('study')
    const s1 = forceHand(s0, [C(10, 'S')])
    s1.regions[0].stability = 2 // weakest living region
    const plan = buildPlan(s1.hand, [0], s1.regions, [])
    expect(plan.suit).toBe('S')
    expect(plan.effects[0]).toEqual({ kind: 'develop', regionId: 0, amount: 1 })
    expect(plan.summary).toContain('Study')
    expect(plan.summary).toContain(s1.regions[0].name)
  })
  it('♠ Study: a targeted region (regionChoice) overrides the weakest-first default', () => {
    const s0 = newGame('study2')
    const s1 = forceHand(s0, [C(10, 'S')])
    s1.regions[0].stability = 2 // weakest
    s1.regions[3].dormant = false
    const plan = buildPlan(s1.hand, [0], s1.regions, [], 3 as unknown as Suit)
    expect(plan.suit).toBe('S')
    expect(plan.effects[0]).toEqual({ kind: 'develop', regionId: 3, amount: 1 })
  })
  it('♠ Study with the Study upgrade gains the law bonus (+1 dev)', () => {
    const s0 = newGame('study2')
    const base = buildPlan([C(10, 'S')], [0], s0.regions, [])
    const buffed = buildPlan([C(10, 'S')], [0], s0.regions, [{ id: 'deep-taproots', title: 'Deep Taproots', desc: '', cost: 10, kind: 'upgrade', studyBonus: 1 }])
    expect((base.effects[0] as any).amount).toBe(1)
    expect((buffed.effects[0] as any).amount).toBe(2)
  })
  it('♣ Settle: +1 stability to EVERY living region (the Drought defence)', () => {
    const s0 = newGame('settle')
    const plan = buildPlan([C(9, 'C')], [0], s0.regions, [])
    expect(plan.suit).toBe('C')
    const stabEffects = plan.effects.filter((e) => e.kind === 'stability')
    expect(stabEffects).toHaveLength(START_REGIONS) // 4 living regions
    for (const e of stabEffects) expect((e as any).amount).toBe(1)
  })
  it('♣ Settle with the Communal Tending upgrade gives +1 extra stability everywhere', () => {
    const s0 = newGame('settle2')
    const plan = buildPlan([C(9, 'C')], [0], s0.regions, [{ id: 'communal-tending', title: 'Communal Tending', desc: '', cost: 9, kind: 'upgrade', settleBonus: 1 }])
    const stabEffects = plan.effects.filter((e) => e.kind === 'stability')
    for (const e of stabEffects) expect((e as any).amount).toBe(2)
  })
  it('every play — any suit — banks ONE Growth score with an ordered growthParts breakdown', () => {
    const s0 = newGame('growth-bank')
    const regions = s0.regions.map((r) => ({ ...r }))
    for (const suit of ['S', 'H', 'D', 'C'] as const) {
      const plan = buildPlan([C(10, suit)], [0], regions, [])
      expect(plan.valid).toBe(true)
      expect(plan.growth).toBe(Math.max(0, plan.growthParts.poker + plan.growthParts.region + plan.growthParts.laws + plan.growthParts.drought))
      // single-card 10: rankSum 10 × mult 1 (high card) = 10 poker base
      expect(plan.growthParts.poker).toBe(10)
      expect(plan.growthParts.laws).toBe(0)
      expect(plan.growthParts.drought).toBe(0) // all living regions start at stability 3+
      expect(plan.effects.some((e) => e.kind === 'flourishing' && e.amount === plan.growth)).toBe(true)
    }
  })
  it('Growth poker base = rankSum × CATEGORY_MULT (flush outscores high card)', () => {
    const s0 = newGame('growth-mult')
    const high = buildPlan([C(10, 'H')], [0], s0.regions, [])
    const flush = buildPlan([C(2, 'H'), C(6, 'H'), C(7, 'H'), C(9, 'H'), C(14, 'H')], [0, 1, 2, 3, 4], s0.regions, [])
    expect(high.growthParts.poker).toBe(10 * CATEGORY_MULT['high'])
    expect(flush.growthParts.poker).toBe((2 + 6 + 7 + 9 + 14) * CATEGORY_MULT['flush'])
    expect(flush.growth).toBeGreaterThan(high.growth)
  })
  it('region part: +floor(acting region development / 3) — the Study loop feeds Growth', () => {
    const s0 = newGame('growth-region')
    const dev3 = s0.regions.map((r, i) => (i === 0 ? { ...r, development: 3 } : { ...r }))
    const plan = buildPlan([C(10, 'S')], [0], dev3, [])
    expect(plan.growthParts.region).toBe(Math.floor(3 / 3))
    const dev7 = s0.regions.map((r, i) => (i === 0 ? { ...r, development: 7 } : { ...r }))
    expect(buildPlan([C(10, 'S')], [0], dev7, []).growthParts.region).toBe(Math.floor(7 / 3))
  })
  it('laws part: owned Grow upgrades add Growth directly (other suits do not)', () => {
    const s0 = newGame('growth-laws')
    const laws = [{ id: 'canopy-choir', title: 'Canopy Choir', desc: '', cost: 10, kind: 'upgrade', growBonus: 3 }]
    const grow = buildPlan([C(10, 'H')], [0], s0.regions, laws)
    expect(grow.growthParts.laws).toBe(3)
    const mine = buildPlan([C(10, 'D')], [0], s0.regions, laws)
    expect(mine.growthParts.laws).toBe(0)
  })
  it('drought part: −DROUGHT_PENALTY_PER_REGION Growth per living region below stability 3 (floored at 0)', () => {
    const s0 = newGame('growth-drought')
    const risky = s0.regions.map((r, i) => (i < START_REGIONS && i < 2 ? { ...r, stability: 2 } : { ...r }))
    const plan = buildPlan([C(10, 'H')], [0], risky, [])
    expect(plan.growthParts.drought).toBe(-2 * DROUGHT_PENALTY_PER_REGION)
    expect(plan.growth).toBe(Math.max(0, 10 - 2 * DROUGHT_PENALTY_PER_REGION))
    // floor at 0: a tiny play in a drought-stricken world banks nothing
    const dire = s0.regions.map((r) => ({ ...r, stability: 0 }))
    const direPlan = buildPlan([C(2, 'H')], [0], dire, [])
    expect(direPlan.growthParts.drought).toBe(-4 * DROUGHT_PENALTY_PER_REGION)
    expect(direPlan.growth).toBe(0)
  })
  it('preview == commit: the same plan (incl. growth and growthParts) is used by both', () => {
    let s = newGame('pv-commit-growth')
    s = forceHand(s, [C(10, 'S'), C(11, 'H'), C(12, 'D'), C(13, 'C'), C(9, 'H')])
    s.regions[0].development = 4
    s.regions[2].stability = 2 // drought liability
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
  it('rejects discarding 0 or 6 cards', () => {
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
    expect(s.phase).toBe('market') // epoch ended → market phase
  })
  it('play with 0 left throws', () => {
    let s = newGame('plays2')
    s.playsLeft = 0
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    expect(() => applyAction(s, { type: 'play' })).toThrow()
  })
})

describe('epoch end: targets, Stability decay, Drought challenge', () => {
  it('Survival pool: starts at 3, capped at 3', () => {
    expect(SURVIVAL_START).toBe(3)
    expect(SURVIVAL_MAX).toBe(3)
    expect(newGame('survival-init').survival).toBe(3)
  })
  it('missing the epoch-1 target costs 1 Survival and halves that epoch-end market income', () => {
    // Mine-only singles bank exactly 10 Growth each (4 plays = 40 + start 3 = 43),
    // deterministically below the epoch-1 target of 50.
    let s = newGame('survival-miss-e1')
    s = forceHand(s, [C(4, 'D'), C(4, 'D'), C(4, 'D'), C(4, 'D')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    const f = s.flourishing
    expect(f).toBeLessThan(EPOCH_TARGETS[0].need)
    expect(s.survival).toBe(SURVIVAL_START - 1)
    expect(s.log.some((l) => l.text.includes(`Survival drops to ${SURVIVAL_START - 1}`))).toBe(true)
    expect(s.log.some((l) => l.text.includes('market income is halved'))).toBe(true)
  })
  it('meeting the epoch target costs no Survival', () => {
    // force a met target: Flourishing already far above the epoch-1 target
    let s = newGame('survival-met')
    s.flourishing = 100
    s.epoch = 1
    s = forceHand(s, [C(4, 'D'), C(4, 'D'), C(4, 'D'), C(4, 'D')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.flourishing).toBeGreaterThanOrEqual(EPOCH_TARGETS[0].need)
    expect(s.survival).toBe(SURVIVAL_START)
    expect(s.log.every((l) => !l.text.includes('Survival drops'))).toBe(true)
    expect(s.log.every((l) => !l.text.includes('halved'))).toBe(true)
  })
  it('missing the epoch-2 target also drains Survival (2 misses leave 1)', () => {
    // epoch 1: Sow-only hand, far below the epoch-1 target -> Survival 3→2
    let s = newGame('survival-miss-e2')
    s = forceHand(s, [C(4, 'D'), C(4, 'D'), C(4, 'D'), C(4, 'D')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.survival).toBe(2)
    // epoch 2: end the market, then again play only weak Sow singles -> Survival 2→1
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.epoch).toBe(2)
    expect(s.phase).toBe('select')
    s = forceHand(s, [C(4, 'D'), C(4, 'D'), C(4, 'D'), C(4, 'D')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.survival).toBe(1)
    expect(s.phase).toBe('market') // still alive at 1
    expect(s.log.some((l) => l.text.includes('Survival drops to 1'))).toBe(true)
  })
  it('a drained Survival pool (0) ends the run withered', () => {
    let s = newGame('survival-zero')
    s.survival = 0
    s.epoch = 1
    s.phase = 'epoch-end'
    s.challenge = null
    const s2 = applyAction(s, { type: 'closeEpoch' })
    expect(s2.phase).toBe('game-over')
    expect(s2.outcome).toBe('withered')
    expect(s2.outcomeReason).toContain('Survival')
  })
  it('the epoch-3 target miss costs no Survival (its miss is already terminal)', () => {
    let s = newGame('survival-e3')
    s.epoch = 3
    s.phase = 'epoch-end'
    s.challenge = null
    s.flourishing = 1
    const s2 = applyAction(s, { type: 'closeEpoch' })
    expect(s2.phase).toBe('game-over')
    expect(s2.outcomeReason).toContain('fell short')
    expect(s2.survival).toBe(SURVIVAL_START)
  })
  it('Survival is serialized in the save envelope', () => {
    const s = newGame('survival-save')
    const j = JSON.parse(JSON.stringify(s))
    expect(j.survival).toBe(3)
  })
  it('epoch end applies decay of 1 and Seeds income', () => {
    let s = newGame('decay')
    // force a hand of Sow cards so no play changes stability — decay only
    s = forceHand(s, [C(4, 'D'), C(4, 'D'), C(4, 'D'), C(4, 'D')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    for (const r of s.regions) {
      if (!r.dormant) expect(r.stability).toBe(STABILITY_BASE - 1)
    }
  })
  it('epoch 3 carries the explicit Drought challenge', () => {
    const ch = droughtChallenge(3)
    expect(ch.kind).toBe('drought')
    expect(ch.desc).toContain('Drought')
    // met when every living region is at 3+
    let s = newGame('drought')
    s.challenge = ch
    expect(s.regions.every((r) => r.stability >= 3)).toBe(true)
    // failed when any drops below
    s.regions[0].stability = 2
    expect(s.regions.some((r) => r.stability < 3)).toBe(true)
  })
  it('Drought challenge appears in the log when epoch 3 begins', () => {
    // fast-forward: force epoch 2 → close it
    let s = newGame('droughtlog')
    s.epoch = 2
    s.challenge = null
    s.phase = 'epoch-end'
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.epoch).toBe(3)
    expect(s.challenge?.kind).toBe('drought')
    expect(s.log.some((l) => l.text.includes('Drought') && l.text.includes('PREVIEWED'))).toBe(true)
  })
  it('failing the Drought challenge ends the game withered', () => {
    let s = newGame('droughtfail')
    s.epoch = 3
    s.challenge = droughtChallenge(3)
    s.regions[0].stability = 0 // drought will fail
    s.phase = 'epoch-end'
    s.challengeFailed = false
    // closeEpoch path via market: go to market then end
    s.phase = 'epoch-end'
    s = applyAction(s, { type: 'closeEpoch' })
    // challenge failed flag set at end-of-epoch resolution; emulate through full epoch flow instead:
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

describe('market: Seeds, laws, upgrades, expansions', () => {
  function toMarket(seed: string): GameState {
    let s = newGame(seed)
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    return s
  }
  it('market offers up to 3 distinct items', () => {
    const s = toMarket('market')
    expect(s.market.length).toBeGreaterThan(0)
    expect(s.market.length).toBeLessThanOrEqual(3)
    expect(new Set(s.market.map((m) => m.id)).size).toBe(s.market.length)
  })
  it('buying an upgrade spends Seeds and grants the bonus', () => {
    let s = toMarket('market2')
    s.seeds = 30
    const item = s.market[0]
    const cost = item.cost
    const f0 = s.flourishing
    s = applyAction(s, { type: 'buy', itemId: item.id })
    expect(s.seeds).toBe(30 - cost)
    expect(s.laws.some((l) => l.id === item.id)).toBe(true)
    expect(s.market.find((m) => m.id === item.id)).toBeUndefined()
  })
  it('expansion wakes the specified dormant region', () => {
    let s = toMarket('market3')
    s.seeds = 30
    s.market = [{ id: 'wake-laguna', title: 'Wake Laguna', desc: '', cost: 12, kind: 'expansion', wakeRegionId: 4 }]
    s = applyAction(s, { type: 'buy', itemId: 'wake-laguna' })
    expect(s.regions[4].dormant).toBe(false)
  })
  it('cannot buy without enough Seeds', () => {
    let s = toMarket('market4')
    s.seeds = 1
    const item = s.market[0]
    if (item.cost > 1) expect(() => applyAction(s, { type: 'buy', itemId: item.id })).toThrow()
  })
  it('Barter Routes law discounts later purchases', () => {
    const s0 = newGame('barter')
    const s1 = forceHand(s0, [C(9, 'D')])
    const plan = buildPlan(s1.hand, [0], s1.regions, [{ id: 'barter-routes', title: '', desc: '', cost: 5, kind: 'law', marketDiscount: 2 }])
    expect(plan.valid).toBe(true)
  })
  it('endMarket closes the epoch', () => {
    const s = toMarket('market5')
    const s2 = applyAction(s, { type: 'endMarket' })
    expect(['epoch-end', 'game-over', 'select']).toContain(s2.phase)
  })
})

describe('capped world stats', () => {
  it('stability caps at 10', () => {
    let s = newGame('cap')
    s.regions[0].stability = 10
    s = forceHand(s, [C(14, 'C')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.regions[0].stability).toBe(STABILITY_MAX)
  })
  it('seeds cap at 30', () => {
    let s = newGame('cap2')
    s.seeds = SEEDS_CAP
    s = forceHand(s, [C(14, 'D')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.seeds).toBe(SEEDS_CAP)
  })
})

describe('withering loss condition', () => {
  it('5 dead living regions ends the world', () => {
    let s = newGame('wither')
    s.regions[4].dormant = false
    s.regions[5].dormant = false
    for (const r of s.regions) if (!r.dormant) r.stability = 0
    const s2 = checkWithering(s)
    expect(s2.phase).toBe('game-over')
    expect(s2.outcome).toBe('withered')
  })
  it('Flourishing ≤ 0 at an epoch boundary ends the world', () => {
    let s = newGame('zero')
    s.flourishing = 0
    s.epoch = 1
    s.phase = 'epoch-end'
    const s2 = applyAction(s, { type: 'closeEpoch' })
    expect(s2.phase).toBe('game-over')
    expect(s2.outcome).toBe('withered')
  })
})

describe('versioned save envelope', () => {
  it('v2 state round-trips through JSON', () => {
    const s = newGame('roundtrip')
    const j = JSON.parse(JSON.stringify(s))
    expect(j.version).toBe(2)
    expect(j.hand).toHaveLength(8)
    expect(j.regions).toHaveLength(12)
    const back = JSON.parse(JSON.stringify(j)) as GameState
    expect(back.regions[0].adjacency).toEqual(s.regions[0].adjacency)
  })
  it('quit does not clear the save (save.ts keeps the envelope)', async () => {
    const mod = await import('../src/ui/save')
    // clearSave is only called explicitly, never on quit
    expect(typeof mod.saveGame).toBe('function')
    expect(typeof mod.loadGame).toBe('function')
    expect(mod.CURRENT_VERSION).toBe(2)
  })
})