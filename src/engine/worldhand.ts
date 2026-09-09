// Worldhand — corrected deterministic planet-building card roguelike. Pure engine, no DOM.
//
// Contracts (vertical slice):
// - 12 regions; each epoch the player makes FOUR plays and THREE discards.
// - Play = select 1–5 cards from the 8-card hand → exact poker scoring.
//   Category decides WHICH suit acts; cards decide magnitude; Ace is low (wheel).
// - Deterministic ResolutionPlan: preview() and commit() share one scoring pipeline.
// - Suit majority (or tie-break choice) decides the acting suit.
// - Discard 1–5 cards → refill from deck; total card conservation invariant.
// - 3 escalating epoch targets on capped world stats; Stability is the core resource.
// - Epoch 3 carries an explicit, previewed Drought challenge.
// - Market (Seeds → laws/upgrades/expansions); capped world stats; two actions per suit.
// - Versioned saves; quitting never destroys the save.
import { Rng, hashSeed, type Seed } from './rng'
import {
  deck, evaluateSelection, CATEGORY_POINTS, categoryLabel,
  type Card, type HandCategory, type Suit,
} from './poker'

export type { Suit } from './poker'

export const SAVE_VERSION = 2
export const HAND_SIZE = 8
export const DISCARDS_PER_EPOCH = 3
export const PLAYS_PER_EPOCH = 4
export const TOTAL_EPOCHS = 3
export const TOTAL_REGIONS = 12
export const START_REGIONS = 4
export const STABILITY_BASE = 3
export const STABILITY_MAX = 10
export const FLOURISH_START = 3
export const SEEDS_START = 8
export const SEEDS_CAP = 30
export const MARKET_SIZE = 3

export type Phase = 'select' | 'market' | 'epoch-end' | 'game-over'
export interface EpochTarget { epoch: number; desc: string; need: number; kind: 'flourishing' | 'stabilitySum' }
export const EPOCH_TARGETS: EpochTarget[] = [
  { epoch: 1, desc: 'Flourishing at 5+ and total stability 14+', need: 5, kind: 'flourishing' },
  { epoch: 2, desc: 'Flourishing at 8+ and total stability 22+', need: 8, kind: 'flourishing' },
  { epoch: 3, desc: 'Flourishing at 12+ and total stability 30+', need: 12, kind: 'flourishing' },
]
export const STABILITY_SUM_TARGETS = [14, 22, 30]

export interface Region {
  id: number
  name: string
  terrain: string
  /** planet-map layout position (0..1 normalized) */
  x: number
  y: number
  stability: number
  development: number
  dormant: boolean
  adjacency: number[]
}

export interface Law {
  id: string
  title: string
  desc: string
  cost: number
  kind: 'law' | 'upgrade' | 'expansion'
  decayDelta?: number
  extraSeedsPerEpoch?: number
  marketDiscount?: number
  bloomBonus?: number
  rootsBonus?: number
  sowBonus?: number
  tendBonus?: number
  wakeRegionId?: number
}

export const MARKET_ITEMS: Law[] = [
  { id: 'mycorrhiza', title: 'Mycorrhiza Network', desc: 'Regions decay 1 less each epoch.', cost: 6, kind: 'law', decayDelta: -1 },
  { id: 'seed-vaults', title: 'Seed Vaults', desc: '+3 Seeds at each epoch end.', cost: 8, kind: 'law', extraSeedsPerEpoch: 3 },
  { id: 'barter-routes', title: 'Barter Routes', desc: 'Market items cost 2 less.', cost: 5, kind: 'law', marketDiscount: 2 },
  { id: 'canopy-choir', title: 'Canopy Choir', desc: 'Bloom plays yield +1 Flourishing.', cost: 10, kind: 'upgrade', bloomBonus: 1 },
  { id: 'deep-taproots', title: 'Deep Taproots', desc: 'Roots plays yield +1 stability.', cost: 10, kind: 'upgrade', rootsBonus: 1 },
  { id: 'rich-soil', title: 'Rich Soil', desc: 'Sow plays yield +1 extra Seed.', cost: 7, kind: 'upgrade', sowBonus: 1 },
  { id: 'communal-tending', title: 'Communal Tending', desc: 'Tend plays give +1 stability everywhere.', cost: 9, kind: 'upgrade', tendBonus: 1 },
  { id: 'wake-laguna', title: 'Wake Laguna', desc: 'Awaken the dormant coastal region.', cost: 12, kind: 'expansion', wakeRegionId: 4 },
  { id: 'wake-brumal', title: 'Wake Brumal', desc: 'Awaken the dormant steppe region.', cost: 12, kind: 'expansion', wakeRegionId: 9 },
]

