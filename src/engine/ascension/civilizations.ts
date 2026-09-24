// Ascension civilizations: emergence, tiers, relations, names and passives.
// Pure — no DOM, no clock, no Math.random.
//
// Terrain + adjacency + the player's world-stat development decide which
// civilizations appear and where. Each has a tier (Settlement 1 → Kingdom 2 →
// Empire 3) that scales its passive and its weight in crises. Civilizations
// whose homes border each other are allies or rivals. Scars can cut a tier;
// a civilization at tier 0 collapses, and its people may rise again later.
import { stream } from '../core/streams'
import type { Region, Terrain, WorldStat, WorldStats } from './world'
import type { ScoreCtx } from './scoring'
import type { Suit } from '../poker'

export type Archetype = 'natureKeepers' | 'nomads' | 'merchants' | 'empireBuilders' | 'scholars' | 'technocrats' | 'mystics' | 'mariners'
export const TIER_LABEL = ['Fallen', 'Settlement', 'Kingdom', 'Empire'] as const

const count = (ctx: ScoreCtx, s: Suit) => ctx.scoring.filter((c) => c.s === s).length

export interface ArchetypeDef {
  label: string
  /** what it needs; its readiness is the LOWEST of these stats */
  stats: readonly WorldStat[]
  /** where it can found its home */
  terrains: readonly Terrain[]
  /** prefers well-connected regions */
  hub: boolean
  passive: { name: string; text: (tier: number) => string; apply: (ctx: ScoreCtx, tier: number, home: Region) => void }
  /** one line of flavour for the chronicle and the encyclopedia */
  lore: string
  /** name roots, combined by the seeded namer */
  names: { pre: readonly string[]; roots: readonly string[] }
}

