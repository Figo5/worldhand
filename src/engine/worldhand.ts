// Worldhand — deterministic planet-building card roguelike. Pure engine, no DOM.
//
// Contracts (Balatro-simple edition — play poker hands, earn money, spend money):
// - 12 regions; each epoch the player makes FOUR plays and THREE discards.
// - A play is JUST "play a poker hand": select 1–5 cards from the 8-card hand →
//   exact poker scoring → the hand resolves to ONE hero number, Growth.
//   No suit decision, no region choice, no per-suit world actions.
// - AUTO-EARN Seeds on every play: seeds += SEEDS_PER_GROWTH × Growth,
//   uncapped — hand quality IS the economy. There is no separate Mine action.
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
 *  economy, market shop, and the every-miss-costs-a-life lives rule,
 *  4 = regional-bonus rules — regions carry a fixed `specialization`
 *  (pair / twopair / flush) that adds a flat Growth bonus to plays of the
 *  EXACT matching category, 5 = per-epoch targets — Growth banked resets each
 *  6 = World Score + World Projects — a maximization goal, all 12
 *  regions wakeable, uncapped development, and an infinite Seed-sink project
 *  shop, 7 = Balatro-hard — a single World Level replaces the region map,
 *  escalating blinds outpace raw hands, and the shop adds Jokers, Planet
 *  cards, Consumables, and Vouchers. A save whose version or structure does
 *  not match the CURRENT engine is rejected (never reinterpreted) and
 *  preserved as recoverable legacy data — see `validateState` + src/ui/save.ts. */
export const SAVE_VERSION = 7
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
export const MARKET_SIZE = 3
export const LIVES_CAP = 3

/** The escalating epoch target: Growth to bank DURING this epoch (per-epoch,
 *  not cumulative). Each epoch you must bank `need(n)` Growth within that
 *  epoch; Growth banked resets at each epoch boundary for the target. A
 *  separate lifetime Flourishing total is kept for score/display. The curve is
 *  deliberately STEEP so even a good scaling engine (5 jokers + world level)
 *  dies around epoch 10-15 — you must build a scaling engine to survive, but
 *  the blinds keep outrunning it. Monotonic increasing. */
export function epochTarget(epoch: number): number {
  const d = epoch - 1
  return Math.round(100 + 40 * d + 5 * d * d)
}

/** Human-readable target descriptor for the current epoch. */
export function epochTargetDesc(epoch: number): string {
  return `Growth ${epochTarget(epoch)} this epoch`
}

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
  /** drives the 3D planet's evolution icons and the regional Growth bonus */
  development: number
  dormant: boolean
  adjacency: number[]
  /** FIXED regional specialization (stable mapping, never rerolled per run):
   *  the exact evaluated poker category this region boosts when AWAKE.
   *  null = no specialization. Dormant specialized regions contribute 0. */
  specialization: null | 'pair' | 'twopair' | 'flush'
}

/** ---------------------------------------------------------------------------
 * REGIONAL BONUS — declared constants (exact numbers also pinned in RULES.md
 * and by tests/regional-bonus.test.ts). Each awake region whose fixed
 * `specialization` equals the played hand's EXACT evaluated category adds
 *
 *     regionBonus = BASE + min(DEV_BONUS_CAP, floor(development / DEV_STEP))
 *
 * PAIR_BASE=3, TWOPAIR_BASE=4, FLUSH_BASE=6, DEV_STEP=2, DEV_BONUS_CAP=4 —
 * e.g. a Pair-specialized region with development 4 grants 3+2=5. Dormant
 * regions contribute 0. Bonuses stack ADDITIVELY across all awake matching
 * regions (multiple Pair regions add; never a multiplicative chain), are
 * applied ONCE, AFTER the existing law-adjusted Growth:
 *
 *     Growth = max(0, round(pokerBase × lawMult) + lawFlat + totalRegionBonus)
 *
 * The law multiplier NEVER re-multiplies the regional bonus.
 * ------------------------------------------------------------------------- */
export const PAIR_BASE = 3
export const TWOPAIR_BASE = 4
export const FLUSH_BASE = 6
export const DEV_STEP = 2
export const DEV_BONUS_CAP = 4

export type Specialization = NonNullable<Region['specialization']>

/** The SPECIALIZATION_BONUS table: base flat bonus per specialization. */
export const SPECIALIZATION_BASE: Record<Specialization, number> = {
  pair: PAIR_BASE,
  twopair: TWOPAIR_BASE,
  flush: FLUSH_BASE,
}

/** The player-facing label for a specialization (exact poker category). */
export const SPECIALIZATION_LABEL: Record<Specialization, string> = {
  pair: 'Pair',
  twopair: 'Two Pair',
  flush: 'Flush',
}

/** Map a played hand's evaluated poker category onto the specialization token.
 *  The Region field uses the declared literal 'twopair'; the poker category is
 *  'two-pair' — this normalization is the ONLY place the two vocabularies meet
 *  (exact-category matching still applies: trips/quads/etc. map to null). */