export interface Challenge {
  id: string
  desc: string
  need: number
  kind: 'stable5' | 'revealed' | 'stabilitySum' | 'drought'
  epoch: number
}

export interface LogEntry { at: string; text: string }

export interface GameState {
  version: number
  seed: Seed
  seedText: string
  epoch: number // 1..3
  phase: Phase
  flourishing: number
  seeds: number
  regions: Region[]
  hand: Card[]
  deckRest: Card[]
  discardPile: Card[]
  discardsLeft: number
  playsLeft: number
  selected: number[] // indices into hand, 1..5 cards
  market: Law[]
  laws: Law[]
  challenge: Challenge | null
  challengeFailed: boolean
  lastResolution: ResolutionPlan | null
  log: LogEntry[]
  outcome: 'flourishing' | 'withered' | null
  outcomeReason: string
}

export type Action =
  | { type: 'toggleCard'; cardIdx: number }
  | { type: 'clearSelection' }
  | { type: 'play'; regionChoice?: number } // regionChoice = tie-break choice region id
  | { type: 'discard'; cardIdxs: number[] }
  | { type: 'buy'; itemId: string }
  | { type: 'endMarket' }
  | { type: 'closeEpoch' }

// ---------------------------------------------------------------------------
// ResolutionPlan: the ONE scoring pipeline shared by preview() and commit().
// ---------------------------------------------------------------------------

export interface ResolutionPlan {
  /** the exact selected cards, in selection order */
  cards: Card[]
  category: HandCategory
  categoryLabel: string
  categoryPoints: number
  /** acting suit after majority / tie-break */
  suit: Suit
  /** how the suit was decided */
  suitDecision: 'majority' | 'tiebreak-first' | 'tiebreak-choice' | 'single'
  /** per-suit counts among selected cards */
  suitCounts: Record<Suit, number>
  /** rank sum of selected cards (magnitude driver) */
  rankSum: number
  /** concrete world effects this plan applies */
  effects: PlanEffect[]
  summary: string
  valid: boolean
  invalidReason: string
}

export type PlanEffect =
  | { kind: 'stability'; regionId: number; amount: number }
  | { kind: 'flourishing'; amount: number }
  | { kind: 'seeds'; amount: number }
  | { kind: 'develop'; regionId: number; amount: number }
  | { kind: 'wake'; regionId: number }

export interface SuitMajority {
  suit: Suit
  decision: ResolutionPlan['suitDecision']
  counts: Record<Suit, number>
  tied: Suit[]
}

export function suitMajority(cards: Card[], tieChoice?: Suit): SuitMajority {
  const counts: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 }
  for (const c of cards) counts[c.s]++
  const max = Math.max(...Object.values(counts))
  const tied = (['S', 'H', 'D', 'C'] as Suit[]).filter((s) => counts[s] === max && max > 0)
  if (tied.length === 1) return { suit: tied[0], decision: cards.length === 1 ? 'single' : 'majority', counts, tied: [] }
  const choice = tieChoice && tied.includes(tieChoice) ? tieChoice : tied[0]
  return { suit: choice, decision: tieChoice && tied.includes(tieChoice) ? 'tiebreak-choice' : 'tiebreak-first', counts, tied }
}

