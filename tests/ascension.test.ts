import { describe, it, expect } from 'vitest'
import {
  newAscensionGame, applyAscensionAction, evaluatePlay, noStats, generateRegions, landAffinity,
  ASCENSION_RULES_VERSION, HAND_SIZE, PLAYS_PER_ROUND, DISCARDS_PER_ROUND, WORLD_STATS, SUIT_STAT,
  TERRAIN, TERRAINS, REGION_ADJACENCY,
  type AscensionState, type AscensionAction, type WorldStats,
} from '../src/engine/ascension/ascension'
import { newGame as newClassicGame, SAVE_VERSION } from '../src/engine/worldhand'
import { Rng, hashSeed } from '../src/engine/rng'
import { stream } from '../src/engine/core/streams'
import { deck, type Card } from '../src/engine/poker'

const key = (c: Card) => `${c.r}${c.s}`
const allCards = (s: AscensionState) => [...s.hand, ...s.drawPile, ...s.discardPile]
const C = (r: Card['r'], suit: Card['s']): Card => ({ r, s: suit })

/** A conserved state whose hand is exactly `cards` (the rest go to the draw pile). */
function withHand(cards: Card[], seedText = 'forced-hand'): AscensionState {
  const s = newAscensionGame(seedText)
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
    expect(ASCENSION_RULES_VERSION).toBe(3)
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
    expect(evaluatePlay(s, [0, 1, 2])).toMatchObject({ category: 'pair', label: 'Pair', chips: 23, mult: 1.5, pokerScore: 35 })
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
  it('tradeoff: the higher-scoring poker hand is not the one that develops Vitality', () => {
    const s = withHand(HAND)
    const kings = evaluatePlay(s, [3, 4, 5])  // K♠ K♦ Q♣: a pair
    const hearts = evaluatePlay(s, [0, 1, 2]) // 9♥ 6♥ 3♥: high card
    expect(kings).toMatchObject({ category: 'pair', pokerScore: 57 })
    expect(hearts).toMatchObject({ category: 'high', pokerScore: 18 })
    expect(kings.pokerScore).toBeGreaterThan(hearts.pokerScore * 3)
    expect(kings.statDeltas).toEqual({ vitality: 0, prosperity: 1, industry: 1, knowledge: 1 })
    expect(hearts.statDeltas).toEqual({ vitality: 3, prosperity: 0, industry: 0, knowledge: 0 })
  })
})

