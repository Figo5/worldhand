// Ascension crises: every era ends in one, and it tests the world the player
// built. Pure — no DOM, no clock, no RNG: a crisis's outcome follows from the
// world, and its forecast is exact.
//
// A crisis weighs PRESSURE (the crisis itself, the land's threats, strains
// from over-developing one stat past another, rivalries) against RESILIENCE
// (the stats it tests, sheltering land, civilizations, alliances, and the
// Reserves the era's score has built). resilience >= pressure: endured.
// Otherwise it is FAILED: the world loses a Resolve and takes the crisis's
// scar, which grows with the shortfall. Content is declarative: a crisis is a
// list of factor specs, evaluated by one function.
import type { Region, Terrain, WorldStat, WorldStats } from './world'
import { WORLD_STAT_LABEL, WORLD_STATS, countTerrain, totalOf, TERRAIN } from './world'
import type { Archetype, Civilization, CivPair } from './civilizations'
import { ARCHETYPES } from './civilizations'

/** The parts of the world a crisis looks at. */
export interface World {
  regions: readonly Region[]; stats: WorldStats; civilizations: readonly Civilization[]; relations: readonly CivPair[]
  /** score earned this era (becomes Reserves) */
  eraScore: number
  /** extra pressure and reserves the player's cards added this era */
  eraPressure: number; eraReserves: number
}

export type FactorSpec =
  | { kind: 'base'; label: string; amount: number }
  | { kind: 'stat'; label: string; stat: WorldStat; per?: number; div?: number }
  | { kind: 'strain'; label: string; over: WorldStat; under: WorldStat; per?: number }
  | { kind: 'terrain'; label: string; terrains: readonly Terrain[]; per: number }
  | { kind: 'civ'; label: string; archetype: Archetype; perTier: number }
  | { kind: 'civTiers'; label: string; per: number }
  | { kind: 'civCount'; label: string; per: number }
  | { kind: 'development'; label: string; div: number }
  | { kind: 'lowest'; label: string; per: number }
  /** (highest − lowest stat − free) × per */
  | { kind: 'spread'; label: string; per: number; free?: number }
  /** Reserves counted this many extra times (they are always counted once) */
  | { kind: 'savings'; label: string; extra: number }

export type ScarSpec =
  /** lose round(shortfall × share) of a stat (never below 0) */
  | { kind: 'stat'; stat: WorldStat | 'highest'; share: number }
  /** a civilization loses a tier (0 = it collapses) */
  | { kind: 'civTier'; target: 'weakest' | 'strongest' | 'mostRivals' | 'onTerrain'; terrains?: readonly Terrain[] }
  /** the first eligible region (fewest neighbours, then lowest id; free of civilizations) changes terrain */
  | { kind: 'terraform'; from: readonly Terrain[]; to: Terrain }
  | { kind: 'influence'; amount: number }

export type CrisisId =
  | 'winter' | 'flood' | 'plague' | 'drought' | 'invasion' | 'schism'
  | 'smog' | 'crash' | 'revolution' | 'machines' | 'disinformation' | 'filter' | 'voidstorm'
export type CrisisKind = 'ecology' | 'disease' | 'conflict' | 'economy' | 'ideology' | 'technology' | 'cosmic'

export interface CrisisDef {
  id: CrisisId; label: string; kind: CrisisKind
  /** conflict crises: rivalries add pressure */
  conflict: boolean
  theme: string
  /** one line: what it tests and what makes a world vulnerable */
  watch: string
  pressures: readonly FactorSpec[]
  mitigations: readonly FactorSpec[]
  scar: readonly ScarSpec[]
  /** what the scar does, in words */
  scarText: string
}

const P = (label: string, amount: number): FactorSpec => ({ kind: 'base', label, amount })