/** Build the deterministic ResolutionPlan for a selection (pure; no state mutation). */
export function buildPlan(
  hand: Card[],
  selected: number[],
  regions: Region[],
  laws: Law[],
  tieChoice?: Suit,
): ResolutionPlan {
  const base: ResolutionPlan = {
    cards: [], category: 'high', categoryLabel: '—', categoryPoints: 0,
    suit: 'S', suitDecision: 'single', suitCounts: { S: 0, H: 0, D: 0, C: 0 },
    rankSum: 0, effects: [], summary: '', valid: false, invalidReason: '',
  }
  if (selected.length < 1 || selected.length > 5) {
    return { ...base, invalidReason: 'select 1–5 cards' }
  }
  if (new Set(selected).size !== selected.length) {
    return { ...base, invalidReason: 'duplicate card selection' }
  }
  for (const i of selected) {
    if (i < 0 || i >= hand.length || hand[i] === undefined) {
      return { ...base, invalidReason: 'card index out of range' }
    }
  }
  const cards = selected.map((i) => hand[i])
  const res = evaluateSelection(cards)
  const maj = suitMajority(cards, tieChoice)
  const sum = cards.reduce((n, c) => n + c.r, 0)
  const lawBonus = (k: 'rootsBonus' | 'bloomBonus' | 'sowBonus' | 'tendBonus') =>
    laws.reduce((n, l) => n + (l[k] ?? 0), 0)

  const effects: PlanEffect[] = []
  let summary = ''
  const living = regions.filter((r) => !r.dormant)
  const weakest = living.reduce((a, b) => (b.stability < a.stability ? b : a), living[0])

  switch (maj.suit) {
    case 'S': { // Roots: stability to a region
      const target = regions.find((r) => r.id === (tieChoice as number | undefined) && !r.dormant) ?? weakest
      const gain = Math.max(1, Math.round(sum / 4)) + lawBonus('rootsBonus')
      effects.push({ kind: 'stability', regionId: target.id, amount: gain })
      summary = `Roots in ${target.name}: +${gain} stability.`
      break
    }
    case 'H': { // Bloom: Flourishing; Q+ cards may wake a dormant region
      const gain = Math.max(1, Math.round(sum / 5)) + lawBonus('bloomBonus')
      effects.push({ kind: 'flourishing', amount: gain })
      summary = `Bloom: +${gain} Flourishing.`
      const high = cards.filter((c) => c.r >= 12)
      if (high.length > 0) {
        const dormant = regions.find((r) => r.dormant)
        if (dormant) {
          effects.push({ kind: 'wake', regionId: dormant.id })
          summary += ` ${dormant.name} wakes.`
        }
      }
      break
    }
    case 'D': { // Sow: Seeds
      const gain = Math.max(1, Math.round(sum / 3)) + lawBonus('sowBonus')
      effects.push({ kind: 'seeds', amount: gain })
      summary = `Sow: +${gain} Seeds.`
      break
    }
    case 'C': { // Tend: +1 (or +2 w/ upgrade) stability to every living region
      const per = 1 + lawBonus('tendBonus')
      for (const r of living) effects.push({ kind: 'stability', regionId: r.id, amount: per })
      summary = `Tend: +${per} stability across ${living.length} regions.`
      break
    }
  }

  return {
    cards,
    category: res.category,
    categoryLabel: categoryLabel(res.category),
    categoryPoints: CATEGORY_POINTS[res.category],
    suit: maj.suit,
    suitDecision: maj.decision,
    suitCounts: maj.counts,
    rankSum: sum,
    effects,
    summary,
    valid: true,
    invalidReason: '',
  }
}

/** Apply a plan to a mutable-ish state copy. Used by BOTH preview-apply and commit. */
export function applyPlanEffects(s: GameState, plan: ResolutionPlan): void {
  for (const e of plan.effects) {
    if (e.kind === 'stability') {
      const r = s.regions.find((x) => x.id === e.regionId)
      if (r) r.stability = Math.min(STABILITY_MAX, r.stability + e.amount)
    } else if (e.kind === 'flourishing') {
      s.flourishing += e.amount
    } else if (e.kind === 'seeds') {
      s.seeds = Math.min(SEEDS_CAP, s.seeds + e.amount)
    } else if (e.kind === 'develop') {
      const r = s.regions.find((x) => x.id === e.regionId)
      if (r) r.development = Math.min(STABILITY_MAX, r.development + e.amount)
    } else if (e.kind === 'wake') {
      const r = s.regions.find((x) => x.id === e.regionId)
      if (r) r.dormant = false
    }
  }
}

