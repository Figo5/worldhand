// Ascension ruleset: engine skeleton. Pure — no DOM, no clock, no Math.random.
//
// Generate a seeded 12-region world, deal a seeded 52-card deck, play or
// discard 1–5 cards, score plays with the shared poker evaluator, grow four
// world stats from the played suits, pay a land bonus for stat gains the
// world's terrain favours, let civilizations emerge at round ends and add
// their passive bonuses to later plays (civilizations.ts). When an era's
// requirements are met at a round end (eras.ts) its crisis becomes ready
// (crises.ts): the player plays on and faces it with a `resolve` action when
// they choose, until it strikes on its own a few round ends later. Facing it
// weighs the world (and the era's score, as reserves) against it; survival
// advances one era (after Medieval: first playable complete), failure ends
// the run. Rounds of 4 plays / 3 discards roll over meanwhile.
// No saves, no content yet.
//
// Boundaries (enforced by tests/engine-boundaries.test.ts): this module never
// imports the Classic ruleset (worldhand.ts). It shares only rng.ts, poker.ts
// and core/streams.ts. All randomness comes from named streams under the
// 'ascension' namespace, so a seed phrase deals differently here than in
// Classic, and each shuffle is independent of every other.
import { hashSeed, type Seed } from '../rng'
import { deck, evaluateSelection, categoryLabel, CATEGORY_MULT, type Card, type HandCategory, type Suit } from '../poker'
import { stream } from '../core/streams'
import { emergeCivilization, civilizationBonuses, type Civilization, type CivBonus } from './civilizations'
import { ERAS, canAdvance, isComplete, type EraAdvance } from './eras'
import { evaluateCrisis, CRISIS_RULES, type CrisisEvaluation, type World } from './crises'

/** Rules generation of Ascension state. Independent of Classic's SAVE_VERSION.
 *  1 = seam skeleton (poker score only), 2 = suit-driven world stats,
 *  3 = procedural terrain + land bonus, 4 = civilization emergence,
 *  5 = civilization passives, 6 = eras (Tribal, Ancient, Medieval) + first-playable completion,
 *  7 = era crises, 8 = ready crises faced by choice, reserves from score,
 *  wealth-driven Invasion. */
export const ASCENSION_RULES_VERSION = 8
export const HAND_SIZE = 8
export const PLAYS_PER_ROUND = 4
export const DISCARDS_PER_ROUND = 3

// ---------------------------------------------------------------------------
// World stats. Working names: change a label here and nothing else moves.
// ---------------------------------------------------------------------------
export type WorldStat = 'vitality' | 'prosperity' | 'industry' | 'knowledge'
export type WorldStats = Record<WorldStat, number>
/** Display order and working labels. */
export const WORLD_STATS: readonly WorldStat[] = ['vitality', 'prosperity', 'industry', 'knowledge']
export const WORLD_STAT_LABEL: Record<WorldStat, string> = {
  vitality: 'Vitality', prosperity: 'Prosperity', industry: 'Industry', knowledge: 'Knowledge',
}
/** Which stat each suit develops: ♥ Vitality, ♦ Prosperity, ♣ Industry, ♠ Knowledge. */
export const SUIT_STAT: Record<Suit, WorldStat> = { H: 'vitality', D: 'prosperity', C: 'industry', S: 'knowledge' }
export const noStats = (): WorldStats => ({ vitality: 0, prosperity: 0, industry: 0, knowledge: 0 })

// ---------------------------------------------------------------------------
// World geography: a FIXED 12-region topology (an outer ring of 8 around a
// core of 4, the same shape Classic's globe renders; copied here, not shared,
// so Classic stays untouched) with terrain assigned per run from the seed.
// ---------------------------------------------------------------------------
export type Terrain = 'plains' | 'forest' | 'mountains' | 'desert' | 'coast' | 'tundra'
/** Terrain data. `stat` is the world stat the terrain favours (working
 *  mapping); `weight` is its relative chance per region. Weights give every
 *  stat the same expected share of the land (2 of 8): forest and mountains
 *  are the only Vitality and Industry terrains, so they count double. */
