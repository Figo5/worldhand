// Worldhand — deterministic planet-building card roguelike. Pure engine, no DOM.
//
// Contracts (Balatro-simple edition — play poker hands, earn money, spend money):
// - 12 regions; each epoch the player makes FOUR plays and THREE discards.
// - A play is JUST "play a poker hand": select 1–5 cards from the 8-card hand →
//   exact poker scoring → the hand resolves to ONE hero number, Growth.
//   No suit decision, no region choice, no per-suit world actions.
// - AUTO-EARN Seeds on every play: seeds += SEEDS_PER_GROWTH × Growth, capped
//   at SEEDS_CAP — hand quality IS the economy. There is no separate Mine action.
// - HERO SCORE — every play resolves to ONE number, **Growth**:
//       1. poker base = rankSum ("chips") × CATEGORY_MULT[category]
//       2. World Laws = owned flat bonus laws (growBonus)
//     Growth = max(0, pokerBase + lawBonus). No region/drought modifiers.
//   Flourishing (the single epoch target) is the cumulative sum of Growth.
// - Survival is exactly Balatro-style lives: start 3; miss an epoch target →
//   lose 1; 0 → game over (withered). Winning = beat the epoch-3 target.
// - Market (Balatro shop): spend Seeds on poker-hand upgrades, card additions
//   (deck conservation still holds — added cards are real 52+ cards), region
//   expansion (wake a dormant region → planet visibly grows), and World Laws.
// - Deterministic ResolutionPlan: preview() and commit() share one scoring
//   pipeline; the plan carries `growth` plus the ordered `growthParts`.
// - Versioned saves; quitting never destroys the save.
import { Rng, hashSeed, type Seed } from './rng'
import {
  deck, evaluateSelection, CATEGORY_POINTS, CATEGORY_MULT, categoryLabel,
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
export const SURVIVAL_START = 3
export const SURVIVAL_MAX = 3
export const FLOURISH_START = 3
export const SEEDS_START = 8
export const SEEDS_CAP = 30
export const MARKET_SIZE = 3
export const LIVES_CAP = 3

/** The 3 escalating epoch targets: cumulative Growth (Flourishing), one per
 *  epoch, strictly increasing. Calibrated with `LOOK=30 npx vite-node
 *  scripts/solve.mjs` into the 40–60% win-rate band (see RULES.md / Balance). */
export const EPOCH_TARGETS: EpochTarget[] = [
  { epoch: 1, desc: 'Growth 45 (cumulative Flourishing)', need: 45 },
  { epoch: 2, desc: 'Growth 110 (cumulative Flourishing)', need: 110 },
  { epoch: 3, desc: 'Growth 360 (cumulative Flourishing)', need: 360 },
]

export type Phase = 'select' | 'market' | 'epoch-end' | 'game-over'
export interface EpochTarget { epoch: number; desc: string; need: number }

export interface Region {
  id: number
  name: string
  terrain: string
  /** planet-map layout position (0..1 normalized) */
  x: number
  y: number
  stability: number
  /** drives the 3D planet's evolution icons (presentation only — no gameplay use) */
  development: number
  dormant: boolean
  adjacency: number[]
}

export interface Law {
  id: string
  title: string
  desc: string
  cost: number
  kind: 'law' | 'upgrade' | 'expansion' | 'cards'
  /** economy laws */
  decayDelta?: number
  extraSeedsPerEpoch?: number
  marketDiscount?: number
  /** Growth bonuses (World Laws + poker-hand upgrades) */
  growthMult?: number
  growthFlat?: number
  /** hand size +1 (card addition) */
  handSize?: number
  /** expansion: wake a dormant region → the planet visibly grows */
  wakeRegionId?: number
}

export const MARKET_ITEMS: Law[] = [
  { id: 'mycorrhiza', title: 'Mycorrhiza Network', desc: 'Regions decay 1 less each epoch.', cost: 6, kind: 'law', decayDelta: -1 },
  { id: 'seed-vaults', title: 'Seed Vaults', desc: '+3 Seeds at each epoch end.', cost: 8, kind: 'law', extraSeedsPerEpoch: 3 },
  { id: 'barter-routes', title: 'Barter Routes', desc: 'Market items cost 2 less.', cost: 5, kind: 'law', marketDiscount: 2 },
  { id: 'canopy-choir', title: 'Canopy Choir', desc: 'Every play: +3 Growth.', cost: 10, kind: 'upgrade', growthFlat: 3 },
  { id: 'stone-masonry', title: 'Stone Masonry', desc: 'Every play: +6 Growth.', cost: 16, kind: 'upgrade', growthFlat: 6 },
  { id: 'open-canals', title: 'Open Canals', desc: 'Growth x1.2 on every play.', cost: 14, kind: 'upgrade', growthMult: 1.2 },
  { id: 'fourth-counsel', title: 'Fourth Counsel', desc: 'Hand grows to 9 cards each epoch.', cost: 12, kind: 'cards', handSize: 1 },
  { id: 'fifth-counsel', title: 'Fifth Counsel', desc: 'Hand grows to 10 cards each epoch.', cost: 18, kind: 'cards', handSize: 1 },
  { id: 'wake-laguna', title: 'Wake Laguna', desc: 'Awaken the dormant coastal region — the planet visibly grows.', cost: 12, kind: 'expansion', wakeRegionId: 4 },
  { id: 'wake-brumal', title: 'Wake Brumal', desc: 'Awaken the dormant steppe region — the planet visibly grows.', cost: 12, kind: 'expansion', wakeRegionId: 9 },
]

export interface LogEntry { at: string; text: string }

export interface GameState {
  version: number
  seed: Seed
  seedText: string
  epoch: number // 1..3
  phase: Phase
  flourishing: number
  /** Balatro-style lives: a missed epoch target costs 1; 0 → game over (withered). */
  lives: number
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
  lastResolution: ResolutionPlan | null
  log: LogEntry[]
  outcome: 'flourishing' | 'withered' | null
  outcomeReason: string
}

export type Action =
  | { type: 'toggleCard'; cardIdx: number }
  | { type: 'clearSelection' }
  | { type: 'play' }
  | { type: 'discard'; cardIdxs: number[] }
  | { type: 'buy'; itemId: string }
  | { type: 'removeLaw'; lawId: string }
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
  /** per-suit counts among selected cards (informational display only) */
  suitCounts: Record<Suit, number>
  /** rank sum of selected cards ("chips") */
  rankSum: number
  /** poker base = rankSum × CATEGORY_MULT (chips × mult) */
  pokerBase: number
  /** the hand's multiplier (CATEGORY_MULT[category]) */
  mult: number
  /** HERO SCORE: the one big number this play resolves to (>= 0).
   *  Growth = max(0, pokerBase × multLaw + flatLaw). */
  growth: number
  /** ordered breakdown of `growth`: poker → laws (mult + flat). */
  growthParts: { poker: number; laws: number }
  effects: PlanEffect[]
  summary: string
  valid: boolean
  invalidReason: string
}

