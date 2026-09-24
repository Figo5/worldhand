// Ascension (rules v10): engine contracts. Determinism, replay, preview ==
// commit, card conservation, the era/crisis/Council loop, graded crises,
// content validity, legendaries and Omens.
import { describe, it, expect } from 'vitest'
import {
  newRun, applyAction, replay, runStatus, forecast, ownedCards, eraEndInfluence, treasury, isTriumph,
  ASCENSION_RULES_VERSION, MIN_DECK, TRIUMPH_BONUS, FAIL_INFLUENCE, HAND_INFLUENCE,
} from '../src/engine/ascension/ascension'
import { evaluatePlay, evaluateDiscard, classify, scoringPositions, HAND_TABLE, cardChips, LAND_CHIPS } from '../src/engine/ascension/scoring'
import { ERAS, FINAL_ERA } from '../src/engine/ascension/eras'
import { CRISIS_ORDER, evaluateCrisis, type CrisisMods } from '../src/engine/ascension/crises'
import { WORLD_CARDS, DECREES, CARD_BY_ID, DECREE_BY_ID, CONTENT_VERSION } from '../src/engine/ascension/content'
import { LEGENDARIES, LEGENDARY_ORDER } from '../src/engine/ascension/legendaries'
import { ARCHETYPES, ARCHETYPE_ORDER, relationOf, relations, emergenceThreshold, grownTier, TIER_GROWTH, type Civilization } from '../src/engine/ascension/civilizations'
import { OMENS, runMods, startingResolve, OPPOSITE, borders } from '../src/engine/ascension/rules'
import { FULL_POOL, STARTER_POOL } from '../src/engine/ascension/pool'
import { generateRegions, landAffinity, NATURAL_TERRAINS, TERRAIN, REGION_ADJACENCY, ORIGIN_ORDER, WORLD_STATS, noStats, type Terrain } from '../src/engine/ascension/world'
import { describe as describeEvent, chronicleByEra } from '../src/engine/ascension/chronicle'
import { marketOffers, legendaryChoice, LEGENDARY_PICK_AFTER, LEGENDARY_SALE_AFTER, REMOVE_PRICE, SELL_REFUND } from '../src/engine/ascension/council'
import type { AscensionAction, AscensionState, CardInst, RunSetup, LegendaryId } from '../src/engine/ascension/state'
import { hashSeed } from '../src/engine/rng'
import type { Card, Rank, Suit } from '../src/engine/poker'

const setup = (seedText = 'test-world', o: Partial<RunSetup> = {}): RunSetup => ({ seedText, omen: 0, origin: 'pangaea', pool: FULL_POOL, ...o })
const C = (r: Rank, s: Suit): Card => ({ r, s })
const inst = (r: Rank, s: Suit, id = 1000 + r * 4 + 'SHDC'.indexOf(s), kind: string | null = null): CardInst => ({ id, r, s, kind, bonus: 0 })
const noMods = { wildSuit: null, straightWrap: false, straightGap: false }
/** A state whose hand is exactly `hand` (the rest of the deck untouched; conservation kept by swapping). */
function withHand(s: AscensionState, hand: CardInst[]): AscensionState {
  const t = structuredClone(s)
  const all = ownedCards(t).filter((c) => !hand.some((h) => h.id === c.id))
  t.hand = hand.map((h) => ({ ...h }))
  t.drawPile = all
  t.discardPile = []
  return t
}
const play = (s: AscensionState, cards: number[]) => applyAction(s, { type: 'play', cards })
const face = (s: AscensionState) => applyAction(s, { type: 'face' })
const leave = (s: AscensionState) => applyAction(s, { type: 'leave' })
/** Play the first card until the hands run out. */
const spendHands = (s: AscensionState) => { let t = s; while (runStatus(t) === 'playing') t = play(t, [0]); return t }
/** A deterministic scripted run: each era, play the best-scoring single pair-or-more greedily, face at the end, leave every Council. */
function scripted(seedText: string, o: Partial<RunSetup> = {}) {
  const actions: AscensionAction[] = []
  let s = newRun(setup(seedText, o))
  const go = (a: AscensionAction) => { actions.push(a); s = applyAction(s, a) }
  for (let guard = 0; guard < 500 && s.phase !== 'won' && s.phase !== 'lost'; guard++) {
    const st = runStatus(s)
    if (st === 'council') {
      if (s.council!.legendaryChoice) go({ type: 'legendary', pick: 0 })
      else {
        const i = s.council!.offers.findIndex((x) => !x.sold && x.kind === 'card' && x.price <= s.influence)
        go(i >= 0 ? { type: 'buy', offer: i } : { type: 'leave' })
      }
    } else if (st === 'crisis') go({ type: 'face' })
    else {
      let best: number[] = [0], v = -1
      for (let m = 1; m < 256; m++) {
        const idx = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => m & (1 << i))
        if (idx.length > 5 || idx.some((i) => i >= s.hand.length)) continue
        const r = evaluatePlay(s, idx)
        if (r.score > v) { v = r.score; best = idx }
      }
      if (s.discardsLeft > 0 && v < 40) go({ type: 'discard', cards: [0, 1] })
      else go({ type: 'play', cards: best })
    }
  }
  return { s, actions }
}
const deepFreeze = <T,>(o: T): T => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v) } return o }
const mods = (o: Partial<CrisisMods> = {}): CrisisMods => ({ reserveRate: 100, pressurePct: 0, strainPct: 0, allyResilience: 3, rivalPressure: 5, rivalsEverywhere: false, extraPressures: [], extraMitigations: [], ...o })

