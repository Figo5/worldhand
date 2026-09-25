// Ascension content: world cards and decrees, as data. Pure.
//
// A WORLD CARD is a playing card (suit + rank, so it takes part in poker
// hands) with declarative effects that trigger when it scores, when it is
// discarded, or while it is held in hand during a play. A DECREE is a one-off
// act bought at the Council (reshape a region, raise a civilization, move stat
// points...). Both use a closed effect vocabulary interpreted by the engine;
// content never carries code. Ids are stable: saves and the profile store
// them, so an id is never reused or renamed (retire it instead).
import type { HandCategory, Rank, Suit } from '../poker'
import type { Terrain, WorldStat } from './world'
import type { Archetype, Relation } from './civilizations'
import type { CrisisKind } from './crises'

/** Bumped whenever content changes in a way that alters an existing id's behaviour. */
export const CONTENT_VERSION = 1

export type Rarity = 'common' | 'uncommon' | 'rare'
export const RARITY_PRICE: Record<Rarity, number> = { common: 3, uncommon: 5, rare: 7 }

/** What a numeric op is multiplied by. */
export type Per =
  | { per: 'terrain'; terrains: readonly Terrain[] }
  | { per: 'civs' }
  | { per: 'civTiers' }
  | { per: 'stat'; stat: WorldStat; div: number }
  | { per: 'scoring'; suit?: Suit }
  | { per: 'relations'; relation: Relation }
  | { per: 'handsPlayed' }
export type Cond =
  | { if: 'terrain'; terrains: readonly Terrain[]; atLeast: number }
  | { if: 'civ'; archetype: Archetype }
  | { if: 'statAbove'; over: WorldStat; under: WorldStat }
  | { if: 'category'; in: readonly HandCategory[] }
  | { if: 'played'; atMost: number }
  | { if: 'scoringSuit'; suit: Suit; atLeast: number }
  | { if: 'spread'; atMost?: number; atLeast?: number }
  | { if: 'lastHand' }
  | { if: 'crisis'; kinds: readonly CrisisKind[] }
export type StatTarget = WorldStat | 'suit' | 'lowest' | 'highest'
export type Op =
  | { op: 'chips'; n: number; per?: Per }
  | { op: 'mult'; n: number; per?: Per }
  | { op: 'xmult'; n: number }
  | { op: 'stat'; stat: StatTarget; n: number; per?: Per }
  | { op: 'influence'; n: number; per?: Per }
  | { op: 'reserves'; n: number }
  | { op: 'pressure'; n: number }
export interface Effect { when: 'scored' | 'discarded' | 'held'; cond?: Cond; ops: readonly Op[] }

export type Archetag = 'terrain' | 'vitality' | 'prosperity' | 'industry' | 'knowledge' | 'civ' | 'crisis' | 'score' | 'risky' | 'balance' | 'focus' | 'discard' | 'held' | 'economy' | 'small' | 'relations'

export interface WorldCardDef {
  id: string
  name: string
  suit: Suit
  rank: Rank
  rarity: Rarity
  /** earliest era (0-based) the Council may offer it */
  era: number
  tags: readonly Archetag[]
  text: string
  effects: readonly Effect[]
  /** unlocked from the start (else earned in the profile) */
  starter: boolean
}

const card = (id: string, name: string, suit: Suit, rank: Rank, rarity: Rarity, era: number, starter: boolean, tags: Archetag[], text: string, effects: Effect[]): WorldCardDef =>
  ({ id, name, suit, rank, rarity, era, starter, tags, text, effects })
const scored = (ops: Op[], cond?: Cond): Effect => ({ when: 'scored', ops, ...(cond ? { cond } : {}) })

