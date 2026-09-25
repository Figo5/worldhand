// Ascension run state and actions (types only, plus tiny constructors). Pure.
import type { Rank, Suit } from '../poker'
import type { Seed } from '../rng'
import type { OriginId, Region, WorldStats } from './world'
import type { Archetype, Civilization } from './civilizations'
import type { CrisisEvaluation, CrisisId } from './crises'
import type { ChronicleEvent } from './chronicle'
import type { PlayResult } from './scoring'

export type LegendaryId =
  | 'worldTree' | 'eternalDragon' | 'sleepingGod' | 'titanForge' | 'cosmicLibrary' | 'architectMoon'
  | 'silkRoad' | 'hydraCrown' | 'monolith' | 'everflame' | 'gaiasHeart' | 'hourglass'
  | 'oraclesEye' | 'starseed' | 'philosophersStone' | 'ironHeart' | 'ouroboros'

/** One owned card. `id` is its identity for the whole run (never reused);
 *  `kind` names its world-card definition (null = a standard card);
 *  `bonus` is permanent extra chips (Titan Forge). */
export interface CardInst { id: number; r: Rank; s: Suit; kind: string | null; bonus: number }
export interface LegendaryInst { id: LegendaryId; counter: number; awake: boolean }

/** What content the run may offer: fixed at the start (the profile's
 *  unlocks), stored in the save so a run replays identically. */
export interface ContentPool { cards: string[]; decrees: string[]; legendaries: LegendaryId[]; archetypes: Archetype[] }
export interface RunSetup { seedText: string; omen: number; origin: OriginId; pool: ContentPool }

export interface Offer { kind: 'card' | 'decree' | 'legendary'; id: string; price: number; sold: boolean }
export interface CouncilState {
  offers: Offer[]
  rerolls: number
  /** a free pick of one legendary (null: none this Council, or already chosen/skipped) */
  legendaryChoice: LegendaryId[] | null
}

export interface CrisisOutcome extends CrisisEvaluation {
  era: number
  /** hands left unspent when it was faced */
  handsLeft: number
  /** endured with a margin of at least a quarter of its pressure */
  triumph: boolean
  /** failed, but a legendary turned it into endured */
  prevented: boolean
  /** Influence it paid (or cost, negative) */
  influence: number
  /** what the scar did, in words (empty when endured) */
  scars: string[]
}

export type Phase = 'play' | 'council' | 'won' | 'lost'

export interface AscensionState {
  mode: 'ascension'
  rulesVersion: number
  setup: RunSetup
  seed: Seed
  regions: Region[]
  phase: Phase
  /** index into ERAS */
  era: number
  /** the crisis each era ends in, fixed from the seed and shown from the start */
  crisisTrack: CrisisId[]
  handsLeft: number
  discardsLeft: number
  /** plays and discards made this era */
  handsPlayed: number
  hand: CardInst[]
  drawPile: CardInst[]
  discardPile: CardInst[]
  reshuffles: number
  nextCardId: number
  score: number
  eraScore: number
  /** pressure and reserves added by cards this era */
  eraPressure: number
  eraReserves: number
  /** banked for the next era (decrees bought at the Council) */
  next: { hands: number; discards: number; reserves: number; treaty: boolean }
  treaty: boolean
  stats: WorldStats
  civilizations: Civilization[]
  /** fallen civilizations, in order of their fall */
  fallen: Civilization[]
  nextCivId: number
  legendaries: LegendaryInst[]
  influence: number
  resolve: number
  crises: CrisisOutcome[]
  council: CouncilState | null
  lastPlay: PlayResult | null
  /** total plays and discards over the run */
  plays: number
  discards: number
  bestPlay: { score: number; label: string; era: number } | null
  chronicle: ChronicleEvent[]
}

export type AscensionAction =
  | { type: 'play'; cards: number[] }
  | { type: 'discard'; cards: number[] }
  | { type: 'face' }
  | { type: 'buy'; offer: number; target?: number | Suit }
  | { type: 'reroll' }
  | { type: 'remove'; card: number }
  | { type: 'legendary'; pick: number | null; replace?: number }
  | { type: 'sell'; slot: number }
  | { type: 'leave' }

export const MAX_RESOLVE = 3
export const LEGENDARY_SLOTS = 4
export const HAND_SIZE = 8
export const MAX_PLAY = 5