describe('Ascension v10: a new run', () => {
  it('is rules version 10 with the documented opening', () => {
    const s = newRun(setup())
    expect(ASCENSION_RULES_VERSION).toBe(10)
    expect(s.rulesVersion).toBe(10)
    expect(s.phase).toBe('play')
    expect(s.era).toBe(0)
    expect(s.handsLeft).toBe(ERAS[0].hands)
    expect(s.discardsLeft).toBe(ERAS[0].discards)
    expect(s.hand).toHaveLength(8)
    expect(ownedCards(s)).toHaveLength(52)
    expect(s.resolve).toBe(3)
    expect(s.influence).toBe(0)
    expect(s.crisisTrack).toHaveLength(ERAS.length)
    s.crisisTrack.forEach((id, i) => expect(ERAS[i].pool).toContain(id))
    expect(s.chronicle[0].t).toBe('genesis')
  })

  it('same seed and actions → the same run; a different seed deals a different world', () => {
    const a = scripted('determinism-1'), b = scripted('determinism-1'), c = newRun(setup('determinism-2'))
    expect(b.s).toEqual(a.s)
    expect(b.actions).toEqual(a.actions)
    const x = newRun(setup('determinism-1'))
    expect(c.hand.map((h) => h.id)).not.toEqual(x.hand.map((h) => h.id))
  })

  it('replay(setup, actions) rebuilds the exact state, and names an illegal action', () => {
    for (const seed of ['replay-a', 'replay-b', 'replay-c']) {
      const { s, actions } = scripted(seed)
      expect(replay(setup(seed), actions)).toEqual(s)
    }
    expect(() => replay(setup('replay-a'), [{ type: 'leave' }])).toThrow(/action 1 \(leave\)/)
  })

  it('validates its setup', () => {
    expect(() => newRun(setup(''))).toThrow(/seed/)
    expect(() => newRun(setup('x', { omen: 9 }))).toThrow(/omen/)
    expect(() => newRun(setup('x', { origin: 'mars' as never }))).toThrow(/origin/)
    expect(() => newRun(setup('x', { pool: { ...FULL_POOL, cards: ['nope'] } }))).toThrow(/unknown card/)
    expect(() => newRun(setup('x', { pool: { ...FULL_POOL, legendaries: ['nope' as LegendaryId] } }))).toThrow(/unknown legendary/)
  })

  it('terrain depends only on (seed, region, origin); origins shift the land', () => {
    const seed = hashSeed('land')
    const a = generateRegions(seed), b = generateRegions(seed)
    expect(b).toEqual(a)
    a.forEach((r, i) => expect(r.neighbors).toEqual(REGION_ADJACENCY[i]))
    // over many seeds, an origin's favoured terrain appears more often
    const count = (origin: typeof ORIGIN_ORDER[number], t: Terrain) => Array.from({ length: 200 }, (_, i) => generateRegions(hashSeed(`o${i}`), origin).filter((r) => r.terrain === t).length).reduce((x, y) => x + y, 0)
    expect(count('archipelago', 'coast')).toBeGreaterThan(count('pangaea', 'coast') * 2)
    expect(count('highlands', 'mountains')).toBeGreaterThan(count('pangaea', 'mountains'))
    expect(count('highlands', 'coast')).toBe(0)
    expect(count('verdant', 'desert')).toBe(0)
  })
})

