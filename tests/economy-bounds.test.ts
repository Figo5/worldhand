// Difficulty repair — the bounded-economy contract (TDD: written BEFORE the
// engine changes). Each describe block pins one remedy from
// .hermes/worldhand-difficulty.md, which names the feedback mechanism it kills.
//
//   F1 bounded overkill income      (kills L1: income proportional to score)
//   F2 one-time vouchers            (kills L2: (1+m+0.5k)^5 for linear cost)
//   F3 per-visit shop limits        (kills L3: 6,077 purchases in one market)
//   F4 superlinear repeat prices    (kills L3/L4: linear price, linear power)
//   F5 the Bigger Hand voucher works(kills D1: a purchase that did nothing)
//   F6 finite consumable queue
//   F7 unused plays pay out         (so F1 never rewards underperforming)
//   F8 the target curve outruns a finished build
//
// Plus the cross-cutting contracts the brief requires: every REJECTED purchase
// leaves the state byte-identical, and preview() == commit() on every number.
import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, preview,
  epochTarget, playSeedCap, boostWorldCost, planetCost,
  SEEDS_PER_GROWTH, PLAYS_PER_EPOCH, CONSUMABLE_SLOTS, JOKER_SLOTS, PLAY_SEED_CAP_BASE,
  VOUCHERS, PLANET_CARDS, CONSUMABLES, JOKERS, handSizeOf, HAND_SIZE,
  SAVE_VERSION, validateState,
  type GameState,
} from '../src/engine/worldhand'
import type { Card, Suit as PSuit } from '../src/engine/poker'

const C = (r: number, s: PSuit): Card => ({ r: r as Card['r'], s })

/** conservation-legal hand swap: hand+deck+discard stays exactly 52 */
function forceHand(s: GameState, cards: Card[]): GameState {
  return { ...s, hand: [...cards], deckRest: [...s.hand, ...s.deckRest.slice(cards.length)] }
}

/** put the state into a market phase with a known Seed balance */
function inMarket(seedText: string, seeds: number, patch: Partial<GameState> = {}): GameState {
  let s = newGame(seedText)
  s = { ...s, epoch: 8, phase: 'select' }
  // burn the four plays with a single low card each -> endEpoch -> market
  s = forceHand(s, [C(2, 'C'), C(3, 'C'), C(4, 'C'), C(5, 'C')])
  for (let i = 0; i < PLAYS_PER_EPOCH; i++) {
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
  }
  expect(s.phase).toBe('market')
  return { ...s, seeds, ...patch }
}

const snapshot = (s: GameState) => JSON.stringify(s)

/** assert an action throws AND changes nothing at all */
function rejects(s: GameState, action: Parameters<typeof applyAction>[1], why: RegExp): void {
  const before = snapshot(s)
  expect(() => applyAction(s, action)).toThrow(why)
  expect(snapshot(s)).toBe(before)
}

// ---------------------------------------------------------------------------
// F1 — bounded overkill income
// ---------------------------------------------------------------------------

