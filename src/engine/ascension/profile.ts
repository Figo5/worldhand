// Ascension profile: long-term progression, as pure data and functions.
// Storage lives in the UI layer (src/ui/ascension/storage.ts); this module
// only decides what a profile is, how an old one is migrated, and what a
// run unlocks. Progression is horizontal: new cards, legendaries, peoples,
// origins and Omens — never a permanent power bonus.
import { WORLD_CARDS, DECREES } from './content'
import { LEGENDARY_ORDER } from './legendaries'
import { ARCHETYPE_ORDER, relations, type Archetype } from './civilizations'
import { ORIGIN_ORDER, WORLD_STATS, type OriginId } from './world'
import { CRISIS_ORDER } from './crises'
import { STARTER_POOL } from './pool'
import { MAX_OMEN } from './rules'
import type { AscensionState, ContentPool, LegendaryId } from './state'

export const PROFILE_SCHEMA = 1
export const HISTORY_LIMIT = 20

export interface RunRecord {
  seedText: string
  omen: number
  origin: OriginId
  result: 'won' | 'lost'
  /** the era the run ended in (0-based) */
  era: number
  score: number
  resolve: number
  civilizations: number
  legendaries: LegendaryId[]
  /** when it ended (ISO string from the UI; the engine never reads a clock) */
  endedAt: string
  /** everything needed to replay it, for the history view */
  replay: { setup: AscensionState['setup']; actions: unknown[] }
}

export interface Profile {
  kind: 'worldhand-ascension-profile'
  schema: number
  unlocked: { cards: string[]; decrees: string[]; legendaries: LegendaryId[]; archetypes: Archetype[]; origins: OriginId[] }
  /** the highest Omen the player may choose (0 = none yet) */
  maxOmen: number
  achievements: string[]
  /** what the player has met, for the encyclopedia */
  seen: { cards: string[]; decrees: string[]; legendaries: string[]; archetypes: string[]; crises: string[] }
  stats: { runs: number; wins: number; bestScore: number; bestOmenWon: number }
  history: RunRecord[]
}

export function newProfile(): Profile {
  return {
    kind: 'worldhand-ascension-profile', schema: PROFILE_SCHEMA,
    unlocked: { cards: [...STARTER_POOL.cards], decrees: [...STARTER_POOL.decrees], legendaries: [...STARTER_POOL.legendaries], archetypes: [...STARTER_POOL.archetypes], origins: ['pangaea'] },
    maxOmen: 0, achievements: [],
    seen: { cards: [], decrees: [], legendaries: [], archetypes: [], crises: [] },
    stats: { runs: 0, wins: 0, bestScore: 0, bestOmenWon: -1 },
    history: [],
  }
}

/** The content pool a new run is dealt from. */
export const poolOf = (p: Profile): ContentPool => ({
  cards: WORLD_CARDS.map((c) => c.id).filter((id) => p.unlocked.cards.includes(id)),
  decrees: DECREES.map((d) => d.id).filter((id) => p.unlocked.decrees.includes(id)),
  legendaries: LEGENDARY_ORDER.filter((id) => p.unlocked.legendaries.includes(id)),
  archetypes: ARCHETYPE_ORDER.filter((a) => p.unlocked.archetypes.includes(a)),
})

// ---------------------------------------------------------------------------
// Migration and validation. A stored profile is untrusted JSON.
// ---------------------------------------------------------------------------
export type ProfileLoad = { ok: true; profile: Profile; migrated: boolean } | { ok: false; reason: string }

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [])
const known = <T extends string>(xs: unknown, valid: readonly T[]): T[] => [...new Set(strings(xs))].filter((v): v is T => (valid as readonly string[]).includes(v))
const num = (x: unknown, lo: number, hi: number, dflt: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.floor(x))) : dflt)

/** Migrations from older schemas, keyed by the schema they upgrade FROM.
 *  (Schema 1 is the first release; add `1: (raw) => ...` when schema 2 lands.) */
export const PROFILE_MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

/** Read a stored profile: migrate old schemas, refuse newer ones, and
 *  normalize (unknown or retired content ids are dropped, starter content is
 *  always unlocked, numbers are clamped). Never throws. */