describe('Ascension v10: hands and scoring', () => {
  it('classifies hands (only five cards make Straights and Flushes)', () => {
    expect(classify([C(2, 'H')], noMods)).toBe('high')
    expect(classify([C(9, 'H'), C(9, 'S')], noMods)).toBe('pair')
    expect(classify([C(9, 'H'), C(9, 'S'), C(4, 'D'), C(4, 'C')], noMods)).toBe('two-pair')
    expect(classify([C(9, 'H'), C(9, 'S'), C(9, 'D')], noMods)).toBe('trips')
    expect(classify([C(2, 'H'), C(3, 'S'), C(4, 'D'), C(5, 'C'), C(6, 'H')], noMods)).toBe('straight')
    expect(classify([C(14, 'H'), C(2, 'S'), C(3, 'D'), C(4, 'C'), C(5, 'H')], noMods)).toBe('straight')
    expect(classify([C(2, 'H'), C(7, 'H'), C(4, 'H'), C(9, 'H'), C(11, 'H')], noMods)).toBe('flush')
    expect(classify([C(2, 'H'), C(2, 'S'), C(2, 'D'), C(9, 'C'), C(9, 'H')], noMods)).toBe('full-house')
    expect(classify([C(2, 'H'), C(2, 'S'), C(2, 'D'), C(2, 'C')], noMods)).toBe('quads')
    expect(classify([C(5, 'S'), C(6, 'S'), C(7, 'S'), C(8, 'S'), C(9, 'S')], noMods)).toBe('straight-flush')
    expect(classify([C(2, 'H'), C(7, 'H'), C(4, 'H'), C(9, 'H')], noMods)).toBe('high')
    // Q-K-A-2-3 wraps only with the Architect Moon; a one-rank gap likewise
    expect(classify([C(12, 'H'), C(13, 'S'), C(14, 'D'), C(2, 'C'), C(3, 'H')], noMods)).toBe('high')
    expect(classify([C(12, 'H'), C(13, 'S'), C(14, 'D'), C(2, 'C'), C(3, 'H')], { ...noMods, straightWrap: true })).toBe('straight')
    expect(classify([C(2, 'H'), C(3, 'S'), C(4, 'D'), C(5, 'C'), C(7, 'H')], noMods)).toBe('high')
    expect(classify([C(2, 'H'), C(3, 'S'), C(4, 'D'), C(5, 'C'), C(7, 'H')], { ...noMods, straightGap: true })).toBe('straight')
    expect(classify([C(2, 'H'), C(3, 'S'), C(4, 'D'), C(5, 'C'), C(8, 'H')], { ...noMods, straightGap: true })).toBe('high')
    // the World Tree: hearts are wild for Flushes
    expect(classify([C(2, 'S'), C(7, 'S'), C(4, 'H'), C(9, 'S'), C(11, 'H')], noMods)).toBe('high')
    expect(classify([C(2, 'S'), C(7, 'S'), C(4, 'H'), C(9, 'S'), C(11, 'H')], { ...noMods, wildSuit: 'H' })).toBe('flush')
    expect(classify([C(2, 'S'), C(7, 'S'), C(4, 'H'), C(9, 'H'), C(11, 'H')], { ...noMods, wildSuit: 'H' })).toBe('high') // only two natural cards
    expect(classify([C(2, 'H'), C(7, 'H'), C(4, 'H'), C(9, 'H'), C(11, 'H')], { ...noMods, wildSuit: 'H' })).toBe('flush')

  })

  it('only the cards that make the hand score', () => {
    expect(scoringPositions([C(9, 'H'), C(9, 'S'), C(4, 'D')], 'pair')).toEqual([0, 1])
    expect(scoringPositions([C(3, 'H'), C(13, 'S'), C(4, 'D')], 'high')).toEqual([1])
    expect(scoringPositions([C(9, 'H'), C(9, 'S'), C(4, 'D'), C(4, 'C'), C(2, 'C')], 'two-pair')).toEqual([0, 1, 2, 3])
    expect(scoringPositions([C(2, 'H'), C(2, 'S'), C(2, 'D'), C(2, 'C'), C(5, 'C')], 'quads')).toEqual([0, 1, 2, 3])
    expect(scoringPositions([C(2, 'H'), C(7, 'H'), C(4, 'H'), C(9, 'H'), C(11, 'H')], 'flush')).toEqual([0, 1, 2, 3, 4])
  })

  it('a pair: base + card values + land, stats from scoring cards only (with the Tribal rule)', () => {
    let s = newRun(setup('score-pair'))
    s = withHand(s, [inst(9, 'H'), inst(9, 'C'), inst(2, 'S'), inst(4, 'D'), inst(5, 'D'), inst(6, 'D'), inst(7, 'D'), inst(8, 'D')])
    const r = evaluatePlay(s, [0, 1, 2])
    const aff = landAffinity(s.regions)
    expect(r.category).toBe('pair')
    expect(r.scoring).toEqual([0, 1])
    expect(r.chips).toBe(HAND_TABLE.pair.chips + 18 + LAND_CHIPS * (aff.vitality + aff.industry))
    expect(r.mult).toBe(HAND_TABLE.pair.mult)
    // Hunters and Gatherers: a pair gives its stats again
    expect(r.statDeltas).toEqual({ vitality: 2, prosperity: 0, industry: 2, knowledge: 0 })
    expect(r.score).toBe(Math.floor(r.chips * r.mult))
    expect(cardChips(14)).toBe(11)
    expect(cardChips(12)).toBe(10)
  })

  it('preview == commit: the play result is exactly what the play does', () => {
    let s = newRun(setup('preview-commit'))
    for (let i = 0; i < 25 && s.phase !== 'won' && s.phase !== 'lost'; i++) {
      if (runStatus(s) === 'council') { s = leave(s); continue }
      if (runStatus(s) === 'crisis') { s = face(s); continue }
      const idx = [0, 1, 2, 3, 4].slice(0, 1 + (i % 5))
      const r = evaluatePlay(s, idx)
      const f = forecast(s)
      const t = play(s, idx)
      expect(t.lastPlay).toEqual(r)
      expect(t.score - s.score).toBe(r.score)
      for (const k of WORLD_STATS) expect(t.stats[k] - s.stats[k]).toBe(r.statDeltas[k])
      expect(t.eraReserves - s.eraReserves).toBe(r.reserves)
      expect(forecast(s)).toEqual(f) // previewing changed nothing
      s = t
    }
  })

  it('illegal actions throw and never change the input state', () => {
    const s = deepFreeze(newRun(setup('illegal')))
    expect(() => play(s, [])).toThrow(/select 1–5/)
    expect(() => play(s, [0, 1, 2, 3, 4, 5])).toThrow(/select 1–5/)
    expect(() => play(s, [0, 0])).toThrow(/twice/)
    expect(() => play(s, [9])).toThrow(/no card/)
    expect(() => applyAction(s, { type: 'leave' })).toThrow(/Council is not in session/)
    expect(() => applyAction(s, { type: 'bogus' } as never)).toThrow(/unknown action/)
    // a legal play still works on the frozen state (transitions never mutate)
    expect(play(s, [0]).handsLeft).toBe(s.handsLeft - 1)
    const spent = spendHands(newRun(setup('illegal')))
    expect(() => play(spent, [0])).toThrow(/face the crisis/)
    let d = newRun(setup('illegal'))
    for (let i = 0; i < ERAS[0].discards; i++) d = applyAction(d, { type: 'discard', cards: [0] })
    expect(() => applyAction(d, { type: 'discard', cards: [0] })).toThrow(/no discards/)
  })

  it('conserves cards through plays, discards, reshuffles, eras and the Council', () => {
    const { s, actions } = scripted('conservation')
    let t = newRun(setup('conservation'))
    let owned = 52
    for (const a of actions) {
      const before = t
      t = applyAction(t, a)
      if (a.type === 'buy' && before.council!.offers[a.offer].kind === 'card') owned += 1
      const ids = ownedCards(t).map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).toHaveLength(owned)
      expect(t.hand.length).toBeLessThanOrEqual(8)
      for (const k of WORLD_STATS) expect(Number.isInteger(t.stats[k]) && t.stats[k] >= 0).toBe(true)
      expect(Number.isFinite(t.score)).toBe(true)
    }
    expect(t).toEqual(s)
  })
})