describe('F1: overkill income is bounded by the epoch target, not by the score', () => {
  it('playSeedCap grows LINEARLY while the blind curve grows geometrically', () => {
    for (const e of [1, 5, 12, 30]) expect(playSeedCap(e)).toBe(PLAY_SEED_CAP_BASE + e)
    expect(playSeedCap(12)).toBeGreaterThan(playSeedCap(5))
    // the load-bearing property: Seeds get SCARCER relative to the difficulty
    // every epoch, so the market never becomes a formality
    const perTarget = (e: number) => (playSeedCap(e) * PLAYS_PER_EPOCH) / epochTarget(e)
    expect(perTarget(20)).toBeLessThan(perTarget(10))
    expect(perTarget(30)).toBeLessThan(perTarget(20))
  })

  it('a modest play still earns the full nominal 1-Seed-per-4-Growth', () => {
    let s = newGame('f1-modest')
    s = { ...s, epoch: 20, seeds: 0 }
    s = forceHand(s, [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')]) // two pair: chips 32 x2 = 64
    for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    const pv = preview(s)
    expect(pv.growth).toBe(64)
    expect(pv.seedsGain).toBe(16) // nominal 16, under the epoch-20 cap of 24
    expect(pv.seedsGain).toBeLessThan(playSeedCap(20))
    expect(pv.summary).not.toContain('(capped)')
    expect(applyAction(s, { type: 'play' }).seeds).toBe(16)
  })

  it('a hand far above its fair share of the target earns exactly the cap', () => {
    // Pick the epoch from the curve rather than hardcoding one, so this test
    // keeps meaning if TARGET_GROWTH is recalibrated: the epoch we want is the
    // one where a World-Level-4009 two pair banks well over its per-play share
    // (so the cap bites) but still under the whole target (so the epoch does
    // not early-advance and we can observe the committed Seed balance).
    const growthOf = (epoch: number) => {
      let s = newGame('f1-overkill')
      s = { ...s, epoch, seeds: 0, worldLevel: 4009 }
      s = forceHand(s, [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')])
      for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      return { s, pv: preview(s) }
    }
    const EP = Array.from({ length: 60 }, (_, i) => i + 1).find((e) => {
      const g = growthOf(e).pv.growth
      return g > (epochTarget(e) / PLAYS_PER_EPOCH) * 2 && g < epochTarget(e)
        && Math.ceil(g * SEEDS_PER_GROWTH) > playSeedCap(e)
    })
    expect(EP, 'no epoch where the cap bites without ending the epoch').toBeDefined()
    const { s, pv } = growthOf(EP!)
    expect(pv.seedsNominal).toBeGreaterThan(playSeedCap(EP!))
    expect(pv.seedsGain).toBe(playSeedCap(EP!))
    expect(pv.summary).toContain('(capped)')
    // preview == commit == chronicle, on the CAPPED number
    const after = applyAction(s, { type: 'play' })
    expect(after.phase).toBe('select')
    expect(after.seeds).toBe(playSeedCap(EP!))
    expect(after.lastResolution!.seedsGain).toBe(playSeedCap(EP!))
    expect(after.log.at(-1)!.text).toContain(`Gains ${playSeedCap(EP!)} Seeds (capped)`)
    expect(pv.summary).toBe(after.lastResolution!.summary)
  })

  it('the supplied save\'s joker core still banks a monster hand — and still earns only the cap', () => {
    const EP = 16
    let s = newGame('f1-save-shape')
    // the save's engine: 3 flush jokers + 2 any, planet flush +5, huge world level
    s = {
      ...s, epoch: EP, seeds: 0, worldLevel: 4009,
      jokers: [
        ...Array.from({ length: 3 }, () => ({ ...JOKERS.find((j) => j.condition === 'flush')! })),
        ...Array.from({ length: 2 }, () => ({ ...JOKERS.find((j) => j.condition === 'any')! })),
      ],
      planetLevels: { flush: 5 },
    }
    s = forceHand(s, [C(14, 'H'), C(13, 'H'), C(11, 'H'), C(9, 'H'), C(7, 'H')])
    for (const i of [0, 1, 2, 3, 4]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    const pv = preview(s)
    expect(pv.growth).toBeGreaterThan(epochTarget(EP) * 20) // still a monster hand
    expect(pv.seedsGain).toBe(playSeedCap(EP))
    expect(pv.seedsNominal / pv.seedsGain).toBeGreaterThan(50) // v7 would have paid all of it
  })

  it('doubling an already-capped score does not buy a single extra Seed', () => {
    const earn = (worldLevel: number) => {
      let s = newGame('f1-flat')
      s = { ...s, epoch: 12, seeds: 0, worldLevel }
      s = forceHand(s, [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')])
      for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      const pv = preview(s)
      return { growth: pv.growth, seeds: pv.seedsGain }
    }
    const a = earn(400), b = earn(800)
    expect(b.growth).toBeGreaterThan(a.growth * 1.8)
    expect(b.seeds).toBe(a.seeds)
  })
})

// ---------------------------------------------------------------------------
// F2 — one-time vouchers
// ---------------------------------------------------------------------------

describe('F2: a voucher is a PERMANENT global — one copy, ever', () => {
  const V = VOUCHERS.find((v) => v.id === 'voucher-joker')!

  it('buying a voucher removes it from the shop for the rest of the run', () => {
    let s = inMarket('f2-once', 500)
    s = { ...s, voucherMarket: [{ ...V }] }
    s = applyAction(s, { type: 'buyVoucher', voucherId: V.id })
    expect(s.vouchers.map((v) => v.id)).toEqual([V.id])
    // every later market re-deal must skip it
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    for (let i = 0; i < 6; i++) {
      s = forceHand(s, [C(2, 'C'), C(3, 'C'), C(4, 'C'), C(5, 'C')])
      for (let p = 0; p < PLAYS_PER_EPOCH && s.phase === 'select'; p++) {
        s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
        s = applyAction(s, { type: 'play' })
      }
      if (s.phase !== 'market') break
      expect(s.voucherMarket.map((v) => v.id)).not.toContain(V.id)
      s = applyAction(s, { type: 'endMarket' })
      if (s.phase === 'epoch-end') s = applyAction(s, { type: 'closeEpoch' })
      if (s.phase === 'game-over') break
    }
  })

  it('a duplicate buyVoucher is REJECTED and mutates nothing', () => {
    let s = inMarket('f2-dupe', 500)
    s = { ...s, voucherMarket: [{ ...V }], vouchers: [{ ...V }] }
    rejects(s, { type: 'buyVoucher', voucherId: V.id }, /already own/i)
  })

  it('the joker-mult bonus can no longer be stacked into an exponent', () => {
    // one copy of each mult voucher is the hard ceiling on jokerMult sources
    const jokerVouchers = VOUCHERS.filter((v) => v.jokerMult)
    expect(jokerVouchers.length).toBeGreaterThan(0)
    let s = newGame('f2-ceiling')
    s = {
      ...s, epoch: 12,
      vouchers: jokerVouchers.map((v) => ({ ...v })),
      jokers: JOKERS.filter((j) => j.condition === 'any').slice(0, 1).map((j) => ({ ...j })),
    }
    s = forceHand(s, [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')])
    for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    const capMult = preview(s).jokerMult
    // the save that motivated this had +4.5 from 9 stacked copies; one copy is +0.5
    const maxBonus = jokerVouchers.reduce((n, v) => n + (v.jokerMult ?? 0), 0)
    expect(maxBonus).toBeLessThanOrEqual(1)
    const anyJoker = JOKERS.find((j) => j.condition === 'any')!
    expect(capMult).toBeLessThanOrEqual(1 + anyJoker.mult + maxBonus + 1e-9)
  })
})

describe('the joker shelf is a real choice', () => {
  it('the Joker pool is strictly larger than the shelf, so you cannot own one of everything', () => {
    expect(JOKERS.length).toBeGreaterThan(JOKER_SLOTS)
  })

  it('committing to a rarer hand pays more than hedging, per Seed', () => {
    const any = JOKERS.find((j) => j.condition === 'any')!
    const flush = JOKERS.find((j) => j.condition === 'flush')!
    const house = JOKERS.find((j) => j.condition === 'fullhouse')!
    // rarity ladder: the universal joker is the weakest multiplier...
    expect(any.mult).toBeLessThan(flush.mult)
    expect(flush.mult).toBeLessThan(house.mult)
    // ...and the weakest Growth per Seed, so hedging has a real price
    expect(any.mult / any.cost).toBeLessThan(flush.mult / flush.cost)
  })

  it('every joker condition can actually fire (no dead entry in the pool)', () => {
    const hands: Record<string, Card[]> = {
      'high-card': [C(14, 'S'), C(9, 'H'), C(5, 'D')],
      pair: [C(9, 'S'), C(9, 'H')],
      twopair: [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')],
      trips: [C(9, 'S'), C(9, 'H'), C(9, 'D')],
      straight: [C(5, 'S'), C(6, 'H'), C(7, 'D'), C(8, 'C'), C(9, 'S')],
      flush: [C(14, 'H'), C(13, 'H'), C(11, 'H'), C(9, 'H'), C(7, 'H')],
      fullhouse: [C(9, 'S'), C(9, 'H'), C(9, 'D'), C(7, 'C'), C(7, 'S')],
      'no-face': [C(9, 'S'), C(5, 'H')],
      any: [C(14, 'S'), C(9, 'H'), C(5, 'D')],
    }
    for (const j of JOKERS) {
      const hand = hands[j.condition]
      expect(hand, `no probe hand for condition ${j.condition}`).toBeDefined()
      let s = newGame(`fire-${j.id}`)
      s = { ...s, epoch: 12, jokers: [{ ...j }] }
      s = forceHand(s, hand)
      for (let i = 0; i < hand.length; i++) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      const pv = preview(s)
      expect(pv.jokerContribs.map((c) => c.id), `${j.id} never fires`).toContain(j.id)
      expect(pv.jokerMult).toBeCloseTo(1 + j.mult, 6)
    }
  })
})

// ---------------------------------------------------------------------------
// F3 — per-visit shop limits
// ---------------------------------------------------------------------------

describe('F3: one market visit is one opportunity, not an unbounded loop', () => {
  it('the World Level can be boosted at most once per market visit', () => {
    let s = inMarket('f3-world', 100000)
    const lvl = s.worldLevel
    s = applyAction(s, { type: 'boostWorld' })
    expect(s.worldLevel).toBe(lvl + 1)
    rejects(s, { type: 'boostWorld' }, /already boosted|once per/i)
  })

  it('each project can be funded at most once per market visit', () => {
    let s = inMarket('f3-proj', 100000)
    const id = s.projectMarket[0].id
    s = applyAction(s, { type: 'buyProject', projectId: id })
    rejects(s, { type: 'buyProject', projectId: id }, /already funded|once per/i)
    // a DIFFERENT offered project is still available in the same visit
    const other = s.projectMarket.find((p) => p.id !== id)
    if (other) expect(() => applyAction(s, { type: 'buyProject', projectId: other.id })).not.toThrow()
  })

  it('the limits reset at the NEXT market visit (a limit, not a lifetime ban)', () => {
    let s = inMarket('f3-reset', 100000)
    const id = s.projectMarket[0].id
    s = applyAction(s, { type: 'buyProject', projectId: id })
    s = applyAction(s, { type: 'boostWorld' })
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    s = forceHand(s, [C(2, 'C'), C(3, 'C'), C(4, 'C'), C(5, 'C')])
    for (let p = 0; p < PLAYS_PER_EPOCH && s.phase === 'select'; p++) {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    }
    expect(s.phase).toBe('market')
    expect(() => applyAction(s, { type: 'boostWorld' })).not.toThrow()
  })

  it('the whole-shop drain from the baseline save is impossible: a visit is finitely many buys', () => {
    let s = inMarket('f3-drain', 100_000_000)
    let buys = 0
    let progress = true
    while (progress && buys < 5000) {
      progress = false
      for (const v of [...s.voucherMarket]) {
        try { s = applyAction(s, { type: 'buyVoucher', voucherId: v.id }); buys++; progress = true } catch { /* rejected */ }
      }
      for (const j of [...s.jokerMarket]) {
        try { s = applyAction(s, { type: 'buyJoker', jokerId: j.id }); buys++; progress = true } catch { /* rejected */ }
      }
      for (const p of [...s.planetMarket]) {
        try { s = applyAction(s, { type: 'buyPlanet', planetId: p.id }); buys++; progress = true } catch { /* rejected */ }
      }
      try { s = applyAction(s, { type: 'boostWorld' }); buys++; progress = true } catch { /* rejected */ }
      for (const p of [...s.projectMarket]) {
        try { s = applyAction(s, { type: 'buyProject', projectId: p.id }); buys++; progress = true } catch { /* rejected */ }
      }
    }
    // shop shelf: <=3 laws, <=3 jokers, <=3 planets, <=2 consumables, <=2 vouchers,
    // <=3 projects, <=1 world boost. Even with 100M Seeds it is a small number.
    expect(buys).toBeLessThanOrEqual(20)
    expect(s.seeds).toBeGreaterThan(99_000_000) // money with nowhere to go
  })
})

// ---------------------------------------------------------------------------
// F4 — superlinear repeat prices
// ---------------------------------------------------------------------------

describe('F4: repeat power costs superlinearly', () => {
  it('boostWorldCost grows with the level already reached', () => {
    expect(boostWorldCost(1)).toBeLessThan(boostWorldCost(2))
    expect(boostWorldCost(10)).toBe(boostWorldCost(1) * 10)
    // total spend to reach level L is quadratic while the benefit is linear
    const total = (L: number) => Array.from({ length: L - 1 }, (_, i) => boostWorldCost(i + 1)).reduce((a, b) => a + b, 0)
    expect(total(20) / total(10)).toBeGreaterThan(3)
  })

  it('a Planet card costs more for every copy already owned in that category', () => {
    const p = PLANET_CARDS.find((x) => x.id === 'planet-flush')!
    expect(planetCost(p, {})).toBe(p.cost)
    expect(planetCost(p, { flush: p.boost })).toBe(p.cost * 2)
    expect(planetCost(p, { flush: p.boost * 3 })).toBe(p.cost * 4)
    // a different category does not raise this one's price
    expect(planetCost(p, { pair: 5 })).toBe(p.cost)
  })

  it('buyPlanet charges the escalated price and rejects when it is unaffordable', () => {
    const p = PLANET_CARDS.find((x) => x.id === 'planet-flush')!
    let s = inMarket('f4-planet', p.cost * 2, { planetLevels: { flush: p.boost } })
    s = { ...s, planetMarket: [{ ...p }] }
    const before = s.seeds
    s = applyAction(s, { type: 'buyPlanet', planetId: p.id })
    expect(before - s.seeds).toBe(p.cost * 2)
    let poor = inMarket('f4-poor', p.cost, { planetLevels: { flush: p.boost } })
    poor = { ...poor, planetMarket: [{ ...p }] }
    rejects(poor, { type: 'buyPlanet', planetId: p.id }, /need \d+ Seeds/)
  })
})

// ---------------------------------------------------------------------------
// F5 — the Bigger Hand voucher actually deals a bigger hand
// ---------------------------------------------------------------------------

describe('F5: the Bigger Hand voucher is no longer a dead purchase', () => {
  const V = VOUCHERS.find((v) => v.id === 'voucher-hand')!

  it('handSizeOf counts voucher hand-size as well as law hand-size', () => {
    expect(handSizeOf([], [{ ...V }])).toBe(HAND_SIZE + 1)
    expect(handSizeOf([], [])).toBe(HAND_SIZE)
  })

  it('a run that owns the voucher is DEALT the extra card at the next epoch', () => {
    let s = inMarket('f5-deal', 500)
    s = { ...s, voucherMarket: [{ ...V }] }
    s = applyAction(s, { type: 'buyVoucher', voucherId: V.id })
    s = applyAction(s, { type: 'endMarket' })
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.phase).toBe('select')
    expect(s.hand.length).toBe(HAND_SIZE + 1)
    expect(s.hand.length + s.deckRest.length + s.discardPile.length).toBe(52)
  })
})

// ---------------------------------------------------------------------------
// F6 — finite consumable queue
// ---------------------------------------------------------------------------

describe('F6: the consumable queue is finite', () => {
  it('queueing past CONSUMABLE_SLOTS is rejected and mutates nothing', () => {
    const cs = CONSUMABLES.map((c) => ({ ...c }))
    let s = inMarket('f6-queue', 100000)
    s = { ...s, consumableMarket: cs, consumables: cs.slice(0, CONSUMABLE_SLOTS).map((c) => ({ ...c })) }
    rejects(s, { type: 'buyConsumable', consumableId: cs[0].id }, /slot/i)
  })
})

// ---------------------------------------------------------------------------
// F7 — unused plays pay out, so cashing out early is never a punishment
// ---------------------------------------------------------------------------

describe('F7: meeting the target early pays for the plays you did not need', () => {
  it('a met target pays +1 Seed per unused play', () => {
    let s = newGame('f7-early')
    s = { ...s, epoch: 1, seeds: 0 }
    // one huge play clears epoch 1 outright, leaving 3 plays unused
    s = { ...s, worldLevel: 200 }
    s = forceHand(s, [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')])
    for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    const after = applyAction(s, { type: 'play' })
    expect(after.phase).toBe('market')
    expect(after.log.some((l) => /unused play/i.test(l.text))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// F8 — the target curve outruns a finished build
// ---------------------------------------------------------------------------

describe('F8: the blind curve outruns a maxed build', () => {
  it('epochTarget is strictly increasing and grows faster than any fixed multiple', () => {
    for (let e = 1; e < 40; e++) expect(epochTarget(e + 1)).toBeGreaterThan(epochTarget(e))
    // geometric: the ratio between successive targets stays above 1 by a margin,
    // so no constant-factor build can hold its lead forever
    for (let e = 5; e < 40; e++) expect(epochTarget(e + 1) / epochTarget(e)).toBeGreaterThan(1.05)
  })

  it('a FULLY built engine (all slots, all vouchers, matching planets) still gets outrun', () => {
    const build = (epoch: number): number => {
      let s = newGame('f8-max')
      s = {
        ...s, epoch,
        jokers: JOKERS.slice(0, JOKER_SLOTS).map((j) => ({ ...j })),
        vouchers: VOUCHERS.map((v) => ({ ...v })),
        planetLevels: { flush: 3 },
        // a world level no bounded economy could actually reach, to be generous
        worldLevel: epoch * 2,
      }
      s = forceHand(s, [C(14, 'H'), C(13, 'H'), C(11, 'H'), C(9, 'H'), C(7, 'H')])
      for (const i of [0, 1, 2, 3, 4]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      return preview(s).growth * PLAYS_PER_EPOCH
    }
    // early on the maxed build is comfortably ahead...
    expect(build(5)).toBeGreaterThan(epochTarget(5))
    // ...and deep in, the blinds have passed it
    expect(build(40)).toBeLessThan(epochTarget(40))
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting: rejected purchases never mutate; saves stay valid
// ---------------------------------------------------------------------------

describe('every rejected purchase leaves the state byte-identical', () => {
  it('unaffordable buys of every kind are rejected with no mutation', () => {
    const s = inMarket('reject-all', 0)
    if (s.market[0]) rejects(s, { type: 'buy', itemId: s.market[0].id }, /need \d+ Seeds/)
    if (s.projectMarket[0]) rejects(s, { type: 'buyProject', projectId: s.projectMarket[0].id }, /need \d+ Seeds/)
    if (s.jokerMarket[0]) rejects(s, { type: 'buyJoker', jokerId: s.jokerMarket[0].id }, /need \d+ Seeds/)
    if (s.planetMarket[0]) rejects(s, { type: 'buyPlanet', planetId: s.planetMarket[0].id }, /need \d+ Seeds/)
    if (s.consumableMarket[0]) rejects(s, { type: 'buyConsumable', consumableId: s.consumableMarket[0].id }, /need \d+ Seeds/)
    if (s.voucherMarket[0]) rejects(s, { type: 'buyVoucher', voucherId: s.voucherMarket[0].id }, /need \d+ Seeds/)
    rejects(s, { type: 'boostWorld' }, /need \d+ Seeds/)
  })

  it('unknown ids are rejected with no mutation', () => {
    const s = inMarket('reject-unknown', 99999)
    rejects(s, { type: 'buyJoker', jokerId: 'nope' }, /no such/)
    rejects(s, { type: 'buyPlanet', planetId: 'nope' }, /no such/)
    rejects(s, { type: 'buyVoucher', voucherId: 'nope' }, /no such/)
    rejects(s, { type: 'buyProject', projectId: 'nope' }, /no such/)
  })

  it('a full joker shelf rejects a sixth joker with no mutation', () => {
    let s = inMarket('reject-jokers', 99999)
    s = { ...s, jokers: JOKERS.slice(0, JOKER_SLOTS).map((j) => ({ ...j })), jokerMarket: [{ ...JOKERS[0] }] }
    rejects(s, { type: 'buyJoker', jokerId: JOKERS[0].id }, /slot/i)
  })
})

describe('persistence under the new rules', () => {
  it('SAVE_VERSION advanced past the runaway-economy generation (v7)', () => {
    expect(SAVE_VERSION).toBeGreaterThan(7)
  })

  it('a fresh game and a mid-market game both validate', () => {
    expect(validateState(newGame('persist-fresh'))).toBeNull()
    expect(validateState(inMarket('persist-market', 40))).toBeNull()
  })

  it('the per-visit purchase ledger survives a JSON round-trip', () => {
    let s = inMarket('persist-ledger', 100000)
    s = applyAction(s, { type: 'boostWorld' })
    const back = JSON.parse(JSON.stringify(s)) as GameState
    expect(validateState(back)).toBeNull()
    rejects(back, { type: 'boostWorld' }, /already boosted|once per/i)
  })

  it('a v7 save (the runaway generation) is REJECTED, never reinterpreted', () => {
    const v7 = { ...newGame('legacy-v7'), version: 7 }
    expect(validateState(v7)).toMatch(/version/i)
  })
})
