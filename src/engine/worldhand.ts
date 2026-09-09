// Worldhand — deterministic planet-building card roguelike. Pure engine, no DOM.
//
// Contracts:
// - 12 regions across a seeded world; 4 revealed at start, the rest via Bloom milestones.
// - 8 epochs; each epoch = 4 hands (32 hands total). Each hand deals 8 cards.
// - Per hand: up to 3 Discards, then explicit Plays (suit-specific actions), then Advance.
// - Suits: ♠ Roots (stability) · ♥ Bloom (Flourishing) · ♦ Sow (Seeds) · ♣ Tend (both).
// - Win ("Flourishing World"): reach the Flourishing target (12) by end of epoch 8.
// - Lose: Flourishing ≤ 0 at an epoch boundary, or any 5 regions at 0 stability (Withering).
// - Stability base is 3; regions decay at epoch end; seeded Challenges test the world.
// - Market (buy cards with Seeds) and Laws (drafted each epoch) modify play.
import { Rng, hashSeed, type Seed } from './rng'
import { deck, evaluate, type Card, type HandResult } from './poker'

export const SAVE_VERSION = 1
export const HAND_SIZE = 8
export const DISCARDS_PER_HAND = 3
export const HANDS_PER_EPOCH = 4
export const TOTAL_EPOCHS = 8
export const TOTAL_REGIONS = 12
export const START_REGIONS = 4
export const STABILITY_BASE = 3
export const STABILITY_MAX = 10
export const FLOURISH_TARGET = 12
export const FLOURISH_START = 3
export const SEEDS_START = 8
export const MARKET_SIZE = 3
export const WITHERING_LIMIT = 5

export type Phase = 'hand' | 'law' | 'game-over'
export type Suit = 'S' | 'H' | 'D' | 'C'

export interface Region {
  id: number
  name: string
  terrain: string
  stability: number
  dormant: boolean
}

export interface Law {
  id: string
  title: string
  desc: string
  cost: number
  decayDelta?: number
  extraSeedsPerEpoch?: number
  marketDiscount?: number
  bloomBonus?: number
  rootsBonus?: number
}

export const LAWS: Law[] = [
  { id: 'mycorrhiza', title: 'Mycorrhiza', desc: 'Regions decay 1 less each epoch.', cost: 6, decayDelta: -1 },
  { id: 'seed-vaults', title: 'Seed Vaults', desc: '+3 Seeds at each epoch end.', cost: 8, extraSeedsPerEpoch: 3 },
  { id: 'barter-routes', title: 'Barter Routes', desc: 'Market cards cost 2 less.', cost: 5, marketDiscount: 2 },
  { id: 'canopy-choir', title: 'Canopy Choir', desc: '♥ Bloom plays yield +1 Flourishing.', cost: 10, bloomBonus: 1 },
  { id: 'deep-taproots', title: 'Deep Taproots', desc: '♠ Roots plays yield +1 stability.', cost: 10, rootsBonus: 1 },
  { id: 'slow-ruin', title: 'Slow Ruin', desc: 'Decay +1, but +5 Seeds each epoch.', cost: 4, decayDelta: 1, extraSeedsPerEpoch: 5 },
]

export interface Challenge {
  desc: string
  /** minimum count required */
  need: number
  /** predicate key */
  kind: 'stable5' | 'revealed' | 'stabilitySum'
}

export interface MarketOffer {
  card: Card
  cost: number
}

export interface LogEntry {
  at: string
  text: string
}

export interface GameState {
  version: number
  seed: Seed
  seedText: string
  epoch: number // 1..8
  handInEpoch: number // 1..4
  phase: Phase
  flourishing: number
  seeds: number
  regions: Region[]
  hand: Card[]
  deckRest: Card[]
  discardPile: Card[]
  discardsLeft: number
  playsLeft: number
  market: MarketOffer[]
  lawDraft: Law[]
  laws: Law[]
  challenge: Challenge | null
  lastHandResult: HandResult | null
  log: LogEntry[]
  outcome: 'flourishing' | 'withered' | null
  outcomeReason: string
}

export type Action =
  | { type: 'discard'; cardIdx: number }
  | { type: 'play'; cardIdx: number; regionId?: number }
  | { type: 'advance' } // end the hand early / deal next hand
  | { type: 'buyCard'; offerIdx: number }
  | { type: 'enactLaw'; lawId: string }
  | { type: 'skipLaw' }

export function newGame(seedText: string): GameState {
  const seed = hashSeed(seedText)
  return dealHand(setupWorld(seed, seedText))
}

