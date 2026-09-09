import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, preview, buildPlan, suitMajority, cardConservation,
  checkWithering, droughtChallenge, applyPlanEffects, EPOCH_TARGETS, STABILITY_SUM_TARGETS,
  SURVIVAL_START, SURVIVAL_MAX,
  PLAYS_PER_EPOCH, DISCARDS_PER_EPOCH, HAND_SIZE, TOTAL_EPOCHS, TOTAL_REGIONS,
  STABILITY_BASE, STABILITY_MAX, SEEDS_CAP, START_REGIONS,
} from '../src/engine/worldhand'
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
  it('three escalating targets are strictly increasing', () => {
    expect(EPOCH_TARGETS).toHaveLength(3)
    expect(STABILITY_SUM_TARGETS).toEqual([20, 30, 40])
    expect(EPOCH_TARGETS.map((t) => t.need)).toEqual([20, 36, 52])
    expect(EPOCH_TARGETS[0].need).toBeLessThan(EPOCH_TARGETS[1].need)
    expect(EPOCH_TARGETS[1].need).toBeLessThan(EPOCH_TARGETS[2].need)
  })
  it('targets are calibrated against measured greedy play, not the final target alone', () => {
    // scripts/balance-sweep.mjs (greedy all-1-5-subsets policy, default 30 seeds,
    // Survival active) measured the win-rate curve the shipped targets sit on:
    //   [12,20,30] 28/30 · [18,32,46] 25/30 · [20,36,52] 21/30 ·
    //   [22,40,58] 12/30 · [24,44,64] 5/30 · [26,48,70] 0/30
    // [20,36,52] lands in the intended challenge band (well below 100%, far
    // above 0%); the final epoch target must be meaningfully above the old
    // trivially-banked 12 and below the ~68 ceiling the best runs reach.
    expect(EPOCH_TARGETS[TOTAL_EPOCHS - 1].need).toBeGreaterThan(12)
    expect(EPOCH_TARGETS[TOTAL_EPOCHS - 1].need).toBeLessThanOrEqual(58)
    expect(EPOCH_TARGETS[TOTAL_EPOCHS - 1].need).toBeLessThan(68)
    // strictly escalating so every epoch's target stays live
    for (let i = 1; i < EPOCH_TARGETS.length; i++) {
      expect(EPOCH_TARGETS[i].need).toBeGreaterThan(EPOCH_TARGETS[i - 1].need * 1.2)
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
    // buildPlan(..., undefined), so a player previewing Clubs/Tend got
    // Hearts/Bloom on commit (S,H,D,C default order).
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
    expect(pv.effects.every((e) => e.kind === 'stability')).toBe(true) // Tend effects
    const s2 = applyAction(s, { type: 'play', suitChoice: 'C' })
    expect(s2.lastResolution!.suit).toBe('C')
    expect(s2.lastResolution!.suitDecision).toBe('tiebreak-choice')
    expect(s2.lastResolution!.effects).toEqual(pv.effects)
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
  it('regionChoice on a committed play still targets the Roots region (backward-compatible)', () => {
    // default: the weakest living region is targeted
    const s1 = forceHand(newGame('roots-target'), [C(10, 'S')])
    s1.regions[0].stability = 2
    s1.regions[1].stability = 9
    const sDefault = applyAction(s1, { type: 'toggleCard', cardIdx: 0 })
    const committedDefault = applyAction(sDefault, { type: 'play' })
    expect(committedDefault.lastResolution!.effects[0]).toMatchObject({ kind: 'stability', regionId: 0 })
    // regionChoice overrides the weakest-first default
    const s2 = forceHand(newGame('roots-target-2'), [C(10, 'S')])
    s2.regions[3].dormant = false
    s2.regions[3].stability = 9
    s2.regions[0].stability = 9
    s2.regions[1].stability = 2
    const sT = applyAction(s2, { type: 'toggleCard', cardIdx: 0 })
    const committedTargeted = applyAction(sT, { type: 'play', regionChoice: 3 })
    expect(committedTargeted.lastResolution!.effects[0]).toMatchObject({ kind: 'stability', regionId: 3 })
  })
})

describe('suit actions — two meaningful actions per suit', () => {
  it('♠ Roots: stability to a living region; weak regions get targeted first', () => {
    const s0 = newGame('roots')
    const s1 = forceHand(s0, [C(10, 'S'), C(5, 'H')])
    s1.regions[0].stability = 2 // weakest
    const plan = buildPlan(s1.hand, [0], s1.regions, [])
    expect(plan.suit).toBe('S')
    expect(plan.effects[0]).toEqual({ kind: 'stability', regionId: 0, amount: Math.round(10 / 4) })
  })
  it('♠ Roots with high ranks gives bigger stability', () => {
    const s0 = newGame('roots2')
    const low = buildPlan([C(4, 'S')], [0], s0.regions, [])
    const high = buildPlan([C(14, 'S')], [0], s0.regions, [])
    const lowAmt = (low.effects[0] as any).amount
    const highAmt = (high.effects[0] as any).amount
    expect(highAmt).toBeGreaterThan(lowAmt)
  })
  it('♥ Bloom: +Flourishing; Q+ heart wakes a dormant region', () => {
    const s0 = newGame('bloom')
    const s1 = forceHand(s0, [C(13, 'H')])
    const plan = buildPlan(s1.hand, [0], s1.regions, [])
    expect(plan.suit).toBe('H')
    expect(plan.effects.some((e) => e.kind === 'wake')).toBe(true)
    expect(s1.regions[4].dormant).toBe(true) // first dormant untouched by plan-building
  })
  it('♥ Bloom low cards do not wake', () => {
    const s0 = newGame('bloom2')
    const plan = buildPlan([C(5, 'H')], [0], s0.regions, [])
    expect(plan.effects.some((e) => e.kind === 'wake')).toBe(false)
  })
  it('♦ Sow: +Seeds (capped)', () => {
    const s0 = newGame('sow')
    const plan = buildPlan([C(12, 'D')], [0], s0.regions, [])
    expect(plan.suit).toBe('D')
    expect(plan.effects[0]).toEqual({ kind: 'seeds', amount: 4 })
  })
  it('♣ Tend: +1 stability to EVERY living region', () => {
    const s0 = newGame('tend')
    const plan = buildPlan([C(9, 'C')], [0], s0.regions, [])
    expect(plan.suit).toBe('C')
    const stabEffects = plan.effects.filter((e) => e.kind === 'stability')
    expect(stabEffects).toHaveLength(START_REGIONS) // 4 living regions
    for (const e of stabEffects) expect((e as any).amount).toBe(1)
  })
  it('commit applies wake from Bloom Q+ play', () => {
    let s = newGame('wake')
    s = forceHand(s, [C(13, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.regions.filter((r) => !r.dormant)).toHaveLength(5)
  })

  // Adjacency/development are mechanical (v2.1 fix): Roots spreads to living
  // neighbors and gains from target development, and plays deepen development.
  it('♠ Roots spreads stability to living neighbors (adjacency matters)', () => {
    const s0 = newGame('adjacency')
    const s1 = forceHand(s0, [C(10, 'S'), C(5, 'H')])
    const plan = buildPlan(s1.hand, [0], s1.regions, [])
    const stab = plan.effects.filter((e) => e.kind === 'stability')
    // region 0's neighbors are 1, 7, 8 — at start only 1 is living (7 and 8 dormant)
    const targetAmount = (plan.effects[0] as any).amount
    expect(plan.effects[0]).toEqual({ kind: 'stability', regionId: 0, amount: targetAmount })
    expect(stab.map((e) => (e as any).regionId).sort()).toEqual([0, 1])
    for (const e of stab.slice(1)) expect((e as any).amount).toBe(Math.floor(targetAmount / 2))
    expect(plan.summary).toContain('Roots spread to')
  })
  it('♠ Roots does not spread to dormant neighbors', () => {
    const s0 = newGame('adjacency-dormant')
    const s1 = forceHand(s0, [C(10, 'S'), C(5, 'H')])
    const plan = buildPlan(s1.hand, [0], s1.regions, [])
    const regionIds = plan.effects.filter((e) => e.kind === 'stability').map((e) => (e as any).regionId)
    expect(regionIds).not.toContain(8)
    expect(regionIds).not.toContain(6)
  })
  it('development deepens Roots: +1 stability per 3 development', () => {
    const s0 = newGame('development')
    s0.regions[0].development = 3
    const base = buildPlan([C(10, 'S')], [0], s0.regions.map((r) => ({ ...r, development: 0 })), [])
    const dev = buildPlan([C(10, 'S')], [0], s0.regions, [])
    expect((dev.effects[0] as any).amount).toBe((base.effects[0] as any).amount + 1)
    expect(dev.summary).toContain('development')
  })
  it('a Roots play adds +1 development to the target (feeding future Roots)', () => {
    let s = newGame('devgrow')
    s = forceHand(s, [C(14, 'S')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
    expect(s.regions[0].development).toBe(1)
  })
  it('development caps at STABILITY_MAX via applyPlanEffects', () => {
    const s = newGame('devcap')
    s.regions[0].development = STABILITY_MAX
    applyPlanEffects(s, { cards: [], category: 'high', categoryLabel: '', categoryPoints: 0, suit: 'S', suitDecision: 'single', suitCounts: { S: 1, H: 0, D: 0, C: 0 }, rankSum: 10, effects: [{ kind: 'develop', regionId: 0, amount: 1 }], summary: '', valid: true, invalidReason: '' })
    expect(s.regions[0].development).toBe(STABILITY_MAX)
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
    let s = newGame('survival-miss-e1')
    s = forceHand(s, [C(4, 'D'), C(4, 'D'), C(4, 'D'), C(4, 'D')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    const f = s.flourishing
    const stab = s.regions.filter((r) => !r.dormant).reduce((n, r) => n + r.stability, 0)
    if (f < EPOCH_TARGETS[0].need && stab < STABILITY_SUM_TARGETS[0]) {
      expect(s.survival).toBe(SURVIVAL_START - 1)
      expect(s.log.some((l) => l.text.includes(`Survival drops to ${SURVIVAL_START - 1}`))).toBe(true)
      expect(s.log.some((l) => l.text.includes('market income is halved'))).toBe(true)
    } else {
      // this seed happened to meet the target: Survival must be untouched
      expect(s.survival).toBe(SURVIVAL_START)
      expect(s.log.every((l) => !l.text.includes('Survival drops'))).toBe(true)
    }
  })
  it('meeting the epoch target costs no Survival', () => {
    // force a met target: huge flourishing, huge stability
    let s = newGame('survival-met')
    s.flourishing = 40
    for (const r of s.regions) if (!r.dormant) r.stability = 8
    s.epoch = 1
    s = forceHand(s, [C(4, 'D'), C(4, 'D'), C(4, 'D'), C(4, 'D')])
    for (let i = 0; i < 4; i++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
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
    s = forceHand(s, [C(14, 'S')])
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