export type PlanEffect =
  | { kind: 'flourishing'; amount: number }
  | { kind: 'seeds'; amount: number }

/** The auto-Seeds economy (documented formula): every play earns Seeds
 *  directly from its hand quality — no separate Mine action.
 *      seedsGained = min(SEEDS_CAP − seeds, ceil(Growth × SEEDS_PER_GROWTH))
 *  i.e. 1 Seed per 4 Growth (a ×12 flush banks 3 Seeds at once), and the
 *  income is capped by SEEDS_CAP like every other Seed source. */
export const SEEDS_PER_GROWTH = 1 / 4

/** Owned-law Growth multiplier: the sum of every owned growthMult, floored at
 *  1 so the multiplier can only help. Open Canals (x1.2) → mult 1.2. */
export function lawGrowthMult(laws: Law[]): number {
  return Math.max(1, laws.reduce((n, l) => n + (l.growthMult ?? 0), 0))
}

/** Owned-law flat Growth bonus (Canopy Choir +3, Stone Masonry +6). */
export function lawGrowthFlat(laws: Law[]): number {
  return laws.reduce((n, l) => n + (l.growthFlat ?? 0), 0)
}

/** The card-addition slot: owned handSize laws extend the dealt hand
 *  (Fourth Counsel → 9, Fifth Counsel → 10). Max 5 owned items total. */
export function handSizeOf(laws: Law[]): number {
  return HAND_SIZE + laws.reduce((n, l) => n + (l.handSize ?? 0), 0)
}

/** Build the deterministic ResolutionPlan for a selection (pure; no state mutation).
 *
 * The HERO SCORE 'Growth' is computed here, in ONE place, in a stable order:
 *   1. poker base  = rankSum ("chips") × CATEGORY_MULT[category] (chips × mult)
 *   2. World Laws  = ×(owned growthMult, floored at 1) then +(owned growthFlat)
 *   Growth = max(0, round(pokerBase × lawMult) + lawFlat). The plan carries the
 * final number (`growth`) plus the ordered parts (`growthParts`); preview and
 * commit both go through this function, so they can never disagree.
 *
 * The SAME plan also carries the auto-Seeds effect: every play earns
 * ceil(Growth × SEEDS_PER_GROWTH) Seeds (capped by SEEDS_CAP at apply time). */