export function specOfCategory(c: HandCategory): Specialization | null {
  if (c === 'pair') return 'pair'
  if (c === 'two-pair') return 'twopair'
  if (c === 'flush') return 'flush'
  return null
}

/** The bonus ONE awake region pays for a play of its exact category at its
 *  current development: `base + min(DEV_BONUS_CAP, floor(dev / DEV_STEP))`. */
export function regionBonusOf(r: Region): number {
  const base = r.specialization ? SPECIALIZATION_BASE[r.specialization] : 0
  if (!r.specialization) return 0
  return base + Math.min(DEV_BONUS_CAP, Math.floor(Math.max(0, r.development) / DEV_STEP))
}

/** The DETERMINISTIC region → specialization map: fixed data, stable across
 *  every run and seed (never rerolled), terrain identity untouched. Exactly
 *  three specializations exist; the Pair region STARTS AWAKE and the Two-Pair
 *  and Flush regions START DORMANT (the starting planet never activates all
 *  three — the dormant ones become obtainable through the wake-* expansions). */
const SPECIALIZATION_MAP: Record<number, Specialization | null> = {
  0: 'pair', // Auralia  — Pair specialization, STARTS AWAKE
  6: 'twopair', // Pellucid — Two Pair specialization, starts dormant (Wake Pellucid)
  11: 'flush', // Vantage  — Flush specialization, starts dormant (Wake Vantage)
}
/** Which specialized regions begin the run dormant (everything but Auralia). */
export const SPECIALIZATION_START_DORMANT = [6, 11]

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

/** A Joker — the strategy core. A conditional multiplier that defines your
 *  build. When the played hand meets its condition, it multiplies Growth by
 *  (1 + mult). Jokers stack multiplicatively. */
export interface Joker {
  id: string
  title: string
  desc: string
  cost: number
  /** the hand condition that triggers this joker */
  condition: 'pair' | 'twopair' | 'flush' | 'no-face' | 'high-card' | 'any'
  /** additive mult when the condition is met (0.5 = ×1.5, 1 = ×2) */
  mult: number
}

/** A Planet card — permanently raises a hand type's base mult. */
export interface PlanetCard {
  id: string
  title: string
  desc: string
  cost: number
  /** the hand category this planet boosts */
  category: HandCategory
  /** +mult to that category's base multiplier */
  boost: number
}

/** A Consumable — a one-shot boost you queue before playing a hand. */
export interface Consumable {
  id: string
  title: string
  desc: string
  cost: number
  /** ×N Growth on the next hand */
  xNext: number
}

/** A Voucher — a permanent global upgrade. */
export interface Voucher {
  id: string
  title: string
  desc: string
  cost: number
  /** +1 hand size */
  handSize?: number
  /** +mult to ALL jokers */
  jokerMult?: number
  /** +Seeds per epoch */
  seedsPerEpoch?: number
}

/** The Joker pool. */
export const JOKERS: Joker[] = [
  { id: 'joker-pair', title: 'Pair Joker', desc: '×1.5 Growth when you play a Pair.', cost: 8, condition: 'pair', mult: 0.5 },
  { id: 'joker-twopair', title: 'Two Pair Joker', desc: '×2 Growth when you play Two Pair.', cost: 10, condition: 'twopair', mult: 1 },
  { id: 'joker-flush', title: 'Flush Joker', desc: '×2 Growth when you play a Flush.', cost: 12, condition: 'flush', mult: 1 },
  { id: 'joker-noface', title: 'No-Face Joker', desc: '×1.5 Growth when you play no face cards.', cost: 8, condition: 'no-face', mult: 0.5 },
  { id: 'joker-high', title: 'High Card Joker', desc: '×1.5 Growth on a High Card.', cost: 6, condition: 'high-card', mult: 0.5 },
  { id: 'joker-any', title: 'All-In Joker', desc: '×1.25 Growth on every hand.', cost: 10, condition: 'any', mult: 0.25 },
]

/** The Planet card pool. */
export const PLANET_CARDS: PlanetCard[] = [
  { id: 'planet-pair', title: 'Planet: Pair', desc: 'Pair base mult +0.5.', cost: 6, category: 'pair', boost: 0.5 },
  { id: 'planet-twopair', title: 'Planet: Two Pair', desc: 'Two Pair base mult +0.5.', cost: 7, category: 'two-pair', boost: 0.5 },
  { id: 'planet-trips', title: 'Planet: Trips', desc: 'Trips base mult +0.5.', cost: 8, category: 'trips', boost: 0.5 },
  { id: 'planet-straight', title: 'Planet: Straight', desc: 'Straight base mult +0.5.', cost: 9, category: 'straight', boost: 0.5 },
  { id: 'planet-flush', title: 'Planet: Flush', desc: 'Flush base mult +0.5.', cost: 10, category: 'flush', boost: 0.5 },
  { id: 'planet-fullhouse', title: 'Planet: Full House', desc: 'Full House base mult +0.5.', cost: 11, category: 'full-house', boost: 0.5 },
  { id: 'planet-quads', title: 'Planet: Quads', desc: 'Quads base mult +0.5.', cost: 12, category: 'quads', boost: 0.5 },
]

