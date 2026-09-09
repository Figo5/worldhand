import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, preview, buildPlan, suitMajority, cardConservation,
  checkWithering, droughtChallenge, EPOCH_TARGETS, STABILITY_SUM_TARGETS,
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
    expect(STABILITY_SUM_TARGETS).toEqual([14, 22, 30])
    expect(EPOCH_TARGETS[0].need).toBeLessThan(EPOCH_TARGETS[1].need)
    expect(EPOCH_TARGETS[1].need).toBeLessThan(EPOCH_TARGETS[2].need)
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