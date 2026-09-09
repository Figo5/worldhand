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
// - Survival is exactly Balatro-style lives: start 3; EVERY missed epoch
//   target (all three epochs) costs 1 life; 0 → game over (withered).
//   Winning = beat the epoch-3 target while lives remain.
// - Market (Balatro shop): spend Seeds on poker-hand upgrades, card additions
//   (deck conservation still holds — added cards are real 52+ cards), region
//   expansion (wake a dormant region → planet visibly grows), and World Laws.
// - Deterministic ResolutionPlan: preview() and commit() share one scoring
//   pipeline; the plan carries `growth` plus the ordered `growthParts`.
// - Versioned saves: SAVE_VERSION tracks the engine-RULES generation and
//   SCHEMA_VERSION the envelope layout. Incompatible saves are preserved as
//   recoverable legacy data on load — never silently reinterpreted or erased;
//   quitting never destroys the save.
import { Rng, hashSeed, type Seed } from './rng'
import {
  deck, evaluateSelection, CATEGORY_POINTS, CATEGORY_MULT, categoryLabel,
  type Card, type HandCategory, type Suit,
} from './poker'

export type { Suit } from './poker'

/** SAVE_VERSION: the engine RULES generation this save was produced by.
 *  History: 1 = old 8-epoch/suit-action contract, 2 = three-epoch no-suit
 *  contract (survival-pool rename), 3 = Balatro-simple engine — auto-Seeds
 *  economy, market shop, and the every-miss-costs-a-life lives rule. A save
 *  whose version or structure does not match the CURRENT engine is rejected
 *  (never reinterpreted) and preserved as recoverable legacy data — see
 *  `validateState` + src/ui/save.ts. */
export const SAVE_VERSION = 3
/** SCHEMA_VERSION: envelope/layout generation, tracked separately from the
 *  rules so a pure layout change does not imply a rules change. */
export const SCHEMA_VERSION = 3
/** Obsolete market ids from pre-Balatro-simple eras (suit-action era). A save
 *  containing any of these is structurally incompatible with the current
 *  engine and must be rejected, not migrated. */
export const OBSOLETE_ITEM_IDS: readonly string[] = [
  'deep-taproots', 'rich-soil', 'communal-tending', 'drought', 'stability-charter',
]
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
 *  epoch, strictly increasing. Recalibrated with the CORRECTED bounded solver
 *  (scripts/solve.mjs: category-spanning candidates, current-mechanics score):
 *  the corrected policy evaluates real poker hands, so it wins far more often
 *  than the old mis-focused one — the shipped [30, 70, 320] measures 83% at
 *  LOOK=30 on the eval-* set (see RULES.md / Balance for the full honest
 *  table). Targets are round integers, not band-forced percentages. */
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
  { id: 'mycorrhiza', title: 'Mycorrhiza Network', desc: 'Regions decay 1 less each epoch (1 → 0: living regions stop decaying).', cost: 6, kind: 'law', decayDelta: -1 },
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
  /** rank sum of ALL selected cards ("chips" — includes every kicker; an
   *  unrelated side card's rank adds to the score exactly like a scoring card) */
  rankSum: number
  /** the true pre-multiplier rank sum — identical to rankSum; exposed so a
   *  display can honestly show "chips × mult = base" with no hidden rounding */
  chips: number
  /** poker base = round(rankSum × mult) — the ALREADY-MULTIPLIED poker part.
   *  It is NOT "chips": showing pokerBase next to "× mult" would imply a
   *  second multiplication that never happens. */
  pokerBase: number
  /** the hand's multiplier (CATEGORY_MULT[category]) */
  mult: number
  /** HERO SCORE: the one big number this play resolves to (>= 0).
   *  Growth = max(0, pokerBase × lawMult + lawFlat). */
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
  | { kind: 'seeds'; amount: number; credited: number; overflow: number }

/** The auto-Seeds economy (documented formula): every play earns Seeds
 *  directly from its hand quality — no separate Mine action.
 *      nominal = ceil(Growth × SEEDS_PER_GROWTH)   (1 Seed per 4 Growth)
 *  The nominal earn is then credited under SEEDS_CAP by `seedCredit` — the ONE
 *  shared contract below — so a hand that earns past the cap shows exactly how
 *  much was banked and how much overflowed. */
