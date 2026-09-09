import { describe, it, expect } from 'vitest'
import { Rng, hashSeed } from '../src/engine/rng'
import { deck, evaluate, compareHands, cardName } from '../src/engine/poker'
import {
  newGame,
  applyAction,
  legalActions,
  HAND_SIZE,
  ACTIONS_PER_EPOCH,
  MAX_EPOCHS,
  WONDERS_TO_WIN,
  type GameState,
} from '../src/engine/worldhand'

describe('RNG determinism', () => {
  it('produces identical sequences from the same seed', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    expect(Array.from({ length: 100 }, () => a.next())).toEqual(
      Array.from({ length: 100 }, () => b.next()),
    )
  })
  it('hashSeed is stable and distinct', () => {
    expect(hashSeed('auralia')).toBe(hashSeed('auralia'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
  })
})

describe('poker evaluation (8-card hand power)', () => {
  const C = (r: number, s: 'S' | 'H' | 'D' | 'C') => ({ r: r as any, s })
  it('royal flush > quads > full house', () => {
    const royal = evaluate([C(14, 'S'), C(13, 'S'), C(12, 'S'), C(11, 'S'), C(10, 'S')])
    const quads = evaluate([C(14, 'S'), C(14, 'H'), C(14, 'D'), C(14, 'C'), C(2, 'S')])
    const boat = evaluate([C(9, 'S'), C(9, 'H'), C(9, 'D'), C(5, 'C'), C(5, 'S')])
    expect(royal.category).toBe('straight-flush')
    expect(compareHands(royal, quads)).toBeGreaterThan(0)
    expect(compareHands(quads, boat)).toBeGreaterThan(0)
  })
  it('detects wheel straight A-2-3-4-5', () => {
    const wheel = evaluate([C(14, 'S'), C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S')])
    expect(wheel.category).toBe('straight')
    expect(wheel.key[1]).toBe(5)
  })
  it('picks best 5 of 8', () => {
    const res = evaluate([
      C(14, 'S'), C(14, 'H'), C(5, 'D'), C(5, 'C'), C(9, 'S'), C(2, 'H'), C(3, 'D'), C(7, 'C'),
    ])
    expect(res.category).toBe('two-pair')
  })
  it('52-card deck, unique names', () => {
    const d = deck()
    expect(d.length).toBe(52)
    expect(new Set(d.map(cardName)).size).toBe(52)
  })
})

describe('worldhand engine', () => {
  it('same seed → identical starting world', () => {
    expect(newGame('auralia-the-first')).toEqual(newGame('auralia-the-first'))
  })
  it('different seeds → different worlds', () => {
    expect(newGame('alpha')).not.toEqual(newGame('beta'))
  })
  it('deals an 8-card hand and grants 3 actions', () => {
    const s = newGame('deal-check')
    expect(s.hand.length).toBe(HAND_SIZE)
    expect(s.actionsLeft).toBe(ACTIONS_PER_EPOCH)
    expect(s.bestHand).not.toBeNull()
    expect(s.regions.length).toBe(3)
  })
  it('prosper increases Order and spends an action', () => {
    let s = newGame('prosper')
    const before = s.order
    const r0 = s.regions[0].id
    s = applyAction(s, { type: 'prosper', regionId: r0 })
    expect(s.order).toBeGreaterThan(before)
    expect(s.actionsLeft).toBe(ACTIONS_PER_EPOCH - 1)
  })
  it('fortify raises stability; repair un-fractures', () => {
    let s = newGame('fortify')
    const r0 = s.regions[0]
    const st = r0.stability
    s = applyAction(s, { type: 'fortify', regionId: r0.id })
    expect(s.regions[0].stability).toBeGreaterThan(st)
    // force fracture path
    s.regions[0].stability = 1
    let s2 = applyAction(s, { type: 'endActions' })
    // skip law phase
    while (s2.phase === 'law') s2 = applyAction(s2, { type: 'enactLaw', lawId: s2.lawDraft[0].id })
    // decay may have fractured; try repair
    const fr = s2.regions.find((r) => r.fractured)
    if (fr && s2.phase === 'actions') {
      const s3 = applyAction(s2, { type: 'fortify', regionId: fr.id })
      expect(s3.regions.find((r) => r.id === fr.id)!.fractured).toBe(false)
    }
  })
  it('trade opens a 3-offer market; buy spends Order', () => {
    let s = newGame('market')
    s = applyAction(s, { type: 'trade' })
    expect(s.market.length).toBe(3)
    s.order = 50
    const bought = applyAction(s, { type: 'buyCard', offerIdx: 0 })
    expect(bought.order).toBe(50 - 6)
    expect(bought.market.length).toBe(2)
  })
  it('epoch advances after actions are spent; law phase appears', () => {
    let s = newGame('epochs')
    for (let i = 0; i < ACTIONS_PER_EPOCH; i++) {
      if (s.phase !== 'actions') break
      s = applyAction(s, { type: 'prosper', regionId: s.regions[0].id })
    }
    // law phase or next epoch
    expect(['law', 'actions', 'game-over']).toContain(s.phase)
    if (s.phase === 'law') {
      const s2 = applyAction(s, { type: 'enactLaw', lawId: s.lawDraft[0].id })
      expect(s2.epoch).toBe(2)
      expect(s2.actionsLeft).toBe(ACTIONS_PER_EPOCH)
    }
  })
  it('full scripted run always terminates with an outcome', () => {
    let s = newGame('full-run-1')
    let guard = 0
    while (s.phase !== 'game-over' && guard < 400) {
      guard++
      if (s.phase === 'law') {
        s = applyAction(s, { type: 'enactLaw', lawId: s.lawDraft[0].id })
      } else if (s.phase === 'actions') {
        const acts = legalActions(s)
        // simple policy: survey once, then prosper/fortify
        const survey = acts.find((a) => a.type === 'survey')
        const pick = survey && s.epoch <= 3 ? survey : acts[0]
        s = applyAction(s, pick as any)
      } else break
    }
    expect(guard).toBeLessThan(400)
    expect(['won', 'lost']).toContain(s.outcome as string)
  })
  it('two seeds running the same policy give different chronicles (variety)', () => {
    const run = (seed: string) => {
      let s = newGame(seed)
      let guard = 0
      while (s.phase !== 'game-over' && guard < 400) {
        guard++
        if (s.phase === 'law') s = applyAction(s, { type: 'enactLaw', lawId: s.lawDraft[0].id })
        else if (s.phase === 'actions') s = applyAction(s, legalActions(s)[0] as any)
        else break
      }
      return s.log.map((l) => l.text).join('|')
    }
    expect(run('var-one')).not.toBe(run('var-two'))
  })
  it('enacting a law persists across epochs', () => {
    let s = newGame('laws')
    for (let i = 0; i < ACTIONS_PER_EPOCH; i++) {
      if (s.phase !== 'actions') break
      s = applyAction(s, { type: 'endActions' })
    }
    if (s.phase === 'law') {
      const chosen = s.lawDraft[0]
      const s2 = applyAction(s, { type: 'enactLaw', lawId: chosen.id })
      expect(s2.laws.some((l) => l.id === chosen.id)).toBe(true)
      if (s2.phase === 'actions') expect(s2.laws).toHaveLength(1)
    }
  })
  it('cannot act with zero actions', () => {
    let s = newGame('zero')
    while (s.phase === 'actions' && s.actionsLeft > 0) s = applyAction(s, { type: 'prosper', regionId: s.regions[0].id })
    expect(s.actionsLeft).toBe(0)
    expect(() => applyAction(s, { type: 'prosper', regionId: 0 })).toThrow()
  })
  it('max epochs bounds the game', () => {
    expect(MAX_EPOCHS).toBe(15)
    expect(WONDERS_TO_WIN).toBe(3)
  })
})

describe('save round-trip', () => {
  it('state survives JSON serialization', () => {
    const s = newGame('roundtrip')
    const j = JSON.parse(JSON.stringify(s))
    expect(j.version).toBe(1)
    expect(j.hand).toHaveLength(HAND_SIZE)
    expect(j.regions.length).toBeGreaterThan(0)
  })
})