function setupWorld(seed: Seed, seedText: string): GameState {
  const rng = new Rng(seed)
  const all = [
    'Auralia', 'Veymark', 'Calder', 'Thessaly', 'Norveil', 'Ozurn',
    'Pellucid', 'Harrow', 'Sequana', 'Brumal', 'Kestrel', 'Vantage',
  ]
  const terrains = ['meadow', 'coast', 'highland', 'forest', 'steppe', 'wetland']
  const regions: Region[] = all.map((name, i) => ({
    id: i,
    name,
    terrain: terrains[i % terrains.length],
    stability: STABILITY_BASE,
    dormant: i >= START_REGIONS,
  }))
  return {
    version: SAVE_VERSION,
    seed,
    seedText,
    epoch: 1,
    handInEpoch: 0,
    phase: 'hand',
    flourishing: FLOURISH_START,
    seeds: SEEDS_START,
    regions,
    hand: [],
    deckRest: rng.shuffle(deck()),
    discardPile: [],
    discardsLeft: DISCARDS_PER_HAND,
    playsLeft: 0,
    market: [],
    lawDraft: [],
    laws: [],
    challenge: null,
    lastHandResult: null,
    log: [{ at: 'world', text: `The world of ${seedText} takes root. Four regions wake.` }],
    outcome: null,
    outcomeReason: '',
  }
}

function clone(s: GameState): GameState {
  return {
    ...s,
    regions: s.regions.map((r) => ({ ...r })),
    hand: [...s.hand],
    deckRest: [...s.deckRest],
    discardPile: [...s.discardPile],
    market: s.market.map((m) => ({ ...m })),
    lawDraft: s.lawDraft.map((l) => ({ ...l })),
    laws: s.laws.map((l) => ({ ...l })),
    log: [...s.log],
  }
}

function rngFor(s: GameState, salt: number): Rng {
  return new Rng((s.seed + s.epoch * 2654435761 + s.handInEpoch * 40503 + salt) >>> 0)
}

function drawUp(s: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    if (s.deckRest.length === 0) {
      s.deckRest = rngFor(s, 99).shuffle([...s.discardPile])
      s.discardPile = []
    }
    s.hand.push(s.deckRest.pop() as Card)
  }
}

function dealHand(state: GameState): GameState {
  const s = clone(state)
  if (s.phase === 'game-over') return s
  s.hand = []
  s.discardsLeft = DISCARDS_PER_HAND
  s.playsLeft = HAND_SIZE // every dealt card may be played; hand ends via Advance
  s.handInEpoch += 1
  drawUp(s, HAND_SIZE - s.hand.length)
  s.lastHandResult = evaluate(s.hand)
  s.log.push({
    at: `e${s.epoch}h${s.handInEpoch}`,
    text: `Hand dealt (best: ${s.lastHandResult.category}). Up to ${DISCARDS_PER_HAND} discards.`,
  })
  s.phase = 'hand'
  return s
}

export function applyAction(state: GameState, action: Action): GameState {
  let s = clone(state)
  if (s.phase === 'game-over') return s

  if (action.type === 'enactLaw') {
    if (s.phase !== 'law') throw new Error('not in law phase')
    const law = s.lawDraft.find((l) => l.id === action.lawId)
    if (!law) throw new Error('law not offered')
    if (s.seeds < law.cost) throw new Error(`need ${law.cost} Seeds`)
    s.seeds -= law.cost
    s.laws.push(law)
    s.lawDraft = []
    s.log.push({ at: `e${s.epoch}`, text: `Law enacted: ${law.title}.` })
    s.lawDraft = []
    return advanceEpoch(s)
  }
  if (action.type === 'skipLaw') {
    if (s.phase !== 'law') throw new Error('not in law phase')
    s.lawDraft = []
    s.log.push({ at: `e${s.epoch}`, text: 'Law declined this epoch.' })
    return advanceEpoch(s)
  }
  if (action.type === 'buyCard') {
    const offer = s.market[action.offerIdx]
    if (!offer) throw new Error('no such offer')
    const cost = offerCost(s, offer)
    if (s.seeds < cost) throw new Error(`need ${cost} Seeds`)
    s.seeds -= cost
    s.discardPile.push(offer.card)
    s.market.splice(action.offerIdx, 1)
    s.log.push({ at: `e${s.epoch}h${s.handInEpoch}`, text: `Bought a card for the deck (-${cost} Seeds).` })
    return s
  }

  if (s.phase !== 'hand') throw new Error('not in hand phase')

  if (action.type === 'discard') {
    if (s.discardsLeft <= 0) throw new Error('no discards left this hand')
    const c = s.hand[action.cardIdx]
    if (!c) throw new Error('no such card')
    s.hand.splice(action.cardIdx, 1)
    s.discardPile.push(c)
    s.discardsLeft -= 1
    s.log.push({ at: `e${s.epoch}h${s.handInEpoch}`, text: 'Discarded a card.' })
    return s
  }

  if (action.type === 'play') {
    const c = s.hand[action.cardIdx]
    if (!c) throw new Error('no such card')
    return playCard(s, action.cardIdx, action.regionId)
  }

  if (action.type === 'advance') {
    return advance(s)
  }

  throw new Error('unknown action')
}

