import { describe, it, expect } from 'vitest'
import {
  newAscensionGame, applyAscensionAction, evaluatePlay, noStats, generateRegions, landAffinity, runStatus, projectRoundEnd, crisisWorld, actionCost,
  ASCENSION_RULES_VERSION, HAND_SIZE, PLAYS_PER_ROUND, DISCARDS_PER_ROUND, WORLD_STATS, SUIT_STAT,
  TERRAIN, TERRAINS, REGION_ADJACENCY,
  type AscensionState, type AscensionAction, type WorldStats, type WorldStat, type Terrain,
} from '../src/engine/ascension/ascension'
import {
  ARCHETYPES, ARCHETYPE_ORDER, EMERGENCE_STEP, emergeCivilization, emergenceThreshold, readinessOf,
  type Archetype, type Civilization,
} from '../src/engine/ascension/civilizations'
import { newGame as newClassicGame, SAVE_VERSION } from '../src/engine/worldhand'
import { Rng, hashSeed } from '../src/engine/rng'
import { stream } from '../src/engine/core/streams'
import { deck, type Card } from '../src/engine/poker'
import { ERAS, ERA_BUDGET, eraRequirements, canAdvance, isComplete, requirementShortfall } from '../src/engine/ascension/eras'
import { CRISES, CRISIS_RULES, evaluateCrisis, type CrisisEvaluation } from '../src/engine/ascension/crises'

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

/** A seeded random mix of legal plays and discards, including rollovers; faces
 *  each crisis at a random moment while it is ready (or when it strikes) and
 *  stops when the run ends. */