export const WORLD_CARDS: readonly WorldCardDef[] = [
  // ---- foundations (common) ------------------------------------------------
  card('fertile-valley', 'Fertile Valley', 'H', 7, 'common', 0, true, ['terrain', 'vitality'], '+3 chips per forest and plains region.',
    [scored([{ op: 'chips', n: 3, per: { per: 'terrain', terrains: ['forest', 'plains'] } }])]),
  card('granary', 'Granary', 'H', 4, 'common', 0, true, ['held', 'vitality', 'crisis'], 'Held in hand when you play: +1 Vitality.',
    [{ when: 'held', ops: [{ op: 'stat', stat: 'vitality', n: 1 }] }]),
  card('trade-road', 'Trade Road', 'D', 8, 'common', 0, true, ['economy', 'prosperity'], 'If 2+ ♦ score: +1 Influence.',
    [scored([{ op: 'influence', n: 1 }], { if: 'scoringSuit', suit: 'D', atLeast: 2 })]),
  card('market-square', 'Market Square', 'D', 6, 'common', 0, true, ['terrain', 'prosperity'], '+1 mult per coast and plains region.',
    [scored([{ op: 'mult', n: 1, per: { per: 'terrain', terrains: ['coast', 'plains'] } }])]),
  card('quarry', 'Quarry', 'C', 9, 'common', 0, true, ['terrain', 'industry'], '+4 chips per mountain region.',
    [scored([{ op: 'chips', n: 4, per: { per: 'terrain', terrains: ['mountains'] } }])]),
  card('forge', 'Forge', 'C', 6, 'common', 0, true, ['industry', 'focus'], '+1 more Industry and +5 chips.',
    [scored([{ op: 'stat', stat: 'industry', n: 1 }, { op: 'chips', n: 5 }])]),
  card('scroll', 'Scroll', 'S', 5, 'common', 0, true, ['knowledge', 'focus'], '+1 more Knowledge and +5 chips.',
    [scored([{ op: 'stat', stat: 'knowledge', n: 1 }, { op: 'chips', n: 5 }])]),
  card('observatory', 'Observatory', 'S', 8, 'common', 0, true, ['terrain', 'knowledge'], '+1 mult per desert and tundra region.',
    [scored([{ op: 'mult', n: 1, per: { per: 'terrain', terrains: ['desert', 'tundra'] } }])]),
  card('hearth', 'Hearth', 'H', 9, 'common', 0, true, ['balance'], '+1 to your lowest stat.',
    [scored([{ op: 'stat', stat: 'lowest', n: 1 }])]),
  card('waystation', 'Waystation', 'D', 5, 'common', 0, true, ['discard', 'prosperity'], 'When discarded: +1 Prosperity.',
    [{ when: 'discarded', ops: [{ op: 'stat', stat: 'prosperity', n: 1 }] }]),
  card('woodpile', 'Woodpile', 'C', 4, 'common', 0, true, ['discard', 'crisis'], 'When discarded: bank +2 Reserves for this era’s crisis.',
    [{ when: 'discarded', ops: [{ op: 'reserves', n: 2 }] }]),
  card('campfire', 'Campfire', 'H', 3, 'common', 0, true, ['small', 'score'], 'If you played 3 or fewer cards: +4 mult.',
    [scored([{ op: 'mult', n: 4 }], { if: 'played', atMost: 3 })]),
  card('tally-stones', 'Tally Stones', 'S', 3, 'common', 0, true, ['crisis'], 'Bank +1 Reserve for this era’s crisis.',
    [scored([{ op: 'reserves', n: 1 }])]),
  // ---- build-arounds and utility (uncommon) --------------------------------
  card('sacred-grove', 'Sacred Grove', 'H', 12, 'uncommon', 1, true, ['vitality', 'focus', 'score'], '+1 mult per 6 Vitality.',
    [scored([{ op: 'mult', n: 1, per: { per: 'stat', stat: 'vitality', div: 6 } }])]),
  card('caravanserai', 'Caravanserai', 'D', 11, 'uncommon', 1, true, ['civ', 'economy'], '+1 Influence and +3 chips per civilization.',
    [scored([{ op: 'influence', n: 1 }, { op: 'chips', n: 3, per: { per: 'civs' } }])]),
  card('aqueduct', 'Aqueduct', 'C', 11, 'uncommon', 1, true, ['vitality', 'industry', 'balance'], '+1 Vitality and +1 Industry.',
    [scored([{ op: 'stat', stat: 'vitality', n: 1 }, { op: 'stat', stat: 'industry', n: 1 }])]),
  card('great-library', 'Great Library', 'S', 11, 'uncommon', 1, true, ['knowledge', 'focus', 'score'], '+1 chip per Knowledge.',
    [scored([{ op: 'chips', n: 1, per: { per: 'stat', stat: 'knowledge', div: 1 } }])]),
  card('border-fort', 'Border Fort', 'C', 8, 'uncommon', 1, true, ['crisis', 'industry'], 'If this era ends in a conflict crisis: bank +3 Reserves.',
    [scored([{ op: 'reserves', n: 3 }], { if: 'crisis', kinds: ['conflict', 'ideology'] })]),
  card('herbalist', 'Herbalist', 'H', 6, 'uncommon', 0, true, ['crisis', 'vitality'], 'If this era ends in an ecology or disease crisis: bank +3 Reserves.',
    [scored([{ op: 'reserves', n: 3 }], { if: 'crisis', kinds: ['ecology', 'disease'] })]),
  card('lighthouse', 'Lighthouse', 'D', 9, 'uncommon', 0, false, ['terrain', 'prosperity'], '+4 chips per coast region.',
    [scored([{ op: 'chips', n: 4, per: { per: 'terrain', terrains: ['coast'] } }])]),
  card('council-hall', 'Council Hall', 'S', 12, 'uncommon', 2, true, ['relations', 'civ'], '+3 mult per allied pair of civilizations.',
    [scored([{ op: 'mult', n: 3, per: { per: 'relations', relation: 'ally' } }])]),
  card('war-drums', 'War Drums', 'C', 12, 'uncommon', 2, false, ['relations', 'risky'], '+4 mult per rival pair of civilizations.',
    [scored([{ op: 'mult', n: 4, per: { per: 'relations', relation: 'rival' } }])]),
  card('pilgrim-road', 'Pilgrim Road', 'H', 11, 'uncommon', 1, true, ['vitality', 'knowledge'], '+1 Vitality and +1 Knowledge.',
    [scored([{ op: 'stat', stat: 'vitality', n: 1 }, { op: 'stat', stat: 'knowledge', n: 1 }])]),
  card('balance-scales', 'Balance Scales', 'D', 12, 'uncommon', 1, true, ['balance', 'score'], 'If your highest and lowest stats are within 6: ×1.5 mult.',
    [scored([{ op: 'xmult', n: 1.5 }], { if: 'spread', atMost: 6 })]),
  card('monument', 'Monument', 'S', 13, 'uncommon', 1, true, ['focus', 'score'], 'If your highest stat leads your lowest by 20+: +6 mult.',
    [scored([{ op: 'mult', n: 6 }], { if: 'spread', atLeast: 20 })]),
  card('ember-seed', 'Ember Seed', 'C', 3, 'uncommon', 0, true, ['risky', 'score'], '+40 chips, but +2 pressure on this era’s crisis.',
    [scored([{ op: 'chips', n: 40 }, { op: 'pressure', n: 2 }])]),
  card('last-stand', 'Last Stand', 'H', 13, 'uncommon', 1, false, ['score'], 'On the era’s last hand: ×2 mult.',
    [scored([{ op: 'xmult', n: 2 }], { if: 'lastHand' })]),
  card('lodestone', 'Lodestone', 'S', 7, 'uncommon', 0, false, ['small', 'discard'], 'If you played 2 or fewer cards: +1 to every stat.',
    [scored([{ op: 'stat', stat: 'vitality', n: 1 }, { op: 'stat', stat: 'prosperity', n: 1 }, { op: 'stat', stat: 'industry', n: 1 }, { op: 'stat', stat: 'knowledge', n: 1 }], { if: 'played', atMost: 2 })]),
  // ---- high impact (rare) ---------------------------------------------------
  card('philosophers-engine', 'Philosopher’s Engine', 'S', 14, 'rare', 2, false, ['knowledge', 'score'], '+1 mult per 4 Knowledge.',
    [scored([{ op: 'mult', n: 1, per: { per: 'stat', stat: 'knowledge', div: 4 } }])]),
  card('golden-harvest', 'Golden Harvest', 'H', 14, 'rare', 1, true, ['vitality', 'prosperity', 'economy'], '+2 Vitality, +2 Prosperity and +1 Influence.',
    [scored([{ op: 'stat', stat: 'vitality', n: 2 }, { op: 'stat', stat: 'prosperity', n: 2 }, { op: 'influence', n: 1 }])]),
  card('iron-colossus', 'Iron Colossus', 'C', 14, 'rare', 2, false, ['risky', 'score', 'industry'], '×2 mult, but +3 pressure on this era’s crisis.',
    [scored([{ op: 'xmult', n: 2 }, { op: 'pressure', n: 3 }])]),
  card('grand-bazaar', 'Grand Bazaar', 'D', 14, 'rare', 2, true, ['economy', 'prosperity'], '+1 Influence per ♦ scored.',
    [scored([{ op: 'influence', n: 1, per: { per: 'scoring', suit: 'D' } }])]),
  card('world-map', 'World Map', 'D', 13, 'rare', 1, false, ['civ', 'score'], '+2 mult per civilization.',
    [scored([{ op: 'mult', n: 2, per: { per: 'civs' } }])]),
  card('wildfire', 'Wildfire', 'C', 13, 'rare', 1, false, ['risky', 'industry'], '+3 Industry, but +4 pressure on this era’s crisis.',
    [scored([{ op: 'stat', stat: 'industry', n: 3 }, { op: 'pressure', n: 4 }])]),
  card('seed-vault', 'Seed Vault', 'H', 5, 'rare', 1, false, ['held', 'crisis'], 'Held in hand when you play: bank +2 Reserves.',
    [{ when: 'held', ops: [{ op: 'reserves', n: 2 }] }]),
  card('long-count', 'The Long Count', 'S', 2, 'rare', 1, false, ['score'], '+2 mult per hand already played this era.',
    [scored([{ op: 'mult', n: 2, per: { per: 'handsPlayed' } }])]),
]

