// Worldhand — corrected deterministic planet-building card roguelike. Pure engine, no DOM.
//
// Contracts (vertical slice, simplified one-action-per-suit edition):
// - 12 regions; each epoch the player makes FOUR plays and THREE discards.
// - Play = select 1–5 cards from the 8-card hand → exact poker scoring.
//   Category decides WHICH suit acts; cards decide magnitude; Ace is low (wheel).
// - ONE action per suit (4 total): ♥ Grow is the Growth suit (its upgrades feed
//   Growth and Q+ hearts wake regions), ♦ Mine gains Seeds, ♠ Study develops
//   the target region, ♣ Settle raises every living region's stability.
// - HERO SCORE — every play resolves to ONE number, **Growth**, read like
//   Balatro's chips×mult:
//       1. poker base   = rankSum × category multiplier
//       2. region bonus = the acting region's development/3 (floor)
//       3. World Laws   = owned law/upgrade bonuses
//       4. Drought      = −5 Growth per living region below stability 3
//     Growth = max(0, pokerBase + regionBonus + lawBonus + droughtMod).
//   EVERY play banks its Growth: Flourishing (the single epoch target) is the
//   cumulative sum of Growth.
// - Deterministic ResolutionPlan: preview() and commit() share one scoring
//   pipeline; the plan carries `growth` plus the ordered `growthParts`
//   breakdown (poker → region → laws → drought).
// - Discard 1–5 cards → refill from deck; total card conservation invariant.
// - 3 escalating epoch targets on the ONE hero currency; the Survival pool is
//   the core resource: every missed epoch target drains 1 Stability (0 →
//   withered) and halves that epoch's market income.
// - Epoch 3 carries an explicit, previewed Drought challenge (per-region
//   stability 3+ — the per-region stability field still exists and matters).
// - Market (Seeds → laws/upgrades/expansions); capped world stats.
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

export type Phase = 'select' | 'market' | 'epoch-end' | 'game-over'
export interface EpochTarget { epoch: number; desc: string; need: number }
/** ONE target per epoch: cumulative Growth (Flourishing). No separate
 *  stability-sum target — per-region stability still exists (the epoch-3
 *  Drought needs every living region at 3+) but it is never an epoch target. */
export const EPOCH_TARGETS: EpochTarget[] = [
  { epoch: 1, desc: 'Growth 50 (cumulative Flourishing)', need: 50 },
  { epoch: 2, desc: 'Growth 120 (cumulative Flourishing)', need: 120 },
  { epoch: 3, desc: 'Growth 200 (cumulative Flourishing)', need: 200 },
]

/** The Drought is decided in epoch 3, but Bloom wake decisions happen from
 * epoch 1 — the upcoming condition is legible in the HUD from the start. */
export const UPCOMING_DROUGHT_EPOCH = 3

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
  /** per-suit law/upgrade bonuses (one action per suit) */
  growBonus?: number
  mineBonus?: number
  studyBonus?: number
  settleBonus?: number
  wakeRegionId?: number
}