export const ARCHETYPES: Record<Archetype, ArchetypeDef> = {
  natureKeepers: {
    label: 'Nature Keepers', stats: ['vitality'], terrains: ['forest'], hub: false,
    lore: 'Keepers of the old groves, who take nothing the forest cannot give back.',
    names: { pre: ['Circle of', 'Wardens of', 'Grove of'], roots: ['Elm', 'Thorn', 'Moss', 'Rowan', 'Fern', 'Willow'] },
    passive: {
      name: 'Stewardship', text: (t) => `While Vitality is at least Industry, each ♥ scored +${3 * t} chips.`,
      apply: (ctx, t) => {
        const h = count(ctx, 'H')
        if (h && ctx.stats.vitality >= ctx.stats.industry) ctx.add('civ', 'Nature Keepers', { chips: 3 * t * h }, `${h} ♥ × ${3 * t}`)
      },
    },
  },
  nomads: {
    label: 'Nomads', stats: ['vitality'], terrains: ['plains', 'desert', 'tundra'], hub: false,
    lore: 'Riders who carry their homes on their backs and their law in their songs.',
    names: { pre: ['Riders of', 'Clans of', 'Wanderers of'], roots: ['Dust', 'Khar', 'Steppe', 'Aru', 'Temur', 'Sable'] },
    passive: {
      name: 'Wandering', text: (t) => `+${t} mult for each suit scored beyond the first.`,
      apply: (ctx, t) => {
        const n = new Set(ctx.scoring.map((c) => c.s)).size
        if (n > 1) ctx.add('civ', 'Nomads', { mult: t * (n - 1) }, `${n} suits`)
      },
    },
  },
  merchants: {
    label: 'Merchants', stats: ['prosperity'], terrains: ['plains', 'coast'], hub: false,
    lore: 'Traders whose ledgers outlast their kings.',
    names: { pre: ['House', 'League of', 'Guild of'], roots: ['Vess', 'Oriel', 'Marro', 'Castel', 'Aurum', 'Delve'] },
    passive: {
      name: 'Commerce', text: (t) => `Plays scoring 2+ ♦: +${2 * t} mult. Each era end: +${t} Influence.`,
      apply: (ctx, t) => {
        const d = count(ctx, 'D')
        if (d >= 2) ctx.add('civ', 'Merchants', { mult: 2 * t }, `${d} ♦`)
      },
    },
  },
  empireBuilders: {
    label: 'Empire Builders', stats: ['industry'], terrains: ['mountains'], hub: true,
    lore: 'Road-builders who measure a realm by the stone laid across it.',
    names: { pre: ['Dominion of', 'Crown of', 'Iron'], roots: ['Karth', 'Valen', 'Ostra', 'Brann', 'Tor', 'Maxen'] },
    passive: {
      name: 'Roads', text: (t) => `Each ♣ scored +${t} chips per border of the home region.`,
      apply: (ctx, t, home) => {
        const c = count(ctx, 'C')
        if (c) ctx.add('civ', 'Empire Builders', { chips: c * t * home.neighbors.length }, `${c} ♣ × ${t} × ${home.neighbors.length} borders`)
      },
    },
  },
  scholars: {
    label: 'Scholars', stats: ['knowledge'], terrains: ['desert', 'tundra'], hub: false,
    lore: 'Star-readers and copyists who keep what the world forgets.',
    names: { pre: ['Academy of', 'Lamp of', 'Scriptorium of'], roots: ['Ilmar', 'Quill', 'Sephra', 'Noor', 'Athen', 'Lyra'] },
    passive: {
      name: 'Libraries', text: (t) => `Each ♠ scored +${t} chips per 5 Knowledge (up to ${10 * t} per ♠).`,
      apply: (ctx, t) => {
        const s = count(ctx, 'S')
        const per = Math.min(10, Math.floor(ctx.stats.knowledge / 5)) * t
        if (s && per) ctx.add('civ', 'Scholars', { chips: s * per }, `${s} ♠ × ${per} (Knowledge ${ctx.stats.knowledge})`)
      },
    },
  },
  technocrats: {
    label: 'Technocrats', stats: ['industry', 'knowledge'], terrains: ['mountains', 'coast'], hub: false,
    lore: 'Engineers who believe every problem is a machine not yet built.',
    names: { pre: ['Institute of', 'Engine of', 'Collegium'], roots: ['Axion', 'Vektor', 'Helix', 'Cogan', 'Ferro', 'Tessel'] },
    passive: {
      name: 'Engineering', text: (t) => `Plays scoring both ♣ and ♠: ×${1 + t / 4} mult.`,
      apply: (ctx, t) => {
        if (count(ctx, 'C') && count(ctx, 'S')) ctx.add('civ', 'Technocrats', { xmult: 1 + t / 4 }, 'both ♣ and ♠ scored')
      },
    },
  },
  mystics: {
    label: 'Mystics', stats: ['vitality', 'knowledge'], terrains: ['forest', 'desert'], hub: false,
    lore: 'Seers who find the whole world in a single card.',
    names: { pre: ['Order of', 'Veil of', 'Seers of'], roots: ['Omen', 'Hollow', 'Ysra', 'Lumen', 'Vesper', 'Anath'] },
    passive: {
      name: 'Contemplation', text: (t) => `High Card, Pair and Two Pair hands: +${3 * t} mult.`,
      apply: (ctx, t) => {
        if (ctx.category === 'high' || ctx.category === 'pair' || ctx.category === 'two-pair') ctx.add('civ', 'Mystics', { mult: 3 * t }, 'a small hand')
      },
    },
  },
  mariners: {
    label: 'Mariners', stats: ['prosperity', 'vitality'], terrains: ['coast'], hub: false,
    lore: 'Sailors who draw the map as they go.',
    names: { pre: ['Fleet of', 'Tide of', 'Harbour of'], roots: ['Corran', 'Selk', 'Maris', 'Brine', 'Nautil', 'Oaren'] },
    passive: {
      name: 'Seafaring', text: (t) => `Each ♦ or ♥ scored +${t} chips per coastal region.`,
      apply: (ctx, t) => {
        const n = count(ctx, 'D') + count(ctx, 'H'), coasts = ctx.regions.filter((r) => r.terrain === 'coast').length
        if (n && coasts) ctx.add('civ', 'Mariners', { chips: n * t * coasts }, `${n} ♦/♥ × ${t} × ${coasts} coasts`)
      },
    },
  },
}
/** Fixed evaluation order (never iterate object keys for this). */
export const ARCHETYPE_ORDER: readonly Archetype[] = ['natureKeepers', 'nomads', 'merchants', 'empireBuilders', 'scholars', 'technocrats', 'mystics', 'mariners']

// ---------------------------------------------------------------------------
// Relations: civilizations whose homes border each other.
// ---------------------------------------------------------------------------
export type Relation = 'ally' | 'rival'
const key = (a: Archetype, b: Archetype) => [a, b].sort().join('+')
const ALLIES = new Set([
  key('natureKeepers', 'nomads'), key('scholars', 'technocrats'), key('mystics', 'natureKeepers'), key('mystics', 'scholars'),
  key('mariners', 'merchants'), key('merchants', 'nomads'), key('merchants', 'scholars'), key('merchants', 'technocrats'), key('merchants', 'empireBuilders'),
])
const RIVALS = new Set([
  key('empireBuilders', 'nomads'), key('technocrats', 'natureKeepers'), key('empireBuilders', 'mariners'), key('mystics', 'technocrats'),
  key('empireBuilders', 'natureKeepers'), key('merchants', 'mystics'),
])
export function relationOf(a: Archetype, b: Archetype): Relation | null {
  const k = key(a, b)
  return ALLIES.has(k) ? 'ally' : RIVALS.has(k) ? 'rival' : null
}
export const RELATION_TEXT: Record<Relation, string> = {
  ally: 'Allies: +3 resilience in every crisis.',
  rival: 'Rivals: +1 mult on every play (competition), +5 pressure in conflict crises.',
}