function randomActions(seedText: string, n: number): AscensionAction[] {
  const rng = new Rng(hashSeed(`actions:${seedText}`))
  let s = newAscensionGame(seedText)
  const out: AscensionAction[] = []
  for (let i = 0; i < n; i++) {
    // a struck crisis must be faced; a ready one is faced at a random moment
    if (runStatus(s) === 'crisis' || (runStatus(s) === 'ready' && rng.next() < 0.3)) { s = applyAscensionAction(s, { type: 'resolve' }); out.push({ type: 'resolve' }); continue }
    if (runStatus(s) !== 'playing' && runStatus(s) !== 'ready') break
    // never beyond the era's budget: a play of at most `budget` cards, a discard only if affordable
    const cards = rng.shuffle(s.hand.map((_, j) => j)).slice(0, Math.min(rng.int(1, 6), Math.max(1, s.budget)))
    const discard = s.discardsLeft > 0 && rng.next() < 0.3 && actionCost({ type: 'discard', cards }) <= s.budget
    const a: AscensionAction = discard ? { type: 'discard', cards } : { type: 'play', cards }
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
    expect(ASCENSION_RULES_VERSION).toBe(9)
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
    expect(a.round).toBeGreaterThan(3)
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
    // clubs + spades grows Empire Builders, Scholars and Technocrats while its Winter waits;
    // faced now it would fail (Industry without Vitality: cleared forests)
    const cs = runRounds('alpha', ['C', 'S'])
    expect(labels(cs)).toEqual(['empireBuilders', 'scholars', 'technocrats'])
    const winter = evaluateCrisis(cs.era, crisisWorld(cs))
    expect([['ready', 'crisis'].includes(runStatus(cs)), winter.crisis, winter.result]).toEqual([true, 'winter', 'failed'])
    expect(winter.pressures.find((f) => f.label === 'Cleared forests')!.amount).toBeGreaterThan(20)
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
/** A seeded mix that reaches crises under the era budget: mostly balanced plays, some random plays and
 *  discards; a ready crisis is faced at a random moment, a struck one at once; stops when the run ends. */
function mixedActions(seedText: string, n: number): AscensionAction[] {
  const rng = new Rng(hashSeed(`mixed:${seedText}`))
  let s = newAscensionGame(seedText)
  const out: AscensionAction[] = []
  for (let i = 0; i < n && ['playing', 'ready', 'crisis'].includes(runStatus(s)); i++) {
    let a: AscensionAction
    if (runStatus(s) === 'crisis' || (runStatus(s) === 'ready' && rng.next() < 0.25)) a = { type: 'resolve' }
    else if (rng.next() < 0.7) a = balancedBot(s)
    else {
      const cards = rng.shuffle(s.hand.map((_, j) => j)).slice(0, rng.int(1, 6))
      a = s.discardsLeft > 0 && rng.next() < 0.4 && actionCost({ type: 'discard', cards }) <= s.budget ? { type: 'discard', cards } : { type: 'play', cards }
    }
    if (a.type === 'play') a = { type: 'play', cards: a.cards.slice(0, Math.max(1, s.budget)) }
    s = applyAscensionAction(s, a)
    out.push(a)
  }
  return out
}
/** Plays up to 5 cards of these suits (else the first card). */
const suitBot = (suits: Card['s'][]) => (s: AscensionState): AscensionAction => {
  const idx = s.hand.flatMap((c, i) => (suits.includes(c.s) ? [i] : [])).slice(0, 5)
  return { type: 'play', cards: idx.length ? idx : [0] }
}
/** Every state of a run: the bot plays and faces each crisis as soon as it is ready; stops when the run ends (or after 150 rounds). */
function drive(seed: string, bot: (s: AscensionState) => AscensionAction): AscensionState[] {
  const states = [newAscensionGame(seed)]
  for (let s = states[0]; ['playing', 'ready', 'crisis'].includes(runStatus(s)) && s.round <= 150; states.push(s)) {
    s = applyAscensionAction(s, runStatus(s) === 'playing' ? bot(s) : { type: 'resolve' })
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
      ['medieval', 'Medieval', { civilizations: 3, stats: 3, min: 40, development: 200 }],
    ])
    // each era asks more civilizations and a higher level
    for (let i = 1; i < ERAS.length; i++) {
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
      // n stats at v, the rest topping development up to at least `dev` (in the last stat, kept below the minimum)
      const stats = (n: number, v: number, dev = 0) => {
        const st = Object.fromEntries(WORLD_STATS.map((k, i) => [k, i < n ? v : 0])) as WorldStats
        st.knowledge += Math.max(0, dev - n * v)
        return st
      }
      const dev = needs.development ?? 0
      expect(canAdvance(era, stats(needs.stats, needs.min, dev), civs)).toBe(true)
      expect(canAdvance(era, stats(needs.stats, needs.min - 1, dev), civs)).toBe(false) // a stat one short
      expect(canAdvance(era, stats(needs.stats - 1, 999), civs)).toBe(false) // one stat too few
      expect(canAdvance(era, stats(needs.stats, needs.min, dev), civs.slice(1))).toBe(false) // one civilization too few
      if (dev) expect(canAdvance(era, stats(needs.stats, needs.min, dev - 1), civs)).toBe(false) // development one short
      expect(eraRequirements(era, stats(needs.stats, needs.min, dev), civs).every((r) => r.met && r.have >= r.need)).toBe(true)
    })
  })

  it('Medieval takes 200 development in any shape: one peak or spread out, with 3 stats at 40+', () => {
    const civs = [civ('nomads', 0, 0), civ('scholars', 1, 1), civ('empireBuilders', 2, 2)]
    const w = (vitality: number, prosperity: number, industry: number, knowledge: number) => canAdvance(2, { vitality, prosperity, industry, knowledge }, civs)
    expect(w(50, 50, 50, 50)).toBe(true) // balanced
    expect(w(100, 40, 40, 20)).toBe(true) // a Vitality peak
    expect(w(40, 0, 40, 120)).toBe(true) // a Knowledge peak with Prosperity neglected
    expect(w(100, 40, 39, 21)).toBe(false) // only 2 stats at 40
    expect(w(99, 40, 40, 20)).toBe(false) // development 199
  })

  it('the crisis becomes ready at the round end where the requirements hold, not before', () => {
    let s = at({ stats: { vitality: 14, prosperity: 15 }, civs: [civ('nomads', 6, 0)], playsLeft: 2 })
    s = play(s, [H]) // Vitality 15: met, but mid-round
    expect(canAdvance(s.era, s.stats, s.civilizations)).toBe(true)
    expect([runStatus(s), s.crisis]).toEqual(['playing', null])
    s = applyAscensionAction(s, { type: 'discard', cards: [0] }) // a discard is not a checkpoint
    expect(runStatus(s)).toBe('playing')
    const round = s.round
    s = play(s, [0]) // the round's last play
    expect([runStatus(s), s.crisis, s.era, s.eraLog, s.crises]).toEqual(['ready', { round }, 0, [], []])
  })

  it('a round end one short of any requirement makes nothing ready; a civilization emerging there counts', () => {
    const civs = [civ('nomads', 6, 0)]
    expect(runStatus(play(at({ stats: { vitality: 13, prosperity: 15 }, civs }), [H]))).toBe('playing') // Vitality 14
    expect(runStatus(play(at({ stats: { vitality: 14, prosperity: 20 }, civs }), [H]))).toBe('ready')
    // no civilization, and none can emerge on tundra without Vitality or Knowledge
    const t = play(at({ stats: { prosperity: 20, industry: 20 }, land: 'tundra' }), [D])
    expect([t.civilizations, runStatus(t)]).toEqual([[], 'playing'])
    const e = play(at({ stats: { vitality: 20, prosperity: 20 } }), [D])
    expect([e.civilizations.length, runStatus(e)]).toEqual([1, 'ready'])
  })

  it('a ready crisis blocks nothing: play on, and face it whenever you choose; surviving advances exactly one era', () => {
    let s = play(at({ stats: { vitality: 30, prosperity: 20 }, civs: [civ('nomads', 6, 0)] }), [H])
    expect(runStatus(s)).toBe('ready')
    s = play(s, [0]) // plays, previews and discards are allowed while ready
    expect(() => evaluatePlay(s, [0])).not.toThrow()
    s = applyAscensionAction(s, { type: 'discard', cards: [0] })
    const forecast = evaluateCrisis(0, crisisWorld(s))
    const after = resolve(s)
    expect(after.crises).toEqual([{ ...forecast, round: s.crisis!.round, faced: s.round }])
    expect(forecast.result).toBe('survived')
    expect([runStatus(after), after.era, after.crisis]).toEqual(['playing', 1, null])
    expect(after.eraLog).toEqual([{ from: 'tribal', to: 'ancient', round: s.round, stats: s.stats, civilizations: s.civilizations.length, score: s.score }])
    // facing changes nothing but the era and crisis records, and the next era's cards join the unspent ones
    const strip = ({ era, eraLog, crisis, crises, budget, ...rest }: AscensionState) => rest
    expect(strip(after)).toEqual(strip(s))
    expect(after.budget).toBe(s.budget + ERA_BUDGET.perEra[1])
    expect(() => resolve(after)).toThrow('no crisis to resolve')
  })

  it("a ready crisis strikes when the era's cards run out: then nothing but facing it is allowed", () => {
    let s: AscensionState = { ...play(at({ stats: { vitality: 30, prosperity: 20 }, civs: [civ('nomads', 6, 0)] }), [H]) }
    expect(runStatus(s)).toBe('ready')
    s = { ...s, budget: 3 }
    s = play(s, [0, 1]) // 2 cards: 1 left, still ready
    expect([runStatus(s), s.budget]).toEqual(['ready', 1])
    s = play(s, [0]) // the last card: it strikes, mid-round
    expect([runStatus(s), s.budget]).toEqual(['crisis', 0])
    expect(() => play(s, [0])).toThrow('resolve the crisis first')
    expect(() => applyAscensionAction(s, { type: 'discard', cards: [0] })).toThrow('resolve the crisis first')
    expect(() => evaluatePlay(s, [0])).toThrow('resolve the crisis first')
    const after = resolve(s)
    expect([after.era, after.budget, runStatus(after)]).toEqual([1, ERA_BUDGET.perEra[1], 'playing']) // nothing left to carry
  })

  it('preparing is a real choice: five clubs before facing turn a lost Invasion into a win, and cost five cards', () => {
    const civs = ARCHETYPE_ORDER.map((a, i) => civ(a, [0, 2, 3, 1, 5, 6][i], i)) // all six, Empire Builders on a mountain
    const hand = [C(2, 'C'), C(3, 'C'), C(4, 'C'), C(5, 'C'), C(6, 'C'), C(7, 'H'), C(8, 'H'), C(9, 'H')]
    const s: AscensionState = { ...withHand(hand), regions: land(EVEN), stats: { vitality: 50, prosperity: 50, industry: 52, knowledge: 50 }, civilizations: civs, era: 2, crisis: { round: 1 }, round: 2, playsLeft: 4, budget: 20 }
    const now = evaluateCrisis(2, crisisWorld(s))
    // 43 + 6 open + 50 riches vs 52 arms + 30 allies + 9 passes + 6 forest cover + 10 Empire Builders
    expect([now.pressure, now.resilience, now.result]).toEqual([99, 107, 'survived'])
    const poorer = { ...s, stats: { ...s.stats, industry: 45, prosperity: 55 } }
    const lost = evaluateCrisis(2, crisisWorld(poorer))
    expect([lost.pressure, lost.resilience, lost.result]).toEqual([43 + 6 + 50 + 10, 45 + 30 + 9 + 6 + 10, 'failed'])
    const later = applyAscensionAction(poorer, { type: 'play', cards: [0, 1, 2, 3, 4] })
    const then = evaluateCrisis(2, crisisWorld(later))
    // +5 arms, −5 undefended wealth, +1 riches, + this play's reserves
    expect(then.resilience - then.pressure - (lost.resilience - lost.pressure)).toBe(5 + 5 - 1 + Math.floor(later.score / CRISIS_RULES.reserveRate))
    expect([then.result, later.budget]).toEqual(['survived', 15])
  })

  it("reserves count only this era's score", () => {
    let s = play(at({ stats: { vitality: 30, prosperity: 20 }, civs: [civ('nomads', 6, 0)] }), [H])
    expect(crisisWorld(s).eraScore).toBe(s.score)
    s = resolve(s)
    expect(crisisWorld(s).eraScore).toBe(0)
    s = play(s, [0])
    expect(crisisWorld(s).eraScore).toBe(s.score - s.eraLog[0].score)
  })

  it('in real runs: crises become ready exactly when the requirements hold, are faced once to the forecast, and the world carries over whole', () => {
    let faced = 0, waitedSome = 0, lapsed = 0
    for (const seed of ['era-run-0', 'era-run-1', 'era-run-2', 'era-run-3', 'era-run-4', 'era-run-5', 'era-run-6', 'era-run-7']) {
      let s = newAscensionGame(seed)
      const world = JSON.stringify(s.regions)
      for (const a of mixedActions(seed, 900)) {
        const before = s
        const preview = a.type === 'play' ? evaluatePlay(before, a.cards) : null
        const forecast = a.type === 'resolve' ? evaluateCrisis(before.era, crisisWorld(before)) : null
        s = applyAscensionAction(s, a)
        const roundEnd = s.round > before.round
        if (forecast) {
          faced += 1
          if (before.round > before.crisis!.round + 1) waitedSome += 1
          expect(s.crises).toEqual([...before.crises, { ...forecast, round: before.crisis!.round, faced: before.round }])
          expect([s.era, s.crisis]).toEqual([before.era + (forecast.result === 'survived' ? 1 : 0), null])
        } else {
          expect([s.era, s.crises]).toEqual([before.era, before.crises])
          // ready exactly at a round end where the requirements hold (or when the cards run out with them met); it stays ready until faced
          const spentOut = s.budget <= 0 && !before.crisis && canAdvance(before.era, s.stats, s.civilizations)
          expect(s.crisis).toEqual(before.crisis ?? (roundEnd && canAdvance(before.era, s.stats, s.civilizations) ? { round: before.round } : spentOut ? { round: s.round } : null))
        }
        if (s.crisis && runStatus(s) !== 'failed') expect(runStatus(s)).toBe(s.budget <= 0 ? 'crisis' : 'ready')
        // the budget: never negative; spent exactly as costed; refilled (with carry-over) by an advance
        expect(s.budget).toBeGreaterThanOrEqual(0)
        if (s.era > before.era) expect(s.budget).toBe(before.budget + (ERA_BUDGET.perEra[s.era] ?? 0))
        else expect(before.budget - s.budget).toBe(actionCost(a))
        if (s.lapsed) expect([s.budget, before.lapsed, canAdvance(s.era, s.stats, s.civilizations)]).toEqual([0, false, false])
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
      if (s.lapsed) lapsed += 1
    }
    expect([faced >= 8, waitedSome >= 1]).toEqual([true, true])
  })

  it('a balanced run completes the first playable, deterministically, with passives working in every era', () => {
    const run = drive('crisis-0', balancedBot)
    const done = last(run)
    expect(drive('crisis-0', balancedBot)).toEqual(run)
    expect(runStatus(done)).toBe('complete')
    expect(done.crises.map((c) => [c.crisis, c.faced, c.resilience, c.pressure, c.result])).toEqual([
      ['winter', 4, 38, 23, 'survived'], ['plague', 7, 69, 51, 'survived'], ['invasion', 11, 111, 98, 'survived'],
    ])
    expect(done.eraLog.map((e) => e.round)).toEqual([4, 7, 11])
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
    const actions = randomActions('era-det', 900)
    const a = replay('era-det', actions)
    expect(a.crises.length).toBeGreaterThanOrEqual(1)
    expect(replay('era-det', actions)).toEqual(a)
  })
})