export const TERRAIN: Record<Terrain, { label: string; stat: WorldStat; weight: number }> = {
  plains: { label: 'Plains', stat: 'prosperity', weight: 1 },
  forest: { label: 'Forest', stat: 'vitality', weight: 2 },
  mountains: { label: 'Mountains', stat: 'industry', weight: 2 },
  desert: { label: 'Desert', stat: 'knowledge', weight: 1 },
  coast: { label: 'Coast', stat: 'prosperity', weight: 1 },
  tundra: { label: 'Tundra', stat: 'knowledge', weight: 1 },
}
/** Fixed pick order for the weighted draw (never iterate object keys for this). */
export const TERRAINS: readonly Terrain[] = ['plains', 'forest', 'mountains', 'desert', 'coast', 'tundra']
/** Region id -> neighbouring region ids (symmetric, connected, stable). */
export const REGION_ADJACENCY: readonly (readonly number[])[] = [
  [1, 7, 8], [0, 2, 9], [1, 3, 9], [2, 4, 10], [3, 5, 11], [4, 6, 11],
  [5, 7, 8], [0, 6, 8], [0, 6, 7, 9, 11], [1, 2, 8, 10], [3, 9, 11], [4, 5, 8, 10],
]

export interface AscensionRegion {
  id: number
  terrain: Terrain
  neighbors: number[]
}

/** The world for a run seed. Each region draws its terrain from its own named
 *  stream ('ascension', 'terrain', id), so a region's terrain depends only on
 *  (seed, id): not on generation order, other regions, the deck, or the UI. */
export function generateRegions(seed: Seed): AscensionRegion[] {
  const total = TERRAINS.reduce((n, t) => n + TERRAIN[t].weight, 0)
  return REGION_ADJACENCY.map((neighbors, id) => {
    let roll = stream(seed, 'ascension', 'terrain', id).int(0, total)
    const terrain = TERRAINS.find((t) => (roll -= TERRAIN[t].weight) < 0) as Terrain
    return { id, terrain, neighbors: [...neighbors] }
  })
}

/** How many regions favour each stat: the land bonus rate for that stat. */
export function landAffinity(regions: readonly AscensionRegion[]): WorldStats {
  const a = noStats()
  for (const r of regions) a[TERRAIN[r.terrain].stat] += 1
  return a
}

export interface PlayResult {
  cards: Card[]
  category: HandCategory
  label: string
  /** rank sum of all played cards */
  chips: number
  mult: number
  /** round(chips × mult) */
  pokerScore: number
  /** world-stat gains: +1 to a suit's stat for every played card of that suit */
  statDeltas: WorldStats
  /** Σ over stats of statDeltas × (regions whose terrain favours that stat) */
  landBonus: number
  /** triggered passives of emerged civilizations, in emergence order */
  civBonuses: CivBonus[]
  /** Σ civBonuses amounts */
  civBonus: number
  /** what the play adds to the run score: pokerScore + landBonus + civBonus */
  score: number
}

export interface AscensionState {
  mode: 'ascension'
  rulesVersion: number
  seed: Seed
  seedText: string
  /** the generated world: fixed topology, seeded terrain */
  regions: AscensionRegion[]
  round: number
  playsLeft: number
  discardsLeft: number
  hand: Card[]
  drawPile: Card[]
  discardPile: Card[]
  /** how many times the discard pile has been reshuffled; keys the next shuffle's stream */
  reshuffles: number
  score: number
  /** the four world stats, grown only by plays */
  stats: WorldStats
  /** civilizations in emergence order; at most one emerges per round end */
  civilizations: Civilization[]
  /** the last play's full result, including its world-stat deltas */
  lastPlay: PlayResult | null
  /** index into ERAS; ERAS.length = first playable complete */
  era: number
  /** era advances, logged with the round end whose crisis they survived */
  eraLog: EraAdvance[]
  /** the current era's crisis, ready since the end of `round` and not yet faced */
  crisis: { round: number } | null
  /** resolved crises in order; a failed one ends the run */
  crises: CrisisOutcome[]
}
/** A resolved crisis: `round` = the round whose end made it ready, `faced` = the round it was faced in. */
export type CrisisOutcome = CrisisEvaluation & { round: number; faced: number }

/** playing → (era requirements met at a round end) ready: play on, face it
 *  whenever you choose → (after CRISIS_RULES.graceRounds more round ends)
 *  crisis: it strikes, play stops until it is faced → playing in the next era,
 *  complete (after Medieval), or failed. */
export type RunStatus = 'playing' | 'ready' | 'crisis' | 'failed' | 'complete'
export function runStatus(s: AscensionState): RunStatus {
  if (isComplete(s.era)) return 'complete'
  if (s.crises.length && s.crises[s.crises.length - 1].result === 'failed') return 'failed'
  if (!s.crisis) return 'playing'
  return s.round > s.crisis.round + CRISIS_RULES.graceRounds ? 'crisis' : 'ready'
}
/** The score this era began with (and the round it began in). */
const eraStart = (s: AscensionState) => (s.eraLog.length ? s.eraLog[s.eraLog.length - 1] : { round: 1, score: 0 })
/** The world the current era's crisis would face now (or right after a play
 *  that leaves these stats and score). */
