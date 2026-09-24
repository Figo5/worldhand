// Ascension eras: the run structure. Pure — no DOM, no clock, no Math.random.
//
// A run is six eras. Each era gives a fixed number of HANDS (plays) and
// DISCARDS, has one identity rule, and ends in a crisis drawn (per seed, shown
// from the start) from its pool. The player faces the crisis whenever they
// choose; when the hands run out it must be faced. Unspent hands become
// Influence. Enduring a crisis leads to the Council and the next era;
// failing one costs a Resolve and leaves a scar, but the run goes on until
// Resolve runs out. The final crisis must be endured to ascend.
import type { CrisisId } from './crises'

export type EraId = 'tribal' | 'ancient' | 'medieval' | 'industrial' | 'information' | 'stellar'
export type EraRule = 'gatherers' | 'writing' | 'levies' | 'steam' | 'network' | 'escape'

export interface EraDef {
  id: EraId
  label: string
  /** plays this era */
  hands: number
  discards: number
  /** era score per point of Reserves */
  reserveRate: number
  /** Influence for enduring its crisis */
  reward: number
  rule: EraRule
  ruleName: string
  ruleText: string
  /** crises this era can end in; the run's is fixed from its seed */
  pool: readonly CrisisId[]
  theme: string
}

export const ERAS: readonly EraDef[] = [
  {
    id: 'tribal', label: 'Tribal', hands: 7, discards: 4, reserveRate: 150, reward: 4, rule: 'gatherers', pool: ['winter', 'flood'],
    ruleName: 'Hunters and Gatherers', ruleText: 'High Card and Pair hands give +1 more of each scoring card’s stat.',
    theme: 'Small bands learn the land. The first peoples settle where the world favours them.',
  },
  {
    id: 'ancient', label: 'Ancient', hands: 8, discards: 4, reserveRate: 250, reward: 5, rule: 'writing', pool: ['plague', 'drought'],
    ruleName: 'Writing', ruleText: 'Each ♠ scored +4 chips. Civilizations may grow into Kingdoms at the dawn of an era.',
    theme: 'Cities, scripts and granaries. What the world knows begins to outlive who knew it.',
  },
  {
    id: 'medieval', label: 'Medieval', hands: 8, discards: 4, reserveRate: 350, reward: 5, rule: 'levies', pool: ['invasion', 'schism'],
    ruleName: 'Feudal Levies', ruleText: '+1 mult on every play for each living civilization.',
    theme: 'Castles and cathedrals. Every realm is a fortress, and every neighbour a question.',
  },
  {
    id: 'industrial', label: 'Industrial', hands: 9, discards: 4, reserveRate: 400, reward: 6, rule: 'steam', pool: ['smog', 'crash', 'revolution'],
    ruleName: 'Steam Power', ruleText: 'Each ♣ scored gives +1 more Industry. Kingdoms may grow into Empires.',
    theme: 'Coal and iron remake the land faster than any age before.',
  },
  {
    id: 'information', label: 'Information', hands: 9, discards: 4, reserveRate: 700, reward: 6, rule: 'network', pool: ['machines', 'disinformation'],
    ruleName: 'The Network', ruleText: '+2 mult on every play for each pair of allied or rival civilizations.',
    theme: 'Every mind is linked to every other, for better and for worse.',
  },
  {
    id: 'stellar', label: 'Stellar', hands: 10, discards: 4, reserveRate: 800, reward: 0, rule: 'escape', pool: ['filter', 'voidstorm'],
    ruleName: 'Escape Velocity', ruleText: 'Straights, Flushes and better score ×1.5.',
    theme: 'The world looks up. One last test stands between it and the stars.',
  },
]
export const FINAL_ERA = ERAS.length - 1