describe('Ascension crises', () => {
  const W = (t: Terrain | Terrain[], stats: Partial<WorldStats>, civs: Civilization[] = [], eraScore = 0, waited = 0) =>
    ({ regions: land(t), stats: { ...noStats(), ...stats }, civilizations: civs, eraScore, waited })
  const amounts = (e: CrisisEvaluation) => [e.pressures.map((f) => f.amount), e.mitigations.map((f) => f.amount), e.pressure, e.resilience, e.result]
  const at = (era: number, stats: Partial<WorldStats>, civs: Civilization[], t: Terrain | Terrain[] = EVEN) => ({
    ...newAscensionGame('crisis-state'), regions: land(t), stats: { ...noStats(), ...stats }, civilizations: civs, era, crisis: { round: 0 },
  })

  it('one crisis per era, in era order, with the documented factors; reserves in every one', () => {
    expect(CRISES.map((c) => [c.id, c.label])).toEqual([['winter', 'Harsh Winter'], ['plague', 'Plague'], ['invasion', 'Invasion']])
    expect(CRISES).toHaveLength(ERAS.length)
    for (const c of CRISES) expect(c.watch).toMatch(/^tests /)
    const labels = (era: number) => { const e = evaluateCrisis(era, W(EVEN, {})); return [e.pressures.map((f) => f.label), e.mitigations.map((f) => f.label)] }
    expect(labels(0)).toEqual([['The winter', 'Cold land', 'Cleared forests'], ['Food stores', 'Fertile land', 'Nature Keepers', 'Nomads', 'Reserves']])
    expect(labels(1)).toEqual([['The plague', 'Crowded ports and farms', 'Trade outruns medicine', 'Merchants'], ['Medicine', 'Healthy people', 'Isolated land', 'Scholars', 'Reserves']])
    expect(labels(2)).toEqual([['The invasion', 'Open land', 'Riches to plunder', 'Undefended wealth'], ['Arms and walls', 'Allied civilizations', 'Mountain passes', 'Forest cover', 'Empire Builders', 'Reserves']])
    // with an era budget there is no waiting cost: the budget is the deadline
    expect(CRISIS_RULES).toEqual({ reserveRate: 150, gatherPerRound: 0, graceRounds: 2, upkeep: 0 })
    expect(() => evaluateCrisis(3, W(EVEN, {}))).toThrow()
  })

  // 3 tundra, 2 mountains, 2 forest, 1 plains, 4 desert
  const WINTER_LAND: Terrain[] = ['tundra', 'tundra', 'tundra', 'mountains', 'mountains', 'forest', 'forest', 'plains', 'desert', 'desert', 'desert', 'desert']
  it('Harsh Winter: 15 + 2 per cold region + Industry over Vitality vs Vitality + 2 per fertile region + 8 per Nature Keepers / Nomads', () => {
    const civs = [civ('nomads', 8, 0)]
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 20, industry: 25 }, civs)))).toEqual([[15, 10, 5], [20, 6, 0, 8, 0], 30, 34, 'survived'])
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 20, industry: 25 }, [...civs, civ('natureKeepers', 5, 1)])))).toEqual([[15, 10, 5], [20, 6, 8, 8, 0], 30, 42, 'survived'])
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 30, industry: 25 }, civs)))[0]).toEqual([15, 10, 0]) // no strain when Vitality leads
    // the boundary: resilience = pressure survives, one short fails
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 18, industry: 25 }, civs))).slice(2)).toEqual([32, 32, 'survived'])
    expect(amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 17, industry: 25 }, civs))).slice(2)).toEqual([33, 31, 'failed'])
  })

  it('reserves: 1 per 150 score earned this era, never negative', () => {
    const w = (eraScore: number) => amounts(evaluateCrisis(0, W(WINTER_LAND, { vitality: 20, industry: 25 }, [civ('nomads', 8, 0)], eraScore)))
    expect([149, 150, 299, 300, 1049].map((sc) => (w(sc)[1] as number[])[4])).toEqual([0, 1, 1, 2, 6])
    expect(w(450)).toEqual([[15, 10, 5], [20, 6, 0, 8, 3], 30, 37, 'survived'])
    expect(w(-50)[1]).toEqual([20, 6, 0, 8, 0])
  })

  // 2 coast, 2 plains, 2 desert, 1 tundra, 5 forest
  const PLAGUE_LAND: Terrain[] = ['coast', 'coast', 'plains', 'plains', 'desert', 'desert', 'tundra', 'forest', 'forest', 'forest', 'forest', 'forest']
  it('Plague: 35 + 2 per coast/plains + Prosperity over Knowledge + 10 for Merchants vs Knowledge + Vitality ÷ 2 + 2 per desert/tundra + 10 for Scholars', () => {
    const civs = [civ('merchants', 2, 0), civ('scholars', 4, 1)]
    const stats = { prosperity: 40, knowledge: 30, vitality: 25 }
    expect(amounts(evaluateCrisis(1, W(PLAGUE_LAND, stats, civs)))).toEqual([[35, 8, 10, 10], [30, 12, 6, 10, 0], 63, 58, 'failed'])
    expect(amounts(evaluateCrisis(1, W(PLAGUE_LAND, stats, civs, 750))).slice(2)).toEqual([63, 63, 'survived']) // 5 reserves close the gap
    expect(amounts(evaluateCrisis(1, W(PLAGUE_LAND, stats, civs, 749))).slice(2)).toEqual([63, 62, 'failed'])
    expect(amounts(evaluateCrisis(1, W(PLAGUE_LAND, { prosperity: 20, knowledge: 30, vitality: 25 }, [])))).toEqual([[35, 8, 0, 0], [30, 12, 6, 0, 0], 43, 48, 'survived'])
  })

  // 3 mountains, 2 plains, 1 desert, 1 coast, 5 forest
  const INVASION_LAND: Terrain[] = ['mountains', 'mountains', 'mountains', 'plains', 'plains', 'desert', 'coast', 'forest', 'forest', 'forest', 'forest', 'forest']
  it('Invasion: 43 + 1 per open region + development ÷ 4 + Prosperity over Industry vs Industry + 5 per civilization + 3 per mountain + 2 per forest + 10 for Empire Builders', () => {
    const civs = [civ('empireBuilders', 0, 0), civ('nomads', 3, 1), civ('merchants', 4, 2), civ('natureKeepers', 7, 3)]
    const w = (vitality: number, prosperity: number, industry: number, knowledge: number, eraScore = 0) =>
      evaluateCrisis(2, W(INVASION_LAND, { vitality, prosperity, industry, knowledge }, civs, eraScore))
    expect(amounts(w(60, 55, 70, 52))).toEqual([[43, 4, 59, 0], [70, 20, 9, 10, 10, 0], 106, 119, 'survived'])
    // wealth without walls: Prosperity above Industry, and the extra development draws raiders too
    expect(amounts(w(60, 90, 70, 52))).toEqual([[43, 4, 68, 20], [70, 20, 9, 10, 10, 0], 135, 119, 'failed'])
    // a broad world is not safe: all 60s, no Empire Builders, no mountains (forests in their place)
    const broad = evaluateCrisis(2, W(EVEN.map((t): Terrain => (t === 'mountains' ? 'forest' : t)), { vitality: 60, prosperity: 60, industry: 60, knowledge: 60 }, civs.slice(1)))
    expect([broad.pressure, broad.resilience, broad.result]).toEqual([43 + 6 + 60, 60 + 15 + 12, 'failed'])
    // Industry always pays: +1 arms against at most +1/4 riches
    const m = (e: CrisisEvaluation) => e.resilience - e.pressure
    expect(m(w(60, 55, 80, 52)) - m(w(60, 55, 70, 52))).toBe(10 - 2) // development 237 → 247: riches 59 → 61
  })

  it('terrain alone can decide a crisis', () => {
    const stats = { vitality: 15, prosperity: 15 }, civs = [civ('nomads', 0, 0)]
    expect(evaluateCrisis(0, W('forest', stats, civs)).result).toBe('survived') // 15 vs 15 + 24 + 8
    expect(evaluateCrisis(0, W('tundra', stats, civs)).result).toBe('failed') // 39 vs 23
  })

  it('the stat distribution alone can decide a crisis: same development, different balance', () => {
    expect(amounts(evaluateCrisis(0, W(EVEN, { vitality: 20, industry: 10 })))).toEqual([[15, 6, 0], [20, 6, 0, 0, 0], 21, 26, 'survived'])
    expect(amounts(evaluateCrisis(0, W(EVEN, { vitality: 10, industry: 20 })))).toEqual([[15, 6, 10], [10, 6, 0, 0, 0], 31, 16, 'failed'])
  })

  it('civilizations alone can decide a crisis: Merchants spread the plague, Scholars contain it', () => {
    const stats = { vitality: 30, prosperity: 30, knowledge: 25 }
    expect(amounts(evaluateCrisis(1, W(EVEN, stats, [civ('merchants', 9, 0)])))).toEqual([[35, 6, 5, 10], [25, 15, 6, 0, 0], 56, 46, 'failed'])
    expect(amounts(evaluateCrisis(1, W(EVEN, stats, [civ('scholars', 6, 0)])))).toEqual([[35, 6, 5, 0], [25, 15, 6, 10, 0], 46, 56, 'survived'])
    const inv = (n: number) => evaluateCrisis(2, W(EVEN, { vitality: 50, prosperity: 50, industry: 50, knowledge: 50 }, ARCHETYPE_ORDER.slice(0, n).map((a, i) => civ(a, i, i))))
    expect(inv(4).resilience - inv(3).resilience).toBe(5 + 10) // the 4th is Empire Builders
  })

  it("score alone can decide a crisis: the same world survives with this era's reserves", () => {
    const w = (eraScore: number) => evaluateCrisis(0, W(WINTER_LAND, { vitality: 17, industry: 25 }, [civ('nomads', 8, 0)], eraScore)).result
    expect([w(0), w(299), w(300)]).toEqual(['failed', 'failed', 'survived'])
  })

  it('the same seed, played differently, meets different fates', () => {
    const fate = (bot: (s: AscensionState) => AscensionAction, seed: string) => { const s = last(drive(seed, bot)); return [runStatus(s), ...outcomes(s)] }
    expect(fate(balancedBot, 'crisis-0')).toEqual(['complete', 'winter:survived', 'plague:survived', 'invasion:survived'])
    expect(fate(suitBot(['C', 'S']), 'crisis-0')).toEqual(['failed', 'winter:failed']) // Industry without Vitality: cleared forests
    // with the card budget, trade without medicine no longer even reaches the Plague: Ancient lapses
    const hd = last(drive('crisis-0', suitBot(['H', 'D'])))
    expect([runStatus(hd), hd.lapsed, hd.era, outcomes(hd)]).toEqual(['failed', true, 1, ['winter:survived']])
  })

  it('the outcome follows from the world alone: no randomness, and the seed does not matter', () => {
    const w = W(WINTER_LAND, { vitality: 18, industry: 25 }, [civ('nomads', 8, 0)])
    expect(evaluateCrisis(0, w)).toEqual(evaluateCrisis(0, w))
    for (const seed of ['a', 'b', 'c']) expect(evaluateCrisis(0, { ...newAscensionGame(seed), ...w })).toEqual(evaluateCrisis(0, w))
    const frozen = deepFreeze(at(0, { vitality: 18, industry: 25 }, [civ('nomads', 8, 0)], WINTER_LAND))
    expect(applyAscensionAction(frozen, { type: 'resolve' }).crises[0]).toEqual({ ...evaluateCrisis(0, crisisWorld(frozen)), round: 0, faced: 1 })
  })

  it('a crisis cannot be skipped: the era never advances without facing it', () => {
    const s = at(0, { vitality: 99, prosperity: 99, industry: 99, knowledge: 99 }, [civ('nomads', 8, 0), civ('scholars', 9, 1)], WINTER_LAND)
    let t: AscensionState = { ...s, crisis: null, playsLeft: 1 }
    for (let r = 0; r < 200 && runStatus(t) !== 'crisis'; r++) t = applyAscensionAction(t, { type: 'play', cards: [0] })
    expect([runStatus(t), t.era, t.crises, t.budget]).toEqual(['crisis', 0, [], 0]) // ready, then struck when the cards ran out; never skipped
  })

  it('a crisis resolves once: resolving with none ready is refused, and a faced crisis never returns', () => {
    expect(() => applyAscensionAction(newAscensionGame('no-crisis'), { type: 'resolve' })).toThrow('no crisis to resolve')
    const s = applyAscensionAction(at(0, { vitality: 18, industry: 25 }, [civ('nomads', 8, 0)], WINTER_LAND), { type: 'resolve' })
    expect([runStatus(s), s.era, s.crises.length]).toEqual(['playing', 1, 1])
    expect(() => applyAscensionAction(s, { type: 'resolve' })).toThrow('no crisis to resolve')
    // the next round end with requirements met brings the NEXT era's crisis
    const next = applyAscensionAction({ ...s, stats: { vitality: 40, prosperity: 40, industry: 40, knowledge: 40 }, civilizations: [civ('nomads', 8, 0), civ('scholars', 9, 1)], playsLeft: 1 }, { type: 'play', cards: [0] })
    expect(runStatus(next)).toBe('ready')
    expect(evaluateCrisis(next.era, crisisWorld(next)).crisis).toBe('plague')
  })

  it('failure ends the run and keeps the world for inspection', () => {
    const struck = at(0, { vitality: 17, industry: 25 }, [civ('nomads', 8, 0)], WINTER_LAND)
    const s = deepFreeze(applyAscensionAction(struck, { type: 'resolve' }))
    expect([runStatus(s), s.era, s.eraLog, s.crisis]).toEqual(['failed', 0, [], null])
    expect(s.crises).toEqual([{ ...evaluateCrisis(0, crisisWorld(struck)), round: 0, faced: 1 }])
    expect(last(s.crises)).toMatchObject({ result: 'failed', pressure: 33, resilience: 31 })
    const snap = JSON.stringify(s)
    for (const a of [{ type: 'play', cards: [0] }, { type: 'discard', cards: [0] }, { type: 'resolve' }] as AscensionAction[]) {
      expect(() => applyAscensionAction(s, a)).toThrow('run over: Harsh Winter failed')
    }
    expect(() => evaluatePlay(s, [0])).toThrow('run over')
    expect(JSON.stringify(s)).toBe(snap)
    expect([s.regions, s.stats, s.civilizations, s.score, s.hand]).toEqual([struck.regions, struck.stats, struck.civilizations, struck.score, struck.hand])
    expectConserved(s)
    const run = drive('crisis-0', suitBot(['C', 'S']))
    expect(runStatus(last(run))).toBe('failed')
    expect(last(run).regions).toEqual(run[0].regions)
  })

  it("the round-end projection the UI shows is exactly what the round's last play commits", () => {
    let checked = 0, withCiv = 0, readied = 0 // forced strikes: see "kept waiting, a crisis gathers" 
    for (const seed of ['project-0', 'project-1', 'project-2', 'project-3', 'project-4', 'project-5', 'project-6', 'project-7']) {
      let s = newAscensionGame(seed)
      for (const a of mixedActions(seed, 900)) {
        if (a.type === 'play' && s.playsLeft === 1) {
          const p = evaluatePlay(s, a.cards)
          const proj = projectRoundEnd(s, Object.fromEntries(WORLD_STATS.map((k) => [k, s.stats[k] + p.statDeltas[k]])) as WorldStats, s.score + p.score, s.budget - actionCost(a))
          const next = applyAscensionAction(s, a)
          expect(next.civilizations).toEqual(proj.civ ? [...s.civilizations, proj.civ] : s.civilizations)
          expect([next.crisis !== null, runStatus(next) === 'crisis', next.lapsed]).toEqual([proj.ready, proj.forced, proj.lapses])
          if (proj.ready) expect(evaluateCrisis(next.era, crisisWorld(next))).toEqual(proj.crisis)
          checked += 1; if (proj.civ) withCiv += 1; if (proj.ready && !s.crisis) readied += 1
          s = next
        } else s = applyAscensionAction(s, a)
      }
    }
    expect([checked > 40, withCiv > 5, readied >= 4]).toEqual([true, true, true])
  })

  it('projecting the round end changes nothing, and with no stats given it uses the world as it stands', () => {
    const s = deepFreeze(newAscensionGame('project-pure'))
    expect(projectRoundEnd(s)).toEqual(projectRoundEnd(s, s.stats, s.score))
    expect(projectRoundEnd(s)).toMatchObject({ civ: null, ready: false, forced: false })
    const rich = { ...noStats(), vitality: 20, prosperity: 20 }
    expect(projectRoundEnd(s, rich).civ).not.toBeNull()
    expect(projectRoundEnd(s, rich)).toMatchObject({ ready: true, forced: false })
  })
})

