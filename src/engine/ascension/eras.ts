// Ascension eras: the run structure. Pure — no DOM, no clock, no Math.random.
//
// cards/hands → rounds → world development + civilizations → era.
// A world leaves an era at a round end once it has enough civilizations and
// enough DEVELOPED stats: each era asks for one more stat than the last
// (Tribal 2, Ancient 3, Medieval all 4), at a higher level. Meeting them
// makes the world face the era's crisis (crises.ts); surviving it advances,
// and surviving Medieval's completes the first playable. Nothing is reset.
import type { Civilization } from './civilizations'
import type { WorldStats } from './ascension'

export type Era = 'tribal' | 'ancient' | 'medieval'

/** Working names, in order. To LEAVE an era the world needs, at a round end:
 *  - at least `civilizations` emerged civilizations, and
 *  - at least `stats` of the four world stats at `min` or more. */
export const ERAS: readonly { id: Era; label: string; needs: { civilizations: number; stats: number; min: number } }[] = [
  { id: 'tribal', label: 'Tribal', needs: { civilizations: 1, stats: 2, min: 15 } },
  { id: 'ancient', label: 'Ancient', needs: { civilizations: 2, stats: 3, min: 30 } },
  { id: 'medieval', label: 'Medieval', needs: { civilizations: 3, stats: 4, min: 50 } },
]

export interface Requirement { key: 'civilizations' | 'stats'; label: string; have: number; need: number; met: boolean }
/** One era advance (a survived crisis), with the round whose end brought the
 *  crisis and the world as it stood. `to` = null: the first playable is complete. */
export interface EraAdvance { from: Era; to: Era | null; round: number; stats: WorldStats; civilizations: number }

export const isComplete = (era: number) => era >= ERAS.length

/** What the world still needs to leave era `era` (none once complete). */
export function eraRequirements(era: number, stats: WorldStats, civs: readonly Civilization[]): Requirement[] {
  if (isComplete(era)) return []
  const { civilizations, stats: n, min } = ERAS[era].needs
  const developed = Object.values(stats).filter((v) => v >= min).length
  return [
    { key: 'civilizations', label: 'Civilizations', have: civs.length, need: civilizations, met: civs.length >= civilizations },
    { key: 'stats', label: `Stats at ${min}+`, have: developed, need: n, met: developed >= n },
  ]
}

/** True when the world meets era `era`'s requirements (at a round end: its crisis strikes). */
export const canAdvance = (era: number, stats: WorldStats, civs: readonly Civilization[]) =>
  !isComplete(era) && eraRequirements(era, stats, civs).every((r) => r.met)