export function loadProfile(raw: unknown): ProfileLoad {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not a profile object' }
  let o = raw as Record<string, unknown>
  if (o.kind !== 'worldhand-ascension-profile') return { ok: false, reason: 'not a Worldhand Ascension profile' }
  let schema = typeof o.schema === 'number' ? o.schema : NaN
  if (!Number.isInteger(schema) || schema < 1) return { ok: false, reason: 'the profile has no valid schema version' }
  if (schema > PROFILE_SCHEMA) return { ok: false, reason: `the profile is from a newer version of Worldhand (schema ${schema}; this build reads up to ${PROFILE_SCHEMA})` }
  let migrated = false
  while (schema < PROFILE_SCHEMA) {
    const step = PROFILE_MIGRATIONS[schema]
    if (!step) return { ok: false, reason: `no migration from profile schema ${schema}` }
    o = step(o)
    schema += 1
    migrated = true
  }
  const base = newProfile()
  const u = (o.unlocked ?? {}) as Record<string, unknown>
  const seen = (o.seen ?? {}) as Record<string, unknown>
  const st = (o.stats ?? {}) as Record<string, unknown>
  const union = <T extends string>(a: T[], b: T[]) => [...new Set([...a, ...b])]
  const profile: Profile = {
    kind: 'worldhand-ascension-profile', schema: PROFILE_SCHEMA,
    unlocked: {
      cards: union(base.unlocked.cards, known(u.cards, WORLD_CARDS.map((c) => c.id))),
      decrees: union(base.unlocked.decrees, known(u.decrees, DECREES.map((d) => d.id))),
      legendaries: union(base.unlocked.legendaries, known(u.legendaries, LEGENDARY_ORDER)),
      archetypes: union(base.unlocked.archetypes, known(u.archetypes, ARCHETYPE_ORDER)),
      origins: union(base.unlocked.origins, known(u.origins, ORIGIN_ORDER)),
    },
    maxOmen: num(o.maxOmen, 0, MAX_OMEN, 0),
    achievements: known(o.achievements, ACHIEVEMENTS.map((a) => a.id)),
    seen: {
      cards: known(seen.cards, WORLD_CARDS.map((c) => c.id)), decrees: known(seen.decrees, DECREES.map((d) => d.id)),
      legendaries: known(seen.legendaries, LEGENDARY_ORDER), archetypes: known(seen.archetypes, ARCHETYPE_ORDER), crises: known(seen.crises, CRISIS_ORDER),
    },
    stats: { runs: num(st.runs, 0, 1e9, 0), wins: num(st.wins, 0, 1e9, 0), bestScore: num(st.bestScore, 0, 1e15, 0), bestOmenWon: num(st.bestOmenWon, -1, MAX_OMEN, -1) },
    history: (Array.isArray(o.history) ? o.history : []).filter(isRecord).slice(0, HISTORY_LIMIT),
  }
  return { ok: true, profile, migrated }
}
function isRecord(x: unknown): x is RunRecord {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  const rp = r.replay as Record<string, unknown> | undefined
  return typeof r.seedText === 'string' && (r.result === 'won' || r.result === 'lost') && typeof r.era === 'number' && typeof r.score === 'number'
    && typeof r.endedAt === 'string' && !!rp && typeof rp.setup === 'object' && Array.isArray(rp.actions)
}

// ---------------------------------------------------------------------------
// Achievements: what a run proves, and what it unlocks for the next one.
// ---------------------------------------------------------------------------
export interface Unlocks { cards?: string[]; decrees?: string[]; legendaries?: LegendaryId[]; archetypes?: Archetype[]; origins?: OriginId[] }
export interface Achievement { id: string; name: string; text: string; unlocks: Unlocks; met: (s: AscensionState) => boolean }

const spread = (s: AscensionState) => { const v = WORLD_STATS.map((k) => s.stats[k]); return { hi: Math.max(...v), lo: Math.min(...v) } }
const endured = (s: AscensionState, era: number) => s.crises.some((c) => c.era === era && c.result === 'endured')

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-history', name: 'A First History', text: 'Finish a run, won or lost.', unlocks: { cards: ['lighthouse', 'last-stand'] }, met: (s) => s.phase === 'won' || s.phase === 'lost' },
  { id: 'ancients-endure', name: 'The Ancients Endure', text: 'Endure the crisis of the Ancient era.', unlocks: { archetypes: ['mariners'], origins: ['archipelago'] }, met: (s) => endured(s, 1) },
  { id: 'empire', name: 'Empire', text: 'Raise a civilization to Empire.', unlocks: { legendaries: ['starseed'], cards: ['world-map'] }, met: (s) => s.civilizations.some((c) => c.tier >= 3) },
  { id: 'ascended', name: 'Ascension', text: 'Pass the final crisis and ascend.', unlocks: { legendaries: ['architectMoon'], origins: ['highlands'] }, met: (s) => s.phase === 'won' },
  { id: 'triumph', name: 'Triumph', text: 'Endure a crisis with a quarter of its pressure to spare.', unlocks: { cards: ['seed-vault'], decrees: ['rally'] }, met: (s) => s.crises.some((c) => c.triumph) },
  { id: 'on-the-brink', name: 'On the Brink', text: 'Ascend with a single Resolve left.', unlocks: { legendaries: ['ouroboros'] }, met: (s) => s.phase === 'won' && s.resolve === 1 },
  { id: 'seven-peoples', name: 'Seven Peoples', text: 'Have seven civilizations alive at once.', unlocks: { archetypes: ['mystics'], legendaries: ['ironHeart'] }, met: (s) => s.civilizations.length >= 7 },
  { id: 'specialist', name: 'The Specialist', text: 'Endure a crisis while your highest stat is 30+ and at least three times your lowest.', unlocks: { cards: ['philosophers-engine'], origins: ['frontier'] }, met: (s) => lastEndured(s) && spread(s).hi >= 30 && spread(s).hi >= 3 * spread(s).lo },
  { id: 'harmony', name: 'Harmony', text: 'Endure the crisis of the Information era with every stat within 10 of the others.', unlocks: { legendaries: ['philosophersStone'], origins: ['verdant'] }, met: (s) => s.era === 4 && lastEndured(s) && spread(s).hi - spread(s).lo <= 10 },
  { id: 'terraformer', name: 'Terraformer', text: 'Reshape three regions by decree in one run.', unlocks: { legendaries: ['gaiasHeart'], decrees: ['open-mines'] }, met: (s) => s.chronicle.filter((e) => e.t === 'terraform' && e.cause === 'a decree').length >= 3 },
  { id: 'rival-realms', name: 'Rival Realms', text: 'Have three rival pairs of civilizations at once.', unlocks: { cards: ['war-drums'], decrees: ['treaty'] }, met: (s) => relations(s.civilizations, s.regions).filter((r) => r.relation === 'rival').length >= 3 },
  { id: 'treasury', name: 'The Treasury', text: 'Hold 25 Influence at once.', unlocks: { cards: ['iron-colossus', 'lodestone'] }, met: (s) => s.influence >= 25 },
  { id: 'long-count', name: 'The Long Count', text: 'Raise Knowledge to 60.', unlocks: { cards: ['long-count', 'wildfire'] }, met: (s) => s.stats.knowledge >= 60 },
]
/** true right after an endured crisis (at the Council, or on winning) */
const lastEndured = (s: AscensionState) => s.crises.length > 0 && s.crises[s.crises.length - 1].result === 'endured' && (s.phase === 'council' || s.phase === 'won')

