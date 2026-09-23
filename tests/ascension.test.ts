import { describe, it, expect } from 'vitest'
import {
  newAscensionGame, applyAscensionAction, evaluatePlay, noStats,
  ASCENSION_RULES_VERSION, HAND_SIZE, PLAYS_PER_ROUND, DISCARDS_PER_ROUND, WORLD_STATS, SUIT_STAT,
  type AscensionState, type AscensionAction, type WorldStats,
} from '../src/engine/ascension/ascension'
import { newGame as newClassicGame, SAVE_VERSION } from '../src/engine/worldhand'
import { Rng, hashSeed } from '../src/engine/rng'
import { deck, type Card } from '../src/engine/poker'

const key = (c: Card) => `${c.r}${c.s}`
const allCards = (s: AscensionState) => [...s.hand, ...s.drawPile, ...s.discardPile]
const C = (r: Card['r'], suit: Card['s']): Card => ({ r, s: suit })

/** A conserved state whose hand is exactly `cards` (the rest go to the draw pile). */
function withHand(cards: Card[]): AscensionState {
  const s = newAscensionGame('forced-hand')
  const picked = new Set(cards.map(key))
  return { ...s, hand: cards, drawPile: allCards(s).filter((c) => !picked.has(key(c))), discardPile: [] }
}

/** Every one of the 52 cards exists exactly once across hand, draw and discard. */
function expectConserved(s: AscensionState) {
  expect(allCards(s).map(key).sort()).toEqual(deck().map(key).sort())
}

/** A seeded random mix of legal plays and discards, including rollovers. */
function randomActions(seedText: string, n: number): AscensionAction[] {
  const rng = new Rng(hashSeed(`actions:${seedText}`))
  let s = newAscensionGame(seedText)
  const out: AscensionAction[] = []
  for (let i = 0; i < n; i++) {
    const cards = rng.shuffle(s.hand.map((_, j) => j)).slice(0, rng.int(1, 6))
    const a: AscensionAction = s.discardsLeft > 0 && rng.next() < 0.3 ? { type: 'discard', cards } : { type: 'play', cards }
    s = applyAscensionAction(s, a)
    out.push(a)
  }
  return out
}
const replay = (seedText: string, actions: AscensionAction[]) => actions.reduce(applyAscensionAction, newAscensionGame(seedText))

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

describe('Ascension skeleton: new game', () => {
  it('is explicitly marked as Ascension with its own rules version', () => {
    const s = newAscensionGame('seam')
    expect(s.mode).toBe('ascension')
    expect(s.rulesVersion).toBe(ASCENSION_RULES_VERSION)
    expect(ASCENSION_RULES_VERSION).toBe(2)
    expect('version' in s).toBe(false) // Classic's SAVE_VERSION field is not reused
    expect(SAVE_VERSION).toBe(8)
  })

  it('deals a full hand from a conserved, seeded 52-card deck', () => {
    const s = newAscensionGame('seam')
    expect(s.hand).toHaveLength(HAND_SIZE)
    expect(s.drawPile).toHaveLength(52 - HAND_SIZE)
    expect(s).toMatchObject({ round: 1, playsLeft: PLAYS_PER_ROUND, discardsLeft: DISCARDS_PER_ROUND, score: 0, reshuffles: 0, lastPlay: null })
    expectConserved(s)
  })

  it('the same seed deals the same game; different seeds deal different games', () => {
    expect(newAscensionGame('alpha')).toEqual(newAscensionGame('alpha'))
    expect(newAscensionGame('alpha').hand).not.toEqual(newAscensionGame('beta').hand)
  })

  it('uses its own streams: a seed phrase deals differently than in Classic', () => {
    for (let i = 0; i < 20; i++) {
      const seed = `mode-${i}`
      expect(newAscensionGame(seed).hand.map(key)).not.toEqual(newClassicGame(seed).hand.map(key))
    }
  })
})

