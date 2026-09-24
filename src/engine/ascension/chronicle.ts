// Ascension Chronicle: the run's history as structured events, and the
// deterministic prose they read as. Pure — no DOM, no clock, no Math.random,
// no generated text from outside: the same run always tells the same story.
import { stream } from '../core/streams'
import type { OriginId, Terrain } from './world'
import { ORIGINS, REGION_NAMES, TERRAIN } from './world'
import type { Archetype } from './civilizations'
import { ARCHETYPES, TIER_LABEL } from './civilizations'
import type { CrisisId } from './crises'
import { CRISES } from './crises'
import { ERAS } from './eras'
import { CARD_BY_ID, DECREE_BY_ID } from './content'
import { LEGENDARIES } from './legendaries'
import type { LegendaryId } from './state'

export type ChronicleEvent =
  | { t: 'genesis'; era: number; origin: OriginId; land: Partial<Record<Terrain, number>> }
  | { t: 'dawn'; era: number }
  | { t: 'civ'; era: number; play: number; civ: number; name: string; archetype: Archetype; home: number; terrain: Terrain; rebirth: boolean }
  | { t: 'tier'; era: number; civ: number; name: string; tier: number; cause: 'growth' | 'patronage' }
  | { t: 'fall'; era: number; civ: number; name: string; archetype: Archetype; cause: string }
  | { t: 'record'; era: number; play: number; score: number; label: string }
  | { t: 'crisis'; era: number; crisis: CrisisId; result: 'endured' | 'failed'; margin: number; triumph: boolean; prevented: boolean }
  | { t: 'scar'; era: number; text: string }
  | { t: 'legendary'; era: number; id: LegendaryId; how: 'chosen' | 'bought' | 'sold' }
  | { t: 'card'; era: number; id: string }
  | { t: 'decree'; era: number; id: string; target: string | null }
  | { t: 'terraform'; era: number; region: number; from: Terrain; to: Terrain; cause: string }
  | { t: 'wonder'; era: number; text: string }
  | { t: 'end'; era: number; result: 'won' | 'lost'; reason: string }

/** Major events make the summary and the important-events view. */
export function isMajor(e: ChronicleEvent): boolean {
  switch (e.t) {
    case 'genesis': case 'civ': case 'fall': case 'crisis': case 'legendary': case 'end': return true
    case 'tier': return e.tier >= 3
    case 'terraform': return e.to === 'wasteland'
    default: return false
  }
}

const region = (id: number) => REGION_NAMES[id] ?? `region ${id}`

/** One event as a sentence. `seed` and `index` pick a deterministic phrasing. */
export function describe(e: ChronicleEvent, seed: number, index: number): string {
  const rng = stream(seed, 'ascension', 'story', index)
  const pick = <T,>(xs: readonly T[]) => rng.pick(xs)
  switch (e.t) {
    case 'genesis': {
      const land = (Object.entries(e.land) as [Terrain, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
      return `${pick(['In the beginning', 'Before any name was spoken', 'When the world was young'])}, ${ORIGINS[e.origin].label} rose from the sea: ${land.map(([t, n]) => `${n} ${TERRAIN[t].label.toLowerCase()}`).join(', ')}.`
    }
    case 'dawn': return `The ${ERAS[e.era].label} age began.`
    case 'civ': return e.rebirth
      ? `From the ruins, the ${ARCHETYPES[e.archetype].label} rose again as ${e.name}, in ${region(e.home)} (${TERRAIN[e.terrain].label.toLowerCase()}).`
      : `${e.name} ${pick(['was founded', 'arose', 'took root', 'raised its first walls'])} in ${region(e.home)}, a ${TERRAIN[e.terrain].label.toLowerCase()} — the first ${ARCHETYPES[e.archetype].label} of this world.`
    case 'tier': return e.cause === 'patronage'
      ? `By the Council's patronage, ${e.name} became ${TIER_LABEL[e.tier] === 'Empire' ? 'an' : 'a'} ${TIER_LABEL[e.tier]}.`
      : `${e.name} ${pick(['grew into', 'rose to become', 'was proclaimed'])} ${TIER_LABEL[e.tier] === 'Empire' ? 'an' : 'a'} ${TIER_LABEL[e.tier]}.`
    case 'fall': return `${e.name} fell — ${e.cause}.`
    case 'record': return `A ${e.label} scored ${String(e.score).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}, the greatest deed of the age so far.`
    case 'crisis': {
      const c = CRISES[e.crisis]
      if (e.prevented) return `${c.label} should have broken the world, but the Sleeping God woke and turned it aside.`
      if (e.result === 'failed') return `${c.label} ${pick(['broke upon the world', 'swept the world', 'overwhelmed the world'])}, short by ${-e.margin}.`
      return e.triumph
        ? `${c.label} came and the world ${pick(['triumphed', 'stood unbowed', 'barely noticed'])}, with ${e.margin} to spare.`
        : `${c.label} was endured${e.margin <= 3 ? ', but only just' : ''} (margin ${e.margin}).`
    }
    case 'scar': return e.text
    case 'legendary': return e.how === 'sold'
      ? `${LEGENDARIES[e.id].name} was given up.`
      : `${LEGENDARIES[e.id].name} ${e.how === 'chosen' ? pick(['came into the world', 'was found', 'awakened']) : 'was bought at a great price'}.`
    case 'card': return `The Council added ${CARD_BY_ID.get(e.id)?.name ?? e.id} to the world's deck.`
    case 'decree': return `The Council decreed ${DECREE_BY_ID.get(e.id)?.name ?? e.id}${e.target ? ` (${e.target})` : ''}.`
    case 'terraform': return `${region(e.region)} turned from ${TERRAIN[e.from].label.toLowerCase()} to ${TERRAIN[e.to].label.toLowerCase()} (${e.cause}).`
    case 'wonder': return e.text
    case 'end': return e.result === 'won'
      ? `The world passed the final test and ascended to the stars.`
      : `The world's story ended in the ${ERAS[Math.min(e.era, ERAS.length - 1)].label} age: ${e.reason}`
  }
}

/** The history as sentences grouped by era (every event, in order). */
export function chronicleByEra(events: readonly ChronicleEvent[], seed: number): { era: number; lines: { text: string; major: boolean }[] }[] {
  const out: { era: number; lines: { text: string; major: boolean }[] }[] = []
  events.forEach((e, i) => {
    let g = out[out.length - 1]
    if (!g || g.era !== e.era) { g = { era: e.era, lines: [] }; out.push(g) }
    g.lines.push({ text: describe(e, seed, i), major: isMajor(e) })
  })
  return out
}