describe('Ascension v10: eras, crises and graded outcomes', () => {
  it('six eras of rising hands, each ending in a crisis from its pool', () => {
    expect(ERAS.map((e) => e.id)).toEqual(['tribal', 'ancient', 'medieval', 'industrial', 'information', 'stellar'])
    for (let i = 1; i < ERAS.length; i++) {
      expect(ERAS[i].hands).toBeGreaterThanOrEqual(ERAS[i - 1].hands)
      expect(ERAS[i].reserveRate).toBeGreaterThan(ERAS[i - 1].reserveRate)
    }
    expect(new Set(ERAS.flatMap((e) => e.pool)).size).toBe(CRISIS_ORDER.length)
    expect(new Set(ERAS.map((e) => e.rule)).size).toBe(ERAS.length)
  })

  it('the forecast is the exact result of facing', () => {
    let s = spendHands(newRun(setup('forecast')))
    const f = forecast(s)
    s = face(s)
    const { era, handsLeft, triumph, prevented, influence, scars, ...ev } = s.crises[0]
    void era; void handsLeft; void triumph; void prevented; void influence; void scars
    expect({ ...ev, result: f.result }).toEqual(f)
  })

  it('facing with hands left banks them as Influence; the hands running out forces the crisis', () => {
    const s = newRun(setup('early'))
    const early = face(s)
    const out = early.crises[0]
    if (out.result === 'endured') expect(out.influence).toBe(eraEndInfluence(s) + (out.triumph ? TRIUMPH_BONUS : 0) + treasury(s))
    else expect(out.influence).toBe(FAIL_INFLUENCE)
    const spent = spendHands(s)
    expect(runStatus(spent)).toBe('crisis')
    expect(eraEndInfluence(spent)).toBe(eraEndInfluence(s) - HAND_INFLUENCE * ERAS[0].hands)
  })

  it('a failed crisis costs a Resolve and leaves its scar, but the run goes on', () => {
    const s0 = newRun(setup('scar'))
    const s = face(s0) // an undeveloped world fails its first crisis
    const out = s.crises[0]
    expect(out.result).toBe('failed')
    expect(s.resolve).toBe(2)
    expect(s.phase).toBe('council')
    expect(out.influence).toBe(FAIL_INFLUENCE)
    expect(s.chronicle.some((e) => e.t === 'crisis' && e.result === 'failed')).toBe(true)
  })

  it('Resolve 0 ends the run; the final crisis must be endured', () => {
    let s = newRun(setup('fall'))
    s = face(s); s = leave(s); s = face(s); s = leave(s); s = face(s)
    expect(s.resolve).toBe(0)
    expect(s.phase).toBe('lost')
    expect(s.chronicle[s.chronicle.length - 1]).toMatchObject({ t: 'end', result: 'lost' })
    expect(() => play(s, [0])).toThrow(/over/)
    expect(() => face(s)).toThrow(/over/)
    // a final crisis failed ends the run even with Resolve left
    const t = structuredClone(newRun(setup('final')))
    t.era = FINAL_ERA
    const f = face(t)
    expect(f.phase).toBe('lost')
    expect(f.resolve).toBe(2)
    // and endured, the world ascends
    const w = structuredClone(t)
    w.stats = { vitality: 500, prosperity: 500, industry: 500, knowledge: 500 }
    expect(face(w).phase).toBe('won')
  })

  it('every crisis is endured by a world strong in what it tests, and failed by an empty one', () => {
    const regions = generateRegions(hashSeed('crisis-land'))
    for (const id of CRISIS_ORDER) {
      const w = { regions, stats: noStats(), civilizations: [], relations: [], eraScore: 0, eraPressure: 0, eraReserves: 0 }
      expect(evaluateCrisis(id, w, mods()).result).toBe('failed')
      const strong = { ...w, stats: { vitality: 200, prosperity: 200, industry: 200, knowledge: 200 } }
      expect(evaluateCrisis(id, strong, mods()).result, id).toBe('endured')
      // reserves always help
      expect(evaluateCrisis(id, { ...w, eraScore: 10_000 }, mods()).resilience).toBeGreaterThan(evaluateCrisis(id, w, mods()).resilience)
    }
  })

  it('crisis math: strain, pressing omens, rivalries only in conflict crises, alliances everywhere', () => {
    const regions = generateRegions(hashSeed('crisis-math'))
    const w = { regions, stats: { vitality: 2, prosperity: 0, industry: 12, knowledge: 0 }, civilizations: [], relations: [{ a: 0, b: 1, relation: 'rival' as const }, { a: 0, b: 2, relation: 'ally' as const }], eraScore: 250, eraPressure: 4, eraReserves: 3 }
    const winter = evaluateCrisis('winter', w, mods())
    expect(winter.pressures.find((f) => f.label === 'Cleared forests')!.amount).toBe(20) // (12 − 2) × 2
    expect(winter.pressures.find((f) => f.label === 'Your own doing')!.amount).toBe(4)
    expect(winter.pressures.some((f) => f.label === 'Rivalries')).toBe(false)
    expect(winter.mitigations.find((f) => f.label === 'Alliances')!.amount).toBe(3)
    expect(winter.mitigations.find((f) => f.label === 'Reserves')!.amount).toBe(2 + 3) // 250 ÷ 100 + 3 banked
    const invasion = evaluateCrisis('invasion', w, mods())
    expect(invasion.pressures.find((f) => f.label === 'Rivalries')!.amount).toBe(5)
    const pressing = evaluateCrisis('winter', w, mods({ pressurePct: 10 }))
    expect(pressing.pressure).toBe(Math.ceil(winter.pressure * 1.1))
    const deep = evaluateCrisis('winter', w, mods({ strainPct: 50 }))
    expect(deep.pressures.find((f) => f.label === 'Cleared forests')!.amount).toBe(30)
    expect(isTriumph({ ...winter, result: 'endured', margin: Math.ceil(winter.pressure / 4) })).toBe(true)
  })
})