/** The Consumable pool. */
export const CONSUMABLES: Consumable[] = [
  { id: 'cons-x2', title: 'Double Down', desc: 'Next hand ×2 Growth.', cost: 8, xNext: 2 },
  { id: 'cons-x3', title: 'Triple Threat', desc: 'Next hand ×3 Growth.', cost: 14, xNext: 3 },
]

/** The Voucher pool. */
export const VOUCHERS: Voucher[] = [
  { id: 'voucher-hand', title: 'Voucher: Bigger Hand', desc: '+1 hand size (9 cards).', cost: 12, handSize: 1 },
  { id: 'voucher-joker', title: 'Voucher: Joker Power', desc: 'All jokers +0.5 mult.', cost: 14, jokerMult: 0.5 },
  { id: 'voucher-seeds', title: 'Voucher: Seed Income', desc: '+2 Seeds each epoch end.', cost: 10, seedsPerEpoch: 2 },
]

/** The World Level — the simplified worldbuilding number. Auto-grows +1 each
 *  epoch; boostable with Seeds. Level 1 = +0 (early play unchanged); each level
 *  above 1 adds +2 Growth/play, +1 Seed/epoch, +5 World Score. */
export function worldLevelBonus(level: number): { growthPerPlay: number; seedsPerEpoch: number; score: number } {
  const above = Math.max(0, level - 1)
  return { growthPerPlay: above * 2, seedsPerEpoch: above, score: level * 5 }
}

/** The World Score — the run's goal: how good you made the world.
 *  World Level is the backbone; jokers/planets/vouchers add to it. */
export function worldScore(s: GameState): number {
  const lvl = worldLevelBonus(s.worldLevel)
  const laws = s.laws.length
  const jokers = s.jokers.length
  const planets = Object.values(s.planetLevels).reduce((n, x) => n + x, 0)
  const vouchers = s.vouchers.length
  const flourish = Math.floor(s.flourishing / 10)
  return lvl.score + laws * 15 + jokers * 10 + planets * 5 + vouchers * 8 + flourish
}

/** A World Project — an infinite Seed-sink that permanently improves the world.
 *  Projects are NOT laws (they don't occupy a LAW_SLOT); each is repeatable and
 *  its effect stacks. They give Seeds a purpose forever and are the "make the
 *  world as good as you can" mechanism. */
export interface WorldProject {
  id: string
  title: string
  desc: string
  baseCost: number
  /** cost grows by this much each purchase (repeatable) */
  costGrowth: number
  /** +development to a specific region (id) — uncapped */
  devRegionId?: number
  /** +World Score flat */
  scoreFlat?: number
  /** +Growth per play (flat) */
  growthFlat?: number
  /** +Seeds per epoch */
  seedsPerEpoch?: number
}

