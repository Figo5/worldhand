// Ascension eras: the run structure. Pure — no DOM, no clock, no Math.random.
//
// cards/hands → rounds → world development + civilizations → era.
// A world is ready to leave an era at a round end once it has enough
// civilizations and enough DEVELOPED stats (Tribal 2 at 15, Ancient 3 at 30,
// Medieval 3 at 40 plus 200 development in any shape). Meeting them makes the
// era's crisis ready (crises.ts); surviving it advances, and surviving
// Medieval's completes the first playable. Nothing is reset.
import type { Civilization } from './civilizations'
import type { WorldStats } from './ascension'

export type Era = 'tribal' | 'ancient' | 'medieval'

/** Working names, in order. To LEAVE an era the world needs, at a round end:
 *  - at least `civilizations` emerged civilizations,
 *  - at least `stats` of the four world stats at `min` or more, and
 *  - (Medieval) `development`: the four stats together at least this high, so a
 *    world may pour it into one peak or spread it across all four. */
export const ERAS: readonly { id: Era; label: string; needs: { civilizations: number; stats: number; min: number; development?: number } }[] = [
  { id: 'tribal', label: 'Tribal', needs: { civilizations: 1, stats: 2, min: 15 } },
  { id: 'ancient', label: 'Ancient', needs: { civilizations: 2, stats: 3, min: 30 } },
  { id: 'medieval', label: 'Medieval', needs: { civilizations: 3, stats: 3, min: 40, development: 200 } },
]

export interface Requirement { key: 'civilizations' | 'stats' | 'development'; label: string; have: number; need: number; met: boolean }
/** One era advance (a survived crisis): the round it was faced in, and the
 *  world and score as they stood. `to` = null: the first playable is complete. */
export interface EraAdvance { from: Era; to: Era | null; round: number; stats: WorldStats; civilizations: number; score: number }

export const isComplete = (era: number) => era >= ERAS.length

/** Scarcity: what each era has a fixed amount of, and how much.
 *  - unit: 'none' (no budget), 'plays', 'actions' (plays and discards),
 *    'cards' (cards played; a discard costs `discardCost`), or 'rounds'
 *  - perEra: granted at the start of each era, in era order
 *  - discardCost: what a discard costs ('actions' and 'cards')
 *  - carryOver: unspent budget carries into the next era
 *  When it runs out the era ends: its crisis strikes if the requirements are
 *  met, otherwise the era lapses and the run is over. The crisis can be faced
 *  as soon as it is ready. */
export const ERA_BUDGET: { unit: 'none' | 'plays' | 'actions' | 'cards' | 'rounds'; perEra: number[]; discardCost: number; carryOver: boolean } =
  { unit: 'cards', perEra: [70, 70, 90], discardCost: 2, carryOver: true }

/** Stat points the world still needs to meet era `era`'s requirements (the
 *  development shortfall included; civilizations aside) — about how many
 *  cards are spoken for before any is free for preparation. */
export function requirementShortfall(era: number, stats: WorldStats): number {
  if (isComplete(era)) return 0
  const { stats: n, min, development = 0 } = ERAS[era].needs
  const vals = Object.values(stats)
  const gaps = vals.map((v) => Math.max(0, min - v)).sort((a, b) => a - b).slice(0, n).reduce((a, b) => a + b, 0)
  return Math.max(gaps, development - vals.reduce((a, b) => a + b, 0))
}

/** What the world still needs to leave era `era` (none once complete). */
export function eraRequirements(era: number, stats: WorldStats, civs: readonly Civilization[]): Requirement[] {
  if (isComplete(era)) return []
  const { civilizations, stats: n, min, development } = ERAS[era].needs
  const developed = Object.values(stats).filter((v) => v >= min).length
  const total = Object.values(stats).reduce((a, b) => a + b, 0)
  return [
    { key: 'civilizations', label: 'Civilizations', have: civs.length, need: civilizations, met: civs.length >= civilizations },
    { key: 'stats', label: `Stats at ${min}+`, have: developed, need: n, met: developed >= n },
    ...(development ? [{ key: 'development' as const, label: 'World development', have: total, need: development, met: total >= development }] : []),
  ]
}

/** True when the world meets era `era`'s requirements (at a round end: its crisis strikes). */
export const canAdvance = (era: number, stats: WorldStats, civs: readonly Civilization[]) =>
  !isComplete(era) && eraRequirements(era, stats, civs).every((r) => r.met)