export interface Civilization {
  /** serial number: stable, never reused */
  id: number
  archetype: Archetype
  name: string
  home: number
  /** 1 Settlement, 2 Kingdom, 3 Empire */
  tier: number
  emergedEra: number
  emergedPlay: number
  /** engine-derived explanation of why it emerged there */
  reason: { stat: WorldStat; readiness: number; needed: number; terrain: Terrain; regionFit: number }
}
export interface CivPair { a: number; b: number; relation: Relation }

/** Pairs of living civilizations whose homes border each other and have a relation (stable order). */
export function relations(civs: readonly Civilization[], regions: readonly Region[]): CivPair[] {
  const out: CivPair[] = []
  for (let i = 0; i < civs.length; i++) for (let j = i + 1; j < civs.length; j++) {
    const x = civs[i], y = civs[j]
    if (!regions[x.home].neighbors.includes(y.home)) continue
    const relation = relationOf(x.archetype, y.archetype)
    if (relation) out.push({ a: x.id, b: y.id, relation })
  }
  return out
}

// ---------------------------------------------------------------------------
// Emergence and growth.
// ---------------------------------------------------------------------------
/** The n-th civilization (0-based) needs readiness >= EMERGENCE_STEP × (n + 1). */
export const EMERGENCE_STEP = 5
/** Tier growth at the dawn of an era: readiness needed and the first era it is possible in. */
export const TIER_GROWTH: readonly { tier: number; readiness: number; fromEra: number }[] = [
  { tier: 2, readiness: 20, fromEra: 1 },
  { tier: 3, readiness: 45, fromEra: 3 },
]
export const readinessOf = (a: Archetype, stats: WorldStats) => Math.min(...ARCHETYPES[a].stats.map((k) => stats[k]))
export const emergenceThreshold = (civCount: number, step = EMERGENCE_STEP) => step * (civCount + 1)

export function regionFit(a: Archetype, region: Region, regions: readonly Region[]): number {
  const { terrains, hub } = ARCHETYPES[a]
  return region.neighbors.filter((n) => terrains.includes(regions[n].terrain)).length + (hub ? region.neighbors.length : 0)
}

/** The tier a civilization grows to at the dawn of `era` (never shrinks here). */
export function grownTier(c: Civilization, stats: WorldStats, era: number): number {
  let t = c.tier
  for (const g of TIER_GROWTH) if (t === g.tier - 1 && era >= g.fromEra && readinessOf(c.archetype, stats) >= g.readiness) t = g.tier
  return t
}

function civName(seed: number, id: number, a: Archetype): string {
  const rng = stream(seed, 'ascension', 'name', id)
  const { pre, roots } = ARCHETYPES[a].names
  return `${rng.pick(pre)} ${rng.pick(roots)}${rng.pick(['', 'a', 'ar', 'eth', 'is', 'on', 'ren'])}`
}

/** The civilization (if any) that emerges after play number `play`. Pure.
 *  1. Candidates: archetypes in the pool, not living now, whose readiness
 *     reaches the threshold and that have a free region of a favoured terrain.
 *  2. Highest readiness wins; then the best region fit.
 *  3. Home: its free favoured region with the best fit.
 *  Remaining ties are broken by the named stream ('ascension','civ', play). */
export function emergeCivilization(
  seed: number, play: number, era: number, regions: readonly Region[], stats: WorldStats,
  civs: readonly Civilization[], pool: readonly Archetype[], nextId: number, step = EMERGENCE_STEP,
): Civilization | null {
  const needed = emergenceThreshold(civs.length, step)
  const taken = new Set(civs.map((c) => c.home))
  let best: { archetype: Archetype; readiness: number; fit: number; homes: Region[] }[] = []
  for (const archetype of ARCHETYPE_ORDER) {
    if (!pool.includes(archetype) || civs.some((c) => c.archetype === archetype)) continue
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
  const rng = stream(seed, 'ascension', 'civ', play)
  const pick = best.length > 1 ? rng.pick(best) : best[0]
  const home = pick.homes.length > 1 ? rng.pick(pick.homes) : pick.homes[0]
  const stat = ARCHETYPES[pick.archetype].stats.reduce((lo, k) => (stats[k] < stats[lo] ? k : lo))
  return {
    id: nextId, archetype: pick.archetype, name: civName(seed, nextId, pick.archetype), home: home.id, tier: 1,
    emergedEra: era, emergedPlay: play,
    reason: { stat, readiness: pick.readiness, needed, terrain: home.terrain, regionFit: pick.fit },
  }
}
