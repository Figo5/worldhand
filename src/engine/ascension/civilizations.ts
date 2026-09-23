// Ascension civilizations: emergence and passives. Pure — no DOM, no clock, no
// Math.random. Terrain + adjacency + the player's world-stat development
// decide which civilizations appear and where; each emerged civilization then
// adds one deterministic passive bonus to plays (score only: never stats,
// terrain, cards or emergence).
import { stream } from '../core/streams'
import type { AscensionRegion, Terrain, WorldStat, WorldStats } from './ascension'
import type { Card, Suit } from '../poker'

export type Archetype = 'natureKeepers' | 'nomads' | 'merchants' | 'empireBuilders' | 'scholars' | 'technocrats'

/** What a passive sees: the played cards, their poker score, the world stats
 *  AFTER the play, and the civilization's home region. */
export interface PassiveContext {
  cards: readonly Card[]
  pokerScore: number
  stats: WorldStats
  home: AscensionRegion
}
/** amount 0 = not triggered; detail explains the numbers to the player. */
type Passive = { name: string; text: string; bonus: (ctx: PassiveContext) => { amount: number; detail: string } }

const count = (cards: readonly Card[], s: Suit) => cards.filter((c) => c.s === s).length

/** Working names, emergence preferences and passives.
 *  - `stats`: what the civilization needs; its readiness is the LOWEST of
 *    these stats (Technocrats need both Industry and Knowledge).
 *  - `terrains`: where it can found its home. No such free region, no civ.
 *  - `hub`: prefers well-connected regions (region fit adds its neighbour count).
 *  - `passive`: its one play bonus, active once it has emerged. */
export const ARCHETYPES: Record<Archetype, { label: string; stats: readonly WorldStat[]; terrains: readonly Terrain[]; hub: boolean; passive: Passive }> = {
  natureKeepers: {
    label: 'Nature Keepers', stats: ['vitality'], terrains: ['forest'], hub: false,
    passive: {
      name: 'Stewardship', text: 'While Vitality is at least Industry after the play, each ♥ card earns +3.',
      bonus: ({ cards, stats: { vitality: v, industry: i } }) => {
        const h = count(cards, 'H')
        return v >= i ? { amount: 3 * h, detail: `${h} ♥ × 3 (Vitality ${v} ≥ Industry ${i})` } : { amount: 0, detail: `Vitality ${v} < Industry ${i}` }
      },
    },
  },
  nomads: {
    label: 'Nomads', stats: ['vitality'], terrains: ['plains', 'desert', 'tundra'], hub: false,
    passive: {
      name: 'Wandering', text: 'Each suit in the play beyond the first earns +4.',
      bonus: ({ cards }) => {
        const n = new Set(cards.map((c) => c.s)).size
        return { amount: 4 * (n - 1), detail: `${n} suits → ${n - 1} × 4` }
      },
    },
  },
  merchants: {
    label: 'Merchants', stats: ['prosperity'], terrains: ['plains', 'coast'], hub: false,
    passive: {
      name: 'Commerce', text: 'A play with at least 2 ♦ earns +10% of its poker score (rounded down).',
      bonus: ({ cards, pokerScore }) => {
        const d = count(cards, 'D')
        return d >= 2 ? { amount: Math.floor(pokerScore / 10), detail: `${d} ♦: 10% of ${pokerScore}` } : { amount: 0, detail: `${d} ♦` }
      },
    },
  },
  empireBuilders: {
    label: 'Empire Builders', stats: ['industry'], terrains: ['mountains'], hub: true,
    passive: {
      name: 'Roads', text: "Each ♣ card earns +1 per region bordering the empire's home.",
      bonus: ({ cards, home }) => {
        const c = count(cards, 'C')
        return { amount: c * home.neighbors.length, detail: `${c} ♣ × ${home.neighbors.length} borders of R${home.id}` }
      },
    },
  },
  scholars: {
    label: 'Scholars', stats: ['knowledge'], terrains: ['desert', 'tundra'], hub: false,
    passive: {
      name: 'Libraries', text: 'Each ♠ card earns +1 per 10 Knowledge after the play, up to +5 per ♠.',
      bonus: ({ cards, stats: { knowledge: k } }) => {
        const s = count(cards, 'S')
        const per = Math.min(5, Math.floor(k / 10))
        return { amount: s * per, detail: `${s} ♠ × ${per} (Knowledge ${k})` }
      },
    },
  },
  technocrats: {
    label: 'Technocrats', stats: ['industry', 'knowledge'], terrains: ['mountains', 'coast'], hub: false,
    passive: {
      name: 'Engineering', text: 'A play with both ♣ and ♠ earns +3 per ♣ and ♠ card.',
      bonus: ({ cards }) => {
        const c = count(cards, 'C'), s = count(cards, 'S')
        return c > 0 && s > 0 ? { amount: 3 * (c + s), detail: `${c} ♣ + ${s} ♠ × 3` } : { amount: 0, detail: 'needs both ♣ and ♠' }
      },
    },
  },
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

/** One triggered passive: which civilization, how much, and why. */
export interface CivBonus { civ: number; archetype: Archetype; amount: number; detail: string }

/** The triggered passives of the EMERGED civilizations, in emergence order.
 *  The only path by which civilizations affect a play (via evaluatePlay). */
export function civilizationBonuses(
  civs: readonly Civilization[], regions: readonly AscensionRegion[], ctx: Omit<PassiveContext, 'home'>,
): CivBonus[] {
  return civs.flatMap((c) => {
    const { amount, detail } = ARCHETYPES[c.archetype].passive.bonus({ ...ctx, home: regions[c.home] })
    return amount > 0 ? [{ civ: c.id, archetype: c.archetype, amount, detail }] : []
  })
}
