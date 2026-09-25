// Ascension content pools: which content a run may offer. The profile's
// unlocks decide the pool of a new run; the pool is stored in the run's save.
import { WORLD_CARDS, DECREES } from './content'
import { LEGENDARY_ORDER, LEGENDARIES } from './legendaries'
import { ARCHETYPE_ORDER, type Archetype } from './civilizations'
import type { ContentPool } from './state'

/** Civilizations that exist from the first run (the others are discovered). */
export const STARTER_ARCHETYPES: readonly Archetype[] = ['natureKeepers', 'nomads', 'merchants', 'empireBuilders', 'scholars', 'technocrats']

export const FULL_POOL: ContentPool = {
  cards: WORLD_CARDS.map((c) => c.id),
  decrees: DECREES.map((d) => d.id),
  legendaries: [...LEGENDARY_ORDER],
  archetypes: [...ARCHETYPE_ORDER],
}
export const STARTER_POOL: ContentPool = {
  cards: WORLD_CARDS.filter((c) => c.starter).map((c) => c.id),
  decrees: DECREES.filter((d) => d.starter).map((d) => d.id),
  legendaries: LEGENDARY_ORDER.filter((id) => LEGENDARIES[id].starter),
  archetypes: [...STARTER_ARCHETYPES],
}