describe('Ascension skeleton: transitions', () => {
  it('same seed + same actions = same state (300 random legal actions, with reshuffles)', () => {
    const actions = randomActions('det', 300)
    const a = replay('det', actions)
    const b = replay('det', actions)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.reshuffles).toBeGreaterThan(0)
    expect(a.round).toBeGreaterThan(10)
  })

  it('keeps every invariant through long random runs', () => {
    for (const seed of ['inv-0', 'inv-1', 'inv-2']) {
      let s = newAscensionGame(seed)
      let scored = 0
      for (const a of randomActions(seed, 200)) {
        const before = s
        s = applyAscensionAction(s, a)
        if (a.type === 'play') scored += evaluatePlay(before, a.cards).score
        expectConserved(s)
        expect(s.hand).toHaveLength(HAND_SIZE)
        expect(s.score).toBe(scored)
        expect(s.playsLeft).toBeGreaterThanOrEqual(1)
        expect(s.playsLeft).toBeLessThanOrEqual(PLAYS_PER_ROUND)
        expect(s.discardsLeft).toBeGreaterThanOrEqual(0)
        expect(s.discardsLeft).toBeLessThanOrEqual(DISCARDS_PER_ROUND)
      }
    }
  })

  it('never mutates its input (deep-frozen states still transition)', () => {
    let s = deepFreeze(newAscensionGame('frozen'))
    for (const a of randomActions('frozen', 60)) s = deepFreeze(applyAscensionAction(s, a))
    expectConserved(s)
  })

  it('a play scores exactly what evaluatePlay previewed and moves the cards to discard', () => {
    const s = newAscensionGame('score')
    const idxs = [0, 2, 4]
    const preview = evaluatePlay(s, idxs)
    const next = applyAscensionAction(s, { type: 'play', cards: idxs })
    expect(next.score).toBe(preview.score)
    expect(next.lastPlay).toEqual(preview)
    expect(next.discardPile.map(key)).toEqual(idxs.map((i) => key(s.hand[i])))
    expect(next.playsLeft).toBe(PLAYS_PER_ROUND - 1)
    expect(next.discardsLeft).toBe(DISCARDS_PER_ROUND)
  })

  it('evaluatePlay scores chips × the shared poker mult', () => {
    const s = withHand([C(5, 'S'), C(5, 'H'), C(13, 'D'), C(2, 'C'), C(3, 'C'), C(4, 'C'), C(6, 'C'), C(7, 'C')])
    expectConserved(s)
    expect(evaluatePlay(s, [0, 1, 2])).toMatchObject({ category: 'pair', label: 'Pair', chips: 23, mult: 1.5, score: 35 })
  })

  it('a discard costs a discard, not a play, and scores nothing', () => {
    const s = newAscensionGame('discard')
    const next = applyAscensionAction(s, { type: 'discard', cards: [1, 3] })
    expect(next).toMatchObject({ discardsLeft: DISCARDS_PER_ROUND - 1, playsLeft: PLAYS_PER_ROUND, score: 0, lastPlay: null })
    expect(next.hand).toHaveLength(HAND_SIZE)
    expectConserved(next)
  })

  it('the last play of a round rolls over to a fresh round and hand', () => {
    let s = newAscensionGame('rollover')
    s = applyAscensionAction(s, { type: 'discard', cards: [0] })
    for (let i = 0; i < PLAYS_PER_ROUND; i++) s = applyAscensionAction(s, { type: 'play', cards: [0] })
    expect(s).toMatchObject({ round: 2, playsLeft: PLAYS_PER_ROUND, discardsLeft: DISCARDS_PER_ROUND })
    expect(s.hand).toHaveLength(HAND_SIZE)
    expectConserved(s)
  })
})