describe('Ascension v10: civilizations', () => {
  it('eight archetypes, each with a passive, homes and names; relations are symmetric', () => {
    expect(ARCHETYPE_ORDER).toHaveLength(8)
    for (const a of ARCHETYPE_ORDER) {
      const d = ARCHETYPES[a]
      expect(d.terrains.length).toBeGreaterThan(0)
      expect(d.passive.text(1)).not.toEqual(d.passive.text(2))
      for (const b of ARCHETYPE_ORDER) expect(relationOf(a, b)).toBe(relationOf(b, a))
    }
    expect(relationOf('natureKeepers', 'nomads')).toBe('ally')
    expect(relationOf('empireBuilders', 'nomads')).toBe('rival')
    expect(emergenceThreshold(0)).toBe(5)
    expect(emergenceThreshold(3)).toBe(20)
  })

  it('civilizations emerge from development, and grow a tier at the dawn of the right era', () => {
    const { s } = scripted('civs-grow')
    expect(s.civilizations.length + s.fallen.length).toBeGreaterThan(0)
    const civ: Civilization = { ...s.civilizations[0] ?? s.fallen[0], tier: 1, archetype: 'natureKeepers' }
    const rich = { vitality: 99, prosperity: 0, industry: 0, knowledge: 0 }
    expect(grownTier(civ, rich, 0)).toBe(1)
    expect(grownTier(civ, rich, TIER_GROWTH[0].fromEra)).toBe(2)
    expect(grownTier({ ...civ, tier: 2 }, rich, TIER_GROWTH[1].fromEra)).toBe(3)
    expect(grownTier(civ, { ...rich, vitality: 5 }, 5)).toBe(1)
  })

  it('relations follow borders (and the Architect Moon adds opposite borders)', () => {
    const regions = generateRegions(hashSeed('rel'))
    const civ = (id: number, home: number, archetype: Civilization['archetype']): Civilization => ({ id, archetype, name: `c${id}`, home, tier: 1, emergedEra: 0, emergedPlay: 0, reason: { stat: 'vitality', readiness: 0, needed: 0, terrain: 'forest', regionFit: 0 } })
    const pair = [civ(0, 0, 'natureKeepers'), civ(1, 1, 'nomads')] // 0 and 1 border
    expect(relations(pair, regions)).toEqual([{ a: 0, b: 1, relation: 'ally' }])
    const far = [civ(0, 0, 'natureKeepers'), civ(1, 4, 'nomads')] // 0 and 4 are opposite
    expect(relations(far, regions)).toEqual([])
    const s = newRun(setup('moon'))
    const m = runMods({ ...s, legendaries: [{ id: 'architectMoon', counter: 0, awake: false }] })
    expect(relations(far, borders(regions, m))).toEqual([{ a: 0, b: 1, relation: 'ally' }])
    OPPOSITE.forEach((o, i) => expect(OPPOSITE[o]).toBe(i))
  })
})