/** Achievements this state meets that the profile does not have yet. */
export function newAchievements(p: Profile, s: AscensionState): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !p.achievements.includes(a.id) && a.met(s))
}

/** What the profile learns from a state (achievements, unlocks, sightings).
 *  Pure: returns a new profile. Safe to call after every action. */
export function learn(p: Profile, s: AscensionState): { profile: Profile; earned: Achievement[] } {
  const earned = newAchievements(p, s)
  const q: Profile = structuredClone(p)
  for (const a of earned) {
    q.achievements.push(a.id)
    const add = <T extends string>(into: T[], xs: readonly T[] | undefined) => { for (const x of xs ?? []) if (!into.includes(x)) into.push(x) }
    add(q.unlocked.cards, a.unlocks.cards); add(q.unlocked.decrees, a.unlocks.decrees); add(q.unlocked.legendaries, a.unlocks.legendaries)
    add(q.unlocked.archetypes, a.unlocks.archetypes); add(q.unlocked.origins, a.unlocks.origins)
  }
  const see = (into: string[], xs: Iterable<string>) => { for (const x of xs) if (!into.includes(x)) into.push(x) }
  see(q.seen.crises, s.crises.map((c) => c.crisis))
  see(q.seen.crises, [s.crisisTrack[s.era]])
  see(q.seen.archetypes, [...s.civilizations, ...s.fallen].map((c) => c.archetype))
  see(q.seen.legendaries, s.legendaries.map((l) => l.id))
  if (s.council) {
    see(q.seen.legendaries, s.council.legendaryChoice ?? [])
    for (const o of s.council.offers) see(o.kind === 'card' ? q.seen.cards : o.kind === 'decree' ? q.seen.decrees : q.seen.legendaries, [o.id])
  }
  see(q.seen.cards, [...s.hand, ...s.drawPile, ...s.discardPile].flatMap((c) => (c.kind ? [c.kind] : [])))
  return { profile: q, earned }
}

/** Record a finished run: counts, best score, the Omen ladder, history. Pure. */
export function recordRun(p: Profile, s: AscensionState, endedAt: string, actions: unknown[]): Profile {
  if (s.phase !== 'won' && s.phase !== 'lost') return p
  const q: Profile = structuredClone(p)
  q.stats.runs += 1
  if (s.phase === 'won') {
    q.stats.wins += 1
    q.stats.bestOmenWon = Math.max(q.stats.bestOmenWon, s.setup.omen)
    q.maxOmen = Math.min(MAX_OMEN, Math.max(q.maxOmen, s.setup.omen + 1))
  }
  q.stats.bestScore = Math.max(q.stats.bestScore, s.score)
  q.history = [{
    seedText: s.setup.seedText, omen: s.setup.omen, origin: s.setup.origin, result: s.phase, era: s.era, score: s.score, resolve: s.resolve,
    civilizations: s.civilizations.length, legendaries: s.legendaries.map((l) => l.id), endedAt, replay: { setup: s.setup, actions },
  }, ...q.history].slice(0, HISTORY_LIMIT)
  return q
}
