// Worldhand — planet-building roguelike engine. Pure, deterministic given seed + action order.
//
// Core loop: each epoch you hold an 8-card hand. Your best 5-card poker hand from those
// 8 cards is your "hand strength". You spend 3 World Actions per epoch applying that
// strength to regions (Prosper / Fortify / Survey / Trade / Wonder). At epoch end,
// regions decay, a law is enacted, and a fresh hand is dealt. No gambling, no betting.
import { Rng, hashSeed, type Seed } from './rng'
import { deck, evaluate, type Card, type HandResult } from './poker'

export const SAVE_VERSION = 1
export const HAND_SIZE = 8
export const ACTIONS_PER_EPOCH = 3
export const MAX_EPOCHS = 15
export const WONDERS_TO_WIN = 3
export const MAX_FRACTURED = 3
export const MAX_REGIONS = 6
export const MARKET_SIZE = 3
export const MARKET_COST = 6
export const STABILITY_CAP = 10
export const START_ORDER = 10

export type Phase = 'actions' | 'law' | 'game-over'

export type Terrain = 'plains' | 'coast' | 'mountain' | 'forest' | 'volcanic' | 'tundra'

export interface Region {
  id: number
  name: string
  terrain: Terrain
  stability: number
  fractured: boolean
  wonder: boolean
}

export interface Law {
  id: string
  title: string
  desc: string
  /** bonus order gained at end of each epoch */
  epochOrder?: number
  /** reduces stability decay each epoch */
  decayDelta?: number
  /** market discount */
  marketDiscount?: number
  /** survey never fails */
  surveyAlwaysSucceeds?: boolean
  /** extra world action per epoch */
  extraAction?: number
}

export const LAWS: Law[] = [
  { id: 'terra-fee', title: 'Terra Fee', desc: '+2 Order at the end of every epoch.', epochOrder: 2 },
  { id: 'deep-roots', title: 'Deep Roots', desc: 'Regions decay 1 less stability each epoch.', decayDelta: -1 },
  { id: 'open-markets', title: 'Open Markets', desc: 'Market cards cost 2 less Order.', marketDiscount: 2 },
  { id: 'sky-watch', title: 'Sky Watch', desc: 'Surveys always reveal new regions.', surveyAlwaysSucceeds: true },
  { id: 'great-works', title: 'Great Works', desc: '+1 World Action every epoch.', extraAction: 1 },
  { id: 'stone-covenant', title: 'Stone Covenant', desc: '+3 Order each epoch; regions decay 1 more.', epochOrder: 3, decayDelta: 1 },
]

export interface MarketOffer {
  card: Card
  cost: number
}

export interface LogEntry {
  epoch: number
  text: string
}

export interface GameState {
  version: number
  seed: Seed
  seedText: string
  epoch: number
  phase: Phase
  actionsLeft: number
  order: number
  regions: Region[]
  hand: Card[]
  deckRest: Card[]
  discard: Card[]
  market: MarketOffer[]
  lawDraft: Law[]
  laws: Law[]
  log: LogEntry[]
  bestHand: HandResult | null
  outcome: 'won' | 'lost' | null
  outcomeReason: string
  surveyPending: boolean
}

export type Action =
  | { type: 'prosper'; regionId: number }
  | { type: 'fortify'; regionId: number }
  | { type: 'survey' }
  | { type: 'trade' }
  | { type: 'buyCard'; offerIdx: number }
  | { type: 'wonder'; regionId: number }
  | { type: 'discardCard'; cardIdx: number }
  | { type: 'enactLaw'; lawId: string }
  | { type: 'endActions' }

export function newGame(seedText: string): GameState {
  const seed = hashSeed(seedText)
  const s = makeInitial(seed, seedText)
  return startEpoch(s)
}

function makeInitial(seed: Seed, seedText: string): GameState {
  return {
    version: SAVE_VERSION,
    seed,
    seedText,
    epoch: 0,
    phase: 'actions',
    actionsLeft: 0,
    order: START_ORDER,
    regions: [],
    hand: [],
    deckRest: [],
    discard: [],
    market: [],
    lawDraft: [],
    laws: [],
    log: [],
    bestHand: null,
    outcome: null,
    outcomeReason: '',
    surveyPending: false,
  }
}

function clone(s: GameState): GameState {
  return {
    ...s,
    regions: s.regions.map((r) => ({ ...r })),
    hand: [...s.hand],
    deckRest: [...s.deckRest],
    discard: [...s.discard],
    market: s.market.map((m) => ({ ...m })),
    lawDraft: [...s.lawDraft],
    laws: s.laws.map((l) => ({ ...l })),
    log: [...s.log],
  }
}

const REGION_NAMES = ['Auralia', 'Veymark', 'Calder', 'Thessaly', 'Norveil', 'Ozurn']
const TERRAINS: Terrain[] = ['plains', 'coast', 'mountain', 'forest', 'volcanic', 'tundra']