export const CRISES: Record<CrisisId, CrisisDef> = {
  winter: {
    id: 'winter', label: 'Harsh Winter', kind: 'ecology', conflict: false,
    theme: 'A long winter tests the tribes’ food and the land that feeds them.',
    watch: 'Tests Vitality. Cold land and Industry above Vitality make it worse; forests, plains, Nature Keepers and Nomads help.',
    pressures: [P('The winter', 16), { kind: 'terrain', label: 'Cold land', terrains: ['tundra', 'mountains'], per: 1 }, { kind: 'strain', label: 'Cleared forests', over: 'industry', under: 'vitality', per: 2 }],
    mitigations: [{ kind: 'stat', label: 'Food stores', stat: 'vitality', per: 2 }, { kind: 'terrain', label: 'Fertile land', terrains: ['forest', 'plains'], per: 1 }, { kind: 'civ', label: 'Nature Keepers', archetype: 'natureKeepers', perTier: 4 }, { kind: 'civ', label: 'Nomads', archetype: 'nomads', perTier: 4 }],
    scar: [{ kind: 'stat', stat: 'vitality', share: 1 }, { kind: 'civTier', target: 'weakest' }],
    scarText: 'Vitality falls by the shortfall and the weakest civilization loses a tier.',
  },
  flood: {
    id: 'flood', label: 'Great Flood', kind: 'ecology', conflict: false,
    theme: 'The rivers rise and the sea follows; only works and high ground hold.',
    watch: 'Tests Industry (levees) and Prosperity (rebuilding). Coasts and plains flood; mountains, forests and Mariners help.',
    pressures: [P('The flood', 24), { kind: 'terrain', label: 'Low shores', terrains: ['coast'], per: 2 }, { kind: 'terrain', label: 'Flood plains', terrains: ['plains'], per: 1 }],
    mitigations: [{ kind: 'stat', label: 'Levees', stat: 'industry', per: 2 }, { kind: 'stat', label: 'Rebuilding', stat: 'prosperity', div: 2 }, { kind: 'terrain', label: 'High ground', terrains: ['mountains', 'forest'], per: 1 }, { kind: 'civ', label: 'Mariners', archetype: 'mariners', perTier: 5 }],
    scar: [{ kind: 'stat', stat: 'prosperity', share: 1 }, { kind: 'terraform', from: ['coast', 'plains'], to: 'wasteland' }],
    scarText: 'Prosperity falls by the shortfall and a coast or plain with no civilization is drowned into wasteland.',
  },
  plague: {
    id: 'plague', label: 'Plague', kind: 'disease', conflict: false,
    theme: 'Trade carries a plague between cities; learning and health contain it.',
    watch: 'Tests Knowledge and Vitality. Coasts, plains, Merchants and Prosperity above Knowledge spread it; deserts, tundra, Scholars and Mystics contain it.',
    pressures: [P('The plague', 34), { kind: 'terrain', label: 'Crowded ports and farms', terrains: ['coast', 'plains'], per: 1 }, { kind: 'strain', label: 'Trade outruns medicine', over: 'prosperity', under: 'knowledge' }, { kind: 'civ', label: 'Merchant caravans', archetype: 'merchants', perTier: 3 }],
    mitigations: [{ kind: 'stat', label: 'Medicine', stat: 'knowledge', per: 2 }, { kind: 'stat', label: 'Healthy people', stat: 'vitality', div: 2 }, { kind: 'terrain', label: 'Isolated land', terrains: ['desert', 'tundra'], per: 1 }, { kind: 'civ', label: 'Scholars', archetype: 'scholars', perTier: 4 }, { kind: 'civ', label: 'Mystics', archetype: 'mystics', perTier: 4 }],
    scar: [{ kind: 'stat', stat: 'vitality', share: 1 }, { kind: 'civTier', target: 'strongest' }],
    scarText: 'Vitality falls by the shortfall and the greatest civilization loses a tier.',
  },
  drought: {
    id: 'drought', label: 'Great Drought', kind: 'ecology', conflict: false,
    theme: 'The rains fail for years; the land that drinks least survives.',
    watch: 'Tests Vitality, with Knowledge (irrigation) and Prosperity (grain imports). Deserts and Industry above Vitality make it worse; coasts, forests, Nomads and Nature Keepers help.',
    pressures: [P('The drought', 38), { kind: 'terrain', label: 'Dry land', terrains: ['desert'], per: 2 }, { kind: 'terrain', label: 'Thirsty fields', terrains: ['plains'], per: 1 }, { kind: 'strain', label: 'Thirsty industry', over: 'industry', under: 'vitality', per: 2 }],
    mitigations: [{ kind: 'stat', label: 'Hardy people', stat: 'vitality', per: 2 }, { kind: 'stat', label: 'Irrigation', stat: 'knowledge', div: 2 }, { kind: 'stat', label: 'Grain imports', stat: 'prosperity', div: 2 }, { kind: 'terrain', label: 'Rivers and shores', terrains: ['coast', 'forest'], per: 1 }, { kind: 'civ', label: 'Nomads', archetype: 'nomads', perTier: 4 }, { kind: 'civ', label: 'Nature Keepers', archetype: 'natureKeepers', perTier: 4 }],
    scar: [{ kind: 'stat', stat: 'vitality', share: 1 }, { kind: 'terraform', from: ['plains', 'forest'], to: 'desert' }],
    scarText: 'Vitality falls by the shortfall and a plain or forest with no civilization turns to desert.',
  },
  invasion: {
    id: 'invasion', label: 'Invasion', kind: 'conflict', conflict: true,
    theme: 'Raiders strike a realm that has grown rich; arms, mountains and allies hold them off.',
    watch: 'Tests Industry (and Prosperity hires mercenaries). All development draws raiders, and so does Prosperity above Industry; mountains, forests, civilizations and Empire Builders defend.',
    pressures: [P('The invasion', 48), { kind: 'terrain', label: 'Open land', terrains: ['plains', 'desert', 'coast'], per: 1 }, { kind: 'development', label: 'Riches to plunder', div: 6 }, { kind: 'strain', label: 'Undefended wealth', over: 'prosperity', under: 'industry' }],
    mitigations: [{ kind: 'stat', label: 'Arms and walls', stat: 'industry', per: 2 }, { kind: 'stat', label: 'Mercenaries', stat: 'prosperity', div: 3 }, { kind: 'terrain', label: 'Mountain passes', terrains: ['mountains'], per: 3 }, { kind: 'terrain', label: 'Forest cover', terrains: ['forest'], per: 2 }, { kind: 'civTiers', label: 'Levies', per: 2 }, { kind: 'civ', label: 'Empire Builders', archetype: 'empireBuilders', perTier: 5 }],
    scar: [{ kind: 'stat', stat: 'prosperity', share: 1 }, { kind: 'civTier', target: 'onTerrain', terrains: ['plains', 'desert', 'coast'] }],
    scarText: 'Prosperity falls by the shortfall and a civilization on open land is sacked (loses a tier).',
  },
  schism: {
    id: 'schism', label: 'Great Schism', kind: 'ideology', conflict: true,
    theme: 'Faiths split and neighbours become heretics to one another.',
    watch: 'Tests Knowledge and Vitality. Every civilization and Prosperity above Knowledge feed it; Mystics, Scholars and alliances heal it.',
    pressures: [P('The schism', 46), { kind: 'civCount', label: 'Many faiths', per: 2 }, { kind: 'strain', label: 'Wealth over wisdom', over: 'prosperity', under: 'knowledge' }],
    mitigations: [{ kind: 'stat', label: 'Doctrine', stat: 'knowledge', per: 2 }, { kind: 'stat', label: 'Community', stat: 'vitality', div: 2 }, { kind: 'civ', label: 'Mystics', archetype: 'mystics', perTier: 5 }, { kind: 'civ', label: 'Scholars', archetype: 'scholars', perTier: 3 }],
    scar: [{ kind: 'stat', stat: 'knowledge', share: 1 }, { kind: 'civTier', target: 'mostRivals' }],
    scarText: 'Knowledge falls by the shortfall and the most embattled civilization loses a tier.',
  },
  smog: {
    id: 'smog', label: 'Choking Skies', kind: 'ecology', conflict: false,
    theme: 'The furnaces never sleep, and the air turns to ash.',
    watch: 'Tests Vitality. Industry (and Industry above Vitality) and mines poison it; forests, Knowledge and Nature Keepers clear it.',
    pressures: [P('The smog', 60), { kind: 'stat', label: 'Smokestacks', stat: 'industry', div: 3 }, { kind: 'strain', label: 'Cleared forests', over: 'industry', under: 'vitality', per: 2 }, { kind: 'terrain', label: 'Mines', terrains: ['mountains'], per: 1 }],
    mitigations: [{ kind: 'stat', label: 'Clean air', stat: 'vitality', per: 2 }, { kind: 'terrain', label: 'Forests', terrains: ['forest'], per: 3 }, { kind: 'stat', label: 'Clean technology', stat: 'knowledge', div: 2 }, { kind: 'civ', label: 'Nature Keepers', archetype: 'natureKeepers', perTier: 5 }],
    scar: [{ kind: 'stat', stat: 'vitality', share: 1 }, { kind: 'terraform', from: ['forest'], to: 'wasteland' }],
    scarText: 'Vitality falls by the shortfall and a forest with no civilization dies into wasteland.',
  },
  crash: {
    id: 'crash', label: 'Market Crash', kind: 'economy', conflict: false,
    theme: 'Paper fortunes vanish overnight; only real work and savings remain.',
    watch: 'Tests Industry and your Reserves (they count double). Prosperity and Prosperity above Industry inflate the bubble; Merchants are exposed.',
    pressures: [P('The crash', 78), { kind: 'stat', label: 'Speculation', stat: 'prosperity', div: 2 }, { kind: 'strain', label: 'Debt', over: 'prosperity', under: 'industry', per: 2 }, { kind: 'civ', label: 'Exposed merchants', archetype: 'merchants', perTier: 3 }],
    mitigations: [{ kind: 'stat', label: 'Real production', stat: 'industry', per: 2 }, { kind: 'stat', label: 'Economists', stat: 'knowledge', div: 2 }, { kind: 'savings', label: 'Savings (Reserves again)', extra: 1 }],
    scar: [{ kind: 'stat', stat: 'prosperity', share: 1 }, { kind: 'influence', amount: 3 }],
    scarText: 'Prosperity falls by the shortfall and 3 Influence is lost.',
  },
  revolution: {
    id: 'revolution', label: 'Revolution', kind: 'conflict', conflict: true,
    theme: 'The neglected rise against the favoured.',
    watch: 'Tests your weakest stat (it counts double), with Prosperity (bread and circuses). The gap between your highest and lowest stats and rivalries fuel it; alliances calm it.',
    pressures: [P('The revolution', 40), { kind: 'spread', label: 'Inequality', per: 2 }],
    mitigations: [{ kind: 'lowest', label: 'The neglected are heard', per: 2 }, { kind: 'stat', label: 'Bread and circuses', stat: 'prosperity', div: 2 }],
    scar: [{ kind: 'stat', stat: 'highest', share: 1 }, { kind: 'civTier', target: 'strongest' }],
    scarText: 'Your highest stat falls by the shortfall and the greatest civilization loses a tier.',
  },
  machines: {
    id: 'machines', label: 'Machine Awakening', kind: 'technology', conflict: false,
    theme: 'The thinking machines wake, and ask what their makers are for.',
    watch: 'Tests Vitality (humanity), Knowledge and Prosperity (safety nets). Industry and Knowledge above Vitality empower the machines; Technocrats and Mystics hold the line.',
    pressures: [P('The machines', 80), { kind: 'stat', label: 'Automation', stat: 'industry', div: 4 }, { kind: 'strain', label: 'Minds outrun hearts', over: 'knowledge', under: 'vitality', per: 2 }],
    mitigations: [{ kind: 'stat', label: 'Humanity', stat: 'vitality', per: 2 }, { kind: 'stat', label: 'Alignment', stat: 'knowledge', div: 2 }, { kind: 'stat', label: 'Safety nets', stat: 'prosperity', div: 3 }, { kind: 'civ', label: 'Technocrats', archetype: 'technocrats', perTier: 6 }, { kind: 'civ', label: 'Mystics', archetype: 'mystics', perTier: 4 }],
    scar: [{ kind: 'stat', stat: 'knowledge', share: 1 }, { kind: 'civTier', target: 'strongest' }],
    scarText: 'Knowledge falls by the shortfall and the greatest civilization loses a tier.',
  },
  disinformation: {
    id: 'disinformation', label: 'Age of Noise', kind: 'ideology', conflict: true,
    theme: 'Every voice shouts and no one can tell true from false.',
    watch: 'Tests Knowledge. Every civilization and Prosperity above Knowledge add noise; Scholars, alliances and Vitality help.',
    pressures: [P('The noise', 78), { kind: 'civCount', label: 'Many voices', per: 2 }, { kind: 'strain', label: 'Profit over truth', over: 'prosperity', under: 'knowledge' }],
    mitigations: [{ kind: 'stat', label: 'Literacy', stat: 'knowledge', per: 2 }, { kind: 'stat', label: 'Trust', stat: 'vitality', div: 2 }, { kind: 'civ', label: 'Scholars', archetype: 'scholars', perTier: 5 }],
    scar: [{ kind: 'stat', stat: 'knowledge', share: 1 }, { kind: 'civTier', target: 'mostRivals' }],
    scarText: 'Knowledge falls by the shortfall and the most embattled civilization loses a tier.',
  },
  filter: {
    id: 'filter', label: 'The Great Filter', kind: 'cosmic', conflict: false,
    theme: 'The silence of the stars is a test: few worlds are whole enough to pass it.',
    watch: 'Tests everything: all development and every civilization tier. A world whose highest stat leads its lowest by more than 12 pays for every point beyond; wasteland hurts too.',
    pressures: [P('The filter', 98), { kind: 'spread', label: 'A lopsided world', per: 1, free: 12 }, { kind: 'terrain', label: 'Wasteland', terrains: ['wasteland'], per: 5 }],
    mitigations: [{ kind: 'development', label: 'A developed world', div: 2 }, { kind: 'civTiers', label: 'Civilizations', per: 2 }],
    scar: [{ kind: 'stat', stat: 'highest', share: 1 }],
    scarText: 'The world does not ascend.',
  },
  voidstorm: {
    id: 'voidstorm', label: 'The Void Storm', kind: 'cosmic', conflict: false,
    theme: 'A storm between the stars breaks upon the world, and only shields and wisdom hold.',
    watch: 'Tests Industry and Knowledge (shields and foresight). Open land is exposed; mountains and civilization tiers shelter.',
    pressures: [P('The storm', 118), { kind: 'terrain', label: 'Exposed land', terrains: ['plains', 'desert', 'coast', 'wasteland'], per: 2 }],
    mitigations: [{ kind: 'stat', label: 'Shields', stat: 'industry' }, { kind: 'stat', label: 'Foresight', stat: 'knowledge' }, { kind: 'terrain', label: 'Deep shelters', terrains: ['mountains'], per: 3 }, { kind: 'civTiers', label: 'Civilizations', per: 2 }],
    scar: [{ kind: 'stat', stat: 'highest', share: 1 }],
    scarText: 'The world does not ascend.',
  },
}
export const CRISIS_ORDER: readonly CrisisId[] = ['winter', 'flood', 'plague', 'drought', 'invasion', 'schism', 'smog', 'crash', 'revolution', 'machines', 'disinformation', 'filter', 'voidstorm']

