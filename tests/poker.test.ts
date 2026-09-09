import { describe, it, expect } from 'vitest'
import { Rng, hashSeed } from '../src/engine/rng'
import {
  deck, evaluate, evaluateSelection, compareHands, cardName,
  CATEGORY_POINTS, categoryLabel,
} from '../src/engine/poker'
import type { Card, Suit } from '../src/engine/poker'

const C = (r: number, s: Suit): Card => ({ r: r as Card['r'], s })

describe('RNG determinism', () => {
  it('same seed → identical sequence', () => {
    const a = new Rng(42); const b = new Rng(42)
    expect(Array.from({ length: 100 }, () => a.next()))
      .toEqual(Array.from({ length: 100 }, () => b.next()))
  })
  it('hashSeed is stable and distinct', () => {
    expect(hashSeed('auralia')).toBe(hashSeed('auralia'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
  })
})

describe('poker evaluation — full 5-card categories and precedence', () => {
  it('royal flush > straight flush > quads > full house > flush > straight > trips > two pair > pair > high', () => {
    const hands: [string, Card[]][] = [
      ['royal', [C(14, 'S'), C(13, 'S'), C(12, 'S'), C(11, 'S'), C(10, 'S')]],
      ['strflush', [C(9, 'H'), C(8, 'H'), C(7, 'H'), C(6, 'H'), C(5, 'H')]],
      ['quads', [C(14, 'S'), C(14, 'H'), C(14, 'D'), C(14, 'C'), C(2, 'S')]],
      ['boat', [C(9, 'S'), C(9, 'H'), C(9, 'D'), C(5, 'C'), C(5, 'S')]],
      ['flush', [C(14, 'D'), C(12, 'D'), C(9, 'D'), C(6, 'D'), C(3, 'D')]],
      ['straight', [C(9, 'S'), C(8, 'H'), C(7, 'D'), C(6, 'C'), C(5, 'S')]],
      ['trips', [C(7, 'S'), C(7, 'H'), C(7, 'D'), C(13, 'C'), C(2, 'S')]],
      ['twopair', [C(9, 'S'), C(9, 'H'), C(5, 'D'), C(5, 'C'), C(13, 'S')]],
      ['pair', [C(9, 'S'), C(9, 'H'), C(13, 'D'), C(6, 'C'), C(2, 'S')]],
      ['high', [C(14, 'S'), C(12, 'H'), C(9, 'D'), C(6, 'C'), C(2, 'S')]],
    ]
    const evals = hands.map(([n, cs]) => ({ n, e: evaluate(cs) }))
    // strictly descending precedence
    for (let i = 0; i + 1 < evals.length; i++) {
      expect(compareHands(evals[i].e, evals[i + 1].e)).toBeGreaterThan(0)
    }
    expect(evals[0].e.category).toBe('straight-flush')
    expect(evals[8].e.category).toBe('pair')
  })
  it('Ace-low wheel (A-2-3-4-5) is a straight ranked below 2-3-4-5-6', () => {
    const wheel = evaluate([C(14, 'S'), C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S')])
    const sixHigh = evaluate([C(6, 'S'), C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S')])
    expect(wheel.category).toBe('straight')
    expect(wheel.key[1]).toBe(5)
    expect(compareHands(sixHigh, wheel)).toBeGreaterThan(0)
  })
  it('best 5 of 8 picks the strongest subset', () => {
    const res = evaluate([C(14, 'S'), C(14, 'H'), C(5, 'D'), C(5, 'C'), C(9, 'S'), C(2, 'H'), C(3, 'D'), C(7, 'C')])
    expect(res.category).toBe('two-pair')
  })
  it('52 unique cards', () => {
    const d = deck()
    expect(d.length).toBe(52)
    expect(new Set(d.map(cardName)).size).toBe(52)
  })
})

describe('evaluateSelection — exact 1–5 card scoring (Worldhand contract)', () => {
  it('1 card → high card with that rank as key', () => {
    const r = evaluateSelection([C(14, 'S')])
    expect(r.category).toBe('high')
    expect(r.key).toEqual([0, 14])
  })
  it('2 same rank → pair; 2 different → high', () => {
    expect(evaluateSelection([C(9, 'S'), C(9, 'H')]).category).toBe('pair')
    expect(evaluateSelection([C(9, 'S'), C(5, 'H')]).category).toBe('high')
  })
  it('4 of same rank → quads even without a 5th card', () => {
    const r = evaluateSelection([C(8, 'S'), C(8, 'H'), C(8, 'D'), C(8, 'C')])
    expect(r.category).toBe('quads')
    expect(r.key[0]).toBe(7)
  })
  it('3 of a kind from exactly 3 cards → trips', () => {
    expect(evaluateSelection([C(6, 'S'), C(6, 'H'), C(6, 'D')]).category).toBe('trips')
  })
  it('two pair from 4 cards', () => {
    expect(evaluateSelection([C(9, 'S'), C(9, 'H'), C(5, 'D'), C(5, 'C')]).category).toBe('two-pair')
  })
  it('4-card selection can never be a straight or flush', () => {
    const r = evaluateSelection([C(5, 'S'), C(6, 'S'), C(7, 'S'), C(8, 'S')])
    expect(['straight', 'flush', 'straight-flush']).not.toContain(r.category)
  })
  it('5-card selection gets full evaluation incl. flush and wheel', () => {
    expect(evaluateSelection([C(14, 'D'), C(12, 'D'), C(9, 'D'), C(6, 'D'), C(3, 'D')]).category).toBe('flush')
    expect(evaluateSelection([C(14, 'S'), C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S')]).category).toBe('straight')
  })
  it('rejects 0 or 6 cards', () => {
    expect(() => evaluateSelection([])).toThrow()
    expect(() => evaluateSelection([C(2, 'S'), C(3, 'S'), C(4, 'S'), C(5, 'S'), C(6, 'S'), C(7, 'S')])).toThrow()
  })
  it('category points are strictly increasing with precedence', () => {
    const order = Object.entries(CATEGORY_POINTS).map(([k, v]) => [k, v] as const)
    for (let i = 0; i + 1 < order.length; i++) {
      expect(order[i][1]).toBeLessThan(order[i + 1][1])
    }
    expect(categoryLabel('straight-flush')).toContain('Straight Flush')
  })
})