/** The World Projects pool — infinite, repeatable, cost-escalating. */
export const WORLD_PROJECTS: WorldProject[] = [
  { id: 'proj-dev-auralia', title: 'Cultivate Auralia', desc: '+1 development to Auralia (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 0 },
  { id: 'proj-dev-veymark', title: 'Cultivate Veymark', desc: '+1 development to Veymark (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 1 },
  { id: 'proj-dev-calder', title: 'Cultivate Calder', desc: '+1 development to Calder (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 2 },
  { id: 'proj-dev-thessaly', title: 'Cultivate Thessaly', desc: '+1 development to Thessaly (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 3 },
  { id: 'proj-dev-laguna', title: 'Cultivate Laguna', desc: '+1 development to Laguna (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 4 },
  { id: 'proj-dev-ozurn', title: 'Cultivate Ozurn', desc: '+1 development to Ozurn (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 5 },
  { id: 'proj-dev-pellucid', title: 'Cultivate Pellucid', desc: '+1 development to Pellucid (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 6 },
  { id: 'proj-dev-harrow', title: 'Cultivate Harrow', desc: '+1 development to Harrow (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 7 },
  { id: 'proj-dev-sequana', title: 'Cultivate Sequana', desc: '+1 development to Sequana (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 8 },
  { id: 'proj-dev-brumal', title: 'Cultivate Brumal', desc: '+1 development to Brumal (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 9 },
  { id: 'proj-dev-kestrel', title: 'Cultivate Kestrel', desc: '+1 development to Kestrel (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 10 },
  { id: 'proj-dev-vantage', title: 'Cultivate Vantage', desc: '+1 development to Vantage (uncapped).', baseCost: 8, costGrowth: 4, devRegionId: 11 },
  { id: 'proj-score', title: 'World Monument', desc: '+5 World Score.', baseCost: 20, costGrowth: 10, scoreFlat: 5 },
  { id: 'proj-growth', title: 'Fertile Soil', desc: '+2 Growth on every play.', baseCost: 15, costGrowth: 8, growthFlat: 2 },
  { id: 'proj-seeds', title: 'Seed Granary', desc: '+2 Seeds at each epoch end.', baseCost: 12, costGrowth: 6, seedsPerEpoch: 2 },
]

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
  { id: 'wake-pellucid', title: 'Wake Pellucid', desc: 'Awaken Pellucid — the planet visibly grows, and Two Pair hands gain +4 Growth there (grows with development).', cost: 12, kind: 'expansion', wakeRegionId: 6 },
  { id: 'wake-vantage', title: 'Wake Vantage', desc: 'Awaken Vantage — the planet visibly grows, and Flush hands gain +6 Growth there (grows with development).', cost: 12, kind: 'expansion', wakeRegionId: 11 },
  { id: 'wake-ozurn', title: 'Wake Ozurn', desc: 'Awaken the dormant highland region — the planet visibly grows.', cost: 12, kind: 'expansion', wakeRegionId: 5 },
  { id: 'wake-harrow', title: 'Wake Harrow', desc: 'Awaken the dormant forest region — the planet visibly grows.', cost: 12, kind: 'expansion', wakeRegionId: 7 },
  { id: 'wake-sequana', title: 'Wake Sequana', desc: 'Awaken the dormant wetland region — the planet visibly grows.', cost: 12, kind: 'expansion', wakeRegionId: 8 },
  { id: 'wake-kestrel', title: 'Wake Kestrel', desc: 'Awaken the dormant steppe region — the planet visibly grows.', cost: 12, kind: 'expansion', wakeRegionId: 10 },
]

export interface LogEntry { at: string; text: string }

export interface GameState {
  version: number
  seed: Seed
  seedText: string
  epoch: number // 1..3
  phase: Phase
  /** Lifetime total Flourishing (score/display) — keeps growing across epochs. */
  flourishing: number
  /** Growth banked DURING the current epoch — resets at each epoch boundary;
   *  the per-epoch target is measured against this, not the lifetime total. */
  epochGrowth: number
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
  /** World Projects offered this market phase (infinite Seed-sink) */
  projectMarket: WorldProject[]
  /** Jokers offered this market phase */
  jokerMarket: Joker[]
  /** Planet cards offered this market phase */
  planetMarket: PlanetCard[]
  /** Consumables offered this market phase */
  consumableMarket: Consumable[]
  /** Vouchers offered this market phase */
  voucherMarket: Voucher[]
  laws: Law[]
  /** owned World Projects (repeatable, cost-escalating Seed-sink) */
  projects: WorldProject[]
  /** the simplified worldbuilding number — auto-grows +1/epoch, boostable */
  worldLevel: number
  /** owned Jokers (the strategy core — conditional multipliers) */
  jokers: Joker[]
  /** owned Planet cards: category → total +mult boost */
  planetLevels: Partial<Record<HandCategory, number>>
  /** queued Consumables (one-shot ×N on the next hand) */
  consumables: Consumable[]
  /** owned Vouchers (permanent globals) */
  vouchers: Voucher[]
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
  | { type: 'buyProject'; projectId: string }
  | { type: 'buyJoker'; jokerId: string }
  | { type: 'buyPlanet'; planetId: string }
  | { type: 'buyConsumable'; consumableId: string }
  | { type: 'buyVoucher'; voucherId: string }
  | { type: 'boostWorld' }
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
   *  Growth = max(0, round(pokerBase × lawMult) + lawFlat + totalRegionBonus). */
  growth: number
  /** ordered breakdown of `growth`: poker → laws (mult + flat) → regions.
   *  The regional part is the sum over awake regions whose fixed
   *  specialization equals the hand's EXACT category; it is added AFTER the
   *  law multiplier (never re-multiplied). poker + laws + regions === growth. */
  growthParts: { poker: number; laws: number; regions: number }
  /** which specializations actually contributed, for the UI breakdown
   *  (e.g. [{ spec: 'twopair', count: 1, bonus: 7 }]; empty when none) */
  regionContribs: { spec: Specialization; count: number; bonus: number }[]
  /** which jokers fired on this hand (for the UI breakdown) */
  jokerContribs: { id: string; title: string; mult: number }[]
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
 *      nominal = ceil(Growth × SEEDS_PER_GROWTH)   (1 Seed per 4 Growth)
 *  Seeds accumulate without ceiling; the nominal earn IS the banked earn. */
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
 * ceil(Growth × SEEDS_PER_GROWTH) Seeds, uncapped — the nominal earn IS the
 * banked earn, so the plan needs no balance and no credited/overflow split. */
export function buildPlan(
  hand: Card[],
  selected: number[],
  laws: Law[],
  regions: Region[] = [],
  projects: WorldProject[] = [],
  ctx: {
    jokers?: Joker[]
    planetLevels?: Partial<Record<HandCategory, number>>
    consumables?: Consumable[]
    worldLevel?: number
    vouchers?: Voucher[]
  } = {},
): ResolutionPlan {
  const base: ResolutionPlan = {
    cards: [], category: 'high', categoryLabel: '—', categoryPoints: 0,
    suitCounts: { S: 0, H: 0, D: 0, C: 0 },
    rankSum: 0, chips: 0, pokerBase: 0, mult: 1, growth: 0,
    growthParts: { poker: 0, laws: 0, regions: 0 }, regionContribs: [], jokerContribs: [],
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

  // ---- HERO SCORE: Growth, in the fixed order poker → laws → world → jokers
  // 1. poker base: rankSum ("chips", ALL selected ranks incl. kickers)
  //    × CATEGORY_MULT[category] (the hand mult) + Planet-card boosts
  const mult = CATEGORY_MULT[res.category] + (ctx.planetLevels?.[res.category] ?? 0)
  const pokerBase = Math.round(sum * mult)
  // 2. World Laws: × owned growthMult (floored at 1), then + owned growthFlat
  const lawMult = lawGrowthMult(laws)
  const lawFlat = lawGrowthFlat(laws) + projects.reduce((n, p) => n + (p.growthFlat ?? 0), 0)
  const lawBonus = Math.round(pokerBase * lawMult) + lawFlat - pokerBase
  // 3. World Level: +2 Growth/play per level above 1 (the simplified worldbuilding)
  const worldBonus = worldLevelBonus(ctx.worldLevel ?? 1).growthPerPlay
  // 4. REGIONS: sum the bonus of every AWAKE region whose fixed specialization
  //    equals the hand's EXACT evaluated category (dormant → 0; additive
  //    stacking across multiple matching regions; applied ONCE, AFTER the law
  //    arithmetic — the law multiplier never re-multiplies this part).
  const wantedSpec = specOfCategory(res.category)
  let regionsBonus = 0
  const regionContribs: ResolutionPlan['regionContribs'] = []
  for (const r of regions) {
    if (r.dormant || r.specialization === null || r.specialization !== wantedSpec) continue
    const bonus = regionBonusOf(r)
    if (bonus <= 0) continue
    regionsBonus += bonus
    const existing = regionContribs.find((c) => c.spec === r.specialization)
    if (existing) { existing.count += 1; existing.bonus += bonus }
    else regionContribs.push({ spec: r.specialization, count: 1, bonus })
  }
  // 5. JOKERS: conditional multipliers, stacked multiplicatively. A joker fires
  //    when the played hand meets its condition. Vouchers add to all joker mult.
  const jokerMultBonus = (ctx.vouchers ?? []).reduce((n, v) => n + (v.jokerMult ?? 0), 0)
  let jokerMult = 1
  const jokerContribs: { id: string; title: string; mult: number }[] = []
  for (const j of ctx.jokers ?? []) {
    const fires = j.condition === 'any'
      || (j.condition === 'pair' && res.category === 'pair')
      || (j.condition === 'twopair' && res.category === 'two-pair')
      || (j.condition === 'flush' && res.category === 'flush')
      || (j.condition === 'high-card' && res.category === 'high')
      || (j.condition === 'no-face' && cards.every((c) => c.r < 11))
    if (!fires) continue
    const m = j.mult + jokerMultBonus
    jokerMult *= (1 + m)
    jokerContribs.push({ id: j.id, title: j.title, mult: m })
  }
  // 6. CONSUMABLES: the queued ×N applies to the next hand (consumed on play).
  const consumableMult = (ctx.consumables ?? []).reduce((n, c) => n * c.xNext, 1)

  const growthParts = { poker: pokerBase, laws: lawBonus, regions: regionsBonus }
  const growth = Math.max(0, Math.round((pokerBase * lawMult + lawFlat + worldBonus + regionsBonus) * jokerMult * consumableMult))

  // AUTO-EARN SEEDS: hand quality pays instantly. 1 Seed per 4 Growth
  // (SEEDS_PER_GROWTH = 1/4). Seeds accumulate without ceiling — the nominal
  // earn IS the banked earn, so the plan carries just `amount` and preview,
  // commit and the chronicle all read the same field.
  const seedsGain = Math.max(0, Math.ceil(growth * SEEDS_PER_GROWTH))

  // EVERY play banks its Growth toward the single epoch target.
  const effects: PlanEffect[] = [
    { kind: 'flourishing', amount: growth },
    { kind: 'seeds', amount: seedsGain },
  ]
  // Honest summary: rankSum × mult (the true chips×mult equation), then the
  // already-multiplied base, then the regional bonus when one applies, then the
  // Seed earn. e.g.
  // "chips 32 x 2 mult = base 64 +7 regions. Gains 18 Seeds."
  const regionClause = regionsBonus > 0
    ? ` +${regionsBonus} region${regionContribs.length > 1 ? 's' : ''}`
    : ''
  const jokerClause = jokerContribs.length > 0
    ? ` ×${jokerMult.toFixed(2)} joker${jokerContribs.length > 1 ? 's' : ''}`
    : ''
  const summary = `Banks ${growth} Growth (chips ${sum} x ${mult.toFixed(2)} mult = base ${pokerBase}${lawBonus !== 0 ? ` ${lawBonus >= 0 ? '+' : ''}${lawBonus} laws` : ''}${worldBonus !== 0 ? ` +${worldBonus} world` : ''}${regionClause}${jokerClause}). Gains ${seedsGain} Seeds.`

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
    regionContribs,
    jokerContribs,
    effects,
    summary,
    valid: true,
    invalidReason: '',
  }
}

/** Apply a plan to a mutable-ish state copy. Used by BOTH preview-apply and commit.
 *  Seed crediting banks the plan's own `amount` — no divergent arithmetic: the
 *  balance moves by exactly the amount the preview and the chronicle state. */
export function applyPlanEffects(s: GameState, plan: ResolutionPlan): void {
  for (const e of plan.effects) {
    if (e.kind === 'flourishing') {
      s.flourishing += e.amount
      s.epochGrowth += e.amount
    } else if (e.kind === 'seeds') {
      s.seeds += e.amount
    }
  }
}

export function preview(s: GameState): ResolutionPlan {
  return buildPlan(s.hand, s.selected, s.laws, s.regions, s.projects, {
    jokers: s.jokers, planetLevels: s.planetLevels, consumables: s.consumables,
    worldLevel: s.worldLevel, vouchers: s.vouchers,
  })
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
    // DETERMINISTIC specialization map (fixed data — see SPECIALIZATION_MAP):
    // Auralia (0) = pair (awake — START_REGIONS covers id 0..3), Pellucid (6)
    // and Vantage (11) start dormant and are awakenable via wake-* expansions.
    specialization: SPECIALIZATION_MAP[i] ?? null,
  }))
  return {
    version: SAVE_VERSION,
    seed,
    seedText,
    epoch: 1,
    phase: 'select',
    flourishing: FLOURISH_START,
    epochGrowth: 0,
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
    projectMarket: [],
    jokerMarket: [],
    planetMarket: [],
    consumableMarket: [],
    voucherMarket: [],
    laws: [],
    projects: [],
    worldLevel: 1,
    jokers: [],
    planetLevels: {},
    consumables: [],
    vouchers: [],
    lastResolution: null,
    log: [{ at: 'world', text: `The world of ${seedText} takes root. Four regions wake.` }],
    outcome: null,
    outcomeReason: '',
  }
}

function clone(s: GameState): GameState {
  return {
    ...s,
    regions: s.regions.map((r) => ({ ...r, adjacency: [...r.adjacency] })), // specialization copies by spread
    hand: [...s.hand],
    deckRest: [...s.deckRest],
    discardPile: [...s.discardPile],
    selected: [...s.selected],
    market: s.market.map((m) => ({ ...m })),
    projectMarket: s.projectMarket.map((p) => ({ ...p })),
    jokerMarket: s.jokerMarket.map((j) => ({ ...j })),
    planetMarket: s.planetMarket.map((p) => ({ ...p })),
    consumableMarket: s.consumableMarket.map((c) => ({ ...c })),
    voucherMarket: s.voucherMarket.map((v) => ({ ...v })),
    laws: s.laws.map((l) => ({ ...l })),
    projects: s.projects.map((p) => ({ ...p })),
    jokers: s.jokers.map((j) => ({ ...j })),
    planetLevels: { ...s.planetLevels },
    consumables: s.consumables.map((c) => ({ ...c })),
    vouchers: s.vouchers.map((v) => ({ ...v })),
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
      const plan = buildPlan(s.hand, s.selected, s.laws, s.regions, s.projects, {
        jokers: s.jokers, planetLevels: s.planetLevels, consumables: s.consumables,
        worldLevel: s.worldLevel, vouchers: s.vouchers,
      })
      if (!plan.valid) throw new Error(plan.invalidReason || 'invalid selection')
      // apply plan effects (shared pipeline — preview and commit agree by construction)
      applyPlanEffects(s, plan)
      // consumables are one-shot: consumed on the hand they boosted
      s.consumables = []
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
      // EARLY ADVANCE: if the play reached the PER-EPOCH target (Growth banked
      // this epoch), close the epoch immediately — unused plays and discards
      // are forfeited, exactly as in Balatro. Otherwise close only when all
      // plays are spent.
      if (s.epochGrowth >= epochTarget(s.epoch)) return endEpoch(s)
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
    case 'buyProject': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      const proj = WORLD_PROJECTS.find((p) => p.id === action.projectId)
      if (!proj) throw new Error('no such world project')
      const owned = s.projects.filter((p) => p.id === proj.id).length
      const cost = proj.baseCost + owned * proj.costGrowth
      if (s.seeds < cost) throw new Error(`need ${cost} Seeds`)
      s.seeds -= cost
      s.projects.push({ ...proj })
      if (proj.devRegionId !== undefined) {
        const r = s.regions.find((x) => x.id === proj.devRegionId)
        if (r) r.development += 1 // uncapped
      }
      s.log.push({ at: `e${s.epoch}`, text: `Funded ${proj.title} (-${cost} Seeds).` })
      return s
    }
    case 'buyJoker': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      const j = s.jokerMarket.find((x) => x.id === action.jokerId)
      if (!j) throw new Error('no such joker')
      if (s.jokers.length >= JOKER_SLOTS) throw new Error(`all ${JOKER_SLOTS} joker slots are full`)
      if (s.seeds < j.cost) throw new Error(`need ${j.cost} Seeds`)
      s.seeds -= j.cost
      s.jokers.push({ ...j })
      s.jokerMarket = s.jokerMarket.filter((x) => x.id !== j.id)
      s.log.push({ at: `e${s.epoch}`, text: `Bought ${j.title} (-${j.cost} Seeds).` })
      return s
    }
    case 'buyPlanet': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      const p = s.planetMarket.find((x) => x.id === action.planetId)
      if (!p) throw new Error('no such planet card')
      if (s.seeds < p.cost) throw new Error(`need ${p.cost} Seeds`)
      s.seeds -= p.cost
      s.planetLevels[p.category] = (s.planetLevels[p.category] ?? 0) + p.boost
      s.planetMarket = s.planetMarket.filter((x) => x.id !== p.id)
      s.log.push({ at: `e${s.epoch}`, text: `Bought ${p.title} (-${p.cost} Seeds).` })
      return s
    }
    case 'buyConsumable': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      const c = s.consumableMarket.find((x) => x.id === action.consumableId)
      if (!c) throw new Error('no such consumable')
      if (s.seeds < c.cost) throw new Error(`need ${c.cost} Seeds`)
      s.seeds -= c.cost
      s.consumables.push({ ...c })
      s.consumableMarket = s.consumableMarket.filter((x) => x.id !== c.id)
      s.log.push({ at: `e${s.epoch}`, text: `Bought ${c.title} (-${c.cost} Seeds).` })
      return s
    }
    case 'buyVoucher': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      const v = s.voucherMarket.find((x) => x.id === action.voucherId)
      if (!v) throw new Error('no such voucher')
      if (s.seeds < v.cost) throw new Error(`need ${v.cost} Seeds`)
      s.seeds -= v.cost
      s.vouchers.push({ ...v })
      s.voucherMarket = s.voucherMarket.filter((x) => x.id !== v.id)
      s.log.push({ at: `e${s.epoch}`, text: `Bought ${v.title} (-${v.cost} Seeds).` })
      return s
    }
    case 'boostWorld': {
      if (s.phase !== 'market') throw new Error('not in market phase')
      const cost = 10 + (s.worldLevel - 1) * 5
      if (s.seeds < cost) throw new Error(`need ${cost} Seeds`)
      s.seeds -= cost
      s.worldLevel += 1
      s.log.push({ at: `e${s.epoch}`, text: `World Level up to ${s.worldLevel} (-${cost} Seeds).` })
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

/** Max owned Jokers — the Balatro 5-slot joker shelf. */
export const JOKER_SLOTS = 5

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
  for (const k of ['seed', 'seedText', 'epoch', 'phase', 'flourishing', 'epochGrowth', 'lives', 'seeds'] as const) {
    if (!(k in s)) return missing(k)
  }
  if (!Array.isArray(s.projects)) return bad('projects', 'must be an array')
  if (typeof s.seed !== 'number' || !Number.isFinite(s.seed)) return bad('seed', 'must be a finite number')
  if (typeof s.seedText !== 'string') return bad('seedText', 'must be a string')
  if (!Number.isInteger(s.epoch) || (s.epoch as number) < 1) {
    return bad('epoch', 'must be an integer >= 1')
  }
  if (!VALID_PHASES.includes(s.phase as Phase)) {
    return `phase "${String(s.phase)}" is not a valid Phase (${VALID_PHASES.join(' | ')})`
  }
  for (const k of ['flourishing', 'epochGrowth', 'seeds'] as const) {
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
  if (!Array.isArray(s.projectMarket)) return bad('projectMarket', 'must be an array')
  if (!Array.isArray(s.projects)) return bad('projects', 'must be an array')
  if (!Array.isArray(s.jokerMarket)) return bad('jokerMarket', 'must be an array')
  if (!Array.isArray(s.planetMarket)) return bad('planetMarket', 'must be an array')
  if (!Array.isArray(s.consumableMarket)) return bad('consumableMarket', 'must be an array')
  if (!Array.isArray(s.voucherMarket)) return bad('voucherMarket', 'must be an array')
  if (!Array.isArray(s.jokers)) return bad('jokers', 'must be an array')
  if (!Array.isArray(s.consumables)) return bad('consumables', 'must be an array')
  if (!Array.isArray(s.vouchers)) return bad('vouchers', 'must be an array')
  if (typeof s.worldLevel !== 'number' || !Number.isFinite(s.worldLevel) || s.worldLevel < 1) {
    return bad('worldLevel', 'must be a number >= 1')
  }
  if (typeof s.planetLevels !== 'object' || s.planetLevels === null || Array.isArray(s.planetLevels)) {
    return bad('planetLevels', 'must be an object')
  }
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
  // (+ the v4 specialization field: exactly null or a legal specialization key)
  for (const r of s.regions as unknown[]) {
    if (!r || typeof r !== 'object') return 'regions contains a malformed entry'
    const rr = r as any
    if (!Number.isInteger(rr.id) || rr.id < 0 || rr.id >= TOTAL_REGIONS) return 'a region has an invalid id'
    if (typeof rr.dormant !== 'boolean') return bad('regions', 'a region is missing its dormant flag')
    if (rr.specialization !== null && !(typeof rr.specialization === 'string' && rr.specialization in SPECIALIZATION_BASE)) {
      return bad('regions', `a region has an invalid specialization ${JSON.stringify(rr.specialization)} (expected null | 'pair' | 'twopair' | 'flush')`)
    }
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

  // epoch target check: the ONE target per epoch is Growth banked DURING this
  // epoch (per-epoch, not cumulative) — `epochGrowth` resets at each boundary.
  const targetNeed = epochTarget(s.epoch)
  const metTarget = s.epochGrowth >= targetNeed
  s.log.push({
    at: `e${s.epoch}`,
    text: `Epoch ${s.epoch} target "${epochTargetDesc(s.epoch)}": ${metTarget ? 'met' : 'missed'} (banked ${s.epochGrowth} this epoch).`,
  })

  // Balatro-style lives: EVERY missed epoch target costs 1 life; the run ends
  // only when lives reach 0. With unlimited epochs, missing a target is the
  // pressure that eventually ends the run — 3 lives is a real, exhaustible
  // resource, not a free pass at a final rung.
  let missedTarget = false
  if (!metTarget) {
    s.lives -= 1
    missedTarget = true
    s.log.push({
      at: `e${s.epoch}`,
      text: `Missed the epoch-${s.epoch} target: a life is lost (now ${s.lives}) and this epoch's market income is halved.`,
    })
    s.log.push({
      at: `e${s.epoch}`,
      text: `Banked ${s.epochGrowth} this epoch, short of ${targetNeed} — the next epoch's market opens with the penalty applied.`,
    })
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

  // civilization growth (presentation + World Score): every living region gains
  // +1 development each epoch — this is what makes the 3D planet's evolution
  // icons appear and the globe itself visibly grow. Development is UNCAPPED so
  // the world keeps growing as long as the run survives.
  for (const r of s.regions) {
    if (!r.dormant) r.development += 1
  }

  // World Level auto-grows +1 each epoch (the simplified worldbuilding).
  s.worldLevel += 1

  // income: +1 per living healthy region (stability > 0 — decay above really
  // feeds this) plus law income plus World-Project Seed income plus World
  // Level + Voucher Seed income, halved on a missed target. Seeds accumulate
  // without ceiling, so the full income is banked.
  const seedIncome = s.laws.reduce((n, l) => n + (l.extraSeedsPerEpoch ?? 0), 0)
    + s.projects.reduce((n, p) => n + (p.seedsPerEpoch ?? 0), 0)
    + s.vouchers.reduce((n, v) => n + (v.seedsPerEpoch ?? 0), 0)
    + worldLevelBonus(s.worldLevel).seedsPerEpoch
    + s.regions.filter((r) => !r.dormant && r.stability > 0).length
  const marketIncome = missedTarget ? Math.floor(seedIncome / 2) : seedIncome
  s.seeds += marketIncome
  s.log.push({
    at: `e${s.epoch}`,
    text: `Epoch end: +${marketIncome} Seeds.`,
  })

  // UNLIMITED EPOCHS: every epoch (met or missed) opens the market — there is
  // no fixed final epoch. The run ends only when lives run out or Flourishing
  // collapses (handled in advanceToNextEpoch).
  const rng = rngFor(s, 77)
  const pool = MARKET_ITEMS.filter((m) => !s.laws.some((l) => l.id === m.id))
  const shuffled = rng.shuffle([...pool])
  s.market = shuffled.slice(0, Math.min(MARKET_SIZE, shuffled.length))
  // World Projects: offer a rotating set of 3 each market (infinite Seed-sink —
  // the shop never drains). Deterministic per epoch.
  const projShuffled = rng.shuffle([...WORLD_PROJECTS])
  s.projectMarket = projShuffled.slice(0, 3)
  // Jokers / Planet cards / Consumables / Vouchers: offer a rotating set each
  // market (Balatro-style shop).
  s.jokerMarket = rng.shuffle([...JOKERS]).slice(0, 3)
  s.planetMarket = rng.shuffle([...PLANET_CARDS]).slice(0, 3)
  s.consumableMarket = rng.shuffle([...CONSUMABLES]).slice(0, 2)
  s.voucherMarket = rng.shuffle([...VOUCHERS]).slice(0, 2)
  s.phase = 'market'
  return s
}

function advanceToNextEpoch(state: GameState): GameState {
  const s = clone(state)
  if (s.lives <= 0 || s.flourishing <= 0) {
    s.phase = 'game-over'
    if (s.lives <= 0) {
      s.outcome = 'withered'
      s.outcomeReason = `Out of lives (${s.lives}): too many epoch targets missed. The world withers.`
    } else {
      s.outcome = 'withered'
      s.outcomeReason = 'Flourishing collapsed to 0.'
    }
    return s
  }
  s.epoch += 1
  s.playsLeft = PLAYS_PER_EPOCH
  s.discardsLeft = DISCARDS_PER_EPOCH
  s.epochGrowth = 0 // per-epoch target resets at the boundary
  s.log.push({ at: 'world', text: `— Epoch ${s.epoch} begins —` })
  return startEpoch(s)
}