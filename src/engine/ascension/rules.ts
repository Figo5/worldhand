// Ascension run rules: Omens (the difficulty ladder) and the modifiers a run
// is played under (era table + Omen + legendaries + Council treaties). Pure.
import type { Region } from './world'
import { REGION_ADJACENCY } from './world'
import { ERAS } from './eras'
import { LEGENDARIES, type RunMods } from './legendaries'
import type { AscensionState } from './state'

/** Omens stack: Omen N plays under every omen up to N. Each is a rule, not a
 *  bigger number wherever a rule would do. */
export const OMENS: readonly { level: number; name: string; text: string }[] = [
  { level: 1, name: 'Lean Years', text: 'One fewer discard every era.' },
  { level: 2, name: 'Harsh Lands', text: 'The world is dealt with more tundra and desert and fewer forests.' },
  { level: 3, name: 'Restless Peoples', text: 'Rivalries add pressure to every crisis, not only conflicts, and alliances give 2 resilience instead of 3.' },
  { level: 4, name: 'Thin Council', text: 'The Council market has one fewer offer, and rerolls cost 1 more.' },
  { level: 5, name: 'Pressing Crises', text: 'Every crisis has +5% pressure.' },
  { level: 6, name: 'Deep Strain', text: 'Strain and inequality in crises count 50% more.' },
  { level: 7, name: 'Fragile World', text: 'The world begins with 2 Resolve instead of 3.' },
  { level: 8, name: 'The Long Night', text: 'One fewer hand in the Information and Stellar eras, and the final crisis gains +10 pressure for every Resolve the world has lost.' },
]
export const MAX_OMEN = OMENS.length
export const omenActive = (omen: number, level: number) => omen >= level

export function startingResolve(omen: number): number { return omenActive(omen, 7) ? 2 : 3 }

/** The modifiers the current era is played under. */
export function runMods(s: AscensionState, era = s.era): RunMods {
  const omen = s.setup.omen
  const m: RunMods = {
    handsBonus: omenActive(omen, 8) && era >= 4 ? -1 : 0,
    discardsBonus: omenActive(omen, 1) ? -1 : 0,
    wildSuit: null, straightWrap: false, straightGap: false, oppositeBorders: false,
    crisis: {
      reserveRate: ERAS[Math.min(era, ERAS.length - 1)].reserveRate,
      pressurePct: omenActive(omen, 5) ? 5 : 0,
      strainPct: omenActive(omen, 6) ? 50 : 0,
      allyResilience: omenActive(omen, 3) ? 2 : 3,
      rivalPressure: s.treaty ? 0 : 5,
      rivalsEverywhere: omenActive(omen, 3),
      extraPressures: [], extraMitigations: [],
    },
    marketSlots: omenActive(omen, 4) ? 4 : 5,
    rerollBase: omenActive(omen, 4) ? 2 : 1,
  }
  for (const inst of s.legendaries) LEGENDARIES[inst.id].mods?.(m, s, inst)
  if (omenActive(omen, 8) && era === ERAS.length - 1) {
    const lost = s.crises.filter((c) => c.result === 'failed' && !c.prevented).length
    if (lost) m.crisis.extraPressures.push({ label: 'The Long Night', amount: 10 * lost, detail: `${lost} Resolve lost × 10` })
  }
  return m
}

/** Opposite regions on the globe (outer ring i ↔ i+4; core 8 ↔ 10, 9 ↔ 11). */
export const OPPOSITE: readonly number[] = [4, 5, 6, 7, 0, 1, 2, 3, 10, 11, 8, 9]

/** The regions with the borders this run plays under (the Architect Moon adds opposite borders). */
export function borders(regions: readonly Region[], m: RunMods): Region[] {
  if (!m.oppositeBorders) return regions as Region[]
  return regions.map((r) => ({ ...r, neighbors: [...new Set([...REGION_ADJACENCY[r.id], OPPOSITE[r.id]])].sort((a, b) => a - b) }))
}