export function crisisWorld(s: AscensionState, stats: WorldStats = s.stats, score = s.score): World {
  const start = eraStart(s)
  return { regions: s.regions, stats, civilizations: s.civilizations, eraScore: score - start.score, waited: s.crisis ? s.round - s.crisis.round - 1 : 0 }
}
/** What this round's end would bring if the round ended with these stats and
 *  score (default: as things stand): the civilization that would emerge,
 *  whether the era's crisis would then be ready, whether it would strike on its
 *  own, and the crisis as it would stand right after that round end. The same
 *  functions as the round-end checkpoint, so a preview of the round's last play
 *  is exactly what that play commits. Pure. */
export function projectRoundEnd(state: AscensionState, stats: WorldStats = state.stats, score = state.score) {
  const civ = emergeCivilization(state.seed, state.round, state.regions, stats, state.civilizations)
  const civilizations = civ ? [...state.civilizations, civ] : state.civilizations
  const ready = state.crisis !== null || canAdvance(state.era, stats, civilizations)
  const readyRound = state.crisis ? state.crisis.round : state.round
  const world = { ...crisisWorld(state, stats, score), civilizations, waited: ready ? state.round - readyRound : 0 }
  return { civ, ready, forced: ready && state.round + 1 > readyRound + CRISIS_RULES.graceRounds, crisis: isComplete(state.era) ? null : evaluateCrisis(state.era, world) }
}

/** Throws unless cards may be played or discarded. */
function assertPlaying(s: AscensionState): void {
  const st = runStatus(s)
  if (st === 'complete') throw new Error('first playable complete')
  if (st === 'failed') throw new Error(`run over: ${s.crises[s.crises.length - 1].label} failed`)
  if (st === 'crisis') throw new Error('resolve the crisis first')
}

/** Card indices refer to positions in `hand`. */
export type AscensionAction =
  | { type: 'play'; cards: number[] }
  | { type: 'discard'; cards: number[] }
  | { type: 'resolve' }

export function newAscensionGame(seedText: string): AscensionState {
  const seed = hashSeed(seedText)
  const s: AscensionState = {
    mode: 'ascension',
    rulesVersion: ASCENSION_RULES_VERSION,
    seed,
    seedText,
    regions: generateRegions(seed),
    round: 1,
    playsLeft: PLAYS_PER_ROUND,
    discardsLeft: DISCARDS_PER_ROUND,
    hand: [],
    drawPile: stream(seed, 'ascension', 'deck').shuffle(deck()),
    discardPile: [],
    reshuffles: 0,
    score: 0,
    stats: noStats(),
    civilizations: [],
    lastPlay: null,
    era: 0,
    eraLog: [],
    crisis: null,
    crises: [],
  }
  drawUp(s)
  return s
}

/** Everything a play would do, without changing anything. The UI preview and
 *  the committed `play` action both use this one result, so they cannot differ.
 *    pokerScore = round(chips × mult)   (chips = rank sum, mult = poker category)
 *    statDeltas = +1 to SUIT_STAT[suit] for every played card
 *    landBonus  = Σ statDeltas[stat] × landAffinity(regions)[stat]
 *    civBonus   = Σ passives of the emerged civilizations (civilizations.ts),
 *                 which see the cards, pokerScore and the stats after the play
 *    score      = pokerScore + landBonus + civBonus
 *  Poker score follows ranks and hand category; stats follow suits only; the
 *  land bonus makes the same stat gains worth more in a world whose terrain
 *  favours them; civilizations add score only, never stats. */
export function evaluatePlay(state: AscensionState, idxs: readonly number[]): PlayResult {
  assertPlaying(state)
  checkSelection(state.hand, idxs)
  const cards = idxs.map((i) => state.hand[i])
  const { category } = evaluateSelection(cards)
  const chips = cards.reduce((n, c) => n + c.r, 0)
  const mult = CATEGORY_MULT[category]
  const statDeltas = noStats()
  for (const c of cards) statDeltas[SUIT_STAT[c.s]] += 1
  const pokerScore = Math.round(chips * mult)
  const affinity = landAffinity(state.regions)
  const landBonus = WORLD_STATS.reduce((n, k) => n + statDeltas[k] * affinity[k], 0)
  const statsAfter = { ...state.stats }
  for (const k of WORLD_STATS) statsAfter[k] += statDeltas[k]
  const civBonuses = civilizationBonuses(state.civilizations, state.regions, { cards, pokerScore, stats: statsAfter })
  const civBonus = civBonuses.reduce((n, b) => n + b.amount, 0)
  return { cards, category, label: categoryLabel(category), chips, mult, pokerScore, statDeltas, landBonus, civBonuses, civBonus, score: pokerScore + landBonus + civBonus }
}