export const MARKET_ITEMS: Law[] = [
  { id: 'mycorrhiza', title: 'Mycorrhiza Network', desc: 'Regions decay 1 less each epoch.', cost: 6, kind: 'law', decayDelta: -1 },
  { id: 'seed-vaults', title: 'Seed Vaults', desc: '+3 Seeds at each epoch end.', cost: 8, kind: 'law', extraSeedsPerEpoch: 3 },
  { id: 'barter-routes', title: 'Barter Routes', desc: 'Market items cost 2 less.', cost: 5, kind: 'law', marketDiscount: 2 },
  { id: 'canopy-choir', title: 'Canopy Choir', desc: 'Grow plays: +3 Growth.', cost: 10, kind: 'upgrade', growBonus: 3 },
  { id: 'deep-taproots', title: 'Deep Taproots', desc: 'Study plays: +1 development.', cost: 10, kind: 'upgrade', studyBonus: 1 },
  { id: 'rich-soil', title: 'Rich Soil', desc: 'Mine plays yield +2 extra Seeds.', cost: 7, kind: 'upgrade', mineBonus: 2 },
  { id: 'communal-tending', title: 'Communal Tending', desc: 'Settle plays give +1 stability everywhere.', cost: 9, kind: 'upgrade', settleBonus: 1 },
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
  /** Survival: run-level survival pool. A missed epoch target costs 1; 0 → withered. */
  survival: number
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
  | { type: 'play'; regionChoice?: number; suitChoice?: Suit } // regionChoice = tie-break choice region id (Roots target); suitChoice = the player's tie-break suit, matching the previewed tieChoice
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
  /** HERO SCORE: the one big number this play resolves to (>= 0).
   *  Growth = max(0, poker + region + laws + drought). */
  growth: number
  /** ordered breakdown of `growth`: [poker, region, laws, drought] — the
   *  stable display/computation order is poker → region → laws → drought. */
  growthParts: { poker: number; region: number; laws: number; drought: number }
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

/** Drought economics: each living region below stability 3 at plan time is a
 *  liability worth −5 Growth. Stated once; used by preview and commit alike. */
export const DROUGHT_PENALTY_PER_REGION = 5

/** Region development feeds Growth: every 3 development on the acting region
 *  grants +1 Growth (the Study loop, and Settle's target bonus). */
const REGION_DEV_BONUS_DIVISOR = 3

/** Build the deterministic ResolutionPlan for a selection (pure; no state mutation).
 *
 * The HERO SCORE 'Growth' is computed here, in ONE place, in a stable order:
 *   1. poker base  = rankSum × CATEGORY_MULT[category]  (chips × mult)
 *   2. region bonus = +floor(actingRegion.development / 3)  (0 if none applies)
 *   3. World Laws   = +owned growBonus / studyBonus / mineBonus / settleBonus
 *   4. Drought      = −5 × living regions currently below stability 3
 * Growth = max(0, sum). The plan carries the final number (`growth`) plus the
 * ordered parts (`growthParts`); preview and commit both go through this
 * function, so they can never disagree. */
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
    rankSum: 0, growth: 0, growthParts: { poker: 0, region: 0, laws: 0, drought: 0 },
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
  const maj = suitMajority(cards, tieChoice)
  const sum = cards.reduce((n, c) => n + c.r, 0)
  const lawBonus = (k: 'growBonus' | 'mineBonus' | 'studyBonus' | 'settleBonus') =>
    laws.reduce((n, l) => n + (l[k] ?? 0), 0)

  const living = regions.filter((r) => !r.dormant)
  // Drought part (order step 4, computed from the pre-play world; preview and
  // commit read the same state so the numbers always agree):
  const droughtCount = living.filter((r) => r.stability < 3).length
  const droughtMod = droughtCount > 0 ? -DROUGHT_PENALTY_PER_REGION * droughtCount : 0

  const effects: PlanEffect[] = []
  let summary = ''
  // Which region's development feeds the region part (and Study's target).
  let regionTarget: Region | null = null

  switch (maj.suit) {
    case 'D': { // Mine: Seeds for the market (the economy suit)
      const gain = Math.max(1, Math.round(sum / 3)) + lawBonus('mineBonus')
      effects.push({ kind: 'seeds', amount: gain })
      summary = `Mine: +${gain} Seeds.`
      break
    }
    case 'S': { // Study: develop the weakest living region (grows the planet, feeds Growth)
      // tieChoice doubles as the Study region target (historical contract):
      // a number selects that living region as the target; a suit letter is
      // never a valid region id, so suit tie choices fall through to the
      // weakest living region.
      const target = (regions.find((r) => r.id === (tieChoice as number | undefined) && !r.dormant)
        ?? weakestOf(living)) as Region
      const gain = 1 + lawBonus('studyBonus')
      effects.push({ kind: 'develop', regionId: target.id, amount: gain })
      regionTarget = target
      summary = `Study in ${target.name}: +${gain} development.`
      break
    }
    case 'C': { // Settle: +1 stability to every living region (matters for the Drought)
      const per = 1 + lawBonus('settleBonus')
      for (const r of living) effects.push({ kind: 'stability', regionId: r.id, amount: per })
      regionTarget = living[0] ?? null
      summary = `Settle: +${per} stability across ${living.length} regions.`
      break
    }
  }

  // ---- HERO SCORE: Growth, in the fixed order poker → region → laws → drought
  // 1. poker base: rankSum ("chips") × category multiplier
  // 2. region bonus: +floor(acting region's development / 3)
  // 3. World Laws: owned Grow upgrades add Growth directly (other suits'
  //    upgrades amplify their own resource, not Growth)
  // 4. Drought: −5 per living region below stability 3
  const pokerBase = Math.round(sum * CATEGORY_MULT[res.category])
  const regionBonus = regionTarget ? Math.floor(regionTarget.development / REGION_DEV_BONUS_DIVISOR) : 0
  const lawGrowth = maj.suit === 'H' ? lawBonus('growBonus') : 0
  const growthParts = { poker: pokerBase, region: regionBonus, laws: lawGrowth, drought: droughtMod }
  const growth = Math.max(0, pokerBase + regionBonus + lawGrowth + droughtMod)

  // Grow-specific wake (the Growth suit's rider): Q+ cards may wake a dormant
  // region. A wake is not pure upside — the newly awake region must hold
  // stability 3+ when the epoch-3 Drought resolves. Stated in the shared plan
  // so preview AND commit both show it.
  let growPrefix = ''
  if (maj.suit === 'H') {
    growPrefix = 'Grow: '
    const high = cards.filter((c) => c.r >= 12)
    if (high.length > 0) {
      const dormant = regions.find((r) => r.dormant)
      if (dormant) {
        effects.push({ kind: 'wake', regionId: dormant.id })
        growPrefix += `${dormant.name} wakes - it will need stability 3+ during the epoch-3 Drought. `
      }
    }
  }
  summary = growPrefix + summary

  // EVERY play banks its Growth — Flourishing is the cumulative sum of Growth
  // toward the single epoch target. The action summary (what the suit DID) is
  // kept in front of the banking line (what the play SCORED) so the preview
  // still names the suit action, e.g. "Mine: +4 Seeds. Banks 12 Growth (…)."
  effects.push({ kind: 'flourishing', amount: growth })
  const part = (n: number) => (n > 0 ? `+${n}` : `${n}`)
  const bankLine = `Banks ${growth} Growth (${part(growthParts.poker)} poker ${part(growthParts.region)} region ${part(growthParts.laws)} laws ${part(growthParts.drought)} drought).`
  summary = summary ? `${summary} ${bankLine}` : bankLine

  return {
    cards,
    category: res.category,
    categoryLabel: categoryLabel(res.category),
    categoryPoints: CATEGORY_POINTS[res.category],
    suit: maj.suit,
    suitDecision: maj.decision,
    suitCounts: maj.counts,
    rankSum: sum,
    growth,
    growthParts,
    effects,
    summary,
    valid: true,
    invalidReason: '',
  }
}