export const SEEDS_PER_GROWTH = 1 / 4

/** THE Seed-credit contract (single source of arithmetic for preview, commit
 *  and the chronicle): crediting a nominal reward `amount` against a balance
 *  `seeds` under SEEDS_CAP yields the amount ACTUALLY banked (`credited`) plus
 *  the part that did not fit (`overflow`). credited = min(cap − seeds, amount)
 *  floored at 0 on both sides; overflow = amount − credited. The plan carries
 *  these values, applyPlanEffects banks exactly `credited`, and every message
 *  (preview summary, committed summary, chronicle line) reads the same fields
 *  — the economy itself is unchanged: the cap still binds at SEEDS_CAP. */
export function seedCredit(seeds: number, amount: number): { credited: number; overflow: number } {
  const nominal = Math.max(0, amount)
  const credited = Math.min(Math.max(0, SEEDS_CAP - seeds), nominal)
  return { credited, overflow: nominal - credited }
}

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
 *   1. poker base  = round(rankSum ("chips") × CATEGORY_MULT[category])
 *      — rankSum sums ALL selected ranks, so kickers DO contribute
 *   2. World Laws  = ×(owned growthMult, floored at 1) then +(owned growthFlat)
 *   Growth = max(0, round(pokerBase × lawMult) + lawFlat). The plan carries the
 * final number (`growth`) plus the ordered parts (`growthParts`); preview and
 * commit both go through this function, so they can never disagree.
 * Invariant (display-honesty contract): plan.chips == plan.rankSum and
 * plan.pokerBase == round(plan.chips × plan.mult) — a UI may honestly show
 * "chips × mult = base" or "base" alone, but never "base × mult".
 *
 * The SAME plan also carries the auto-Seeds effect: every play earns
 * ceil(Growth × SEEDS_PER_GROWTH) Seeds (nominal), credited under SEEDS_CAP by
 * the shared `seedCredit` contract using the CURRENT balance `seeds` — so the
 * plan's summary already shows the truthful credited figure and any overflow.
 * Pass `seeds` to state the live balance; omit it to compute the nominal-only
 * plan (balance-agnostic: credited/overflow then assume an empty bank). */