describe('Ascension v10: content', () => {
  it('world cards: 30–50, unique stable ids, valid cards, text and effects; decrees likewise', () => {
    expect(CONTENT_VERSION).toBeGreaterThanOrEqual(1)
    const n = WORLD_CARDS.length + DECREES.length
    expect(n).toBeGreaterThanOrEqual(30)
    expect(n).toBeLessThanOrEqual(55)
    const ids = [...WORLD_CARDS.map((c) => c.id), ...DECREES.map((d) => d.id)]
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of WORLD_CARDS) {
      expect(c.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(c.rank).toBeGreaterThanOrEqual(2)
      expect(c.rank).toBeLessThanOrEqual(14)
      expect('SHDC').toContain(c.suit)
      expect(c.text.length).toBeGreaterThan(8)
      expect(c.effects.length).toBeGreaterThan(0)
      expect(c.era).toBeGreaterThanOrEqual(0)
      expect(c.era).toBeLessThan(ERAS.length)
      for (const e of c.effects) for (const op of e.ops) {
        if ('per' in op && op.per?.per === 'terrain') for (const t of op.per.terrains) expect(TERRAIN[t]).toBeDefined()
      }
      expect(CARD_BY_ID.get(c.id)).toBe(c)
    }
    for (const d of DECREES) { expect(d.price).toBeGreaterThan(0); expect(d.ops.length).toBeGreaterThan(0); expect(DECREE_BY_ID.get(d.id)).toBe(d) }
    // every rarity and many archetypes are represented
    for (const r of ['common', 'uncommon', 'rare']) expect(WORLD_CARDS.some((c) => c.rarity === r)).toBe(true)
    expect(new Set(WORLD_CARDS.flatMap((c) => c.tags)).size).toBeGreaterThanOrEqual(12)
  })

  it('every world card does something when it triggers', () => {
    for (const def of WORLD_CARDS) {
      let s = newRun(setup(`card-${def.id}`))
      s.stats = { vitality: 30, prosperity: 30, industry: 30, knowledge: 36 }
      const card = inst(def.rank, def.suit, 5000, def.id)
      if (def.effects.some((e) => e.when === 'discarded')) {
        s = withHand(s, [card, inst(2, 'S', 5001), inst(3, 'S', 5002), inst(4, 'S', 5003), inst(5, 'S', 5004), inst(6, 'S', 5005), inst(7, 'S', 5006), inst(8, 'S', 5007)])
        const d = evaluateDiscard(s, [0])
        expect(d.lines.length, def.id).toBeGreaterThan(0)
        continue
      }
      const held = def.effects.some((e) => e.when === 'held')
      const hand = held
        ? [inst(9, 'S', 5001), card, inst(3, 'D', 5002), inst(4, 'D', 5003), inst(5, 'D', 5004), inst(6, 'D', 5005), inst(7, 'D', 5006), inst(8, 'D', 5007)]
        : [card, inst(def.rank, def.suit === 'S' ? 'H' : 'S', 5001), inst(3, 'D', 5002), inst(4, 'C', 5003), inst(5, 'D', 5004), inst(6, 'D', 5005), inst(7, 'D', 5006), inst(8, 'D', 5007)]
      s = withHand(s, hand)
      // put it where its condition holds
      for (const e of def.effects) for (const op of e.ops) if ('per' in op && op.per?.per === 'terrain') s.regions[11].terrain = op.per.terrains[0]
      if (def.id === 'last-stand') s.handsLeft = 1
      if (def.id === 'long-count') s.handsPlayed = 3
      if (def.id === 'balance-scales') s.stats = { vitality: 30, prosperity: 30, industry: 30, knowledge: 30 }
      if (def.id === 'monument') s.stats = { vitality: 60, prosperity: 10, industry: 10, knowledge: 10 }
      if (def.id === 'border-fort') s.crisisTrack[s.era] = 'invasion'
      if (def.id === 'herbalist') s.crisisTrack[s.era] = 'winter'
      if (def.id === 'trade-road' || def.id === 'grand-bazaar') s = withHand(s, [card, inst(def.rank, 'D', 5001), inst(3, 'S', 5002), inst(4, 'C', 5003), inst(5, 'S', 5004), inst(6, 'S', 5005), inst(7, 'S', 5006), inst(8, 'C', 5007)])
      if (def.tags.includes('civ') || def.tags.includes('relations')) {
        const c = (id: number, home: number, archetype: Civilization['archetype']): Civilization => ({ id, archetype, name: `c${id}`, home, tier: 1, emergedEra: 0, emergedPlay: 0, reason: { stat: 'vitality', readiness: 0, needed: 0, terrain: 'forest', regionFit: 0 } })
        s.civilizations = def.id === 'war-drums' ? [c(0, 0, 'empireBuilders'), c(1, 1, 'nomads')] : [c(0, 0, 'natureKeepers'), c(1, 1, 'nomads')]
      }
      const idx = held ? [0] : def.id === 'trade-road' || def.id === 'grand-bazaar' ? [0, 1] : [0, 1]
      const r = evaluatePlay(s, idx)
      const src = held ? 'held' : 'card'
      expect(r.lines.some((l) => l.source === src), `${def.id}: ${JSON.stringify(r.lines)}`).toBe(true)
    }
  })

  it('legendaries: 12–20, each changes a rule through at least one hook, with text', () => {
    expect(LEGENDARY_ORDER.length).toBeGreaterThanOrEqual(12)
    expect(LEGENDARY_ORDER.length).toBeLessThanOrEqual(20)
    expect(new Set(LEGENDARY_ORDER).size).toBe(LEGENDARY_ORDER.length)
    for (const id of LEGENDARY_ORDER) {
      const d = LEGENDARIES[id]
      expect(d.id).toBe(id)
      expect(d.text.length).toBeGreaterThan(20)
      const hooks = ['mods', 'score', 'crisis', 'discard', 'dawn', 'eraEnd', 'endure', 'prevent', 'tempered'].filter((h) => h in d)
      expect(hooks.length, id).toBeGreaterThan(0)
    }
  })

  it('pools: the starter pool is a subset of the full pool; both are valid run setups', () => {
    for (const k of ['cards', 'decrees', 'legendaries', 'archetypes'] as const) {
      for (const id of STARTER_POOL[k]) expect((FULL_POOL[k] as string[]).includes(id)).toBe(true)
      expect(STARTER_POOL[k].length).toBeLessThan(FULL_POOL[k].length)
    }
    expect(() => newRun(setup('starter', { pool: STARTER_POOL }))).not.toThrow()
  })
})