function offerCost(s: GameState, offer: MarketOffer): number {
  const discount = s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
  return Math.max(1, offer.cost - discount)
}

function playCard(s: GameState, cardIdx: number, regionId?: number): GameState {
  const c = s.hand[cardIdx]
  if (!c) throw new Error('no such card')
  const rootsBonus = s.laws.reduce((n, l) => n + (l.rootsBonus ?? 0), 0)
  const bloomBonus = s.laws.reduce((n, l) => n + (l.bloomBonus ?? 0), 0)
  let text = ''

  if (c.s === 'S') {
    // ♠ Roots: stability to one living region
    const r = region(s, regionId)
    if (r.dormant) throw new Error('region is dormant')
    const gain = Math.max(1, Math.round(c.r / 4)) + rootsBonus
    r.stability = Math.min(STABILITY_MAX, r.stability + gain)
    text = `Roots in ${r.name}: +${gain} stability.`
  } else if (c.s === 'H') {
    // ♥ Bloom: Flourishing; high cards may also wake a dormant region
    const gain = Math.max(1, Math.round(c.r / 5)) + bloomBonus
    s.flourishing += gain
    text = `Bloom: +${gain} Flourishing.`
    if (c.r >= 12) {
      const dormant = s.regions.find((r) => r.dormant)
      if (dormant) {
        dormant.dormant = false
        text += ` ${dormant.name} wakes.`
      }
    }
  } else if (c.s === 'D') {
    // ♦ Sow: Seeds
    const gain = Math.max(1, Math.round(c.r / 3))
    s.seeds += gain
    text = `Sow: +${gain} Seeds.`
  } else {
    // ♣ Tend: +1 stability everywhere healthy, small Flourishing
    let touched = 0
    for (const r of s.regions) {
      if (!r.dormant && r.stability > 0) {
        r.stability = Math.min(STABILITY_MAX, r.stability + 1)
        touched++
      }
    }
    s.flourishing += 1
    text = `Tend: +1 stability across ${touched} regions, +1 Flourishing.`
  }

  s.hand.splice(cardIdx, 1)
  s.discardPile.push(c)
  s.log.push({ at: `e${s.epoch}h${s.handInEpoch}`, text })
  return s
}

function region(s: GameState, id?: number): Region {
  const r = s.regions.find((x) => x.id === id)
  if (!r) throw new Error('choose a region for this play')
  return r
}

/** Advance: finish the current hand; deal the next or close the epoch. */
function advance(s: GameState): GameState {
  if (s.hand.length > 0) {
    // unplayed cards return to the discard pile
    s.discardPile.push(...s.hand)
    s.hand = []
  }
  s.log.push({ at: `e${s.epoch}h${s.handInEpoch}`, text: `Hand ${s.handInEpoch} advanced.` })

  if (s.handInEpoch < HANDS_PER_EPOCH) {
    return dealHand(s)
  }
  return closeEpoch(s)
}