export function buildPlan(
  hand: Card[],
  selected: number[],
  laws: Law[],
  seeds: number = 0,
): ResolutionPlan {
  const base: ResolutionPlan = {
    cards: [], category: 'high', categoryLabel: '—', categoryPoints: 0,
    suitCounts: { S: 0, H: 0, D: 0, C: 0 },
    rankSum: 0, chips: 0, pokerBase: 0, mult: 1, growth: 0, growthParts: { poker: 0, laws: 0 },
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
  // 1. poker base: rankSum ("chips", ALL selected ranks incl. kickers)
  //    × CATEGORY_MULT[category] (the hand mult)
  const mult = CATEGORY_MULT[res.category]
  const pokerBase = Math.round(sum * mult)
  // 2. World Laws: × owned growthMult (floored at 1), then + owned growthFlat
  const lawMult = lawGrowthMult(laws)
  const lawFlat = lawGrowthFlat(laws)
  const lawBonus = Math.round(pokerBase * lawMult) + lawFlat - pokerBase
  const growthParts = { poker: pokerBase, laws: lawBonus }
  const growth = Math.max(0, Math.round(pokerBase * lawMult) + lawFlat)

  // AUTO-EARN SEEDS: hand quality pays instantly. 1 Seed per 4 Growth
  // (SEEDS_PER_GROWTH = 1/4). The nominal earn is credited under SEEDS_CAP by
  // the ONE shared contract (seedCredit) against the CURRENT balance — the
  // plan therefore carries nominal (`amount`), `credited` and `overflow`, and
  // preview, commit and the chronicle all read these same fields.
  const seedsGain = Math.max(0, Math.ceil(growth * SEEDS_PER_GROWTH))
  const credit = seedCredit(seeds, seedsGain)
  const overflowClause = credit.overflow > 0
    ? ` (Credited ${credit.credited}; overflow ${credit.overflow})`
    : ''

  // EVERY play banks its Growth toward the single epoch target.
  const effects: PlanEffect[] = [
    { kind: 'flourishing', amount: growth },
    { kind: 'seeds', amount: seedsGain, credited: credit.credited, overflow: credit.overflow },
  ]
  // Honest summary: rankSum × mult (the true chips×mult equation), then the
  // already-multiplied base, then the TRUTHFUL Seed credit. e.g.
  // "chips 30 x 4 mult = base 120. Gains 16 Seeds (Credited 6; overflow 10)."
  const summary = `Banks ${growth} Growth (chips ${sum} x ${mult} mult = base ${pokerBase}${lawBonus !== 0 ? ` ${lawBonus >= 0 ? '+' : ''}${lawBonus} laws` : ''}). Gains ${seedsGain} Seeds${overflowClause}.`

  return {
    cards,
    category: res.category,
    categoryLabel: categoryLabel(res.category),
    categoryPoints: CATEGORY_POINTS[res.category],
    suitCounts,
    rankSum: sum,
    chips: sum,
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

/** Apply a plan to a mutable-ish state copy. Used by BOTH preview-apply and commit.
 *  Seed crediting goes through the SAME shared contract the plan was built
 *  with (seedCredit), reading the plan's own credited figure — no divergent
 *  arithmetic: the balance moves by exactly the credited amount the preview
 *  and the chronicle already state. */
export function applyPlanEffects(s: GameState, plan: ResolutionPlan): void {
  for (const e of plan.effects) {
    if (e.kind === 'flourishing') {
      s.flourishing += e.amount
    } else if (e.kind === 'seeds') {
      s.seeds += e.credited
    }
  }
}

export function preview(s: GameState): ResolutionPlan {
  return buildPlan(s.hand, s.selected, s.laws, s.seeds)
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
      const plan = buildPlan(s.hand, s.selected, s.laws, s.seeds)
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
// Save validation: structural checks against the CURRENT engine contract.
// A save that fails any check is INCOMPATIBLE — it is never migrated, never
// silently reinterpreted, and never erased (save.ts archives it as legacy).
// ---------------------------------------------------------------------------

const VALID_PHASES: readonly Phase[] = ['select', 'market', 'epoch-end', 'game-over']
const VALID_OUTCOMES: readonly string[] = ['flourishing', 'withered', '']
const VALID_LAW_KINDS: readonly Law['kind'][] = ['law', 'upgrade', 'expansion', 'cards']
const VALID_SUIT_SET = new Set<string>(['S', 'H', 'D', 'C'])

/** Structural validator for a deserialized GameState under the CURRENT rules
 *  (SAVE_VERSION). Returns a plain-language rejection reason, or null when the
 *  state is acceptable. Deliberately strict: an incompatible save must be
 *  rejected wholesale (preserved as legacy data), never partially migrated —
 *  a half-migrated state would silently reinterpret the player's old run. */
export function validateState(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'not a state object'
  const s = v as Record<string, unknown>
  const missing = (k: string) => `missing required field "${k}"`
  const bad = (k: string, why: string) => `field "${k}" ${why}`

  if (typeof s.version !== 'number') return missing('version')
  if (s.version !== SAVE_VERSION) {
    return `state version ${JSON.stringify(s.version)} is not the current engine rules version (${SAVE_VERSION})`
  }
  for (const k of ['seed', 'seedText', 'epoch', 'phase', 'flourishing', 'lives', 'seeds'] as const) {
    if (!(k in s)) return missing(k)
  }
  if (typeof s.seed !== 'number' || !Number.isFinite(s.seed)) return bad('seed', 'must be a finite number')
  if (typeof s.seedText !== 'string') return bad('seedText', 'must be a string')
  if (!Number.isInteger(s.epoch) || (s.epoch as number) < 1 || (s.epoch as number) > TOTAL_EPOCHS) {
    return bad('epoch', `must be an integer 1..${TOTAL_EPOCHS}`)
  }
  if (!VALID_PHASES.includes(s.phase as Phase)) {
    return `phase "${String(s.phase)}" is not a valid Phase (${VALID_PHASES.join(' | ')})`
  }
  for (const k of ['flourishing', 'seeds'] as const) {
    if (typeof s[k] !== 'number' || !Number.isFinite(s[k])) return bad(k, 'must be a finite number')
  }
  // lives: present and numeric is the load-bearing check (the pre-v3 contract
  // could serialize a save without it).
  if (typeof s.lives !== 'number' || !Number.isFinite(s.lives)) {
    return 'lives is missing or not a number — the current engine requires the lives contract'
  }
  if (!Number.isInteger(s.lives) || (s.lives as number) < 0 || (s.lives as number) > LIVES_CAP) {
    return bad('lives', `must be an integer 0..${LIVES_CAP}`)
  }
  for (const k of ['playsLeft', 'discardsLeft'] as const) {
    if (!Number.isInteger(s[k]) || (s[k] as number) < 0) return bad(k, 'must be a non-negative integer')
  }
  if (!Array.isArray(s.hand) || !Array.isArray(s.deckRest) || !Array.isArray(s.discardPile)) {
    return 'hand, deckRest and discardPile must be arrays'
  }
  if (!Array.isArray(s.selected) || !s.selected.every((i: unknown) => typeof i === 'number')) {
    return bad('selected', 'must be an array of card indices')
  }
  if (!Array.isArray(s.regions) || s.regions.length !== TOTAL_REGIONS) {
    return bad('regions', `must have exactly ${TOTAL_REGIONS} entries`)
  }
  if (!Array.isArray(s.market) || !Array.isArray(s.laws)) return 'market and laws must be arrays'
  if (!Array.isArray(s.log)) return bad('log', 'must be an array')
  if (s.lastResolution !== null && typeof s.lastResolution !== 'object') {
    return bad('lastResolution', 'must be null or an object')
  }
  if (s.outcome !== null && !VALID_OUTCOMES.includes(s.outcome as string)) {
    return `outcome "${String(s.outcome)}" is not a valid outcome`
  }

  // cards: every card must have a legal rank and suit (and be a real 52-card
  // card — no invented ranks from older engines)
  const isCard = (c: unknown): c is { r: number; s: string } =>
    !!c && typeof c === 'object' && typeof (c as any).r === 'number' && typeof (c as any).s === 'string'
  for (const pile of ['hand', 'deckRest', 'discardPile'] as const) {
    for (const c of s[pile] as unknown[]) {
      if (!isCard(c)) return `${pile} contains a malformed card`
      if (!Number.isInteger(c.r) || c.r < 2 || c.r > 14) return `${pile} has a card with invalid rank ${JSON.stringify((c as any).r)}`
      if (!VALID_SUIT_SET.has(c.s)) return `${pile} has a card with invalid suit "${c.s}"`
    }
  }
  // deck conservation under the current 52-card contract
  const total = (s.hand.length as number) + (s.deckRest.length as number) + (s.discardPile.length as number)
  if (total !== 52) return `deck conservation violated: hand+deck+discard = ${total}, expected 52`

  // laws / market items: every id must exist in the CURRENT MARKET_ITEMS pool,
  // and no obsolete (suit-action era) ids may survive anywhere.
  const validIds = new Set(MARKET_ITEMS.map((m) => m.id))
  for (const listName of ['market', 'laws'] as const) {
    for (const it of s[listName] as unknown[]) {
      if (!it || typeof it !== 'object') return `${listName} contains a malformed item`
      const id = (it as any).id
      if (typeof id !== 'string') return `${listName} contains an item without an id`
      if ((OBSOLETE_ITEM_IDS as readonly string[]).includes(id)) {
        return `obsolete era item "${id}" is not part of the current engine (found in ${listName})`
      }
      if (!validIds.has(id)) {
        return `unknown market item "${id}" is not in the current MARKET_ITEMS (found in ${listName})`
      }
      const kind = (it as any).kind
      if (!VALID_LAW_KINDS.includes(kind)) return `${listName} item "${id}" has invalid kind "${String(kind)}"`
    }
  }
  if ((s.laws.length as number) > LAW_SLOTS) return bad('laws', `exceeds the ${LAW_SLOTS}-slot cap`)

  // regions: ids, adjacency references and dormancy flags must be well-formed
  for (const r of s.regions as unknown[]) {
    if (!r || typeof r !== 'object') return 'regions contains a malformed entry'
    const rr = r as any
    if (!Number.isInteger(rr.id) || rr.id < 0 || rr.id >= TOTAL_REGIONS) return 'a region has an invalid id'
    if (typeof rr.dormant !== 'boolean') return bad('regions', 'a region is missing its dormant flag')
    if (!Array.isArray(rr.adjacency) || !rr.adjacency.every((a: unknown) => typeof a === 'number' && (a as number) >= 0 && (a as number) < TOTAL_REGIONS)) {
      return bad('regions', 'a region has malformed adjacency')
    }
  }

  // phase-consistency: dead runs must already be in game-over
  if (s.phase !== 'game-over' && (s.lives as number) <= 0) {
    return 'a run with 0 lives must be in the game-over phase'
  }
  return null
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

  // Balatro-style lives: EVERY missed epoch target (epochs 1, 2 AND 3) costs
  // 1 life; the run ends only when lives reach 0. The epoch-3 miss is ALSO the
  // loss check for the final target (the win is decided separately below), but
  // it still costs its life like every other epoch — 3 lives is a real,
  // exhaustible resource, not a free pass at the final rung.
  let missedTarget = false
  if (!metTarget) {
    s.lives -= 1
    missedTarget = true
    s.log.push({
      at: `e${s.epoch}`,
      text: `Missed the epoch-${s.epoch} target: a life is lost (now ${s.lives}) and this epoch's market income is halved.`,
    })
    if (s.epoch < TOTAL_EPOCHS) {
      s.log.push({
        at: `e${s.epoch}`,
        text: `Flourishing ${s.flourishing} fell short of ${target.need} — the next epoch's market opens with the penalty applied.`,
      })
    }
  }

  // decay: every living region with stability left loses exactly 1 per epoch.
  // Mycorrhiza Network (decayDelta −1) reduces that decay BY 1 → ZERO decay:
  // `decay` is the per-region loss this epoch, floored at 0 — never a gain,
  // never a double loss. Regions at 0 stay at 0 (never resurrected). This is
  // real pressure on the Seed income base, not pure cosmetics: epoch income
  // counts only living regions with stability > 0 (see below).
  const decayDelta = s.laws.reduce((n, l) => n + (l.decayDelta ?? 0), 0)
  const decay = Math.max(0, 1 + decayDelta)
  for (const r of s.regions) {
    if (r.dormant || r.stability <= 0) continue
    r.stability = Math.max(0, r.stability - decay)
  }

  // civilization growth (presentation only): every living region gains
  // +1 development each epoch — this is what makes the 3D planet's evolution
  // icons appear and the globe itself visibly grow. No gameplay read.
  for (const r of s.regions) {
    if (!r.dormant) r.development = Math.min(STABILITY_MAX, r.development + 1)
  }

  // income: +1 per living healthy region (stability > 0 — decay above really
  // feeds this) plus law income, halved on a missed target. The credit under
  // SEEDS_CAP goes through the ONE shared contract (seedCredit): the log line
  // states the nominal income, the amount actually banked, and the overflow.
  const seedIncome = s.laws.reduce((n, l) => n + (l.extraSeedsPerEpoch ?? 0), 0)
    + s.regions.filter((r) => !r.dormant && r.stability > 0).length
  const marketIncome = missedTarget ? Math.floor(seedIncome / 2) : seedIncome
  const incomeCredit = seedCredit(s.seeds, marketIncome)
  s.seeds += incomeCredit.credited
  s.log.push({
    at: `e${s.epoch}`,
    text: `Epoch end: +${marketIncome} Seeds (Credited ${incomeCredit.credited}; overflow ${incomeCredit.overflow}).`,
  })

  // FINAL-EPOCH TERMINATION: once the last hand is played the run is decided —
  // no market can matter, so none is offered. Resolve the verdict EXACTLY ONCE
  // here (target check + life deduction + income above already ran) instead of
  // pushing a market phase and advertising a nonexistent epoch 4.
  if (s.epoch >= TOTAL_EPOCHS) return advanceToNextEpoch(s)

  // market phase (epochs 1–2 only — unchanged flow)
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
      s.outcomeReason = `The world flourishes at ${s.flourishing} after ${TOTAL_EPOCHS} epochs (lives remaining: ${s.lives}).`
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