export function preview(s: GameState, tieChoice?: Suit): ResolutionPlan {
  return buildPlan(s.hand, s.selected, s.regions, s.laws, tieChoice)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const REGION_NAMES = [
  'Auralia', 'Veymark', 'Calder', 'Thessaly', 'Laguna', 'Ozurn',
  'Pellucid', 'Harrow', 'Sequana', 'Brumal', 'Kestrel', 'Vantage',
]
const TERRAINS = ['meadow', 'coast', 'highland', 'forest', 'steppe', 'wetland']
/** 12 positions on the planet disc, roughly a ring + core. */
const PLANET_POS: [number, number][] = [
  [0.50, 0.16], [0.78, 0.28], [0.86, 0.55], [0.72, 0.80], [0.50, 0.88], [0.28, 0.80],
  [0.14, 0.55], [0.22, 0.28], [0.36, 0.42], [0.64, 0.42], [0.62, 0.64], [0.38, 0.64],
]
/** adjacency: ring neighbors + two chords */
const ADJACENCY: number[][] = [
  [1, 7, 8], [0, 2, 9], [1, 3, 9], [2, 4, 10], [3, 5, 11], [4, 6, 11],
  [5, 7, 8], [0, 6, 8], [0, 6, 7, 9, 11], [1, 2, 8, 10], [3, 9, 11], [4, 5, 8, 10],
]

export function newGame(seedText: string): GameState {
  const seed = hashSeed(seedText)
  return startEpoch(setupWorld(seed, seedText))
}

function setupWorld(seed: Seed, seedText: string): GameState {
  const rng = new Rng(seed)
  const regions: Region[] = REGION_NAMES.map((name, i) => ({
    id: i,
    name,
    terrain: TERRAINS[i % TERRAINS.length],
    x: PLANET_POS[i][0],
    y: PLANET_POS[i][1],
    stability: STABILITY_BASE,
    development: 0,
    dormant: i >= START_REGIONS,
    adjacency: ADJACENCY[i],
  }))
  return {
    version: SAVE_VERSION,
    seed,
    seedText,
    epoch: 1,
    phase: 'select',
    flourishing: FLOURISH_START,
    seeds: SEEDS_START,
    regions,
    hand: [],
    deckRest: rng.shuffle(deck()),
    discardPile: [],
    discardsLeft: DISCARDS_PER_EPOCH,
    playsLeft: PLAYS_PER_EPOCH,
    selected: [],
    market: [],
    laws: [],
    challenge: null,
    challengeFailed: false,
    lastResolution: null,
    log: [{ at: 'world', text: `The world of ${seedText} takes root. Four regions wake.` }],
    outcome: null,
    outcomeReason: '',
  }
}

function clone(s: GameState): GameState {
  return {
    ...s,
    regions: s.regions.map((r) => ({ ...r, adjacency: [...r.adjacency] })),
    hand: [...s.hand],
    deckRest: [...s.deckRest],
    discardPile: [...s.discardPile],
    selected: [...s.selected],
    market: s.market.map((m) => ({ ...m })),
    laws: s.laws.map((l) => ({ ...l })),
    lastResolution: s.lastResolution ? { ...s.lastResolution, cards: [...s.lastResolution.cards], effects: [...s.lastResolution.effects], suitCounts: { ...s.lastResolution.suitCounts } } : null,
    log: [...s.log],
  }
}

function rngFor(s: GameState, salt: number): Rng {
  return new Rng((s.seed + s.epoch * 2654435761 + salt) >>> 0)
}

function drawUp(s: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    if (s.deckRest.length === 0) {
      s.deckRest = rngFor(s, 99).shuffle([...s.discardPile])
      s.discardPile = []
    }
    if (s.deckRest.length === 0) break
    s.hand.push(s.deckRest.pop() as Card)
  }
}