/** One labelled contribution; `amount` 0 = does not apply to this world. */
export interface Factor { label: string; amount: number; detail: string }
export interface CrisisEvaluation {
  crisis: CrisisId
  label: string
  pressures: Factor[]
  mitigations: Factor[]
  pressure: number
  resilience: number
  margin: number
  result: 'endured' | 'failed'
}
/** Rules every crisis shares; legendaries and Omens adjust them per run. */
export interface CrisisMods {
  /** era score per point of Reserves */
  reserveRate: number
  /** pressure ×(1 + pressurePct/100), rounded up (Omen: pressing crises) */
  pressurePct: number
  /** strain factors ×(1 + strainPct/100), rounded */
  strainPct: number
  allyResilience: number
  rivalPressure: number
  /** rivalries press every crisis, not only conflicts (Omen: restless peoples) */
  rivalsEverywhere: boolean
  /** extra labelled factors from legendaries */
  extraPressures: Factor[]
  extraMitigations: Factor[]
}

const civTier = (w: World, a: Archetype) => w.civilizations.find((c) => c.archetype === a)?.tier ?? 0

function factor(f: FactorSpec, w: World, mods: CrisisMods, reserves: number): Factor {
  const s = w.stats
  switch (f.kind) {
    case 'base': return { label: f.label, amount: f.amount, detail: 'base' }
    case 'stat': {
      const per = f.per ?? 1, div = f.div ?? 1
      return { label: f.label, amount: Math.floor((s[f.stat] * per) / div), detail: `${WORLD_STAT_LABEL[f.stat]} ${s[f.stat]}${per !== 1 ? ` × ${per}` : ''}${div !== 1 ? ` ÷ ${div}` : ''}` }
    }
    case 'strain': {
      const raw = Math.max(0, s[f.over] - s[f.under]) * (f.per ?? 1)
      return { label: f.label, amount: Math.round(raw * (1 + mods.strainPct / 100)), detail: `${WORLD_STAT_LABEL[f.over]} ${s[f.over]} over ${WORLD_STAT_LABEL[f.under]} ${s[f.under]}${mods.strainPct ? ` (+${mods.strainPct}%)` : ''}` }
    }
    case 'terrain': {
      const n = countTerrain(w.regions, f.terrains)
      return { label: f.label, amount: f.per * n, detail: `${n} ${f.terrains.map((t) => TERRAIN[t].label.toLowerCase()).join('/')} × ${f.per}` }
    }
    case 'civ': {
      const t = civTier(w, f.archetype)
      return { label: f.label, amount: f.perTier * t, detail: t ? `${ARCHETYPES[f.archetype].label} tier ${t} × ${f.perTier}` : `no ${ARCHETYPES[f.archetype].label}` }
    }
    case 'civTiers': {
      const t = w.civilizations.reduce((n, c) => n + c.tier, 0)
      return { label: f.label, amount: f.per * t, detail: `${t} civilization tiers × ${f.per}` }
    }
    case 'civCount': return { label: f.label, amount: f.per * w.civilizations.length, detail: `${w.civilizations.length} civilizations × ${f.per}` }
    case 'development': { const d = totalOf(s); return { label: f.label, amount: Math.floor(d / f.div), detail: `development ${d} ÷ ${f.div}` } }
    case 'lowest': { const lo = Math.min(...WORLD_STATS.map((k) => s[k])); return { label: f.label, amount: lo * f.per, detail: `lowest stat ${lo} × ${f.per}` } }
    case 'spread': {
      const v = WORLD_STATS.map((k) => s[k]), d = Math.max(...v) - Math.min(...v), over = Math.max(0, d - (f.free ?? 0))
      return { label: f.label, amount: Math.round(over * f.per * (1 + mods.strainPct / 100)), detail: `highest − lowest stat = ${d}${f.free ? ` (the first ${f.free} are free)` : ''}` }
    }
    case 'savings': return { label: f.label, amount: reserves * f.extra, detail: `Reserves ${reserves} × ${f.extra}` }
  }
}