export function buildPlan(
  hand: Card[],
  selected: number[],
  laws: Law[],
): ResolutionPlan {
  const base: ResolutionPlan = {
    cards: [], category: 'high', categoryLabel: '—', categoryPoints: 0,
    suitCounts: { S: 0, H: 0, D: 0, C: 0 },
    rankSum: 0, pokerBase: 0, mult: 1, growth: 0, growthParts: { poker: 0, laws: 0 },
    effects: [], summary: '', valid: false, invalidReason: '',
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
  const suitCounts: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 }
  for (const c of cards) suitCounts[c.s]++
  const sum = cards.reduce((n, c) => n + c.r, 0)

  // ---- HERO SCORE: Growth, in the fixed order poker → laws (mult → flat)
  // 1. poker base: rankSum ("chips") × CATEGORY_MULT[category] (the hand mult)
  const mult = CATEGORY_MULT[res.category]
  const pokerBase = Math.round(sum * mult)
  // 2. World Laws: × owned growthMult (floored at 1), then + owned growthFlat
  const lawMult = lawGrowthMult(laws)
  const lawFlat = lawGrowthFlat(laws)
  const lawBonus = Math.round(pokerBase * lawMult) + lawFlat - pokerBase
  const growthParts = { poker: pokerBase, laws: lawBonus }
  const growth = Math.max(0, Math.round(pokerBase * lawMult) + lawFlat)

  // AUTO-EARN SEEDS: hand quality pays instantly. 1 Seed per 4 Growth
  // (SEEDS_PER_GROWTH = 1/4), capped by SEEDS_CAP at apply time.
  const seedsGain = Math.max(0, Math.ceil(growth * SEEDS_PER_GROWTH))

  // EVERY play banks its Growth toward the single epoch target.
  const effects: PlanEffect[] = [
    { kind: 'flourishing', amount: growth },
    { kind: 'seeds', amount: seedsGain },
  ]
  const summary = `Banks ${growth} Growth (${pokerBase} chips x ${mult} mult${lawBonus !== 0 ? ` ${lawBonus >= 0 ? '+' : ''}${lawBonus} laws` : ''}). Gains ${seedsGain} Seeds.`

  return {
    cards,
    category: res.category,
    categoryLabel: categoryLabel(res.category),
    categoryPoints: CATEGORY_POINTS[res.category],
    suitCounts,
    rankSum: sum,
    pokerBase,
    mult,
    growth,
    growthParts,
    effects,
    summary,
    valid: true,
    invalidReason: '',
  }
}

/** Apply a plan to a mutable-ish state copy. Used by BOTH preview-apply and commit. */
export function applyPlanEffects(s: GameState, plan: ResolutionPlan): void {
  for (const e of plan.effects) {
    if (e.kind === 'flourishing') {
      s.flourishing += e.amount
    } else if (e.kind === 'seeds') {
      s.seeds = Math.min(SEEDS_CAP, s.seeds + e.amount)
    }
  }
}

export function preview(s: GameState): ResolutionPlan {
  return buildPlan(s.hand, s.selected, s.laws)
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
    lives: SURVIVAL_START,
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
  drawUp(s, handSizeOf(s.laws) - s.hand.length)
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
      const plan = buildPlan(s.hand, s.selected, s.laws)
      if (!plan.valid) throw new Error(plan.invalidReason || 'invalid selection')
      // apply plan effects (shared pipeline — preview and commit agree by construction)
      applyPlanEffects(s, plan)
      s.playsLeft -= 1
      const played = s.selected.map((i) => s.hand[i])
      // remove played cards from hand → discard pile
      const keep: Card[] = []
      s.hand.forEach((c, i) => { if (!s.selected.includes(i)) keep.push(c) })
      s.hand = keep
      s.discardPile.push(...played)
      s.lastResolution = plan
      s.log.push({ at: `e${s.epoch}`, text: `Played ${plan.categoryLabel}: ${plan.summary}` })
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
      if (s.laws.length >= LAW_SLOTS) throw new Error(`all ${LAW_SLOTS} law/upgrade slots are full — remove one to buy`)
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
    case 'removeLaw': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      const at = s.laws.findIndex((l) => l.id === action.lawId)
      if (at < 0) throw new Error('no such owned law')
      const [removed] = s.laws.splice(at, 1)
      s.log.push({ at: `e${s.epoch}`, text: `Removed ${removed.kind}: ${removed.title}.` })
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
  drawUp(s, handSizeOf(s.laws) - s.hand.length)
  s.selected = []
  return s
}

function marketCost(s: GameState, item: Law): number {
  const discount = s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
  return Math.max(1, item.cost - discount)
}

