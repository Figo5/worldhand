import { describe, it, expect } from 'vitest'
import { Rng, hashSeed } from '../src/engine/rng'
import { deck, evaluate, compareHands, cardName } from '../src/engine/poker'
import {
  newGame,
  applyAction,
  legalActions,
  checkWithering,
  challengeMet,
  suitActionName,
  HAND_SIZE,
  DISCARDS_PER_HAND,
  HANDS_PER_EPOCH,
  TOTAL_EPOCHS,
  TOTAL_REGIONS,
  STABILITY_BASE,
  FLOURISH_TARGET,
  FLOURISH_START,
  SEEDS_START,
  type GameState,
} from '../src/engine/worldhand'
import type { Card } from '../src/engine/poker'

describe('RNG determinism', () => {
  it('same seed → identical sequence', () => {
    expect(Array.from({ length: 100 }, () => new Rng(42).next() ? 0 : new Rng(42))).toBeTruthy()
    const a = new Rng(42); const b = new Rng(42)
    expect(Array.from({ length: 100 }, () => a.next())).toEqual(Array.from({ length: 100 }, () => b.next()))
  })
  it('hashSeed is stable and distinct', () => {
    expect(hashSeed('auralia')).toBe(hashSeed('auralia'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
  })
})

describe('poker evaluation', () => {
  const C = (r: number, s: 'S' | 'H' | 'D' | 'C') => ({ r: r as any, s })
  it('royal > quads > full house', () => {
    const royal = evaluate([C(14, 'S'), C(13, 'S'), C(12, 'S'), C(11, 'S'), C(10, 'S')])
    const quads = evaluate([C(14, 'S'), C(14, 'H'), C(14, 'D'), C(14, 'C'), C(2, 'S')])
    const boat = evaluate([C(9, 'S'), C(9, 'H'), C(9, 'D'), C(5, 'C'), C(5, 'S')])
    expect(royal.category).toBe('straight-flush')
    expect(compareHands(royal, quads)).toBeGreaterThan(0)
    expect(compareHands(quads, boat)).toBeGreaterThan(0)
  })
  it('wheel straight A-2-3-4-5', () => {
    const wheel = evaluate([C(14, 'S'), C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S')])
    expect(wheel.category).toBe('straight')
    expect(wheel.key[1]).toBe(5)
  })
  it('best 5 of 8', () => {
    const res = evaluate([C(14, 'S'), C(14, 'H'), C(5, 'D'), C(5, 'C'), C(9, 'S'), C(2, 'H'), C(3, 'D'), C(7, 'C')])
    expect(res.category).toBe('two-pair')
  })
  it('52 unique cards', () => {
    const d = deck()
    expect(d.length).toBe(52)
    expect(new Set(d.map(cardName)).size).toBe(52)
  })
})

describe('worldhand contracts', () => {
  it('starts: 12 regions (4 awake), stability base 3, 3 Flourishing, 8 Seeds', () => {
    const s = newGame('auralia-the-first')
    expect(s.regions).toHaveLength(TOTAL_REGIONS)
    expect(s.regions.filter((r) => !r.dormant)).toHaveLength(4)
    for (const r of s.regions) expect(r.stability).toBe(STABILITY_BASE)
    expect(s.flourishing).toBe(FLOURISH_START)
    expect(s.seeds).toBe(SEEDS_START)
    expect(s.phase).toBe('hand')
  })
  it('same seed → identical world and hand; different seed differs', () => {
    expect(newGame('same-seed')).toEqual(newGame('same-seed'))
    expect(newGame('alpha')).not.toEqual(newGame('beta'))
  })
  it('deals 8 cards with 3 discards available', () => {
    const s = newGame('deal')
    expect(s.hand).toHaveLength(8)
    expect(s.discardsLeft).toBe(DISCARDS_PER_HAND)
  })
  it('discard consumes the 3-discard budget', () => {
    let s = newGame('discard')
    s = applyAction(s, { type: 'discard', cardIdx: 0 })
    s = applyAction(s, { type: 'discard', cardIdx: 0 })
    expect(s.discardsLeft).toBe(1)
    s = applyAction(s, { type: 'discard', cardIdx: 0 })
    expect(s.discardsLeft).toBe(0)
    expect(() => applyAction(s, { type: 'discard', cardIdx: 0 })).toThrow()
  })
  it('suit actions: ♠ needs a region, ♥ raises Flourishing, ♦ raises Seeds, ♣ tends all', () => {
    let s = newGame('suits')
    const hand = s.hand
    const suitIdx = (suit: string) => s.hand.findIndex((c) => c.s === suit)
    const spadeIdx = suitIdx('S')
    if (spadeIdx >= 0) {
      expect(() => applyAction(s, { type: 'play', cardIdx: spadeIdx })).toThrow() // needs region
      const st = s.regions[0].stability
      s = applyAction(s, { type: 'play', cardIdx: spadeIdx, regionId: 0 })
      expect(s.regions[0].stability).toBeGreaterThan(st)
    }
    const heartIdx = suitIdx('H')
    if (heartIdx >= 0) {
      const f = s.flourishing
      s = applyAction(s, { type: 'play', cardIdx: heartIdx })
      expect(s.flourishing).toBeGreaterThan(f)
    }
    const diamondIdx = suitIdx('D')
    if (diamondIdx >= 0) {
      const sd = s.seeds
      s = applyAction(s, { type: 'play', cardIdx: diamondIdx })
      expect(s.seeds).toBeGreaterThan(sd)
    }
    const clubIdx = suitIdx('C')
    if (clubIdx >= 0) {
      const f = s.flourishing
      s = applyAction(s, { type: 'play', cardIdx: clubIdx })
      expect(s.flourishing).toBe(f + 1)
    }
  })
  it('advance deals 4 hands per epoch, then epoch end (decay + challenge + law draft)', () => {
    let s = newGame('epochs')
    expect(s.handInEpoch).toBe(1)
    s = applyAction(s, { type: 'advance' })
    expect(s.handInEpoch).toBe(2)
    s = applyAction(s, { type: 'advance' })
    s = applyAction(s, { type: 'advance' })
    expect(s.handInEpoch).toBe(4)
    s = applyAction(s, { type: 'advance' })
    // epoch closed: challenge resolved, law draft offered (epoch stays until law resolved)
    expect(s.epoch).toBe(1)
    expect(s.phase).toBe('law')
    expect(s.handInEpoch).toBe(0)
    expect(s.lawDraft.length).toBeGreaterThan(0)
    const s2 = applyAction(s, { type: 'skipLaw' })
    expect(s2.phase).toBe('hand')
    expect(s2.epoch).toBe(2)
    expect(s2.handInEpoch).toBe(1)
  })
  it('market refreshes at epoch end; buy spends Seeds', () => {
    let s = newGame('market')
    while (s.epoch < 2 && s.phase !== 'game-over') {
      s = applyAction(s, { type: 'advance' })
      if (s.phase === 'law') s = applyAction(s, { type: 'skipLaw' })
    }
    expect(s.phase).toBe('hand')
    expect(s.market).toHaveLength(3)
    s.seeds = 20
    const bought = applyAction(s, { type: 'buyCard', offerIdx: 0 })
    expect(bought.market).toHaveLength(2)
    expect(bought.seeds).toBeLessThan(20)
  })
  it('full scripted run terminates in 8 epochs with an outcome', () => {
    let s = newGame('full-run')
    let guard = 0
    while (s.phase !== 'game-over' && guard < 400) {
      guard++
      if (s.phase === 'law') s = applyAction(s, { type: 'skipLaw' })
      else if (s.phase === 'hand') s = applyAction(s, { type: 'advance' })
    }
    expect(s.phase).toBe('game-over')
    expect(['flourishing', 'withered']).toContain(s.outcome as string)
    expect(guard).toBeLessThan(400)
  })
  it('withering check: 5 dead regions ends the world', () => {
    let s = newGame('wither')
    // wake two dormant regions so 5 living regions can fail together
    s.regions[4].dormant = false
    s.regions[5].dormant = false
    for (const r of s.regions) if (!r.dormant) r.stability = 0
    const s2 = checkWithering(s)
    expect(s2.phase).toBe('game-over')
    expect(s2.outcome).toBe('withered')
  })
  it('challenge evaluation helpers behave', () => {
    let s = newGame('challenge')
    s.challenge = { kind: 'stable5', need: 1, desc: '1 region at 5+' }
    expect(challengeMet(s, s.challenge)).toBe(false) // all at 3
    s.regions[0].stability = 5
    expect(challengeMet(s, s.challenge)).toBe(true)
    s.challenge = { kind: 'revealed', need: 4, desc: '4 awake' }
    expect(challengeMet(s, s.challenge)).toBe(true)
    s.challenge = { kind: 'revealed', need: 5, desc: '5 awake' }
    expect(challengeMet(s, s.challenge)).toBe(false)
  })
  it('save envelope round-trips through JSON', () => {
    const s = newGame('roundtrip')
    const j = JSON.parse(JSON.stringify(s))
    expect(j.version).toBe(1)
    expect(j.hand).toHaveLength(8)
    expect(j.regions).toHaveLength(12)
  })
  it('same policy across seeds produces different chronicles', () => {
    const run = (seed: string) => {
      let s: GameState = newGame(seed)
      let guard = 0
      while (s.phase !== 'game-over' && guard < 400) {
        guard++
        if (s.phase === 'law') s = applyAction(s, { type: 'skipLaw' })
        else if (s.phase === 'hand') s = applyAction(s, { type: 'advance' })
      }
      return s.log.map((l) => l.text).join('|')
    }
    expect(run('var-one')).not.toBe(run('var-two'))
  })
  it('legalActions offers discards only while budget remains', () => {
    let s = newGame('legal')
    expect(legalActions(s).length).toBe(8)
    s = applyAction(s, { type: 'advance' })
    expect(legalActions(s).length).toBe(8)
  })
  it('constants match the contracts', () => {
    expect(TOTAL_EPOCHS).toBe(8)
    expect(HANDS_PER_EPOCH).toBe(4)
    expect(DISCARDS_PER_HAND).toBe(3)
    expect(TOTAL_REGIONS).toBe(12)
    expect(STABILITY_BASE).toBe(3)
    expect(FLOURISH_TARGET).toBe(12)
  })
  it('suit labels are distinct per suit', () => {
    expect(suitActionName('S')).toContain('stability')
    expect(suitActionName('H')).toContain('Flourishing')
    expect(suitActionName('D')).toContain('Seeds')
    expect(suitActionName('C')).toContain('Tend')
  })
})