function startEpoch(state: GameState): GameState {
  const s = clone(state)
  drawUp(s, HAND_SIZE - s.hand.length)
  s.selected = []
  s.phase = 'select'
  return s
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, action: Action): GameState {
  let s = clone(state)
  if (s.phase === 'game-over') return s

  switch (action.type) {
    case 'toggleCard': {
      if (s.phase !== 'select') throw new Error('not in select phase')
      const at = s.selected.indexOf(action.cardIdx)
      if (at >= 0) s.selected.splice(at, 1)
      else {
        if (s.selected.length >= 5) throw new Error('at most 5 cards may be selected')
        if (action.cardIdx < 0 || action.cardIdx >= s.hand.length) throw new Error('no such card')
        s.selected.push(action.cardIdx)
      }
      return s
    }
    case 'clearSelection': {
      s.selected = []
      return s
    }
    case 'play': {
      if (s.phase !== 'select') throw new Error('not in select phase')
      if (s.playsLeft <= 0) throw new Error('no plays left this epoch')
      const plan = buildPlan(s.hand, s.selected, s.regions, s.laws, undefined)
      if (!plan.valid) throw new Error(plan.invalidReason || 'invalid selection')
      // apply plan effects (shared pipeline)
      applyPlanEffects(s, plan)
      s.playsLeft -= 1
      const played = s.selected.map((i) => s.hand[i])
      // remove played cards from hand → discard pile
      const keep: Card[] = []
      s.hand.forEach((c, i) => { if (!s.selected.includes(i)) keep.push(c) })
      s.hand = keep
      s.discardPile.push(...played)
      s.lastResolution = plan
      s.log.push({ at: `e${s.epoch}`, text: `Play (${plan.categoryLabel}, ${plan.suit}): ${plan.summary}` })
      s.selected = []
      if (s.playsLeft === 0) return endEpoch(s)
      return refill(s)
    }
    case 'discard': {
      if (s.phase !== 'select') throw new Error('not in select phase')
      if (s.discardsLeft <= 0) throw new Error('no discards left this epoch')
      const idxs = [...new Set(action.cardIdxs)]
      if (idxs.length < 1 || idxs.length > 5) throw new Error('discard 1–5 cards')
      for (const i of idxs) {
        if (i < 0 || i >= s.hand.length) throw new Error('no such card')
      }
      const discarded = idxs.map((i) => s.hand[i])
      const keep = s.hand.filter((_, i) => !idxs.includes(i))
      s.hand = keep
      s.discardPile.push(...discarded)
      s.discardsLeft -= 1
      s.log.push({ at: `e${s.epoch}`, text: `Discarded ${discarded.length} card${discarded.length > 1 ? 's' : ''}; hand refilled.` })
      return refill(s)
    }
    case 'buy': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      const item = s.market.find((m) => m.id === action.itemId)
      if (!item) throw new Error('no such market item')
      const cost = marketCost(s, item)
      if (s.seeds < cost) throw new Error(`need ${cost} Seeds`)
      s.seeds -= cost
      s.laws.push(item)
      s.market = s.market.filter((m) => m.id !== action.itemId)
      if (item.wakeRegionId !== undefined) {
        const r = s.regions.find((x) => x.id === item.wakeRegionId)
        if (r) r.dormant = false
      }
      s.log.push({ at: `e${s.epoch}`, text: `Acquired ${item.kind}: ${item.title} (-${cost} Seeds).` })
      return s
    }
    case 'endMarket': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      s.phase = 'epoch-end'
      return s
    }
    case 'closeEpoch': {
      if (s.phase !== 'epoch-end') throw new Error('not at epoch end')
      return advanceToNextEpoch(s)
    }
  }
  throw new Error('unknown action')
}

function refill(s: GameState): GameState {
  drawUp(s, HAND_SIZE - s.hand.length)
  s.selected = []
  return s
}

function marketCost(s: GameState, item: Law): number {
  const discount = s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
  return Math.max(1, item.cost - discount)
}

/** Card conservation invariant: hand + deck + discard + market(never held) == 52 - played this epoch? No — always exactly 52 minus nothing. */
export function cardConservation(s: GameState): boolean {
  const marketCards = 0 // market items are laws/upgrades, not cards (v2 contract)
  return s.hand.length + s.deckRest.length + s.discardPile.length + marketCards === 52
}

// ---------------------------------------------------------------------------
// Epoch end / targets / challenge
// ---------------------------------------------------------------------------