// ---------------------------------------------------------------------------
// Decrees: one-off acts bought at the Council.
// ---------------------------------------------------------------------------
export type DecreeTarget = 'none' | 'region' | 'civ' | 'suit'
export type DecreeOp =
  | { op: 'terraform'; from: readonly Terrain[]; to: Terrain }
  | { op: 'stat'; stat: StatTarget; n: number }
  | { op: 'shift'; from: 'highest' | 'lowest'; to: 'highest' | 'lowest'; n: number }
  | { op: 'tier'; n: number }
  | { op: 'resolve'; n: number }
  | { op: 'hands'; n: number }
  | { op: 'discards'; n: number }
  | { op: 'reserves'; n: number }
  | { op: 'recruit'; n: number }
  | { op: 'treaty' }
export interface DecreeDef {
  id: string
  name: string
  rarity: Rarity
  era: number
  price: number
  target: DecreeTarget
  tags: readonly Archetag[]
  text: string
  ops: readonly DecreeOp[]
  starter: boolean
}
const decree = (id: string, name: string, rarity: Rarity, era: number, price: number, target: DecreeTarget, starter: boolean, tags: Archetag[], text: string, ops: DecreeOp[]): DecreeDef =>
  ({ id, name, rarity, era, price, target, starter, tags, text, ops })