function epochRng(s: GameState): Rng {
  return new Rng((s.seed + s.epoch * 2654435761) >>> 0)
}

function startEpoch(s: GameState): GameState {
  s = clone(s)
  if (s.phase === 'game-over') return s
  s.epoch += 1
  s.bestHand = null
  s.surveyPending = false
  const rng = epochRng(s)

  if (s.epoch === 1) {
    // starting world: 3 revealed regions
    for (let i = 0; i < 3; i++) {
      s.regions.push({
        id: i,
        name: REGION_NAMES[i],
        terrain: TERRAINS[rng.int(0, TERRAINS.length)],
        stability: 5 + rng.int(0, 3),
        fractured: false,
        wonder: false,
      })
    }
    s.log.push({ epoch: 1, text: 'The first age begins. Three regions stand.' })
  } else {
    s.log.push({ epoch: s.epoch, text: `— Epoch ${s.epoch} —` })
  }

  // build/reshuffle deck from discard
  const full = rng.shuffle(
    s.epoch === 1
      ? deck()
      : [...s.deckRest, ...s.discard],
  )
  s.deckRest = full
  s.discard = []
  s.hand = s.deckRest.splice(-HAND_SIZE)
  s.market = []
  s.lawDraft = []

  const extra = s.laws.reduce((n, l) => n + (l.extraAction ?? 0), 0)
  s.actionsLeft = ACTIONS_PER_EPOCH + extra
  s.phase = 'actions'

  // recompute best hand
  if (s.hand.length >= 5) s.bestHand = evaluate(s.hand)
  return s
}

function endEpoch(s: GameState): GameState {
  s = clone(s)
  const rng = epochRng(s)
  // income from laws
  let income = s.laws.reduce((n, l) => n + (l.epochOrder ?? 0), 0)
  // production from healthy regions
  for (const r of s.regions) {
    if (!r.fractured) income += 1
  }
  s.order += income
  s.log.push({ epoch: s.epoch, text: `End of epoch: +${income} Order.` })

  // decay
  const decayDelta = s.laws.reduce((n, l) => n + (l.decayDelta ?? 0), 0)
  for (const r of s.regions) {
    if (r.fractured) continue
    r.stability -= 1 + decayDelta
    if (r.stability <= 0) {
      r.stability = 0
      r.fractured = true
      s.log.push({ epoch: s.epoch, text: `${r.name} has fractured.` })
    }
  }

  // law draft (2 random laws not yet enacted)
  const pool = LAWS.filter((l) => !s.laws.some((en) => en.id === l.id))
  if (pool.length > 0) {
    const shuffled = rng.shuffle([...pool])
    s.lawDraft = shuffled.slice(0, 2)
    s.phase = 'law'
    return s
  }
  return checkOutcome(s)
}

function checkOutcome(s: GameState): GameState {
  const fractured = s.regions.filter((r) => r.fractured).length
  const wonders = s.regions.filter((r) => r.wonder).length
  if (wonders >= WONDERS_TO_WIN) {
    s.phase = 'game-over'
    s.outcome = 'won'
    s.outcomeReason = `Three wonders raise the Worldhand in epoch ${s.epoch}.`
    return s
  }
  if (fractured >= MAX_FRACTURED) {
    s.phase = 'game-over'
    s.outcome = 'lost'
    s.outcomeReason = `${fractured} regions fractured; the worldhand crumbled in epoch ${s.epoch}.`
    return s
  }
  if (s.epoch >= MAX_EPOCHS) {
    s.phase = 'game-over'
    s.outcome = wonders >= 2 ? 'won' : 'lost'
    s.outcomeReason = `Final epoch reached: ${wonders} wonder(s), ${fractured} fractured region(s).`
    return s
  }
  return startEpoch(s)
}