describe('Ascension v10: the Council', () => {
  const atCouncil = (seed: string) => { const s = face(newRun(setup(seed))); expect(s.phase).toBe('council'); return s }

  it('offers are a deterministic function of seed, era and reroll; a legendary is chosen after the right eras', () => {
    const s = atCouncil('council-a')
    const m = runMods(s)
    expect(marketOffers(s, 0, 0, m)).toEqual(s.council!.offers)
    expect(marketOffers(s, 0, 1, m)).not.toEqual(s.council!.offers)
    expect(s.council!.offers.filter((o) => o.kind === 'card')).toHaveLength(m.marketSlots - 2)
    expect(s.council!.offers.filter((o) => o.kind === 'decree')).toHaveLength(2)
    expect(LEGENDARY_PICK_AFTER).toContain(0)
    expect(s.council!.legendaryChoice).toEqual(legendaryChoice(s, 0))
    expect(s.council!.legendaryChoice).toHaveLength(3)
    for (const e of LEGENDARY_SALE_AFTER) expect(LEGENDARY_PICK_AFTER).not.toContain(e)
  })

  it('buying a card adds it to the deck; decrees act; legendaries fill slots; prices are paid', () => {
    let s = atCouncil('council-b')
    s = { ...structuredClone(s), influence: 100 }
    const ci = s.council!.offers.findIndex((o) => o.kind === 'card')
    const bought = applyAction(s, { type: 'buy', offer: ci })
    const def = CARD_BY_ID.get(s.council!.offers[ci].id)!
    expect(ownedCards(bought)).toHaveLength(53)
    expect(ownedCards(bought).some((c) => c.kind === def.id && c.r === def.rank && c.s === def.suit)).toBe(true)
    expect(bought.influence).toBe(100 - s.council!.offers[ci].price)
    expect(() => applyAction(bought, { type: 'buy', offer: ci })).toThrow(/already bought/)
    const picked = applyAction(s, { type: 'legendary', pick: 1 })
    expect(picked.legendaries.map((l) => l.id)).toEqual([s.council!.legendaryChoice![1]])
    expect(picked.council!.legendaryChoice).toBeNull()
    const sold = applyAction(picked, { type: 'sell', slot: 0 })
    expect(sold.legendaries).toEqual([])
    expect(sold.influence).toBe(picked.influence + SELL_REFUND)
    const rr = applyAction(s, { type: 'reroll' })
    expect(rr.council!.rerolls).toBe(1)
    expect(rr.influence).toBe(99)
    const card = ownedCards(s)[0].id
    const thin = applyAction(s, { type: 'remove', card })
    expect(ownedCards(thin)).toHaveLength(51)
    expect(thin.influence).toBe(100 - REMOVE_PRICE)
    expect(() => applyAction({ ...s, influence: 0 }, { type: 'reroll' })).toThrow(/not enough Influence/)
  })

  it('decrees: terraform needs a legal region; shift and census move stats; Rally caps at 3', () => {
    const s = { ...structuredClone(atCouncil('council-c')), influence: 100 }
    const run = (id: string, target?: number | Suit) => {
      const t = structuredClone(s)
      t.council!.offers = [{ kind: 'decree', id, price: 1, sold: false }]
      return applyAction(t, { type: 'buy', offer: 0, ...(target !== undefined ? { target } : {}) })
    }
    const desert = s.regions.find((r) => r.terrain === 'desert' || r.terrain === 'tundra')
    if (desert) expect(run('irrigate', desert.id).regions[desert.id].terrain).toBe('plains')
    const wrong = s.regions.find((r) => r.terrain === 'forest')!
    expect(() => run('irrigate', wrong.id)).toThrow(/needs desert or tundra/)
    expect(() => run('irrigate')).toThrow(/choose a region/)
    const lo = run('census')
    expect(Object.values(lo.stats).reduce((a, b) => a + b, 0)).toBe(Object.values(s.stats).reduce((a, b) => a + b, 0) + 3)
    const full = { ...structuredClone(s), resolve: 3 }
    full.council!.offers = [{ kind: 'decree', id: 'rally', price: 1, sold: false }]
    expect(() => applyAction(full, { type: 'buy', offer: 0 })).toThrow(/already full/)
    const summer = run('long-summer')
    expect(leave(summer).handsLeft).toBe(ERAS[1].hands + 2)
    const charter = run('guild-charter', 'C')
    expect(ownedCards(charter).filter((c) => c.s === 'C')).toHaveLength(16)
  })

  it('the deck cannot be thinned below the minimum', () => {
    const s = structuredClone(atCouncil('council-d'))
    s.influence = 1000
    s.drawPile = s.drawPile.slice(0, MIN_DECK)
    expect(() => applyAction(s, { type: 'remove', card: s.drawPile[0].id })).toThrow(/cannot be thinned/)
  })
})

describe('Ascension v10: legendaries in play', () => {
  const withLegend = (id: LegendaryId, seed = `leg-${id}`) => { const s = structuredClone(newRun(setup(seed))); s.legendaries = [{ id, counter: 0, awake: false }]; return s }

  it('the Sleeping God turns the first failed crisis into endured, then wakes (+4 mult)', () => {
    const s = face(withLegend('sleepingGod'))
    expect(s.crises[0]).toMatchObject({ result: 'endured', prevented: true })
    expect(s.resolve).toBe(3)
    expect(s.legendaries[0].awake).toBe(true)
    const t = face(leave(s))
    expect(t.crises[1].result).toBe('failed')
    const r = evaluatePlay(leave(t), [0])
    expect(r.lines.some((l) => l.label === 'The Sleeping God' && l.mult === 4)).toBe(true)
  })

  it('the Hourglass adds hands and pressure; the Oracle adds discards and banks reserves', () => {
    const h = withLegend('hourglass')
    const base = newRun(setup('leg-hourglass'))
    expect(runMods(h).handsBonus).toBe(2)
    expect(forecast(h).pressure).toBeGreaterThan(forecast(base).pressure)
    const o = withLegend('oraclesEye')
    expect(runMods(o).discardsBonus).toBe(2)
    expect(applyAction(o, { type: 'discard', cards: [0] }).eraReserves).toBe(2)
  })

  it('the Titan Forge tempers scoring cards permanently; the Everflame doubles small hands', () => {
    let s = withLegend('titanForge')
    s = withHand(s, [inst(9, 'C', 7001), inst(9, 'D', 7002), inst(2, 'S', 7003), inst(3, 'S', 7004), inst(4, 'S', 7005), inst(5, 'H', 7006), inst(6, 'H', 7007), inst(7, 'H', 7008)])
    const t = play(s, [0, 1])
    expect(ownedCards(t).find((c) => c.id === 7001)!.bonus).toBe(8)
    expect(ownedCards(t).find((c) => c.id === 7002)!.bonus).toBe(8)
    expect(ownedCards(t).find((c) => c.id === 7003)!.bonus).toBe(0)
    let e = withLegend('everflame')
    e = withHand(e, [inst(9, 'C', 7001), inst(9, 'D', 7002), inst(2, 'S', 7003), inst(3, 'S', 7004), inst(4, 'S', 7005), inst(5, 'H', 7006), inst(6, 'H', 7007), inst(7, 'H', 7008)])
    expect(evaluatePlay(e, [0, 1]).xmult).toBe(2)
  })

  it('the Eternal Dragon devours the weakest civilization of three and grows; Gaia heals the harshest land', () => {
    const s = withLegend('eternalDragon')
    s.stats = { vitality: 300, prosperity: 300, industry: 300, knowledge: 300 }
    const c = (id: number, home: number, tier: number, archetype: Civilization['archetype']): Civilization => ({ id, archetype, name: `c${id}`, home, tier, emergedEra: 0, emergedPlay: 0, reason: { stat: 'vitality', readiness: 0, needed: 0, terrain: 'forest', regionFit: 0 } })
    s.civilizations = [c(0, 0, 2, 'nomads'), c(1, 3, 1, 'scholars'), c(2, 6, 2, 'merchants')] // devours the Settlement
    const t = face(s)
    expect(t.civilizations.map((x) => x.id)).toEqual([0, 2])
    expect(t.fallen.map((x) => x.id)).toEqual([1])
    expect(t.legendaries[0].counter).toBe(1)
    const g = withLegend('gaiasHeart')
    g.regions[5].terrain = 'wasteland'
    const next = leave(face(g))
    expect(next.regions[5].terrain).toBe('forest')
  })

  it('the Monolith doubles the tested highest stat; the Cosmic Library adds foresight', () => {
    const s = withLegend('monolith')
    s.crisisTrack[0] = 'winter'
    s.stats = { vitality: 20, prosperity: 0, industry: 0, knowledge: 0 }
    expect(forecast(s).mitigations.find((f) => f.label === 'The Monolith')!.amount).toBe(40)
    const k = withLegend('cosmicLibrary')
    k.stats.knowledge = 21
    expect(forecast(k).mitigations.find((f) => f.label === 'The Cosmic Library')!.amount).toBe(7)
  })

  it('no legendary combination produces a non-finite or runaway score', () => {
    for (const [i, id] of LEGENDARY_ORDER.entries()) {
      const s = structuredClone(newRun(setup(`combo-${i}`)))
      s.legendaries = LEGENDARY_ORDER.slice(i, i + 4).map((x) => ({ id: x, counter: 5, awake: true }))
      s.stats = { vitality: 200, prosperity: 200, industry: 200, knowledge: 200 }
      const r = evaluatePlay(s, [0, 1, 2, 3, 4])
      expect(Number.isFinite(r.score), id).toBe(true)
      expect(r.score).toBeLessThan(1e9)
    }
  })
})

