// Ascension world: stats, terrain, the fixed 12-region topology, seeded land
// generation and starting origins. Pure — no DOM, no clock, no Math.random.
import type { Seed } from '../rng'
import type { Suit } from '../poker'
import { stream } from '../core/streams'

// ---------------------------------------------------------------------------
// World stats. ♥ Vitality, ♦ Prosperity, ♣ Industry, ♠ Knowledge.
// ---------------------------------------------------------------------------
export type WorldStat = 'vitality' | 'prosperity' | 'industry' | 'knowledge'
export type WorldStats = Record<WorldStat, number>
/** Display order. Iterate this, never object keys. */
export const WORLD_STATS: readonly WorldStat[] = ['vitality', 'prosperity', 'industry', 'knowledge']
export const WORLD_STAT_LABEL: Record<WorldStat, string> = {
  vitality: 'Vitality', prosperity: 'Prosperity', industry: 'Industry', knowledge: 'Knowledge',
}
export const SUIT_STAT: Record<Suit, WorldStat> = { H: 'vitality', D: 'prosperity', C: 'industry', S: 'knowledge' }
export const STAT_SUIT: Record<WorldStat, Suit> = { vitality: 'H', prosperity: 'D', industry: 'C', knowledge: 'S' }
export const SUIT_SYMBOL: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' }
export const noStats = (): WorldStats => ({ vitality: 0, prosperity: 0, industry: 0, knowledge: 0 })
export const totalOf = (s: WorldStats) => s.vitality + s.prosperity + s.industry + s.knowledge
export const highestStat = (s: WorldStats) => WORLD_STATS.reduce((a, k) => (s[k] > s[a] ? k : a))
export const lowestStat = (s: WorldStats) => WORLD_STATS.reduce((a, k) => (s[k] < s[a] ? k : a))

// ---------------------------------------------------------------------------
// Terrain. `stat` is what the land favours (its land bonus); wasteland is what
// a scar leaves behind and favours nothing.
// ---------------------------------------------------------------------------
export type Terrain = 'plains' | 'forest' | 'mountains' | 'desert' | 'coast' | 'tundra' | 'wasteland'
export const TERRAIN: Record<Terrain, { label: string; stat: WorldStat | null; weight: number; blurb: string }> = {
  plains: { label: 'Plains', stat: 'prosperity', weight: 1, blurb: 'Open farmland: favours Prosperity; crowds spread plague; open to raiders.' },
  forest: { label: 'Forest', stat: 'vitality', weight: 2, blurb: 'Deep woods: favours Vitality; shelters against winter and war.' },
  mountains: { label: 'Mountains', stat: 'industry', weight: 2, blurb: 'Ore and passes: favours Industry; cold in winter, a wall in war.' },
  desert: { label: 'Desert', stat: 'knowledge', weight: 1, blurb: 'Clear skies and isolation: favours Knowledge; thirsty in drought.' },
  coast: { label: 'Coast', stat: 'prosperity', weight: 1, blurb: 'Harbours: favours Prosperity; exposed to floods and plague ships.' },
  tundra: { label: 'Tundra', stat: 'knowledge', weight: 1, blurb: 'Frozen reaches: favours Knowledge; bitter in winter.' },
  wasteland: { label: 'Wasteland', stat: null, weight: 0, blurb: 'Scarred land: favours nothing and hosts no civilization until restored.' },
}
/** Natural terrains in fixed pick order (never iterate object keys for this). */
export const NATURAL_TERRAINS: readonly Terrain[] = ['plains', 'forest', 'mountains', 'desert', 'coast', 'tundra']

/** Region id -> neighbouring region ids (symmetric, connected, stable): an
 *  outer ring of 8 around a core of 4, the shape the globe renders. */