/** Pure transition. An illegal action throws before anything is built, so the
 *  input state is never changed. */
export function applyAscensionAction(state: AscensionState, action: AscensionAction): AscensionState {
  if (action.type === 'resolve') {
    const st = runStatus(state)
    if (st === 'playing') throw new Error('no crisis to resolve')
    if (st !== 'ready' && st !== 'crisis') assertPlaying(state)
    const outcome: CrisisOutcome = { ...evaluateCrisis(state.era, crisisWorld(state)), round: state.crisis!.round, faced: state.round }
    const s = { ...state, crisis: null, crises: [...state.crises, outcome] }
    if (outcome.result === 'survived') {
      s.eraLog = [...s.eraLog, { from: ERAS[s.era].id, to: ERAS[s.era + 1]?.id ?? null, round: s.round, stats: { ...s.stats }, civilizations: s.civilizations.length, score: s.score }]
      s.era += 1
    }
    return s
  }
  assertPlaying(state)
  if (action.type === 'play') {
    if (state.playsLeft <= 0) throw new Error('no plays left this round')
    const result = evaluatePlay(state, action.cards)
    const s = moveToDiscard(state, action.cards)
    s.score += result.score
    s.stats = { ...s.stats }
    for (const k of WORLD_STATS) s.stats[k] += result.statDeltas[k]
    s.lastPlay = result
    s.playsLeft -= 1
    if (s.playsLeft === 0) {
      // round-end checkpoint: at most one civilization emerges
      const civ = emergeCivilization(s.seed, s.round, s.regions, s.stats, s.civilizations)
      if (civ) s.civilizations = [...s.civilizations, civ]
      // then, if the era's requirements hold, its crisis becomes ready (faced by a separate action)
      if (!s.crisis && canAdvance(s.era, s.stats, s.civilizations)) s.crisis = { round: s.round }
      s.discardPile.push(...s.hand)
      s.hand = []
      s.round += 1
      s.playsLeft = PLAYS_PER_ROUND
      s.discardsLeft = DISCARDS_PER_ROUND
    }
    drawUp(s)
    return s
  }
  if (action.type === 'discard') {
    if (state.discardsLeft <= 0) throw new Error('no discards left this round')
    checkSelection(state.hand, action.cards)
    const s = moveToDiscard(state, action.cards)
    s.discardsLeft -= 1
    drawUp(s)
    return s
  }
  throw new Error(`unknown action ${JSON.stringify((action as { type?: unknown }).type)}`)
}

function checkSelection(hand: readonly Card[], idxs: readonly number[]): void {
  if (!Array.isArray(idxs) || idxs.length < 1 || idxs.length > 5) throw new Error('select 1–5 cards')
  if (new Set(idxs).size !== idxs.length) throw new Error('a card was selected twice')
  for (const i of idxs) {
    if (!Number.isInteger(i) || i < 0 || i >= hand.length) throw new Error(`no card at position ${String(i)}`)
  }
}

/** A copy of `state` with the selected hand cards moved to the discard pile. */
function moveToDiscard(state: AscensionState, idxs: readonly number[]): AscensionState {
  return {
    ...state,
    hand: state.hand.filter((_, i) => !idxs.includes(i)),
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile, ...idxs.map((i) => state.hand[i])],
  }
}

/** Refill the hand to HAND_SIZE, reshuffling the discard pile into the draw
 *  pile when it runs out. Mutates `s`, which must be a fresh copy. */
function drawUp(s: AscensionState): void {
  while (s.hand.length < HAND_SIZE) {
    if (s.drawPile.length === 0) {
      if (s.discardPile.length === 0) return
      s.drawPile = stream(s.seed, 'ascension', 'reshuffle', s.reshuffles).shuffle(s.discardPile)
      s.discardPile = []
      s.reshuffles += 1
    }
    s.hand.push(s.drawPile.pop() as Card)
  }
}
