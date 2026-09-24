// Ascension crises: the world an era built is tested before the next era.
// Pure — no DOM, no clock, no RNG: a crisis's outcome follows from the world.
//
// Each era ends in one crisis. It weighs PRESSURE (the crisis itself, the
// land's threats, a strain from over-developing one stat past its
// counterpart) against
// RESILIENCE (the stats it tests, sheltering land, civilizations, and the
// reserves the era's score has built). resilience >= pressure: survived;
// otherwise the run fails.
import type { AscensionRegion, Terrain, WorldStats } from './ascension'
import type { Archetype, Civilization } from './civilizations'

/** The parts of the world a crisis looks at: the land, stats and civilizations,
 *  the score earned this era, and the rounds the ready crisis has been kept waiting. */
export interface World {
  regions: readonly AscensionRegion[]; stats: WorldStats; civilizations: readonly Civilization[]
  eraScore: number; waited: number
}
/** Rules every crisis shares (working numbers; research harnesses patch them).
 *  - reserveRate: score earned this era per point of Reserves (Infinity: score never helps)
 *  - gatherPerRound: pressure added for each round a ready crisis is kept waiting
 *  - graceRounds: once ready, round ends the player may let pass before the
 *    crisis strikes on its own (0: it strikes at once, as in rules v7)
 *  - upkeep: score each round of the era costs before the rest becomes Reserves
 *  With an era budget (eras.ts ERA_BUDGET) the budget is the deadline: the
 *  grace and the waiting cost apply only without one. */
export const CRISIS_RULES: { reserveRate: number; gatherPerRound: number; graceRounds: number; upkeep: number } =
  { reserveRate: 150, gatherPerRound: 0, graceRounds: 2, upkeep: 0 }
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

/** One crisis per era, in era order. `watch` says in a line what it tests and
 *  what makes a world vulnerable (for players planning a build); `test` lists
 *  its pressures and mitigations. */
export const CRISES: readonly { id: CrisisId; label: string; theme: string; watch: string; test: (w: World) => { pressures: Factor[]; mitigations: Factor[] } }[] = [
  {
    id: 'winter', label: 'Harsh Winter', theme: 'A long winter tests the tribes’ food and the land that feeds them.',
    watch: 'tests Vitality; hurt by cold land and by Industry above Vitality; Nature Keepers and Nomads help',
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
    watch: 'tests Knowledge (and Vitality); hurt by crowded coasts and plains, Merchants, and Prosperity above Knowledge; Scholars help',
    test: (w) => ({
      pressures: [
        { label: 'The plague', amount: 35, detail: 'base' },
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
    id: 'invasion', label: 'Invasion', theme: 'Raiders strike a realm that has grown rich; arms, mountains and allies hold them off.',
    watch: 'tests Industry; every point of development draws raiders, and so does Prosperity above Industry; mountains, forests, allies and Empire Builders help',
    test: (w) => {
      const dev = Object.values(w.stats).reduce((a, b) => a + b, 0)
      return {
        pressures: [
          { label: 'The invasion', amount: 43, detail: 'base' },
          perLand('Open land', 1, ['plains', 'desert', 'coast'], w),
          { label: 'Riches to plunder', amount: Math.floor(dev / 4), detail: `development ${dev} ÷ 4` },
          strain('Undefended wealth', w.stats.prosperity, w.stats.industry, 'Prosperity', 'Industry'),
        ],
        mitigations: [
          { label: 'Arms and walls', amount: w.stats.industry, detail: `Industry ${w.stats.industry}` },
          { label: 'Allied civilizations', amount: 5 * w.civilizations.length, detail: `${w.civilizations.length} × 5` },
          perLand('Mountain passes', 3, ['mountains'], w),
          perLand('Forest cover', 2, ['forest'], w),
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
  const { reserveRate, gatherPerRound } = CRISIS_RULES
  if (gatherPerRound) pressures.push({ label: 'Time to gather', amount: gatherPerRound * w.waited, detail: `kept waiting ${w.waited} round${w.waited === 1 ? '' : 's'} × ${gatherPerRound}` })
  const reserves = Number.isFinite(reserveRate) ? Math.floor(Math.max(0, w.eraScore) / reserveRate) : 0
  mitigations.push({ label: 'Reserves', amount: reserves, detail: `${w.eraScore} score this era ÷ ${reserveRate}` })
  const pressure = pressures.reduce((n, f) => n + f.amount, 0)
  const resilience = mitigations.reduce((n, f) => n + f.amount, 0)
  return { crisis: c.id, label: c.label, pressures, mitigations, pressure, resilience, result: resilience >= pressure ? 'survived' : 'failed' }
}