export function applyAction(state: GameState, action: Action): GameState {
  let s = clone(state)
  if (s.phase === 'game-over') return s

  switch (action.type) {
    case 'enactLaw': {
      if (s.phase !== 'law') throw new Error('not in law phase')
      const law = s.lawDraft.find((l) => l.id === action.lawId)
      if (!law) throw new Error('law not in draft')
      s.laws.push(law)
      s.log.push({ epoch: s.epoch, text: `Law enacted: ${law.title} — ${law.desc}` })
      s.lawDraft = []
      return checkOutcome(s)
    }
    case 'buyCard': {
      const offer = s.market[action.offerIdx]
      if (!offer) throw new Error('no such offer')
      const discount = s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
      const cost = Math.max(1, offer.cost - discount)
      if (s.order < cost) throw new Error('not enough Order')
      s.order -= cost
      s.deckRest.push(offer.card)
      s.market.splice(action.offerIdx, 1)
      s.log.push({ epoch: s.epoch, text: `Bought a card for the world deck (-${cost} Order).` })
      return s
    }
    default:
      break
  }

  if (s.phase !== 'actions') throw new Error('not in action phase')
  if (s.actionsLeft <= 0) throw new Error('no actions left')

  const strength = s.bestHand ? s.bestHand.key[0] : 0 // 0..8
  const cat = s.bestHand?.category ?? 'high'

  if (action.type === 'prosper') {
    const r = findRegion(s, action.regionId)
    if (r.fractured) throw new Error('region is fractured')
    const gain = 3 + strength * 2
    s.order += gain
    s.actionsLeft -= 1
    s.log.push({ epoch: s.epoch, text: `Prospered ${r.name} (${cat}): +${gain} Order.` })
  } else if (action.type === 'fortify') {
    const r = findRegion(s, action.regionId)
    if (r.fractured) {
      // repair instead
      r.stability = 3
      r.fractured = false
      s.actionsLeft -= 1
      s.log.push({ epoch: s.epoch, text: `Repaired ${r.name} to stability 3.` })
    } else {
      r.stability = Math.min(STABILITY_CAP, r.stability + 2 + strength)
      s.actionsLeft -= 1
      s.log.push({ epoch: s.epoch, text: `Fortified ${r.name} (${cat}) to stability ${r.stability}.` })
    }
  } else if (action.type === 'survey') {
    const always = s.laws.some((l) => l.surveyAlwaysSucceeds)
    const rng = epochRng(s)
    const success = always || rng.next() < 0.45 + strength * 0.05
    if (success && s.regions.length < MAX_REGIONS) {
      const id = s.regions.length
      s.regions.push({
        id,
        name: REGION_NAMES[id],
        terrain: TERRAINS[rng.int(0, TERRAINS.length)],
        stability: 4 + rng.int(0, 3),
        fractured: false,
        wonder: false,
      })
      s.log.push({ epoch: s.epoch, text: `Surveyed and revealed ${REGION_NAMES[id]}.` })
    } else {
      s.order += 2
      s.log.push({ epoch: s.epoch, text: success ? 'Survey found no new lands: +2 Order.' : 'Survey failed: +2 Order salvage.' })
    }
    s.actionsLeft -= 1
  } else if (action.type === 'trade') {
    const rng = epochRng(s)
    const rest = [...s.deckRest]
    s.market = []
    for (let i = 0; i < MARKET_SIZE && rest.length > 0; i++) {
      const idx = rng.int(0, rest.length)
      s.market.push({ card: rest.splice(idx, 1)[0], cost: MARKET_COST })
    }
    s.deckRest = rest
    s.actionsLeft -= 1
    s.log.push({ epoch: s.epoch, text: 'Markets opened for the epoch.' })
  } else if (action.type === 'wonder') {
    const r = findRegion(s, action.regionId)
    if (r.fractured) throw new Error('cannot build on a fractured region')
    if (r.wonder) throw new Error('wonder already stands here')
    if (r.stability < 6) throw new Error('region needs stability 6+')
    if (strength < 5) throw new Error(`hand too weak (${cat}); need flush or better`)
    if (s.order < 12) throw new Error('need 12 Order')
    s.order -= 12
    r.wonder = true
    s.actionsLeft -= 1
    s.log.push({ epoch: s.epoch, text: `A Wonder rises in ${r.name}! (${s.regions.filter((x) => x.wonder).length}/${WONDERS_TO_WIN})` })
  } else if (action.type === 'discardCard') {
    const c = s.hand[action.cardIdx]
    if (!c) throw new Error('no such card')
    s.hand.splice(action.cardIdx, 1)
    s.discard.push(c)
    if (s.hand.length >= 5) s.bestHand = evaluate(s.hand)
    s.log.push({ epoch: s.epoch, text: 'Discarded a card to reshape the hand.' })
  } else if (action.type === 'endActions') {
    s.actionsLeft = 0
  } else {
    throw new Error('unknown action')
  }

  if (s.actionsLeft <= 0) {
    s = endEpoch(s)
  }
  return s
}

function findRegion(s: GameState, id: number): Region {
  const r = s.regions.find((x) => x.id === id)
  if (!r) throw new Error('no such region')
  return r
}

export function legalActions(s: GameState): Action[] {
  const acts: Action[] = []
  if (s.phase === 'law') {
    for (const l of s.lawDraft) acts.push({ type: 'enactLaw', lawId: l.id })
    return acts
  }
  if (s.phase !== 'actions' || s.actionsLeft <= 0) return acts
  for (const r of s.regions) {
    if (!r.fractured) {
      acts.push({ type: 'prosper', regionId: r.id })
      acts.push({ type: 'fortify', regionId: r.id })
      if (r.stability >= 6 && !r.wonder) acts.push({ type: 'wonder', regionId: r.id })
    } else {
      acts.push({ type: 'fortify', regionId: r.id })
    }
  }
  acts.push({ type: 'survey' })
  if (s.market.length > 0) {
    const discount = s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
    s.market.forEach((m, i) => {
      if (s.order >= Math.max(1, m.cost - discount)) acts.push({ type: 'buyCard', offerIdx: i })
    })
  } else {
    acts.push({ type: 'trade' })
  }
  acts.push({ type: 'endActions' })
  return acts
}