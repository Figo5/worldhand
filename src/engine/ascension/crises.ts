// Ascension crises: the world an era built is tested before the next era.
// Pure — no DOM, no clock, no RNG: a crisis's outcome follows from the world.
//
// Each era ends in one crisis. It weighs PRESSURE (the crisis itself, the
// land's threats, and a strain from over-developing one stat past its
// counterpart) against RESILIENCE (the stats it tests, sheltering land and
// civilizations). resilience >= pressure: survived; otherwise the run fails.
import type { AscensionRegion, Terrain, WorldStats } from './ascension'
import type { Archetype, Civilization } from './civilizations'

/** The parts of the world a crisis looks at. */
export interface World { regions: readonly AscensionRegion[]; stats: WorldStats; civilizations: readonly Civilization[] }
/** One labelled contribution; `amount` 0 = does not apply to this world. */
export interface Factor { label: string; amount: number; detail: string }
export type CrisisId = 'winter' | 'plague' | 'invasion'
export interface CrisisEvaluation {
  crisis: CrisisId
  label: string
  pressures: Factor[]
  mitigations: Factor[]
  pressure: number
  resilience: number
  result: 'survived' | 'failed'
}

const lands = (w: World, ts: readonly Terrain[]) => w.regions.filter((r) => ts.includes(r.terrain)).length
const has = (w: World, a: Archetype) => w.civilizations.some((c) => c.archetype === a)
const perLand = (label: string, per: number, ts: readonly Terrain[], w: World): Factor => {
  const n = lands(w, ts)
  return { label, amount: per * n, detail: `${n} ${ts.join('/')} region${n === 1 ? '' : 's'} × ${per}` }
}
const civ = (label: string, amount: number, a: Archetype, w: World): Factor =>
  ({ label, amount: has(w, a) ? amount : 0, detail: has(w, a) ? `${label} present` : `no ${label}` })
/** Strain: how far `over` has outgrown its counterpart `under` (0 if not). */
const strain = (label: string, over: number, under: number, overName: string, underName: string): Factor =>
  ({ label, amount: Math.max(0, over - under), detail: `${overName} ${over} vs ${underName} ${under}` })

/** One crisis per era, in era order. `test` lists its pressures and mitigations. */
export const CRISES: readonly { id: CrisisId; label: string; theme: string; test: (w: World) => { pressures: Factor[]; mitigations: Factor[] } }[] = [
  {
    id: 'winter', label: 'Harsh Winter', theme: 'A long winter tests the tribes’ food and the land that feeds them.',
    test: (w) => ({
      pressures: [
        { label: 'The winter', amount: 15, detail: 'base' },
        perLand('Cold land', 2, ['tundra', 'mountains'], w),
        strain('Cleared forests', w.stats.industry, w.stats.vitality, 'Industry', 'Vitality'),
      ],
      mitigations: [
        { label: 'Food stores', amount: w.stats.vitality, detail: `Vitality ${w.stats.vitality}` },
        perLand('Fertile land', 2, ['forest', 'plains'], w),
        civ('Nature Keepers', 8, 'natureKeepers', w),
        civ('Nomads', 8, 'nomads', w),
      ],
    }),
  },
  {
    id: 'plague', label: 'Plague', theme: 'Trade carries a plague between cities; learning and health contain it.',
    test: (w) => ({
      pressures: [
        { label: 'The plague', amount: 30, detail: 'base' },
        perLand('Crowded ports and farms', 2, ['coast', 'plains'], w),
        strain('Trade outruns medicine', w.stats.prosperity, w.stats.knowledge, 'Prosperity', 'Knowledge'),
        civ('Merchants', 10, 'merchants', w),
      ],
      mitigations: [
        { label: 'Medicine', amount: w.stats.knowledge, detail: `Knowledge ${w.stats.knowledge}` },
        { label: 'Healthy people', amount: Math.floor(w.stats.vitality / 2), detail: `Vitality ${w.stats.vitality} ÷ 2` },
        perLand('Isolated land', 2, ['desert', 'tundra'], w),
        civ('Scholars', 10, 'scholars', w),
      ],
    }),
  },
  {
    id: 'invasion', label: 'Invasion', theme: 'Raiders strike a realm that has grown rich and wide.',
    test: (w) => {
      const vals = Object.values(w.stats), hi = Math.max(...vals), lo = Math.min(...vals)
      return {
        pressures: [
          { label: 'The invasion', amount: 50, detail: 'base' },
          perLand('Open land', 2, ['plains', 'desert', 'coast'], w),
          strain('A lopsided realm', hi, lo, 'highest stat', 'lowest'),
        ],
        mitigations: [
          { label: 'Arms and walls', amount: w.stats.industry, detail: `Industry ${w.stats.industry}` },
          { label: 'Allied civilizations', amount: 5 * w.civilizations.length, detail: `${w.civilizations.length} × 5` },
          perLand('Mountain passes', 3, ['mountains'], w),
          civ('Empire Builders', 10, 'empireBuilders', w),
        ],
      }
    },
  },
]

/** The crisis that ends era `era`, weighed against the world as it stands. */
export function evaluateCrisis(era: number, w: World): CrisisEvaluation {
  const c = CRISES[era]
  if (!c) throw new Error(`no crisis for era ${era}`)
  const { pressures, mitigations } = c.test(w)
  const pressure = pressures.reduce((n, f) => n + f.amount, 0)
  const resilience = mitigations.reduce((n, f) => n + f.amount, 0)
  return { crisis: c.id, label: c.label, pressures, mitigations, pressure, resilience, result: resilience >= pressure ? 'survived' : 'failed' }
}