export const REGION_ADJACENCY: readonly (readonly number[])[] = [
  [1, 7, 8], [0, 2, 9], [1, 3, 9], [2, 4, 10], [3, 5, 11], [4, 6, 11],
  [5, 7, 8], [0, 6, 8], [0, 6, 7, 9, 11], [1, 2, 8, 10], [3, 9, 11], [4, 5, 8, 10],
]
export const REGION_NAMES: readonly string[] = [
  'Northreach', 'Amberfold', 'Saltmarch', 'Emberlee', 'Greyhollow', 'Sunward',
  'Duskmere', 'Windhollow', 'Heartvale', 'Stonecrown', 'Mirrorbay', 'Highhearth',
]

export interface Region { id: number; terrain: Terrain; neighbors: number[] }

// ---------------------------------------------------------------------------
// Origins: the starting world a run is dealt from. Horizontal choices (the
// land changes, not the player's power); all but Pangaea are unlocked in the
// profile.
// ---------------------------------------------------------------------------
export type OriginId = 'pangaea' | 'archipelago' | 'highlands' | 'verdant' | 'frontier'
export const ORIGINS: Record<OriginId, { label: string; text: string; weights: Partial<Record<Terrain, number>> }> = {
  pangaea: { label: 'Pangaea', text: 'A balanced supercontinent: every stat favoured about equally.', weights: {} },
  archipelago: { label: 'Archipelago', text: 'Island chains: far more coast, few mountains. Rich trade, raw exposure to floods and plague.', weights: { coast: 4, mountains: 1, plains: 1 } },
  highlands: { label: 'Highlands', text: 'Peaks and passes: more mountains and tundra, little coast. Strong walls, bitter winters.', weights: { mountains: 4, tundra: 2, coast: 0 } },
  verdant: { label: 'Verdant', text: 'Endless green: more forest and plains, little desert. Easy life, slow learning.', weights: { forest: 4, plains: 2, desert: 0 } },
  frontier: { label: 'Frontier', text: 'Hard country: more desert and tundra, few forests. Wisdom comes easier than food.', weights: { desert: 3, tundra: 3, forest: 1 } },
}
export const ORIGIN_ORDER: readonly OriginId[] = ['pangaea', 'archipelago', 'highlands', 'verdant', 'frontier']

/** Terrain weights for an origin, optionally harshened (Omen: harsh lands). */
export function terrainWeights(origin: OriginId, harsh = false): Record<Terrain, number> {
  const w = Object.fromEntries(NATURAL_TERRAINS.map((t) => [t, ORIGINS[origin].weights[t] ?? TERRAIN[t].weight])) as Record<Terrain, number>
  w.wasteland = 0
  if (harsh) { w.tundra += 1; w.desert += 1; w.forest = Math.max(1, w.forest - 1) }
  return w
}

/** The world for a run seed. Each region draws its terrain from its own named
 *  stream ('ascension', 'terrain', id), so a region's terrain depends only on
 *  (seed, id, origin): not on generation order, the deck or the UI. */
export function generateRegions(seed: Seed, origin: OriginId = 'pangaea', harsh = false): Region[] {
  const w = terrainWeights(origin, harsh)
  const total = NATURAL_TERRAINS.reduce((n, t) => n + w[t], 0)
  return REGION_ADJACENCY.map((neighbors, id) => {
    let roll = stream(seed, 'ascension', 'terrain', id).int(0, total)
    const terrain = NATURAL_TERRAINS.find((t) => (roll -= w[t]) < 0) as Terrain
    return { id, terrain, neighbors: [...neighbors] }
  })
}

/** How many regions favour each stat: the land bonus per scoring card of that stat. */
export function landAffinity(regions: readonly Region[]): WorldStats {
  const a = noStats()
  for (const r of regions) { const k = TERRAIN[r.terrain].stat; if (k) a[k] += 1 }
  return a
}
export const countTerrain = (regions: readonly Region[], ts: readonly Terrain[]) => regions.filter((r) => ts.includes(r.terrain)).length