describe('Ascension v10: Omens', () => {
  it('eight stacking Omens, each doing what it says', () => {
    expect(OMENS.map((o) => o.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    const at = (omen: number) => newRun(setup('omens', { omen }))
    expect(at(1).discardsLeft).toBe(ERAS[0].discards - 1)
    expect(at(0).discardsLeft).toBe(ERAS[0].discards)
    const harsh = Array.from({ length: 100 }, (_, i) => generateRegions(hashSeed(`h${i}`), 'pangaea', true).filter((r) => r.terrain === 'tundra' || r.terrain === 'desert').length).reduce((a, b) => a + b, 0)
    const mild = Array.from({ length: 100 }, (_, i) => generateRegions(hashSeed(`h${i}`)).filter((r) => r.terrain === 'tundra' || r.terrain === 'desert').length).reduce((a, b) => a + b, 0)
    expect(harsh).toBeGreaterThan(mild)
    expect(runMods(at(3)).crisis.rivalsEverywhere).toBe(true)
    expect(runMods(at(3)).crisis.allyResilience).toBe(2)
    expect(runMods(at(2)).crisis.rivalsEverywhere).toBe(false)
    expect(runMods(at(4)).marketSlots).toBe(4)
    expect(runMods(at(5)).crisis.pressurePct).toBe(5)
    expect(runMods(at(6)).crisis.strainPct).toBe(50)
    expect(startingResolve(7)).toBe(2)
    expect(at(7).resolve).toBe(2)
    expect(at(6).resolve).toBe(3)
    expect(runMods(at(8), 3).handsBonus).toBe(0)
    expect(runMods(at(8), 4).handsBonus).toBe(-1)
    const night = structuredClone(at(8))
    night.era = FINAL_ERA
    night.crises = [{ ...face(at(8)).crises[0], result: 'failed', prevented: false }]
    expect(runMods(night).crisis.extraPressures.find((f) => f.label === 'The Long Night')!.amount).toBe(10)
  })
})

describe('Ascension v10: the Chronicle', () => {
  it('every event of a full run reads as a sentence, deterministically', () => {
    const { s } = scripted('chronicle')
    const a = chronicleByEra(s.chronicle, s.seed), b = chronicleByEra(s.chronicle, s.seed)
    expect(b).toEqual(a)
    const lines = a.flatMap((g) => g.lines)
    expect(lines.length).toBe(s.chronicle.length)
    for (const l of lines) { expect(l.text.length).toBeGreaterThan(8); expect(l.text).not.toMatch(/undefined|NaN|\[object/) }
    expect(s.chronicle.some((e) => e.t === 'crisis')).toBe(true)
    expect(s.chronicle[s.chronicle.length - 1].t).toBe('end')
    expect(describeEvent(s.chronicle[0], s.seed, 0)).toEqual(lines[0].text)
  })

  it('long runs stay bounded: many seeds end, with finite numbers', () => {
    for (let i = 0; i < 12; i++) {
      const { s } = scripted(`bounded-${i}`, { omen: i % 9 })
      expect(['won', 'lost']).toContain(s.phase)
      expect(Number.isFinite(s.score)).toBe(true)
      expect(s.crises.length).toBeGreaterThan(0)
    }
  })
})

describe('Ascension v10: terrain data', () => {
  it('every natural terrain favours a stat; wasteland favours none', () => {
    for (const t of NATURAL_TERRAINS) expect(TERRAIN[t].stat).not.toBeNull()
    expect(TERRAIN.wasteland.stat).toBeNull()
  })
})