describe('Ascension skeleton: illegal actions are rejected safely', () => {
  const s = deepFreeze(newAscensionGame('illegal'))
  const snapshot = JSON.stringify(s)
  const bad: [string, AscensionAction, RegExp][] = [
    ['empty play', { type: 'play', cards: [] }, /1–5/],
    ['six cards', { type: 'play', cards: [0, 1, 2, 3, 4, 5] }, /1–5/],
    ['duplicate card', { type: 'play', cards: [2, 2] }, /twice/],
    ['index past the hand', { type: 'play', cards: [HAND_SIZE] }, /no card/],
    ['negative index', { type: 'discard', cards: [-1] }, /no card/],
    ['fractional index', { type: 'play', cards: [1.5] }, /no card/],
    ['non-array cards', { type: 'play', cards: 3 as unknown as number[] }, /1–5/],
    ['unknown action', { type: 'boostWorld' } as unknown as AscensionAction, /unknown action/],
  ]
  for (const [name, action, message] of bad) {
    it(`${name} throws and leaves the state untouched`, () => {
      expect(() => applyAscensionAction(s, action)).toThrow(message)
      expect(JSON.stringify(s)).toBe(snapshot)
    })
  }

  it('discarding with no discards left throws', () => {
    let t = newAscensionGame('no-discards')
    for (let i = 0; i < DISCARDS_PER_ROUND; i++) t = applyAscensionAction(t, { type: 'discard', cards: [0] })
    const before = JSON.stringify(t)
    expect(() => applyAscensionAction(t, { type: 'discard', cards: [0] })).toThrow(/no discards left/)
    expect(JSON.stringify(t)).toBe(before)
    expect(() => applyAscensionAction(t, { type: 'play', cards: [0] })).not.toThrow()
  })

  it('playing with no plays left throws (unreachable through rollover, guarded anyway)', () => {
    const t = { ...newAscensionGame('no-plays'), playsLeft: 0 }
    expect(() => applyAscensionAction(t, { type: 'play', cards: [0] })).toThrow(/no plays left/)
  })
})