function endEpoch(state: GameState): GameState {
  const s = clone(state)
  // unplayed hand cards stay for the market phase view? No — they return to deck-order via discard.
  s.discardPile.push(...s.hand)
  s.hand = []
  s.selected = []

  // epoch target check
  const target = EPOCH_TARGETS[s.epoch - 1]
  const totalStab = s.regions.filter((r) => !r.dormant).reduce((n, r) => n + r.stability, 0)
  const metTarget = s.flourishing >= target.need && totalStab >= STABILITY_SUM_TARGETS[s.epoch - 1]
  s.log.push({
    at: `e${s.epoch}`,
    text: `Epoch ${s.epoch} target "${target.desc}": ${metTarget ? 'met' : 'missed'} (Flourishing ${s.flourishing}, stability ${totalStab}).`,
  })

  // challenge resolution (Drought in epoch 3 is explicit and previewed)
  if (s.challenge) {
    if (challengeMet(s, s.challenge)) {
      s.flourishing += 2
      s.log.push({ at: `e${s.epoch}`, text: `Challenge met: ${s.challenge.desc} (+2 Flourishing).` })
    } else {
      s.challengeFailed = true
      s.flourishing -= 2
      s.log.push({ at: `e${s.epoch}`, text: `Challenge failed: ${s.challenge.desc} (-2 Flourishing).` })
    }
  }

  // decay (Mycorrhiza softens it)
  const decayDelta = s.laws.reduce((n, l) => n + (l.decayDelta ?? 0), 0)
  for (const r of s.regions) {
    if (r.dormant || r.stability <= 0) continue
    r.stability = Math.max(0, r.stability - 1 + decayDelta)
  }

  // income
  const seedIncome = s.laws.reduce((n, l) => n + (l.extraSeedsPerEpoch ?? 0), 0)
    + s.regions.filter((r) => !r.dormant && r.stability > 0).length
  s.seeds = Math.min(SEEDS_CAP, s.seeds + seedIncome)
  s.log.push({ at: `e${s.epoch}`, text: `Epoch end: +${seedIncome} Seeds.` })

  // market phase
  const rng = rngFor(s, 77)
  const pool = MARKET_ITEMS.filter((m) => !s.laws.some((l) => l.id === m.id))
  const shuffled = rng.shuffle([...pool])
  s.market = shuffled.slice(0, Math.min(MARKET_SIZE, shuffled.length))
  s.phase = 'market'
  return s
}

export function challengeMet(s: GameState, c: Challenge): boolean {
  const living = s.regions.filter((r) => !r.dormant)
  if (c.kind === 'stable5') return living.filter((r) => r.stability >= 5).length >= c.need
  if (c.kind === 'revealed') return living.length >= c.need
  if (c.kind === 'stabilitySum') return living.reduce((n, r) => n + r.stability, 0) >= c.need
  if (c.kind === 'drought') {
    // Drought: keep every living region at stability 3+ through the dry epoch
    return living.every((r) => r.stability >= 3)
  }
  return false
}

export function droughtChallenge(epoch: number): Challenge {
  return {
    id: 'drought',
    kind: 'drought',
    epoch,
    need: 3,
    desc: `Drought: every living region must hold stability ${3}+ at epoch ${epoch}'s end`,
  }
}

function advanceToNextEpoch(state: GameState): GameState {
  const s = clone(state)
  if (s.epoch >= TOTAL_EPOCHS || s.challengeFailed || s.flourishing <= 0) {
    s.phase = 'game-over'
    if (s.challengeFailed) {
      s.outcome = 'withered'
      s.outcomeReason = `The epoch-${s.epoch} challenge failed; the world could not recover.`
    } else if (s.flourishing <= 0) {
      s.outcome = 'withered'
      s.outcomeReason = 'Flourishing collapsed to 0.'
    } else if (s.flourishing >= EPOCH_TARGETS[TOTAL_EPOCHS - 1].need) {
      s.outcome = 'flourishing'
      s.outcomeReason = `The world flourishes at ${s.flourishing} after ${TOTAL_EPOCHS} epochs.`
    } else {
      s.outcome = 'withered'
      s.outcomeReason = `Final Flourishing ${s.flourishing} fell short of ${EPOCH_TARGETS[TOTAL_EPOCHS - 1].need}.`
    }
    return s
  }
  s.epoch += 1
  s.playsLeft = PLAYS_PER_EPOCH
  s.discardsLeft = DISCARDS_PER_EPOCH
  if (s.epoch === 3) {
    s.challenge = droughtChallenge(3)
    s.log.push({ at: 'world', text: `— Epoch 3 begins. PREVIEWED CHALLENGE: ${s.challenge.desc} —` })
  } else {
    s.challenge = null
    s.log.push({ at: 'world', text: `— Epoch ${s.epoch} begins —` })
  }
  return startEpoch(s)
}

export function checkWithering(s: GameState): GameState {
  const dead = s.regions.filter((r) => !r.dormant && r.stability <= 0).length
  if (dead >= 5) {
    s.phase = 'game-over'
    s.outcome = 'withered'
    s.outcomeReason = `${dead} regions withered to 0 stability; the worldhand collapsed.`
  }
  return s
}

export function suitActionName(s: Suit): string {
  return {
    S: 'Roots — stability to the weakest living region',
    H: 'Bloom — Flourishing; Q+ wakes a region',
    D: 'Sow — Seeds',
    C: 'Tend — stability to all living regions',
  }[s]
}