describe('Ascension era budget (scarcity)', () => {
  const HAND = [C(2, 'H'), C(3, 'D'), C(4, 'C'), C(5, 'S'), C(6, 'H'), C(7, 'D'), C(8, 'C'), C(9, 'S')]
  /** a conserved Tribal state with this hand, stats, civilizations and budget left */
  const game = (o: { stats?: Partial<WorldStats>; civs?: Civilization[]; budget: number; playsLeft?: number; hand?: Card[] }): AscensionState => ({
    ...withHand(o.hand ?? HAND), regions: land(EVEN), stats: { ...noStats(), ...o.stats }, civilizations: o.civs ?? [], budget: o.budget, playsLeft: o.playsLeft ?? 4,
  })
  const play = (s: AscensionState, cards: number[]) => applyAscensionAction(s, { type: 'play', cards })

  it('each era grants its cards: a card played costs 1, a discard 2, facing a crisis nothing', () => {
    expect(ERA_BUDGET).toEqual({ unit: 'cards', perEra: [70, 70, 90], discardCost: 2, carryOver: true })
    let s = newAscensionGame('budget-accounting')
    expect(s.budget).toBe(70)
    s = play(s, [0, 1, 2])
    expect(s.budget).toBe(67)
    s = applyAscensionAction(s, { type: 'discard', cards: [0, 1, 2, 3, 4] })
    expect(s.budget).toBe(65) // a discard costs 2 however many cards it throws away
    expect([actionCost({ type: 'play', cards: [0] }), actionCost({ type: 'play', cards: [0, 1, 2, 3, 4] }), actionCost({ type: 'discard', cards: [0] }), actionCost({ type: 'resolve' })]).toEqual([1, 5, 2, 0])
  })

  it('the budget cannot be exceeded, and a refused action changes nothing', () => {
    const s = deepFreeze(game({ budget: 2 }))
    const snap = JSON.stringify(s)
    expect(() => play(s, [0, 1, 2])).toThrow('not enough cards left: this costs 3, 2 left')
    expect(() => applyAscensionAction(game({ budget: 1 }), { type: 'discard', cards: [0] })).toThrow('not enough cards left: this costs 2, 1 left')
    expect(JSON.stringify(s)).toBe(snap)
    expect(play(s, [0, 1]).budget).toBe(0) // exactly the budget is allowed
  })

  it('the last card ends the era: the crisis strikes if the requirements hold, otherwise the era lapses and the run is over', () => {
    const met = play(game({ stats: { vitality: 20, prosperity: 20 }, civs: [civ('nomads', 6, 0)], budget: 2 }), [0, 1])
    expect([met.budget, met.round, runStatus(met), met.lapsed]).toEqual([0, 1, 'crisis', false]) // mid-round: no round end needed
    const short = play(game({ stats: { vitality: 13, prosperity: 15 }, civs: [civ('nomads', 6, 0)], budget: 1 }), [0]) // Vitality 14: one short
    expect([short.budget, runStatus(short), short.lapsed, short.crises]).toEqual([0, 'failed', true, []])
    for (const a of [{ type: 'play', cards: [0] }, { type: 'discard', cards: [0] }, { type: 'resolve' }] as AscensionAction[]) {
      expect(() => applyAscensionAction(short, a)).toThrow('run over: the Tribal era ran out of cards')
    }
    expect(() => evaluatePlay(short, [0])).toThrow('ran out of cards')
    expect([short.regions, short.stats.vitality, short.civilizations.length]).toEqual([land(EVEN), 14, 1]) // the world is kept
    expectConserved(short)
  })

  it('a discard can spend the era out too', () => {
    const s = applyAscensionAction(game({ stats: { vitality: 20, prosperity: 20 }, civs: [civ('nomads', 6, 0)], budget: 2 }), { type: 'discard', cards: [0] })
    expect([s.budget, runStatus(s)]).toEqual([0, 'crisis'])
  })

  it('facing a ready crisis early carries the unspent cards into the next era', () => {
    let s = game({ stats: { vitality: 30, prosperity: 20 }, civs: [civ('nomads', 6, 0)], budget: 50, playsLeft: 1 })
    s = play(s, [0]) // round end: ready, 49 left
    expect([runStatus(s), s.budget]).toEqual(['ready', 49])
    s = applyAscensionAction(s, { type: 'resolve' })
    expect([s.era, s.budget]).toEqual([1, 49 + 70])
  })

  it('the requirement shortfall says how many cards are spoken for', () => {
    expect(requirementShortfall(0, { vitality: 10, prosperity: 14, industry: 0, knowledge: 0 })).toBe(5 + 1)
    expect(requirementShortfall(2, { vitality: 90, prosperity: 40, industry: 40, knowledge: 0 })).toBe(30) // development 170 of 200
    expect(requirementShortfall(2, { vitality: 80, prosperity: 60, industry: 30, knowledge: 35 })).toBe(5) // a third stat at 40: Knowledge is 5 short
    expect(requirementShortfall(3, noStats())).toBe(0)
  })

  it('hand size is a choice: a strong pair earns more per card, five cards more per play', () => {
    const s = game({ budget: 70, hand: [C(14, 'S'), C(14, 'H'), C(2, 'D'), C(3, 'C'), C(5, 'S'), C(7, 'D'), C(9, 'C'), C(4, 'H')] })
    const pair = evaluatePlay(s, [0, 1]), five = evaluatePlay(s, [0, 1, 4, 5, 6]) // A♠ A♥ vs A♠ A♥ 5♠ 7♦ 9♣
    expect(five.score).toBeGreaterThan(pair.score)
    expect(pair.score / 2).toBeGreaterThan(five.score / 5)
  })

  /** A focused player who reads the forecast and spends cards only on what it wants: its main suit, what the
   *  requirements need when the budget is tight, the crisis's best stat while it would be lost; faces when safe. */
  const focused = (main: Card['s']) => (s: AscensionState): AscensionAction => {
    const margin = (st: WorldStats) => { const e = evaluateCrisis(s.era, crisisWorld(s, st)); return e.resilience - e.pressure }
    if (runStatus(s) === 'ready' && margin(s.stats) >= 0) return { type: 'resolve' }
    const min = ERAS[s.era].needs.min
    const needy = requirementShortfall(s.era, s.stats) * 1.2 >= s.budget
    const help = WORLD_STATS.map((k) => [k, margin({ ...s.stats, [k]: s.stats[k] + 1 })] as const).sort((a, b) => b[1] - a[1])[0][0]
    const rank = (k: WorldStat) => (margin(s.stats) < 0 ? (k === help ? 0 : k === SUIT_STAT[main] ? 1 : 2)
      : needy ? (s.stats[k] < min ? 0 : k === SUIT_STAT[main] ? 1 : 2) : k === SUIT_STAT[main] ? 0 : s.stats[k] < min ? 1 : 2)
    const idx = s.hand.map((_, j) => j).sort((a, b) => rank(SUIT_STAT[s.hand[a].s]) - rank(SUIT_STAT[s.hand[b].s]) || a - b).slice(0, Math.min(5, s.budget))
    const wanted = idx.filter((j) => rank(SUIT_STAT[s.hand[j].s]) <= 1)
    return { type: 'play', cards: wanted.length ? wanted : idx.slice(0, 1) }
  }
  it('focused worlds complete under the budget too (and by playing fewer cards)', () => {
    const cases: [Card['s'], WorldStats][] = [
      ['H', { vitality: 68, prosperity: 44, industry: 46, knowledge: 42 }],
      ['C', { vitality: 45, prosperity: 40, industry: 76, knowledge: 44 }],
      ['S', { vitality: 43, prosperity: 45, industry: 43, knowledge: 73 }],
    ]
    for (const [suit, stats] of cases) {
      const run = drive('focus-0', focused(suit))
      const done = last(run)
      expect([runStatus(done), done.stats]).toEqual(['complete', stats])
      const plays = run.slice(1).map((s, i) => s.lastPlay !== run[i].lastPlay ? s.lastPlay!.cards.length : null).filter((n): n is number => n !== null)
      expect(plays.reduce((a, b) => a + b, 0) / plays.length).toBeLessThan(4)
    }
    expect(runStatus(last(drive('crisis-0', balancedBot)))).toBe('complete')
  })

  it('budget transitions never mutate their input, and replay deterministically', () => {
    const actions = mixedActions('budget-det', 600)
    expect(replay('budget-det', actions)).toEqual(replay('budget-det', actions))
    let s = deepFreeze(newAscensionGame('budget-det'))
    for (const a of actions) s = deepFreeze(applyAscensionAction(s, a))
    expect(s).toEqual(replay('budget-det', actions))
  })
})