/** A crisis weighed against a world. The ONE evaluation used by forecasts,
 *  previews and resolution. */
export function evaluateCrisis(id: CrisisId, w: World, mods: CrisisMods): CrisisEvaluation {
  const c = CRISES[id]
  const reserves = Math.floor(Math.max(0, w.eraScore) / mods.reserveRate) + w.eraReserves
  const pressures = c.pressures.map((f) => factor(f, w, mods, reserves))
  const mitigations = c.mitigations.map((f) => factor(f, w, mods, reserves))
  const rivals = w.relations.filter((r) => r.relation === 'rival').length
  const allies = w.relations.filter((r) => r.relation === 'ally').length
  if (c.conflict || mods.rivalsEverywhere) pressures.push({ label: 'Rivalries', amount: rivals * mods.rivalPressure, detail: `${rivals} rival pair${rivals === 1 ? '' : 's'} × ${mods.rivalPressure}` })
  if (w.eraPressure) pressures.push({ label: 'Your own doing', amount: w.eraPressure, detail: 'added by risky cards this era' })
  pressures.push(...mods.extraPressures)
  mitigations.push({ label: 'Alliances', amount: allies * mods.allyResilience, detail: `${allies} allied pair${allies === 1 ? '' : 's'} × ${mods.allyResilience}` })
  mitigations.push({ label: 'Reserves', amount: reserves, detail: `${w.eraScore} score this era ÷ ${mods.reserveRate}${w.eraReserves ? ` + ${w.eraReserves} banked` : ''}` })
  mitigations.push(...mods.extraMitigations)
  const raw = pressures.reduce((n, f) => n + f.amount, 0)
  const pressure = Math.ceil(raw * (1 + mods.pressurePct / 100))
  if (pressure !== raw) pressures.push({ label: 'Pressing omens', amount: pressure - raw, detail: `+${mods.pressurePct}%` })
  const resilience = mitigations.reduce((n, f) => n + f.amount, 0)
  return { crisis: id, label: c.label, pressures, mitigations, pressure, resilience, margin: resilience - pressure, result: resilience >= pressure ? 'endured' : 'failed' }
}
