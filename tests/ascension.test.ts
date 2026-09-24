import { describe, it, expect } from 'vitest'
import {
  newAscensionGame, applyAscensionAction, evaluatePlay, noStats, generateRegions, landAffinity, runStatus,
  ASCENSION_RULES_VERSION, HAND_SIZE, PLAYS_PER_ROUND, DISCARDS_PER_ROUND, WORLD_STATS, SUIT_STAT,
  TERRAIN, TERRAINS, REGION_ADJACENCY,
  type AscensionState, type AscensionAction, type WorldStats, type Terrain,
} from '../src/engine/ascension/ascension'
import {
  ARCHETYPES, ARCHETYPE_ORDER, EMERGENCE_STEP, emergeCivilization, emergenceThreshold, readinessOf,
  type Archetype, type Civilization,
} from '../src/engine/ascension/civilizations'
import { newGame as newClassicGame, SAVE_VERSION } from '../src/engine/worldhand'
import { Rng, hashSeed } from '../src/engine/rng'
import { stream } from '../src/engine/core/streams'
import { deck, type Card } from '../src/engine/poker'
import { ERAS, eraRequirements, canAdvance, isComplete } from '../src/engine/ascension/eras'
import { CRISES, evaluateCrisis, type CrisisEvaluation } from '../src/engine/ascension/crises'

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

/** A seeded random mix of legal plays and discards, including rollovers; resolves
 *  each crisis as it strikes and stops when the run ends. */