/** weakest = lowest stability living region (tie → lowest id, deterministic). */
function weakestOf(living: Region[]): Region | undefined {
  return living.reduce<Region | undefined>(
    (a, b) => (a === undefined || b.stability < a.stability ? b : a),
    undefined,
  )
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
    survival: SURVIVAL_START,
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
      // Commit consumes the SAME tie choice the preview showed (action.suitChoice,
      // dispatched by the UI from its tieChoice state). A committed Roots play may
      // instead carry regionChoice — the historical Roots-target slot; when a
      // region is targeted by id, no suit tie choice is possible (Roots targeting
      // is only consulted when the acting suit is already ♠).
      const plan = buildPlan(s.hand, s.selected, s.regions, s.laws,
        action.suitChoice ?? ((action.regionChoice !== undefined ? action.regionChoice : undefined) as Suit | undefined))
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

  // epoch target check: the ONE target per epoch is cumulative Growth (Flourishing)
  const target = EPOCH_TARGETS[s.epoch - 1]
  const metTarget = s.flourishing >= target.need
  s.log.push({
    at: `e${s.epoch}`,
    text: `Epoch ${s.epoch} target "${target.desc}": ${metTarget ? 'met' : 'missed'} (Growth/Flourishing ${s.flourishing}).`,
  })

  // Survival pool: a missed epoch target costs 1 Survival (0 → the run ends
  // withered) and halves this epoch's market income. Costs apply at epochs 1
  // and 2 only — epoch 3's miss is already terminal (final-target check below
  // in advanceToNextEpoch).
  let missedTarget = false
  if (!metTarget) {
    if (s.epoch < TOTAL_EPOCHS) {
      s.survival -= 1
      missedTarget = true
      s.log.push({
        at: `e${s.epoch}`,
        text: `Missed the epoch-${s.epoch} target: Survival drops to ${s.survival} (0 ends the run) and this epoch's market income is halved.`,
      })
    }
  }

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
  if (s.epoch >= TOTAL_EPOCHS || s.challengeFailed || s.flourishing <= 0 || s.survival <= 0) {
    s.phase = 'game-over'
    if (s.survival <= 0) {
      s.outcome = 'withered'
      s.outcomeReason = `The Survival pool ran dry at ${s.survival}: too many epoch targets missed.`
    } else if (s.challengeFailed) {
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
    S: 'Study — development in a living region (feeds Growth region bonus)',
    H: 'Grow — bank Growth toward the epoch target; Q+ wakes a region',
    D: 'Mine — gain Seeds for the market',
    C: 'Settle — stability to all living regions (matters for the Drought)',
  }[s]
}