function closeEpoch(state: GameState): GameState {
  let s = clone(state)
  s.handInEpoch = 0

  // market refresh for the new epoch
  const rng = rngFor(s, 77)
  const rest = [...s.deckRest, ...s.discardPile]
  s.market = []
  for (let i = 0; i < MARKET_SIZE && rest.length > 0; i++) {
    const idx = rng.int(0, rest.length)
    s.market.push({ card: rest.splice(idx, 1)[0], cost: 4 + rng.int(0, 5) })
  }
  s.deckRest = rest.filter((c) => !s.market.some((m) => m.card === c))
  s.discardPile = []
  // NOTE: market cards came from the pool; they stay out until bought (then join discardPile).

  // challenge for the coming epoch
  s.challenge = rollChallenge(s)

  // income
  const seedIncome = s.laws.reduce((n, l) => n + (l.extraSeedsPerEpoch ?? 0), 0)
  const revealed = s.regions.filter((r) => !r.dormant).length
  s.seeds += seedIncome + revealed
  s.log.push({ at: `e${s.epoch}`, text: `Epoch end: +${seedIncome + revealed} Seeds.` })

  // decay
  const decayDelta = s.laws.reduce((n, l) => n + (l.decayDelta ?? 0), 0)
  for (const r of s.regions) {
    if (r.dormant || r.stability <= 0) continue
    r.stability -= 1 + decayDelta
  }

  // challenge resolution
  if (s.challenge && challengeMet(s, s.challenge)) {
    s.flourishing += 2
    s.log.push({ at: `e${s.epoch}`, text: `Challenge met: ${s.challenge.desc} (+2 Flourishing).` })
  } else if (s.challenge) {
    s.flourishing -= 1
    s.log.push({ at: `e${s.epoch}`, text: `Challenge failed: ${s.challenge.desc} (-1 Flourishing).` })
  }
  s.challenge = null

  // law draft (paid enact during law phase)
  const pool = LAWS.filter((l) => !s.laws.some((en) => en.id === l.id))
  if (pool.length > 0 && s.epoch < TOTAL_EPOCHS) {
    const rng2 = rngFor(s, 991)
    const shuffled = rng2.shuffle([...pool])
    s.lawDraft = shuffled.slice(0, 2)
    s.phase = 'law'
    return s
  }
  return afterLaw(s)
}

function rollChallenge(s: GameState): Challenge {
  const rng = rngFor(s, 55)
  const kinds: Challenge['kind'][] = ['stable5', 'revealed', 'stabilitySum']
  const kind = kinds[rng.int(0, kinds.length)]
  if (kind === 'stable5') {
    const need = 2 + rng.int(0, 2)
    return { kind, need, desc: `${need}+ regions at stability 5 or higher` }
  }
  if (kind === 'revealed') {
    const need = 5 + rng.int(0, 3)
    return { kind, need, desc: `${need}+ regions awakened` }
  }
  const sum = 14 + rng.int(0, 8)
  return { kind, need: sum, desc: `total stability of ${sum}+ across living regions` }
}

export function challengeMet(s: GameState, c: Challenge): boolean {
  if (c.kind === 'stable5') return s.regions.filter((r) => !r.dormant && r.stability >= 5).length >= c.need
  if (c.kind === 'revealed') return s.regions.filter((r) => !r.dormant).length >= c.need
  return s.regions.filter((r) => !r.dormant).reduce((n, r) => n + r.stability, 0) >= c.need
}

function afterLaw(s: GameState): GameState {
  if (s.epoch >= TOTAL_EPOCHS) {
    s.phase = 'game-over'
    if (s.flourishing >= FLOURISH_TARGET) {
      s.outcome = 'flourishing'
      s.outcomeReason = `The world flourishes at ${s.flourishing} (target ${FLOURISH_TARGET}) after ${TOTAL_EPOCHS} epochs.`
    } else {
      s.outcome = 'withered'
      s.outcomeReason = `Final Flourishing ${s.flourishing} fell short of ${FLOURISH_TARGET}.`
    }
    return s
  }
  s.epoch += 1
  s.log.push({ at: 'world', text: `— Epoch ${s.epoch} begins —` })
  return dealHand(s)
}

function advanceEpoch(s: GameState): GameState {
  // law enacted mid-stream → continue into next epoch or finish
  return afterLaw(s)
}

/** Check withering loss after any state change that could trigger it. */
export function checkWithering(s: GameState): GameState {
  const dead = s.regions.filter((r) => !r.dormant && r.stability <= 0).length
  if (dead >= WITHERING_LIMIT) {
    s.phase = 'game-over'
    s.outcome = 'withered'
    s.outcomeReason = `${dead} regions withered to 0 stability; the worldhand collapsed.`
  }
  return s
}

export function legalActions(s: GameState): Action[] {
  const acts: Action[] = []
  if (s.phase === 'law') {
    for (const l of s.lawDraft) {
      if (s.seeds >= l.cost) acts.push({ type: 'enactLaw', lawId: l.id })
    }
    acts.push({ type: 'skipLaw' })
    return acts
  }
  if (s.phase !== 'hand') return acts
  if (s.discardsLeft > 0) {
    s.hand.forEach((_, i) => acts.push({ type: 'discard', cardIdx: i }))
  }
  return acts
}

export function suitActionName(s: Suit): string {
  return { S: 'Roots (stability)', H: 'Bloom (Flourishing)', D: 'Sow (Seeds)', C: 'Tend (all regions)' }[s]
}