/** Max owned law/upgrade/card/expansion items — the Balatro 5-slot shelf. */
export const LAW_SLOTS = 5

/** Card conservation invariant: hand + deck + discard == 52 + added cards.
 *  Market card-additions are laws, not cards — but 'cards' kind items grow the
 *  dealt hand WITHOUT touching the 52-card deck, so conservation still holds
 *  as exactly 52 (the extra hand slots come from the same pool). */
export function cardConservation(s: GameState): boolean {
  return s.hand.length + s.deckRest.length + s.discardPile.length === 52
}

// ---------------------------------------------------------------------------
// Epoch end / targets / lives
// ---------------------------------------------------------------------------

function endEpoch(state: GameState): GameState {
  const s = clone(state)
  // unplayed hand cards return via the discard pile
  s.discardPile.push(...s.hand)
  s.hand = []
  s.selected = []

  // epoch target check: the ONE target per epoch is cumulative Growth (Flourishing)
  const target = EPOCH_TARGETS[s.epoch - 1]
  const metTarget = s.flourishing >= target.need
  s.log.push({
    at: `e${s.epoch}`,
    text: `Epoch ${s.epoch} target "${target.desc}": ${metTarget ? 'met' : 'missed'} (Flourishing ${s.flourishing}).`,
  })

  // Balatro-style lives: a missed epoch target costs 1 life; 0 ends the run.
  let missedTarget = false
  if (!metTarget) {
    if (s.epoch < TOTAL_EPOCHS) {
      s.lives -= 1
      missedTarget = true
      s.log.push({
        at: `e${s.epoch}`,
        text: `Missed the epoch-${s.epoch} target: a life is lost (now ${s.lives}) and this epoch's market income is halved.`,
      })
    }
  }

  // decay (Mycorrhiza softens it) — cosmetic pressure only; withering is
  // governed by the lives pool above.
  const decayDelta = s.laws.reduce((n, l) => n + (l.decayDelta ?? 0), 0)
  for (const r of s.regions) {
    if (r.dormant || r.stability <= 0) continue
    r.stability = Math.max(0, r.stability - 1 + decayDelta)
  }

  // civilization growth (presentation only): every living region gains
  // +1 development each epoch — this is what makes the 3D planet's evolution
  // icons appear and the globe itself visibly grow. No gameplay read.
  for (const r of s.regions) {
    if (!r.dormant) r.development = Math.min(STABILITY_MAX, r.development + 1)
  }

  // income
  const seedIncome = s.laws.reduce((n, l) => n + (l.extraSeedsPerEpoch ?? 0), 0)
    + s.regions.filter((r) => !r.dormant && r.stability > 0).length
  const marketIncome = missedTarget ? Math.floor(seedIncome / 2) : seedIncome
  s.seeds = Math.min(SEEDS_CAP, s.seeds + marketIncome)
  s.log.push({ at: `e${s.epoch}`, text: `Epoch end: +${marketIncome} Seeds.` })

  // market phase
  const rng = rngFor(s, 77)
  const pool = MARKET_ITEMS.filter((m) => !s.laws.some((l) => l.id === m.id))
  const shuffled = rng.shuffle([...pool])
  s.market = shuffled.slice(0, Math.min(MARKET_SIZE, shuffled.length))
  s.phase = 'market'
  return s
}

function advanceToNextEpoch(state: GameState): GameState {
  const s = clone(state)
  if (s.epoch >= TOTAL_EPOCHS || s.lives <= 0 || s.flourishing <= 0) {
    s.phase = 'game-over'
    if (s.lives <= 0) {
      s.outcome = 'withered'
      s.outcomeReason = `Out of lives (${s.lives}): too many epoch targets missed. The world withers.`
    } else if (s.flourishing >= EPOCH_TARGETS[TOTAL_EPOCHS - 1].need) {
      s.outcome = 'flourishing'
      s.outcomeReason = `The world flourishes at ${s.flourishing} after ${TOTAL_EPOCHS} epochs.`
    } else if (s.flourishing <= 0) {
      s.outcome = 'withered'
      s.outcomeReason = 'Flourishing collapsed to 0.'
    } else {
      s.outcome = 'withered'
      s.outcomeReason = `Final Flourishing ${s.flourishing} fell short of ${EPOCH_TARGETS[TOTAL_EPOCHS - 1].need}.`
    }
    return s
  }
  s.epoch += 1
  s.playsLeft = PLAYS_PER_EPOCH
  s.discardsLeft = DISCARDS_PER_EPOCH
  s.log.push({ at: 'world', text: `— Epoch ${s.epoch} begins —` })
  return startEpoch(s)
}