describe('Ascension world stats', () => {
  const statsOf = (s: AscensionState) => ({ ...s.stats })
  const HAND = [C(9, 'H'), C(6, 'H'), C(3, 'H'), C(13, 'S'), C(13, 'D'), C(12, 'C'), C(2, 'S'), C(8, 'D')]

  it('a new game starts with all four stats at 0 and no deltas', () => {
    const s = newAscensionGame('stats')
    expect(s.stats).toEqual({ vitality: 0, prosperity: 0, industry: 0, knowledge: 0 })
    expect(s.lastPlay).toBeNull()
  })

  it('suits map to the right stats: ♥ Vitality, ♦ Prosperity, ♣ Industry, ♠ Knowledge', () => {
    expect(SUIT_STAT).toEqual({ H: 'vitality', D: 'prosperity', C: 'industry', S: 'knowledge' })
    const s = withHand([C(10, 'H'), C(10, 'D'), C(10, 'C'), C(10, 'S'), C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S')])
    const only = (stat: keyof WorldStats, n = 1): WorldStats => ({ ...noStats(), [stat]: n })
    expect(evaluatePlay(s, [0]).statDeltas).toEqual(only('vitality'))
    expect(evaluatePlay(s, [1]).statDeltas).toEqual(only('prosperity'))
    expect(evaluatePlay(s, [2]).statDeltas).toEqual(only('industry'))
    expect(evaluatePlay(s, [3]).statDeltas).toEqual(only('knowledge'))
  })

  it('every played card counts, kickers included, so a play grows the world by its card count', () => {
    const s = withHand(HAND)
    expect(evaluatePlay(s, [0, 1, 2]).statDeltas).toEqual({ vitality: 3, prosperity: 0, industry: 0, knowledge: 0 })
    for (const idxs of [[0], [3, 4], [0, 3, 5], [0, 1, 4, 5], [0, 1, 2, 6, 7]]) {
      const d = evaluatePlay(s, idxs).statDeltas
      expect(WORLD_STATS.reduce((n, k) => n + d[k], 0)).toBe(idxs.length)
    }
  })

  it('a mixed-suit hand develops several stats at once', () => {
    const s = withHand(HAND)
    expect(evaluatePlay(s, [3, 4, 5, 0]).statDeltas).toEqual({ vitality: 1, prosperity: 1, industry: 1, knowledge: 1 })
  })

  it('previewed deltas are exactly the committed deltas', () => {
    let s = newAscensionGame('preview-commit')
    for (const a of randomActions('preview-commit', 120)) {
      const before = s
      s = applyAscensionAction(s, a)
      if (a.type !== 'play') continue
      const preview = evaluatePlay(before, a.cards)
      expect(s.lastPlay).toEqual(preview)
      for (const k of WORLD_STATS) expect(s.stats[k]).toBe(before.stats[k] + preview.statDeltas[k])
    }
  })

  it('same seed + same actions gives identical world stats', () => {
    const actions = randomActions('stats-det', 200)
    const a = replay('stats-det', actions)
    const b = replay('stats-det', actions)
    expect(a.stats).toEqual(b.stats)
    expect(a.lastPlay?.statDeltas).toEqual(b.lastPlay?.statDeltas)
    expect(WORLD_STATS.every((k) => a.stats[k] > 0)).toBe(true)
  })

  it('stats always equal the sum of every play\'s deltas, and cards stay conserved', () => {
    let s = newAscensionGame('stats-sum')
    const total = noStats()
    for (const a of randomActions('stats-sum', 200)) {
      const before = s
      s = applyAscensionAction(s, a)
      if (a.type === 'play') for (const k of WORLD_STATS) total[k] += evaluatePlay(before, a.cards).statDeltas[k]
      expect(s.stats).toEqual(total)
      expectConserved(s)
    }
  })

  it('discards never change world stats', () => {
    let s = applyAscensionAction(newAscensionGame('stats-discard'), { type: 'play', cards: [0, 1, 2] })
    const stats = statsOf(s)
    const last = s.lastPlay
    for (let i = 0; i < DISCARDS_PER_ROUND; i++) s = applyAscensionAction(s, { type: 'discard', cards: [0, 1, 2, 3, 4] })
    expect(s.stats).toEqual(stats)
    expect(s.lastPlay).toEqual(last)
  })

  it('illegal actions never change world stats', () => {
    const s = deepFreeze(applyAscensionAction(newAscensionGame('stats-illegal'), { type: 'play', cards: [0, 1] }))
    const stats = statsOf(s)
    for (const a of [{ type: 'play', cards: [] }, { type: 'play', cards: [1, 1] }, { type: 'play', cards: [9] }, { type: 'discard', cards: [0, 1, 2, 3, 4, 5] }] as AscensionAction[]) {
      expect(() => applyAscensionAction(s, a)).toThrow()
      expect(s.stats).toEqual(stats)
    }
  })

  it('evaluatePlay changes nothing (pure preview)', () => {
    const s = deepFreeze(newAscensionGame('stats-pure'))
    const snapshot = JSON.stringify(s)
    evaluatePlay(s, [0, 1, 2, 3, 4])
    expect(JSON.stringify(s)).toBe(snapshot)
  })

  // Not a balance claim: it only shows the mechanic can make choices diverge.
  it('tradeoff: the higher-scoring hand is not the one that develops Vitality', () => {
    const s = withHand(HAND)
    const kings = evaluatePlay(s, [3, 4, 5])  // K♠ K♦ Q♣: a pair
    const hearts = evaluatePlay(s, [0, 1, 2]) // 9♥ 6♥ 3♥: high card
    expect(kings).toMatchObject({ category: 'pair', score: 57 })
    expect(hearts).toMatchObject({ category: 'high', score: 18 })
    expect(kings.score).toBeGreaterThan(hearts.score * 3)
    expect(kings.statDeltas).toEqual({ vitality: 0, prosperity: 1, industry: 1, knowledge: 1 })
    expect(hearts.statDeltas).toEqual({ vitality: 3, prosperity: 0, industry: 0, knowledge: 0 })
  })
})