function randomActions(seedText: string, n: number): AscensionAction[] {
  const rng = new Rng(hashSeed(`actions:${seedText}`))
  let s = newAscensionGame(seedText)
  const out: AscensionAction[] = []
  for (let i = 0; i < n; i++) {
    if (runStatus(s) === 'crisis') { s = applyAscensionAction(s, { type: 'resolve' }); out.push({ type: 'resolve' }); continue }
    if (runStatus(s) !== 'playing') break
    const cards = rng.shuffle(s.hand.map((_, j) => j)).slice(0, rng.int(1, 6))
    const a: AscensionAction = s.discardsLeft > 0 && rng.next() < 0.3 ? { type: 'discard', cards } : { type: 'play', cards }
    s = applyAscensionAction(s, a)
    out.push(a)
  }
  return out
}
/** Play these cards, first resolving a pending crisis (a crisis blocks play). */
const playThrough = (s: AscensionState, cards: number[]) =>
  applyAscensionAction(runStatus(s) === 'crisis' ? applyAscensionAction(s, { type: 'resolve' }) : s, { type: 'play', cards })
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
    expect(ASCENSION_RULES_VERSION).toBe(7)
    expect('version' in s).toBe(false) // Classic's SAVE_VERSION field is not reused
    expect(SAVE_VERSION).toBe(8)
  })

  it('deals a full hand from a conserved, seeded 52-card deck', () => {
    const s = newAscensionGame('seam')
    expect(s.hand).toHaveLength(HAND_SIZE)
    expect(s.drawPile).toHaveLength(52 - HAND_SIZE)
    expect(s).toMatchObject({ round: 1, playsLeft: PLAYS_PER_ROUND, discardsLeft: DISCARDS_PER_ROUND, score: 0, reshuffles: 0, lastPlay: null, era: 0, eraLog: [], crisis: null, crises: [] })
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
    for (let i = 0; i < PLAYS_PER_ROUND; i++) s = playThrough(s, [0])
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

  it('land bonus = Σ stat deltas × regions favouring that stat; a play adds poker score + land bonus + civ bonus', () => {
    let s = newAscensionGame('land-bonus')
    for (const act of randomActions('land-bonus', 100)) {
      if (act.type === 'play') {
        const r = evaluatePlay(s, act.cards)
        const affinity = landAffinity(s.regions)
        expect(r.landBonus).toBe(WORLD_STATS.reduce((n, k) => n + r.statDeltas[k] * affinity[k], 0))
        expect(r.score).toBe(r.pokerScore + r.landBonus + r.civBonus)
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

describe('Ascension civilizations', () => {
  /** A policy that plays up to 5 cards of the given suits (else the first card). */
  const suitPolicy = (suits: Card['s'][]) => (s: AscensionState) => {
    const idx = s.hand.flatMap((c, i) => (suits.includes(c.s) ? [i] : [])).slice(0, 5)
    return idx.length ? idx : [0]
  }
  const runRounds = (seed: string, suits: Card['s'][], rounds = 6) => {
    let s = newAscensionGame(seed)
    const policy = suitPolicy(suits)
    while (s.round <= rounds && runStatus(s) !== 'failed') {
      s = runStatus(s) === 'crisis' ? applyAscensionAction(s, { type: 'resolve' }) : applyAscensionAction(s, { type: 'play', cards: policy(s) })
    }
    return s
  }
  const labels = (s: AscensionState) => s.civilizations.map((c) => c.archetype)
  /** A crafted world: terrain per region (or one terrain everywhere) and stats; one play from a round end. */
  const crafted = (terrain: Terrain | Terrain[], stats: Partial<WorldStats>, seed = 'craft') => {
    const s = newAscensionGame(seed)
    return {
      ...s,
      regions: REGION_ADJACENCY.map((n, id) => ({ id, terrain: Array.isArray(terrain) ? terrain[id] : terrain, neighbors: [...n] })),
      stats: { ...noStats(), ...stats },
      playsLeft: 1,
    }
  }
  const endRound = (s: AscensionState) => applyAscensionAction(s, { type: 'play', cards: [0] })

  it('the archetype table is well-formed and a new game has no civilizations', () => {
    expect([...ARCHETYPE_ORDER].sort()).toEqual(Object.keys(ARCHETYPES).sort())
    for (const a of ARCHETYPE_ORDER) {
      expect(ARCHETYPES[a].stats.length).toBeGreaterThan(0)
      for (const t of ARCHETYPES[a].terrains) expect(TERRAINS).toContain(t)
      for (const k of ARCHETYPES[a].stats) expect(WORLD_STATS).toContain(k)
    }
    expect(newAscensionGame('civ').civilizations).toEqual([])
  })

  it('emerges only at a round end, at most one per round, with an escalating threshold', () => {
    let s = { ...crafted('plains', { vitality: 50, prosperity: 50 }), playsLeft: PLAYS_PER_ROUND }
    for (let i = 0; i < PLAYS_PER_ROUND - 1; i++) s = playThrough(s, [0])
    expect(s.civilizations).toEqual([])
    s = endRound(s)
    expect(s.civilizations).toHaveLength(1)
    expect(s.civilizations[0]).toMatchObject({ id: 0, tier: 1, emergedRound: 1, reason: { needed: EMERGENCE_STEP } })
    for (let i = 0; i < PLAYS_PER_ROUND; i++) s = playThrough(s, [0])
    expect(s.civilizations).toHaveLength(2)
    expect(s.civilizations[1]).toMatchObject({ id: 1, emergedRound: 2, reason: { needed: 2 * EMERGENCE_STEP } })
    expect(emergenceThreshold(2)).toBe(3 * EMERGENCE_STEP)
    expect(endRound(crafted('plains', { vitality: EMERGENCE_STEP - 2 })).civilizations).toEqual([])
  })

  it('same seed + same actions gives the same civilizations', () => {
    const actions = randomActions('civ-det', 300)
    const a = replay('civ-det', actions)
    expect(a.civilizations.length).toBeGreaterThan(0)
    expect(replay('civ-det', actions).civilizations).toEqual(a.civilizations)
  })

  it('the player decides: different strategies on the same seed grow different civilizations', () => {
    expect(labels(runRounds('alpha', ['H']))).toEqual(['nomads', 'natureKeepers'])
    expect(labels(runRounds('alpha', ['S']))).toEqual(['scholars'])
    expect(labels(runRounds('alpha', ['D']))).toEqual(['merchants'])
    // clubs + spades grows Empire Builders and Scholars, then dies in the Harsh Winter
    // (Industry without Vitality) before Technocrats can emerge
    const cs = runRounds('alpha', ['C', 'S'])
    expect(labels(cs)).toEqual(['empireBuilders', 'scholars'])
    expect(cs.crises.map((c) => [c.crisis, c.result])).toEqual([['winter', 'failed']])
  })

  it('the seed decides too: the same strategy on different terrain grows different civilizations', () => {
    // world-5 has no desert or tundra; world-8 has seven Knowledge regions
    expect(landAffinity(newAscensionGame('world-5').regions).knowledge).toBe(0)
    expect(labels(runRounds('world-5', ['S']))).toEqual([])
    expect(labels(runRounds('world-8', ['S']))).toEqual(['scholars'])
    // beta has no plains or coast, so no Merchants however much Prosperity grows
    const beta = runRounds('beta', ['D'])
    expect(beta.stats.prosperity).toBeGreaterThan(3 * EMERGENCE_STEP)
    expect(labels(beta)).toEqual([])
  })

  it('terrain preference: a civilization only founds a home on its terrains', () => {
    expect(endRound(crafted('forest', { industry: 50 })).civilizations).toEqual([]) // no mountains
    expect(labels(endRound(crafted('mountains', { industry: 50 })))).toEqual(['empireBuilders'])
    expect(endRound(crafted('mountains', { vitality: 50 })).civilizations).toEqual([]) // no forest or open land
  })

  it('stat preference: the most developed eligible archetype emerges', () => {
    const land: Terrain[] = ['forest', 'desert', 'plains', 'coast', 'mountains', 'tundra', 'forest', 'desert', 'plains', 'coast', 'mountains', 'tundra']
    expect(labels(endRound(crafted(land, { vitality: 9, knowledge: 30 })))).toEqual(['scholars'])
    expect(labels(endRound(crafted(land, { vitality: 30, knowledge: 9 }))).map((a) => ARCHETYPES[a].stats[0])).toEqual(['vitality'])
    expect(labels(endRound(crafted(land, { prosperity: 20, industry: 21 })))).toEqual(['empireBuilders'])
    // all coast: Empire Builders (mountains) and Scholars (desert/tundra) have no home,
    // so Technocrats emerge when BOTH their stats are high, and not before
    expect(labels(endRound(crafted('coast', { industry: 30, knowledge: 30 })))).toEqual(['technocrats'])
    expect(endRound(crafted('coast', { industry: 30, knowledge: 4 })).civilizations).toEqual([])
    expect(readinessOf('technocrats', { ...noStats(), industry: 30, knowledge: 7 })).toBe(7)
  })

  it('adjacency matters: Empire Builders take the best-connected mountain', () => {
    // all mountains: region 8 is the only one with 5 neighbours
    expect(endRound(crafted('mountains', { industry: 50 })).civilizations[0].home).toBe(8)
    // mountains at R0, R1, R2, R8: R0/R1 have the most mountain neighbours (2 each), but the
    // hub preference adds each region's degree, so R8 (1 mountain neighbour, 5 borders) wins
    const hubLand = REGION_ADJACENCY.map((_, id): Terrain => ([0, 1, 2, 8].includes(id) ? 'mountains' : 'plains'))
    expect(endRound(crafted(hubLand, { industry: 50 })).civilizations[0]).toMatchObject({ archetype: 'empireBuilders', home: 8, reason: { regionFit: 6 } })
    // Nature Keepers prefer the forest with the most forest neighbours
    const land: Terrain[] = ['forest', 'forest', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'forest', 'forest', 'mountains', 'mountains', 'mountains']
    const civ = endRound(crafted(land, { vitality: 50 })).civilizations[0]
    expect(civ).toMatchObject({ archetype: 'natureKeepers', home: 0, reason: { regionFit: 3, terrain: 'forest' } }) // R0 borders forests R1, R7, R8
  })

  it('exact ties are broken by the seeded civ stream, reproducibly', () => {
    // all tundra, Vitality == Knowledge: Nomads and Scholars tie on readiness AND fit
    // (called directly, so no round-ending play can tip one stat first)
    const regions = crafted('tundra', {}).regions
    const stats = { ...noStats(), vitality: 50, knowledge: 50 }
    const pick = (i: number) => emergeCivilization(hashSeed(`tie-${i}`), 1, regions, stats, [])!
    const picks = Array.from({ length: 30 }, (_, i) => pick(i).archetype)
    expect(new Set(picks)).toEqual(new Set(['nomads', 'scholars']))
    for (let i = 0; i < 5; i++) expect(pick(i).archetype).toBe(picks[i])
    expect(pick(0).home).toBe(8) // the only region with 5 tundra neighbours: no tie, no RNG
  })

  it('equally good homes are chosen by the seeded civ stream, reproducibly', () => {
    // forest only at R2 and R5 (no forest neighbours each): Nature Keepers' homes tie on fit
    const land = REGION_ADJACENCY.map((_, id): Terrain => ([2, 5].includes(id) ? 'forest' : 'mountains'))
    const regions = crafted(land, {}).regions
    const stats = { ...noStats(), vitality: 50 }
    const home = (i: number) => emergeCivilization(hashSeed(`home-${i}`), 1, regions, stats, [])!.home
    const homes = Array.from({ length: 30 }, (_, i) => home(i))
    expect(new Set(homes)).toEqual(new Set([2, 5]))
    for (let i = 0; i < 5; i++) expect(home(i)).toBe(homes[i])
  })

  it('one civilization per region and per archetype; a lone home cannot be shared', () => {
    let s = crafted(['forest', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains'], { vitality: 90 })
    s = endRound(s)
    expect(labels(s)).toEqual(['natureKeepers'])
    for (let i = 0; i < 3 * PLAYS_PER_ROUND; i++) s = playThrough(s, [0])
    expect(labels(s)).toEqual(['natureKeepers'])
  })

  it('invariants over many runs: valid unique homes on favoured terrain, readiness met and maximal, terrain untouched', () => {
    for (let i = 0; i < 12; i++) {
      const seed = `civ-inv-${i}`
      let s = newAscensionGame(seed)
      const land = JSON.stringify(s.regions)
      for (const a of randomActions(seed, 250)) {
        const before = s
        s = applyAscensionAction(s, a)
        if (s.civilizations.length === before.civilizations.length) continue
        const civ = s.civilizations[s.civilizations.length - 1]
        const home = s.regions[civ.home]
        expect(ARCHETYPES[civ.archetype].terrains).toContain(home.terrain)
        expect(civ.reason.readiness).toBe(readinessOf(civ.archetype, s.stats))
        expect(civ.reason.readiness).toBeGreaterThanOrEqual(emergenceThreshold(before.civilizations.length))
        for (const other of ARCHETYPE_ORDER) {
          if (before.civilizations.some((c) => c.archetype === other)) continue
          const hasHome = s.regions.some((r) => ARCHETYPES[other].terrains.includes(r.terrain) && !before.civilizations.some((c) => c.home === r.id))
          if (hasHome) expect(readinessOf(other, s.stats)).toBeLessThanOrEqual(civ.reason.readiness)
        }
      }
      expect(JSON.stringify(s.regions)).toBe(land)
      const homes = s.civilizations.map((c) => c.home)
      expect(new Set(homes).size).toBe(homes.length)
      expect(new Set(labels(s)).size).toBe(s.civilizations.length)
      for (const h of homes) expect(h >= 0 && h < 12).toBe(true)
      expectConserved(s)
    }
  })

  it('emergence is a pure function of its inputs and does not touch stats or score', () => {
    const s = deepFreeze(crafted('plains', { prosperity: 40 }))
    const a = emergeCivilization(s.seed, s.round, s.regions, s.stats, s.civilizations)
    expect(emergeCivilization(s.seed, s.round, s.regions, s.stats, s.civilizations)).toEqual(a)
    const next = endRound(s)
    const play = evaluatePlay(s, [0])
    expect(next.score).toBe(s.score + play.score)
    for (const k of WORLD_STATS) expect(next.stats[k]).toBe(s.stats[k] + play.statDeltas[k])
  })
})

describe('Ascension civilization passives', () => {
  const civ = (archetype: Archetype, home = 0, id = 0): Civilization => ({
    id, archetype, home, tier: 1, emergedRound: 1,
    reason: { stat: ARCHETYPES[archetype].stats[0], readiness: EMERGENCE_STEP, needed: EMERGENCE_STEP, terrain: ARCHETYPES[archetype].terrains[0], regionFit: 0 },
  })
  /** Every archetype, Empire Builders at hub R8 (5 borders). */
  const allSix = () => ARCHETYPE_ORDER.map((a, i) => civ(a, [0, 1, 2, 8, 4, 5][i], i))
  /** Forest, mountains, desert, coast ×3: every stat has land affinity 3, so
   *  plays of the same size earn the same land bonus. */
  const EVEN_LAND = REGION_ADJACENCY.map((n, id) => ({ id, terrain: (['forest', 'mountains', 'desert', 'coast'] as const)[id % 4] as Terrain, neighbors: [...n] }))
  const world = (hand: Card[], stats: Partial<WorldStats>, civilizations: Civilization[]): AscensionState =>
    ({ ...withHand(hand), regions: EVEN_LAND.map((r) => ({ ...r, neighbors: [...r.neighbors] })), stats: { ...noStats(), ...stats }, civilizations })
  /** [archetype, amount] of each triggered passive, in order. */
  const bonuses = (s: AscensionState, idxs: number[]) => evaluatePlay(s, idxs).civBonuses.map((b) => [b.archetype, b.amount])
  // hand positions:  0     1     2     3     4     5     6     7
  const HAND = [C(2, 'H'), C(3, 'H'), C(4, 'C'), C(5, 'C'), C(9, 'S'), C(10, 'S'), C(13, 'D'), C(14, 'D')]
  const H1 = 0, H2 = 1, C1 = 2, C2 = 3, S1 = 4, S2 = 5, D1 = 6, D2 = 7

  it('the passive table is well-formed: every archetype has a named, documented passive', () => {
    for (const a of ARCHETYPE_ORDER) {
      expect(ARCHETYPES[a].passive.name).toMatch(/\w/)
      expect(ARCHETYPES[a].passive.text).toMatch(/\+\d/)
    }
  })

  it('Nature Keepers (Stewardship): +3 per ♥ while Vitality ≥ Industry AFTER the play', () => {
    const s = world(HAND, { vitality: 5, industry: 5 }, [civ('natureKeepers')])
    expect(bonuses(s, [H1])).toEqual([['natureKeepers', 3]]) // 6 ≥ 5
    expect(bonuses(s, [H1, H2])).toEqual([['natureKeepers', 6]])
    expect(bonuses(s, [H1, C1])).toEqual([['natureKeepers', 3]]) // 6 ≥ 6: equality counts
    expect(bonuses(s, [H1, C1, C2])).toEqual([]) // its own ♣ push Industry to 7 > 6
    expect(bonuses(s, [C1, S1])).toEqual([]) // no ♥
    expect(evaluatePlay(s, [H1, C1, C2]).civBonus).toBe(0)
  })

  it('Nomads (Wandering): +4 per suit beyond the first', () => {
    const s = world(HAND, {}, [civ('nomads')])
    expect(bonuses(s, [H1, H2])).toEqual([])
    expect(bonuses(s, [H1, C1])).toEqual([['nomads', 4]])
    expect(bonuses(s, [H1, C1, S1])).toEqual([['nomads', 8]])
    expect(bonuses(s, [H1, H2, C1, S1, D1])).toEqual([['nomads', 12]])
  })

  it('Merchants (Commerce): with at least 2 ♦, +10% of the poker score rounded down', () => {
    const s = world([C(14, 'D'), C(13, 'D'), C(12, 'S'), C(14, 'S'), C(2, 'H'), C(3, 'H'), C(4, 'C'), C(5, 'C')], {}, [civ('merchants')])
    expect(evaluatePlay(s, [0, 1, 2]).pokerScore).toBe(39) // A♦ K♦ Q♠ high card
    expect(bonuses(s, [0, 1, 2])).toEqual([['merchants', 3]])
    expect(bonuses(s, [0, 1])).toEqual([['merchants', 2]]) // 27 → 2
    expect(bonuses(s, [0, 3, 2])).toEqual([]) // one ♦
  })

  it("Empire Builders (Roads): +1 per ♣ per border of the empire's home", () => {
    const at = (home: number) => world(HAND, {}, [civ('empireBuilders', home)])
    expect(bonuses(at(8), [C1, C2])).toEqual([['empireBuilders', 10]]) // R8: 5 borders
    expect(bonuses(at(9), [C1, C2])).toEqual([['empireBuilders', 8]]) // R9: 4 borders
    expect(bonuses(at(0), [C1, C2])).toEqual([['empireBuilders', 6]]) // R0: 3 borders
    expect(bonuses(at(8), [H1, S1])).toEqual([])
  })

  it('Scholars (Libraries): +1 per ♠ per 10 Knowledge AFTER the play, capped at +5 per ♠', () => {
    const at = (knowledge: number) => world(HAND, { knowledge }, [civ('scholars')])
    expect(bonuses(at(8), [S1])).toEqual([]) // 9
    expect(bonuses(at(9), [S1])).toEqual([['scholars', 1]]) // this ♠ makes 10
    expect(bonuses(at(18), [S1])).toEqual([['scholars', 1]]) // 19
    expect(bonuses(at(29), [S1])).toEqual([['scholars', 3]]) // 30
    expect(bonuses(at(80), [S1, S2])).toEqual([['scholars', 10]]) // 82 → capped at 5 per ♠
    expect(bonuses(at(80), [H1, C1])).toEqual([])
  })

  it('Technocrats (Engineering): with both ♣ and ♠, +3 per ♣ and ♠ card', () => {
    const s = world(HAND, {}, [civ('technocrats')])
    expect(bonuses(s, [C1, S1])).toEqual([['technocrats', 6]])
    expect(bonuses(s, [C1, C2, S1, H1])).toEqual([['technocrats', 9]]) // the ♥ adds nothing
    expect(bonuses(s, [C1, C2])).toEqual([])
    expect(bonuses(s, [S1, S2])).toEqual([])
  })

  it('only emerged civilizations act; all of them stack, in emergence order, into the score', () => {
    const play = [H1, C1, S1, D1, D2] // 1♥ 1♣ 1♠ 2♦
    const stats = { vitality: 50, knowledge: 50 }
    expect(evaluatePlay(world(HAND, stats, []), play)).toMatchObject({ civBonuses: [], civBonus: 0 })
    expect(bonuses(world(HAND, stats, [civ('nomads')]), play)).toEqual([['nomads', 12]])
    const six = evaluatePlay(world(HAND, stats, allSix()), play) // 2♥ 4♣ 9♠ K♦ A♦: high card, poker 42
    expect(six.civBonuses.map((b) => [b.archetype, b.amount])).toEqual([
      ['natureKeepers', 3], ['nomads', 12], ['merchants', 4], ['empireBuilders', 5], ['scholars', 5], ['technocrats', 6],
    ])
    expect(six.civBonus).toBe(35)
    expect(six.score).toBe(42 + 15 + 35)
    expect(bonuses(world(HAND, stats, allSix().reverse()), play).map(([a]) => a)).toEqual([...ARCHETYPE_ORDER].reverse())
    // untriggered passives are left out, not listed at 0
    expect(bonuses(world(HAND, stats, [civ('technocrats'), civ('merchants', 1, 1)]), [H1, H2])).toEqual([])
  })

  it('every civ bonus carries a readable explanation of its numbers', () => {
    const six = evaluatePlay(world(HAND, { vitality: 50, knowledge: 50 }, allSix()), [H1, C1, S1, D1, D2])
    expect(six.civBonuses.map((b) => b.detail)).toEqual([
      '1 ♥ × 3 (Vitality 51 ≥ Industry 1)', '4 suits → 3 × 4', '2 ♦: 10% of 42', '1 ♣ × 5 borders of R8', '1 ♠ × 5 (Knowledge 51)', '1 ♣ + 1 ♠ × 3',
    ])
  })

  it('in real runs: preview equals commit, determinism, stats and emergence untouched, terrain static, cards conserved', () => {
    let withBonus = 0
    for (const seed of ['civ-run-0', 'civ-run-1', 'civ-run-2']) {
      const actions = randomActions(seed, 400)
      let s = newAscensionGame(seed)
      const land = JSON.stringify(s.regions)
      // an independent shadow of the world: suit counts only, and emergence from them
      const shadow = noStats()
      let shadowCivs: Civilization[] = []
      for (const a of actions) {
        const before = s
        const preview = a.type === 'play' ? evaluatePlay(before, a.cards) : null
        s = applyAscensionAction(s, a)
        if (!preview) continue
        expect(s.score - before.score).toBe(preview.score)
        expect(s.lastPlay).toEqual(preview)
        if (preview.civBonus > 0) withBonus += 1
        for (const c of preview.cards) shadow[SUIT_STAT[c.s]] += 1
        if (s.round > before.round) {
          const civ = emergeCivilization(s.seed, before.round, s.regions, shadow, shadowCivs)
          if (civ) shadowCivs = [...shadowCivs, civ]
        }
        expect(s.stats).toEqual(shadow)
        expect(s.civilizations).toEqual(shadowCivs)
        expectConserved(s)
      }
      expect(s.civilizations.length).toBeGreaterThanOrEqual(2)
      expect(JSON.stringify(s.regions)).toBe(land)
      expect(replay(seed, actions)).toEqual(s)
    }
    expect(withBonus).toBeGreaterThan(50) // not vacuous
  })

  it('evaluatePlay with all six civilizations changes nothing (deep-frozen state)', () => {
    const s = deepFreeze(world(HAND, { vitality: 50, knowledge: 50 }, allSix()))
    const snap = JSON.stringify(s)
    expect(evaluatePlay(s, [H1, C1, S1, D1, D2]).civBonus).toBe(35)
    expect(applyAscensionAction(s, { type: 'play', cards: [H1, C1, S1, D1, D2] }).score).toBe(s.score + evaluatePlay(s, [H1, C1, S1, D1, D2]).score)
    expect(JSON.stringify(s)).toBe(snap)
  })

  it('a discard triggers no passive, even with a selection every civilization would reward', () => {
    const s = world(HAND, { vitality: 50, knowledge: 50 }, allSix())
    const next = applyAscensionAction(s, { type: 'discard', cards: [H1, C1, S1, D1, D2] })
    expect(next.score).toBe(s.score)
    expect(next.stats).toEqual(s.stats)
    expect(next.lastPlay).toBeNull()
    expect(next.civilizations).toEqual(s.civilizations)
    expectConserved(next)
  })

  it('illegal actions trigger no passive and leave the state untouched', () => {
    const s = world(HAND, { vitality: 50, knowledge: 50 }, allSix())
    const snap = JSON.stringify(s)
    const bad: [AscensionState, AscensionAction][] = [
      [s, { type: 'play', cards: [] }],
      [s, { type: 'play', cards: [H1, H1] }],
      [s, { type: 'play', cards: [8] }],
      [s, { type: 'play', cards: [0, 1, 2, 3, 4, 5] }],
      [{ ...s, playsLeft: 0 }, { type: 'play', cards: [H1] }],
      [{ ...s, discardsLeft: 0 }, { type: 'discard', cards: [H1] }],
    ]
    for (const [state, a] of bad) expect(() => applyAscensionAction(state, a)).toThrow()
    expect(JSON.stringify(s)).toBe(snap)
  })

  // Tradeoffs, not balance: each pair of plays comes from ONE hand in ONE
  // state; the civilization flips which play scores more. EVEN_LAND gives
  // equal-sized plays the same land bonus, so only poker + passive differ.
  it('reversal: Nomads make a mixed pair beat a flush', () => {
    const hand = [C(2, 'H'), C(3, 'H'), C(4, 'H'), C(5, 'H'), C(7, 'H'), C(14, 'S'), C(14, 'D'), C(13, 'C')]
    const flush = [0, 1, 2, 3, 4], pair = [5, 6, 7, 4, 3] // A♠ A♦ K♣ 7♥ 5♥
    const before = world(hand, {}, []), after = world(hand, {}, [civ('nomads')])
    expect([evaluatePlay(before, flush).score, evaluatePlay(before, pair).score]).toEqual([84 + 15, 80 + 15])
    expect([evaluatePlay(after, flush).score, evaluatePlay(after, pair).score]).toEqual([99, 95 + 12])
  })

  it('reversal: Nature Keepers turn Industry growth into a cost', () => {
    // both plays have one ♥; the ♣ play pushes Industry past Vitality and loses Stewardship
    const hand = [C(13, 'H'), C(12, 'C'), C(11, 'C'), C(12, 'D'), C(9, 'S'), C(2, 'S'), C(3, 'D'), C(4, 'D')]
    const clubs = [0, 1, 2], mixed = [0, 3, 4] // K♥ Q♣ J♣ (36) vs K♥ Q♦ 9♠ (34)
    const stats = { vitality: 10, industry: 10 }
    const before = world(hand, stats, []), after = world(hand, stats, [civ('natureKeepers')])
    expect([evaluatePlay(before, clubs).score, evaluatePlay(before, mixed).score]).toEqual([36 + 9, 34 + 9])
    expect([evaluatePlay(after, clubs).score, evaluatePlay(after, mixed).score]).toEqual([45, 43 + 3])
  })

  it('reversal: Merchants make a smaller pair with diamonds beat bigger aces', () => {
    const hand = [C(14, 'S'), C(14, 'C'), C(12, 'S'), C(13, 'D'), C(13, 'H'), C(12, 'D'), C(2, 'C'), C(3, 'C')]
    const aces = [0, 1, 2], kings = [3, 4, 5] // 40 × 1.5 = 60 vs 38 × 1.5 = 57
    const before = world(hand, {}, []), after = world(hand, {}, [civ('merchants')])
    expect([evaluatePlay(before, aces).score, evaluatePlay(before, kings).score]).toEqual([60 + 9, 57 + 9])
    expect([evaluatePlay(after, aces).score, evaluatePlay(after, kings).score]).toEqual([69, 66 + 5])
  })
})

/** A civilization record for crafted states. */
const civ = (archetype: Archetype, home: number, id: number): Civilization => ({
  id, archetype, home, tier: 1, emergedRound: 1,
  reason: { stat: ARCHETYPES[archetype].stats[0], readiness: EMERGENCE_STEP, needed: EMERGENCE_STEP, terrain: ARCHETYPES[archetype].terrains[0], regionFit: 0 },
})
/** Regions on the fixed topology: one terrain everywhere, or one per region id. */
const land = (t: Terrain | Terrain[]) => REGION_ADJACENCY.map((n, id) => ({ id, terrain: Array.isArray(t) ? t[id] : t, neighbors: [...n] }))
/** forest, mountains, desert, coast ×3 */
const EVEN = (['forest', 'mountains', 'desert', 'coast'] as const).flatMap((t) => [t, t, t]) as Terrain[]
/** 5 cards, each time the one whose stat (current + chosen) is lowest; the deterministic diagnostic bot. */
const balancedBot = (s: AscensionState): AscensionAction => {
  const add = { ...s.stats }, pick: number[] = []
  while (pick.length < 5) {
    const i = s.hand.map((_, j) => j).filter((j) => !pick.includes(j)).sort((a, b) => add[SUIT_STAT[s.hand[a].s]] - add[SUIT_STAT[s.hand[b].s]] || a - b)[0]
    pick.push(i); add[SUIT_STAT[s.hand[i].s]] += 1
  }
  return { type: 'play', cards: pick }
}
/** Plays up to 5 cards of these suits (else the first card). */
const suitBot = (suits: Card['s'][]) => (s: AscensionState): AscensionAction => {
  const idx = s.hand.flatMap((c, i) => (suits.includes(c.s) ? [i] : [])).slice(0, 5)
  return { type: 'play', cards: idx.length ? idx : [0] }
}
/** Every state of a run: the bot plays, each crisis is resolved as it strikes; stops when the run ends (or after 150 rounds). */
function drive(seed: string, bot: (s: AscensionState) => AscensionAction): AscensionState[] {
  const states = [newAscensionGame(seed)]
  for (let s = states[0]; ['playing', 'crisis'].includes(runStatus(s)) && s.round <= 150; states.push(s)) {
    s = applyAscensionAction(s, runStatus(s) === 'crisis' ? { type: 'resolve' } : bot(s))
  }
  return states
}
const last = <T>(a: T[]) => a[a.length - 1]
const outcomes = (s: AscensionState) => s.crises.map((c) => `${c.crisis}:${c.result}`)

describe('Ascension eras', () => {
  /** A conserved state `playsLeft` plays from a round end: this hand, stats, civs, era and land (default EVEN). */
  const at = (o: { stats?: Partial<WorldStats>; civs?: Civilization[]; era?: number; playsLeft?: number; land?: Terrain | Terrain[] }) => ({
    ...withHand([C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S'), C(6, 'H'), C(7, 'D'), C(8, 'C'), C(9, 'S')]),
    regions: land(o.land ?? EVEN),
    stats: { ...noStats(), ...o.stats }, civilizations: o.civs ?? [], era: o.era ?? 0, playsLeft: o.playsLeft ?? 1,
  })
  const H = 0, D = 1, C_ = 2, S = 3 // hand positions of 2♥ 3♦ 4♣ 5♠
  const play = (s: AscensionState, cards: number[]) => applyAscensionAction(s, { type: 'play', cards })
  const resolve = (s: AscensionState) => applyAscensionAction(s, { type: 'resolve' })
  const reqs = (s: AscensionState) => eraRequirements(s.era, s.stats, s.civilizations).map((r) => [r.key, r.have, r.need, r.met])

  it('three eras, in order, with the documented requirements; every world can meet them', () => {
    expect(ERAS.map((e) => [e.id, e.label, e.needs])).toEqual([
      ['tribal', 'Tribal', { civilizations: 1, stats: 2, min: 15 }],
      ['ancient', 'Ancient', { civilizations: 2, stats: 3, min: 30 }],
      ['medieval', 'Medieval', { civilizations: 3, stats: 4, min: 50 }],
    ])
    // each era asks one more developed stat, at a higher level, from more civilizations
    for (let i = 1; i < ERAS.length; i++) {
      expect(ERAS[i].needs.stats).toBe(ERAS[i - 1].needs.stats + 1)
      expect(ERAS[i].needs.min).toBeGreaterThan(ERAS[i - 1].needs.min)
      expect(ERAS[i].needs.civilizations).toBeGreaterThan(ERAS[i - 1].needs.civilizations)
    }
    // 3 civilizations need 3 archetypes with distinct homes: true of every sampled world
    const hosts = (seed: string) => {
      const regions = generateRegions(hashSeed(seed))
      const opts = ARCHETYPE_ORDER.map((a) => regions.filter((r) => ARCHETYPES[a].terrains.includes(r.terrain)).map((r) => r.id))
      const go = (i: number, used: number[]): number => (i === opts.length ? 0
        : Math.max(go(i + 1, used), ...opts[i].filter((h) => !used.includes(h)).map((h) => 1 + go(i + 1, [...used, h]))))
      return go(0, [])
    }
    for (let i = 0; i < 300; i++) expect(hosts(`hosts-${i}`)).toBeGreaterThanOrEqual(ERAS[ERAS.length - 1].needs.civilizations)
  })

  it('a new world is Tribal and shows exactly what it needs', () => {
    const s = newAscensionGame('era-new')
    expect(s).toMatchObject({ era: 0, eraLog: [] })
    expect(reqs(s)).toEqual([['civilizations', 0, 1, false], ['stats', 0, 2, false]])
    expect(canAdvance(s.era, s.stats, s.civilizations)).toBe(false)
  })

  it('requirements are met exactly at their thresholds, never one short', () => {
    ERAS.forEach(({ needs }, era) => {
      const civs = ARCHETYPE_ORDER.slice(0, needs.civilizations).map((a, i) => civ(a, i, i))
      const stats = (n: number, v: number) => Object.fromEntries(WORLD_STATS.map((k, i) => [k, i < n ? v : 0])) as WorldStats
      expect(canAdvance(era, stats(needs.stats, needs.min), civs)).toBe(true)
      expect(canAdvance(era, stats(needs.stats, needs.min - 1), civs)).toBe(false) // a stat one short
      expect(canAdvance(era, stats(needs.stats - 1, 999), civs)).toBe(false) // one stat too few
      expect(canAdvance(era, stats(needs.stats, needs.min), civs.slice(1))).toBe(false) // one civilization too few
      expect(eraRequirements(era, stats(needs.stats, needs.min), civs).map((r) => [r.have, r.need, r.met]))
        .toEqual([[needs.civilizations, needs.civilizations, true], [needs.stats, needs.stats, true]])
    })
  })

  it('the crisis strikes at the round end where the requirements hold, not before; surviving it advances one era', () => {
    let s = at({ stats: { vitality: 14, prosperity: 15 }, civs: [civ('nomads', 6, 0)], playsLeft: 2 })
    s = play(s, [H]) // Vitality 15: met, but mid-round
    expect(canAdvance(s.era, s.stats, s.civilizations)).toBe(true)
    expect([runStatus(s), s.crisis]).toEqual(['playing', null])
    s = applyAscensionAction(s, { type: 'discard', cards: [0] }) // a discard is not a checkpoint
    expect(runStatus(s)).toBe('playing')
    const round = s.round
    s = play(s, [0]) // the round's last play
    expect([runStatus(s), s.crisis, s.era, s.eraLog, s.crises]).toEqual(['crisis', { round }, 0, [], []])
    const forecast = evaluateCrisis(0, s)
    const after = resolve(s)
    expect(after.crises).toEqual([{ ...forecast, round }])
    expect(forecast.result).toBe('survived')
    expect([runStatus(after), after.era, after.crisis]).toEqual(['playing', 1, null])
    expect(after.eraLog).toEqual([{ from: 'tribal', to: 'ancient', round, stats: s.stats, civilizations: 2 }]) // Merchants emerged at that round end
    expect(reqs(after)).toEqual([['civilizations', 2, 2, true], ['stats', 0, 3, false]]) // now Ancient's: stats at 30+
    // resolving changes nothing but the era and crisis records
    const strip = ({ era, eraLog, crisis, crises, ...rest }: AscensionState) => rest
    expect(strip(after)).toEqual(strip(s))
  })

  it('a round end one short of any requirement brings no crisis', () => {
    const civs = [civ('nomads', 6, 0)]
    expect(runStatus(play(at({ stats: { vitality: 13, prosperity: 15 }, civs }), [H]))).toBe('playing') // Vitality 14
    expect(runStatus(play(at({ stats: { vitality: 14, prosperity: 20 }, civs }), [H]))).toBe('crisis')
    // no civilization, and none can emerge on tundra without Vitality or Knowledge
    const s = play(at({ stats: { prosperity: 20, industry: 20 }, land: 'tundra' }), [D])
    expect([s.civilizations, runStatus(s)]).toEqual([[], 'playing'])
  })

  it('a civilization that emerges at this round end counts toward this round end', () => {
    const s = play(at({ stats: { vitality: 20, prosperity: 20 } }), [D])
    expect(s.civilizations).toHaveLength(1)
    expect(runStatus(s)).toBe('crisis')
  })

  it('each round end brings at most one crisis and each survival exactly one era, in order', () => {
    const civs = [civ('nomads', 6, 0), civ('scholars', 7, 1), civ('empireBuilders', 3, 2)]
    let s = at({ stats: { vitality: 99, prosperity: 99, industry: 99, knowledge: 99 }, civs })
    for (const era of [1, 2, 3]) {
      s = play(s, [0])
      expect([runStatus(s), s.era]).toEqual(['crisis', era - 1])
      s = resolve(s)
      expect(s.era).toBe(era)
      for (let i = 1; i < PLAYS_PER_ROUND && runStatus(s) === 'playing'; i++) s = play(s, [0])
    }
    expect(runStatus(s)).toBe('complete')
    expect(outcomes(s)).toEqual(['winter:survived', 'plague:survived', 'invasion:survived'])
    expect(s.eraLog.map((e) => [e.from, e.to])).toEqual([['tribal', 'ancient'], ['ancient', 'medieval'], ['medieval', null]])
  })

  it('in real runs: crises strike exactly when the requirements hold, resolve once to the forecast, and the world carries over whole', () => {
    let resolved = 0
    for (const seed of ['era-run-0', 'era-run-1', 'era-run-2', 'era-run-3']) {
      let s = newAscensionGame(seed)
      const world = JSON.stringify(s.regions)
      for (const a of randomActions(seed, 800)) {
        const before = s
        const preview = a.type === 'play' ? evaluatePlay(before, a.cards) : null
        const forecast = a.type === 'resolve' ? evaluateCrisis(before.era, before) : null
        s = applyAscensionAction(s, a)
        const roundEnd = s.round > before.round
        expect(runStatus(s) === 'crisis').toBe(forecast ? false : before.crisis !== null || (roundEnd && canAdvance(before.era, s.stats, s.civilizations)))
        if (forecast) {
          resolved += 1
          expect(s.crises).toEqual([...before.crises, { ...forecast, round: before.crisis!.round }])
          expect(s.era).toBe(before.era + (forecast.result === 'survived' ? 1 : 0))
        } else {
          expect([s.era, s.crises]).toEqual([before.era, before.crises])
        }
        expect(JSON.stringify(s.regions)).toBe(world)
        expect(s.civilizations.slice(0, before.civilizations.length)).toEqual(before.civilizations)
        if (preview) {
          expect(s.lastPlay).toEqual(preview)
          expect(s.score - before.score).toBe(preview.score)
          for (const k of WORLD_STATS) expect(s.stats[k]).toBe(before.stats[k] + preview.statDeltas[k])
        } else {
          expect([s.stats, s.score]).toEqual([before.stats, before.score])
        }
        expectConserved(s)
      }
      expect(new Set(s.crises.map((c) => c.crisis)).size).toBe(s.crises.length) // no crisis twice
      expect(s.crises.map((c) => c.crisis)).toEqual(['winter', 'plague', 'invasion'].slice(0, s.crises.length))
    }
    expect(resolved).toBeGreaterThanOrEqual(4)
  })

  it('a balanced run completes the first playable, deterministically, with passives working in every era', () => {
    const run = drive('crisis-0', balancedBot)
    const done = last(run)
    expect(drive('crisis-0', balancedBot)).toEqual(run)
    expect(runStatus(done)).toBe('complete')
    expect(done.crises.map((c) => [c.crisis, c.round, c.resilience, c.pressure, c.result])).toEqual([
      ['winter', 3, 32, 23, 'survived'], ['plague', 6, 63, 46, 'survived'], ['invasion', 10, 96, 60, 'survived'],
    ])
    expect(done.eraLog.map((e) => e.round)).toEqual([3, 6, 10])
    for (let era = 0; era < ERAS.length; era++) {
      expect(run.some((s, i) => i > 0 && run[i - 1].era === era && s.lastPlay !== run[i - 1].lastPlay && s.lastPlay!.civBonus > 0)).toBe(true)
    }
  })

  it('passives are the same in every era: eras change no play', () => {
    const civs = ARCHETYPE_ORDER.map((a, i) => civ(a, i, i))
    const base = at({ stats: { vitality: 50, knowledge: 50 }, civs })
    for (let era = 0; era < ERAS.length; era++) expect(evaluatePlay({ ...base, era }, [H, D, C_, S, 6])).toEqual(evaluatePlay(base, [H, D, C_, S, 6]))
  })

  it('first playable complete: every action is refused and the world is kept for inspection', () => {
    const run = drive('crisis-0', balancedBot)
    const done = deepFreeze(last(run))
    const snap = JSON.stringify(done)
    expect([isComplete(done.era), done.era, runStatus(done)]).toEqual([true, ERAS.length, 'complete'])
    expect(eraRequirements(done.era, done.stats, done.civilizations)).toEqual([])
    expect(canAdvance(done.era, done.stats, done.civilizations)).toBe(false)
    for (const a of [{ type: 'play', cards: [0] }, { type: 'discard', cards: [0] }, { type: 'resolve' }] as AscensionAction[]) {
      expect(() => applyAscensionAction(done, a)).toThrow('first playable complete')
    }
    expect(() => evaluatePlay(done, [0])).toThrow('first playable complete')
    expect(JSON.stringify(done)).toBe(snap)
    expectConserved(done)
    expect(done.regions).toEqual(run[0].regions)
  })

  it('same seed + same actions give the same eras and crises', () => {
    const actions = randomActions('era-det', 800)
    const a = replay('era-det', actions)
    expect(a.crises.length).toBeGreaterThanOrEqual(1)
    expect(replay('era-det', actions)).toEqual(a)
  })
})

describe('Ascension crises', () => {
  const W = (t: Terrain | Terrain[], stats: Partial<WorldStats>, civs: Civilization[] = []) =>
    ({ regions: land(t), stats: { ...noStats(), ...stats }, civilizations: civs })
  const amounts = (e: CrisisEvaluation) => [e.pressures.map((f) => f.amount), e.mitigations.map((f) => f.amount), e.pressure, e.resilience, e.result]
  const at = (era: number, stats: Partial<WorldStats>, civs: Civilization[], t: Terrain | Terrain[] = EVEN) => ({
    ...newAscensionGame('crisis-state'), regions: land(t), stats: { ...noStats(), ...stats }, civilizations: civs, era, crisis: { round: 9 },
  })

  it('one crisis per era, in era order, with the documented factors', () => {
    expect(CRISES.map((c) => [c.id, c.label])).toEqual([['winter', 'Harsh Winter'], ['plague', 'Plague'], ['invasion', 'Invasion']])
    expect(CRISES).toHaveLength(ERAS.length)
    const e = evaluateCrisis(0, W(EVEN, {}))
    expect(e.pressures.map((f) => f.label)).toEqual(['The winter', 'Cold land', 'Cleared forests'])
    expect(e.mitigations.map((f) => f.label)).toEqual(['Food stores', 'Fertile land', 'Nature Keepers', 'Nomads'])
    expect(evaluateCrisis(1, W(EVEN, {})).pressures.map((f) => f.label)).toEqual(['The plague', 'Crowded ports and farms', 'Trade outruns medicine', 'Merchants'])
    expect(evaluateCrisis(1, W(EVEN, {})).mitigations.map((f) => f.label)).toEqual(['Medicine', 'Healthy people', 'Isolated land', 'Scholars'])
    expect(evaluateCrisis(2, W(EVEN, {})).pressures.map((f) => f.label)).toEqual(['The invasion', 'Open land', 'A lopsided realm'])
    expect(evaluateCrisis(2, W(EVEN, {})).mitigations.map((f) => f.label)).toEqual(['Arms and walls', 'Allied civilizations', 'Mountain passes', 'Empire Builders'])
    expect(() => evaluateCrisis(3, W(EVEN, {}))).toThrow()
  })

  // 3 tundra, 2 mountains, 2 forest, 1 plains, 4 desert
  const WINTER_LAND: Terrain[] = ['tundra', 'tundra', 'tundra', 'mountains', 'mountains', 'forest', 'forest', 'plains', 'desert', 'desert', 'desert', 'desert']
  it('Harsh Winter: 15 + 2 per cold region + Industry over Vitality vs Vitality + 2 per fertile region + 8 per Nature Keepers / Nomads', () => {
    const civs = [civ('nomads', 8, 0)]
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 20, industry: 25 }, civs)))).toEqual([[15, 10, 5], [20, 6, 0, 8], 30, 34, 'survived'])
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 20, industry: 25 }, [...civs, civ('natureKeepers', 5, 1)])))).toEqual([[15, 10, 5], [20, 6, 8, 8], 30, 42, 'survived'])
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 30, industry: 25 }, civs)))[0]).toEqual([15, 10, 0]) // no strain when Vitality leads
    // the boundary: resilience = pressure survives, one short fails
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 18, industry: 25 }, civs))).slice(2)).toEqual([32, 32, 'survived'])
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 17, industry: 25 }, civs))).slice(2)).toEqual([33, 31, 'failed'])
  })

  // 2 coast, 2 plains, 2 desert, 1 tundra, 5 forest
  const PLAGUE_LAND: Terrain[] = ['coast', 'coast', 'plains', 'plains', 'desert', 'desert', 'tundra', 'forest', 'forest', 'forest', 'forest', 'forest']
  it('Plague: 30 + 2 per coast/plains + Prosperity over Knowledge + 10 for Merchants vs Knowledge + Vitality ÷ 2 + 2 per desert/tundra + 10 for Scholars', () => {
    const civs = [civ('merchants', 2, 0), civ('scholars', 4, 1)]
    expect(amounts(evaluateCrisis(1, W(PLAGUE_LAND, { prosperity: 40, knowledge: 30, vitality: 25 }, civs)))).toEqual([[30, 8, 10, 10], [30, 12, 6, 10], 58, 58, 'survived'])
    expect(amounts(evaluateCrisis(1, W(PLAGUE_LAND, { prosperity: 40, knowledge: 29, vitality: 25 }, civs))).slice(2)).toEqual([59, 57, 'failed'])
    expect(amounts(evaluateCrisis(1, W(PLAGUE_LAND, { prosperity: 20, knowledge: 30, vitality: 25 }, [])))).toEqual([[30, 8, 0, 0], [30, 12, 6, 0], 38, 48, 'survived'])
  })

  // 3 mountains, 2 plains, 1 desert, 1 coast, 5 forest
  const INVASION_LAND: Terrain[] = ['mountains', 'mountains', 'mountains', 'plains', 'plains', 'desert', 'coast', 'forest', 'forest', 'forest', 'forest', 'forest']
  it('Invasion: 50 + 2 per open region + highest − lowest stat vs Industry + 5 per civilization + 3 per mountain + 10 for Empire Builders', () => {
    const civs = [civ('empireBuilders', 0, 0), civ('nomads', 3, 1), civ('merchants', 4, 2), civ('natureKeepers', 7, 3)]
    expect(amounts(evaluateCrisis(2, W(INVASION_LAND, { vitality: 60, prosperity: 55, industry: 70, knowledge: 52 }, civs)))).toEqual([[50, 8, 18], [70, 20, 9, 10], 76, 109, 'survived'])
    // over-developing Industry buys nothing once it is the highest stat: its strain grows just as fast
    const spike = evaluateCrisis(2, W(INVASION_LAND, { vitality: 60, prosperity: 55, industry: 170, knowledge: 52 }, civs))
    expect(spike.resilience - spike.pressure).toBe(109 - 76)
    // a lopsided realm falls: the same stats with Knowledge neglected
    expect(amounts(evaluateCrisis(2, W(INVASION_LAND, { vitality: 60, prosperity: 55, industry: 70, knowledge: 5 }, civs))).slice(2)).toEqual([123, 109, 'failed'])
  })

  it('terrain alone can decide a crisis', () => {
    const stats = { vitality: 15, prosperity: 15 }, civs = [civ('nomads', 0, 0)]
    expect(evaluateCrisis(0, W('forest', stats, civs)).result).toBe('survived') // 15 vs 15 + 24 + 8
    expect(evaluateCrisis(0, W('tundra', stats, civs)).result).toBe('failed') // 39 vs 23
  })

  it('the stat distribution alone can decide a crisis: same development, different balance', () => {
    expect(amounts(evaluateCrisis(0, W(EVEN, { vitality: 20, industry: 10 })))).toEqual([[15, 6, 0], [20, 6, 0, 0], 21, 26, 'survived'])
    expect(amounts(evaluateCrisis(0, W(EVEN, { vitality: 10, industry: 20 })))).toEqual([[15, 6, 10], [10, 6, 0, 0], 31, 16, 'failed'])
  })

  it('civilizations alone can decide a crisis: Merchants spread the plague, Scholars contain it', () => {
    const stats = { vitality: 30, prosperity: 30, knowledge: 25 }
    expect(amounts(evaluateCrisis(1, W(EVEN, stats, [civ('merchants', 9, 0)])))).toEqual([[30, 6, 5, 10], [25, 15, 6, 0], 51, 46, 'failed'])
    expect(amounts(evaluateCrisis(1, W(EVEN, stats, [civ('scholars', 6, 0)])))).toEqual([[30, 6, 5, 0], [25, 15, 6, 10], 41, 56, 'survived'])
    // and Allied civilizations count in the Invasion
    const inv = (n: number) => evaluateCrisis(2, W(EVEN, { vitality: 50, prosperity: 50, industry: 50, knowledge: 50 }, ARCHETYPE_ORDER.slice(0, n).map((a, i) => civ(a, i, i))))
    expect(inv(4).resilience - inv(3).resilience).toBe(5 + 10) // the 4th is Empire Builders
  })

  it('the same seed, played differently, meets different fates', () => {
    const fate = (bot: (s: AscensionState) => AscensionAction, seed: string) => { const s = last(drive(seed, bot)); return [runStatus(s), ...outcomes(s)] }
    expect(fate(balancedBot, 'crisis-0')).toEqual(['complete', 'winter:survived', 'plague:survived', 'invasion:survived'])
    expect(fate(suitBot(['C', 'S']), 'crisis-0')).toEqual(['failed', 'winter:failed']) // Industry without Vitality: cleared forests
    expect(fate(suitBot(['H', 'D']), 'crisis-0')).toEqual(['failed', 'winter:survived', 'plague:failed']) // trade without medicine
    // and a balanced world one short of the winter survives it when played for Vitality
    expect(last(drive('crisis-11', balancedBot)).crises.map((c) => [c.crisis, c.resilience, c.pressure, c.result])).toEqual([['winter', 27, 28, 'failed']])
    expect(last(drive('crisis-11', suitBot(['H', 'D']))).crises[0]).toMatchObject({ crisis: 'winter', result: 'survived' })
  })

  it('the outcome follows from the world alone: no randomness, and the seed does not matter', () => {
    const w = W(WINTER_LAND, { vitality: 18, industry: 25 }, [civ('nomads', 8, 0)])
    expect(evaluateCrisis(0, w)).toEqual(evaluateCrisis(0, w))
    for (const seed of ['a', 'b', 'c']) expect(evaluateCrisis(0, { ...newAscensionGame(seed), ...w })).toEqual(evaluateCrisis(0, w))
    const frozen = deepFreeze(at(0, { vitality: 18, industry: 25 }, [civ('nomads', 8, 0)], WINTER_LAND))
    expect(applyAscensionAction(frozen, { type: 'resolve' }).crises[0]).toEqual({ ...evaluateCrisis(0, w), round: 9 })
  })

  it('a pending crisis cannot be skipped: no play, discard or preview until it is resolved', () => {
    const s = deepFreeze(at(0, { vitality: 18, industry: 25 }, [civ('nomads', 8, 0)], WINTER_LAND))
    expect(runStatus(s)).toBe('crisis')
    expect(() => applyAscensionAction(s, { type: 'play', cards: [0] })).toThrow('resolve the crisis first')
    expect(() => applyAscensionAction(s, { type: 'discard', cards: [0] })).toThrow('resolve the crisis first')
    expect(() => evaluatePlay(s, [0])).toThrow('resolve the crisis first')
  })

  it('a crisis resolves once: resolving with none pending is refused, and a resolved crisis cannot fire again', () => {
    expect(() => applyAscensionAction(newAscensionGame('no-crisis'), { type: 'resolve' })).toThrow('no crisis to resolve')
    const s = applyAscensionAction(at(0, { vitality: 18, industry: 25 }, [civ('nomads', 8, 0)], WINTER_LAND), { type: 'resolve' })
    expect([runStatus(s), s.era, s.crises.length]).toEqual(['playing', 1, 1])
    expect(() => applyAscensionAction(s, { type: 'resolve' })).toThrow('no crisis to resolve')
    // the next round end with requirements met brings the NEXT era's crisis, not this one again
    const next = applyAscensionAction({ ...s, stats: { vitality: 40, prosperity: 40, industry: 40, knowledge: 40 }, civilizations: [civ('nomads', 8, 0), civ('scholars', 9, 1)], playsLeft: 1 }, { type: 'play', cards: [0] })
    expect(runStatus(next)).toBe('crisis')
    expect(evaluateCrisis(next.era, next).crisis).toBe('plague')
  })

  it('failure ends the run and keeps the world for inspection', () => {
    const struck = at(0, { vitality: 17, industry: 25 }, [civ('nomads', 8, 0)], WINTER_LAND)
    const s = deepFreeze(applyAscensionAction(struck, { type: 'resolve' }))
    expect([runStatus(s), s.era, s.eraLog, s.crisis]).toEqual(['failed', 0, [], null])
    expect(s.crises).toEqual([{ ...evaluateCrisis(0, struck), round: 9 }])
    expect(last(s.crises)).toMatchObject({ result: 'failed', pressure: 33, resilience: 31 })
    const snap = JSON.stringify(s)
    for (const a of [{ type: 'play', cards: [0] }, { type: 'discard', cards: [0] }, { type: 'resolve' }] as AscensionAction[]) {
      expect(() => applyAscensionAction(s, a)).toThrow('run over: Harsh Winter failed')
    }
    expect(() => evaluatePlay(s, [0])).toThrow('run over')
    expect(JSON.stringify(s)).toBe(snap)
    expect([s.regions, s.stats, s.civilizations, s.score, s.hand]).toEqual([struck.regions, struck.stats, struck.civilizations, struck.score, struck.hand])
    expectConserved(s)
    // a real run that fails keeps its world too
    const run = drive('crisis-11', balancedBot)
    expect(runStatus(last(run))).toBe('failed')
    expect(last(run).regions).toEqual(run[0].regions)
    expect(last(run).civilizations.length).toBeGreaterThanOrEqual(1)
  })
})