export const DECREES: readonly DecreeDef[] = [
  decree('irrigate', 'Irrigate', 'common', 0, 4, 'region', true, ['terrain'], 'A desert or tundra region becomes plains.', [{ op: 'terraform', from: ['desert', 'tundra'], to: 'plains' }]),
  decree('plant-forests', 'Plant Forests', 'common', 0, 4, 'region', true, ['terrain', 'vitality'], 'A plains or wasteland region becomes forest.', [{ op: 'terraform', from: ['plains', 'wasteland'], to: 'forest' }]),
  decree('found-port', 'Found a Port', 'common', 0, 4, 'region', true, ['terrain', 'prosperity'], 'A plains or desert region becomes coast.', [{ op: 'terraform', from: ['plains', 'desert'], to: 'coast' }]),
  decree('open-mines', 'Open the Mines', 'uncommon', 1, 5, 'region', false, ['terrain', 'industry'], 'A forest, plains or tundra region becomes mountains.', [{ op: 'terraform', from: ['forest', 'plains', 'tundra'], to: 'mountains' }]),
  decree('restore-land', 'Restore the Land', 'common', 1, 3, 'region', true, ['terrain', 'crisis'], 'A wasteland region becomes plains.', [{ op: 'terraform', from: ['wasteland'], to: 'plains' }]),
  decree('patronage', 'Patronage', 'uncommon', 1, 6, 'civ', true, ['civ'], 'A civilization grows one tier (up to Empire).', [{ op: 'tier', n: 1 }]),
  decree('census', 'Census', 'common', 0, 3, 'none', true, ['balance'], '+3 to your lowest stat.', [{ op: 'stat', stat: 'lowest', n: 3 }]),
  decree('specialize', 'Specialize', 'common', 0, 2, 'none', true, ['focus'], 'Move 4 points from your lowest stat to your highest.', [{ op: 'shift', from: 'lowest', to: 'highest', n: 4 }]),
  decree('harmonize', 'Harmonize', 'common', 0, 2, 'none', true, ['balance'], 'Move 4 points from your highest stat to your lowest.', [{ op: 'shift', from: 'highest', to: 'lowest', n: 4 }]),
  decree('rally', 'Rally the People', 'rare', 1, 9, 'none', false, ['crisis'], '+1 Resolve (up to 3).', [{ op: 'resolve', n: 1 }]),
  decree('long-summer', 'Long Summer', 'uncommon', 0, 5, 'none', true, ['score'], '+2 hands next era.', [{ op: 'hands', n: 2 }]),
  decree('guild-charter', 'Guild Charter', 'uncommon', 0, 4, 'suit', true, ['focus'], 'The 3 lowest cards of other suits in your deck become the chosen suit.', [{ op: 'recruit', n: 3 }]),
  decree('stockpile', 'Stockpile', 'common', 0, 4, 'none', true, ['crisis'], 'Bank +6 Reserves for the next crisis.', [{ op: 'reserves', n: 6 }]),
  decree('treaty', 'Peace Treaty', 'uncommon', 2, 5, 'none', false, ['relations', 'crisis'], 'Next era, rivalries add no crisis pressure.', [{ op: 'treaty' }]),
]

export type WorldCardId = string
export type DecreeId = string
export const CARD_BY_ID: ReadonlyMap<string, WorldCardDef> = new Map(WORLD_CARDS.map((c) => [c.id, c]))
export const DECREE_BY_ID: ReadonlyMap<string, DecreeDef> = new Map(DECREES.map((d) => [d.id, d]))