describe('Ascension terrain', () => {
  const layout = (seed: string) => newAscensionGame(seed).regions.map((r) => r.terrain).join(',')
  /** the documented rule: weighted pick over TERRAINS from stream ('ascension','terrain',id) */
  const expectedTerrain = (seed: number, id: number) => {
    let roll = stream(seed, 'ascension', 'terrain', id).int(0, TERRAINS.reduce((n, t) => n + TERRAIN[t].weight, 0))
    return TERRAINS.find((t) => (roll -= TERRAIN[t].weight) < 0)
  }

  it('the same seed always generates the same world', () => {
    for (const seed of ['alpha', 'beta', 'world-5']) {
      expect(newAscensionGame(seed).regions).toEqual(newAscensionGame(seed).regions)
      expect(newAscensionGame(seed).regions).toEqual(generateRegions(hashSeed(seed)))
    }
  })

  it('different seeds usually generate different layouts, and every terrain occurs', () => {
    const layouts = Array.from({ length: 200 }, (_, i) => layout(`sample-${i}`))
    expect(new Set(layouts).size).toBeGreaterThanOrEqual(195)
    const seen = new Set(layouts.flatMap((l) => l.split(',')))
    expect([...seen].sort()).toEqual([...TERRAINS].sort())
  })

  it('region ids and adjacency are stable, symmetric and connected; terrain is always valid', () => {
    for (const seed of ['alpha', 'beta', 'gamma', 'world-8']) {
      const regions = newAscensionGame(seed).regions
      expect(regions.map((r) => r.id)).toEqual([...Array(12).keys()])
      expect(regions.map((r) => r.neighbors)).toEqual(REGION_ADJACENCY)
      for (const r of regions) expect(TERRAINS).toContain(r.terrain)
    }
    REGION_ADJACENCY.forEach((ns, id) => {
      expect(ns).not.toContain(id)
      for (const n of ns) expect(REGION_ADJACENCY[n]).toContain(id)
    })
    const reached = new Set([0])
    for (let grew = true; grew;) {
      grew = false
      for (const id of [...reached]) for (const n of REGION_ADJACENCY[id]) if (!reached.has(n)) { reached.add(n); grew = true }
    }
    expect(reached.size).toBe(12)
  })

  it('each region draws only from its own named stream, and terrain never shifts the deal', () => {
    for (const seedText of ['alpha', 'beta', 'world-5']) {
      const s = newAscensionGame(seedText)
      s.regions.forEach((r) => expect(r.terrain).toBe(expectedTerrain(s.seed, r.id)))
      const deal = stream(s.seed, 'ascension', 'deck').shuffle(deck()).slice(-HAND_SIZE).reverse()
      expect(s.hand).toEqual(deal)
    }
  })

  it('terrain is static during play and never changes suit stats or poker score', () => {
    let s = newAscensionGame('static-land')
    const regions = JSON.stringify(s.regions)
    for (const a of randomActions('static-land', 150)) s = applyAscensionAction(s, a)
    expect(JSON.stringify(s.regions)).toBe(regions)
    const hand = [C(9, 'H'), C(6, 'H'), C(3, 'H'), C(2, 'H'), C(10, 'S'), C(7, 'S'), C(4, 'S'), C(2, 'S')]
    const a = evaluatePlay(withHand(hand, 'world-5'), [0, 1, 2, 3])
    const b = evaluatePlay(withHand(hand, 'world-8'), [0, 1, 2, 3])
    expect(a.statDeltas).toEqual(b.statDeltas)
    expect(a.pokerScore).toBe(b.pokerScore)
  })

  it('land bonus = Σ stat deltas × regions favouring that stat; a play adds poker score + land bonus', () => {
    let s = newAscensionGame('land-bonus')
    for (const act of randomActions('land-bonus', 100)) {
      if (act.type === 'play') {
        const r = evaluatePlay(s, act.cards)
        const affinity = landAffinity(s.regions)
        expect(r.landBonus).toBe(WORLD_STATS.reduce((n, k) => n + r.statDeltas[k] * affinity[k], 0))
        expect(r.score).toBe(r.pokerScore + r.landBonus)
        const next = applyAscensionAction(s, act)
        expect(next.score - s.score).toBe(r.score)
      }
      s = applyAscensionAction(s, act)
    }
    expect(WORLD_STATS.reduce((n, k) => n + landAffinity(s.regions)[k], 0)).toBe(12)
  })

  // Not a balance claim: it only shows terrain can change which play is better.
  it('two seeds, same hand: terrain flips which play is worth more', () => {
    expect(landAffinity(newAscensionGame('world-5').regions)).toEqual({ vitality: 6, prosperity: 4, industry: 2, knowledge: 0 })
    expect(landAffinity(newAscensionGame('world-8').regions)).toEqual({ vitality: 1, prosperity: 2, industry: 2, knowledge: 7 })
    const hand = [C(9, 'H'), C(6, 'H'), C(3, 'H'), C(2, 'H'), C(10, 'S'), C(7, 'S'), C(4, 'S'), C(2, 'S')]
    const HEARTS = [0, 1, 2, 3] // 9♥ 6♥ 3♥ 2♥: high card 20, +4 Vitality
    const SPADES = [4, 5, 6, 7] // 10♠ 7♠ 4♠ 2♠: high card 23, +4 Knowledge
    const forestWorld = withHand(hand, 'world-5')
    const loreWorld = withHand(hand, 'world-8')
    // poker alone always prefers the spades
    expect(evaluatePlay(forestWorld, SPADES).pokerScore).toBeGreaterThan(evaluatePlay(forestWorld, HEARTS).pokerScore)
    // the same +4 Vitality is worth +24 in the forest world and +4 in the lore world
    expect(evaluatePlay(forestWorld, HEARTS)).toMatchObject({ pokerScore: 20, landBonus: 24, score: 44 })
    expect(evaluatePlay(loreWorld, HEARTS)).toMatchObject({ pokerScore: 20, landBonus: 4, score: 24 })
    expect(evaluatePlay(forestWorld, SPADES)).toMatchObject({ pokerScore: 23, landBonus: 0, score: 23 })
    expect(evaluatePlay(loreWorld, SPADES)).toMatchObject({ pokerScore: 23, landBonus: 28, score: 51 })
  })

  it('Classic geography ignores the seed and is untouched by Ascension terrain', () => {
    const classic = (seed: string) => newClassicGame(seed).regions.map((r) => `${r.id}:${r.name}:${r.terrain}:${r.adjacency.join('.')}`).join('|')
    for (const seed of ['alpha', 'beta', 'world-5', 'world-8']) expect(classic(seed)).toBe(classic('replay-0'))
    expect(newClassicGame('world-5').regions.map((r) => r.terrain)).toEqual(
      ['meadow', 'coast', 'highland', 'forest', 'steppe', 'wetland', 'meadow', 'coast', 'highland', 'forest', 'steppe', 'wetland'])
  })
})
