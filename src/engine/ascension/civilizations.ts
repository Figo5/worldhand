// Ascension civilizations: emergence only. Pure — no DOM, no clock, no
// Math.random. Civilizations have no gameplay effect yet; this system proves
// that terrain + adjacency + the player's world-stat development decide
// which civilizations appear and where.
import { stream } from '../core/streams'
import type { AscensionRegion, Terrain, WorldStat, WorldStats } from './ascension'

export type Archetype = 'natureKeepers' | 'nomads' | 'merchants' | 'empireBuilders' | 'scholars' | 'technocrats'

/** Working names and emergence preferences.
 *  - `stats`: what the civilization needs; its readiness is the LOWEST of
 *    these stats (Technocrats need both Industry and Knowledge).
 *  - `terrains`: where it can found its home. No such free region, no civ.
 *  - `hub`: prefers well-connected regions (region fit adds its neighbour count). */
export const ARCHETYPES: Record<Archetype, { label: string; stats: readonly WorldStat[]; terrains: readonly Terrain[]; hub: boolean }> = {
  natureKeepers: { label: 'Nature Keepers', stats: ['vitality'], terrains: ['forest'], hub: false },
  nomads: { label: 'Nomads', stats: ['vitality'], terrains: ['plains', 'desert', 'tundra'], hub: false },
  merchants: { label: 'Merchants', stats: ['prosperity'], terrains: ['plains', 'coast'], hub: false },
  empireBuilders: { label: 'Empire Builders', stats: ['industry'], terrains: ['mountains'], hub: true },
  scholars: { label: 'Scholars', stats: ['knowledge'], terrains: ['desert', 'tundra'], hub: false },
  technocrats: { label: 'Technocrats', stats: ['industry', 'knowledge'], terrains: ['mountains', 'coast'], hub: false },
}
/** Fixed evaluation order (never iterate object keys for this). */
export const ARCHETYPE_ORDER: readonly Archetype[] = ['natureKeepers', 'nomads', 'merchants', 'empireBuilders', 'scholars', 'technocrats']

/** The n-th civilization (0-based) needs readiness >= EMERGENCE_STEP × (n + 1). */
export const EMERGENCE_STEP = 6

export interface Civilization {
  id: number
  archetype: Archetype
  home: number
  /** 1 = settlement. Growth comes later. */
  tier: number
  emergedRound: number
  /** engine-derived explanation of why it emerged here, now */
  reason: { stat: WorldStat; readiness: number; needed: number; terrain: Terrain; regionFit: number }
}

export const readinessOf = (a: Archetype, stats: WorldStats) => Math.min(...ARCHETYPES[a].stats.map((k) => stats[k]))
export const emergenceThreshold = (civCount: number) => EMERGENCE_STEP * (civCount + 1)

/** Neighbours with a favoured terrain, plus the neighbour count for hub lovers. */
export function regionFit(a: Archetype, region: AscensionRegion, regions: readonly AscensionRegion[]): number {
  const { terrains, hub } = ARCHETYPES[a]
  const favoured = region.neighbors.filter((n) => terrains.includes(regions[n].terrain)).length
  return favoured + (hub ? region.neighbors.length : 0)
}

/** The civilization (if any) that emerges at this round-end checkpoint. Pure.
 *  1. Candidates: archetypes not yet present whose readiness reaches the
 *     threshold and that have a free region of a favoured terrain.
 *  2. Highest readiness wins; then the best region fit.
 *  3. Home: its free favoured region with the best fit.
 *  Remaining ties (equal readiness and fit) are broken by the named stream
 *  ('ascension','civ', round), and only then. */
export function emergeCivilization(
  seed: number, round: number, regions: readonly AscensionRegion[], stats: WorldStats, civs: readonly Civilization[],
): Civilization | null {
  const needed = emergenceThreshold(civs.length)
  const taken = new Set(civs.map((c) => c.home))
  let best: { archetype: Archetype; readiness: number; fit: number; homes: AscensionRegion[] }[] = []
  for (const archetype of ARCHETYPE_ORDER) {
    if (civs.some((c) => c.archetype === archetype)) continue
    const readiness = readinessOf(archetype, stats)
    if (readiness < needed) continue
    const free = regions.filter((r) => !taken.has(r.id) && ARCHETYPES[archetype].terrains.includes(r.terrain))
    if (free.length === 0) continue
    const fit = Math.max(...free.map((r) => regionFit(archetype, r, regions)))
    const homes = free.filter((r) => regionFit(archetype, r, regions) === fit)
    const cand = { archetype, readiness, fit, homes }
    const top = best[0]
    if (!top || readiness > top.readiness || (readiness === top.readiness && fit > top.fit)) best = [cand]
    else if (readiness === top.readiness && fit === top.fit) best.push(cand)
  }
  if (best.length === 0) return null
  const rng = stream(seed, 'ascension', 'civ', round)
  const pick = best.length > 1 ? rng.pick(best) : best[0]
  const home = pick.homes.length > 1 ? rng.pick(pick.homes) : pick.homes[0]
  const stat = ARCHETYPES[pick.archetype].stats.reduce((lo, k) => (stats[k] < stats[lo] ? k : lo))
  return {
    id: civs.length,
    archetype: pick.archetype,
    home: home.id,
    tier: 1,
    emergedRound: round,
    reason: { stat, readiness: pick.readiness, needed, terrain: home.terrain, regionFit: pick.fit },
  }
}
