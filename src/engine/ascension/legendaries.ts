// Ascension legendaries: world-defining relics. Pure.
//
// Each legendary changes a rule, through typed engine hooks (no scripting):
//   mods      static run modifiers (hands, discards, poker rules, crisis rules)
//   score     adds to a play, after civilizations
//   crisis    adds labelled factors to a crisis evaluation
//   discard   when the player discards
//   dawn      at the start of each era (after the first)
//   eraEnd    Influence when an era's crisis is endured
//   endure    after a crisis is endured
//   prevent   may turn a failed crisis into an endured one (once)
//   tempered  permanent chips a scoring card gains
// All hooks are deterministic functions of the state they are given.
import type { Suit } from '../poker'
import type { Region, WorldStats } from './world'
import { WORLD_STATS, highestStat, lowestStat, WORLD_STAT_LABEL } from './world'
import type { Civilization } from './civilizations'
import { CRISES, type CrisisId, type CrisisMods, type World } from './crises'
import type { Archetag } from './content'
import type { AscensionState, CardInst, LegendaryId, LegendaryInst } from './state'
import type { ScoreCtx } from './scoring'

export interface RunMods {
  handsBonus: number
  discardsBonus: number
  /** cards of this suit count as any suit for Flushes */
  wildSuit: Suit | null
  straightWrap: boolean
  straightGap: boolean
  /** opposite regions border each other */
  oppositeBorders: boolean
  crisis: CrisisMods
  marketSlots: number
  rerollBase: number
}

/** A draft state the engine owns and may mutate (a fresh clone inside a transition). */
type Draft = AscensionState

export interface LegendaryDef {
  id: LegendaryId
  name: string
  /** earliest era it may be offered after */
  era: number
  tags: readonly Archetag[]
  text: string
  lore: string
  starter: boolean
  mods?: (m: RunMods, s: AscensionState, inst: LegendaryInst) => void
  score?: (ctx: ScoreCtx, inst: LegendaryInst) => void
  crisis?: (w: World, m: CrisisMods, id: CrisisId, inst: LegendaryInst) => void
  discard?: (s: Draft, inst: LegendaryInst, cards: number) => void
  dawn?: (s: Draft, inst: LegendaryInst) => string | null
  eraEnd?: (s: AscensionState, relations: { ally: number; rival: number }) => number
  endure?: (s: Draft, inst: LegendaryInst) => string | null
  prevent?: (s: Draft, inst: LegendaryInst) => boolean
  tempered?: (card: CardInst) => number
}

/** The weakest living civilization: lowest tier, then the most recent. */
export const weakestCiv = (civs: readonly Civilization[]) =>
  civs.reduce<Civilization | null>((w, c) => (!w || c.tier < w.tier || (c.tier === w.tier && c.id > w.id) ? c : w), null)

function shift(stats: WorldStats, n: number): string | null {
  const hi = highestStat(stats), lo = lowestStat(stats)
  const moved = Math.min(n, Math.max(0, Math.floor((stats[hi] - stats[lo]) / 2)))
  if (!moved || hi === lo) return null
  stats[hi] -= moved
  stats[lo] += moved
  return `${moved} ${WORLD_STAT_LABEL[hi]} became ${WORLD_STAT_LABEL[lo]}`
}

const HARSH: readonly Region['terrain'][] = ['wasteland', 'tundra', 'desert']

export const LEGENDARIES: Record<LegendaryId, LegendaryDef> = {
  worldTree: {
    id: 'worldTree', name: 'The World Tree', era: 0, starter: true, tags: ['vitality', 'focus'],
    text: '♥ cards count as every suit for Flushes. Scars never take Vitality.',
    lore: 'Its roots drink from every river at once.',
    mods: (m) => { m.wildSuit = 'H' },
  },
  eternalDragon: {
    id: 'eternalDragon', name: 'The Eternal Dragon', era: 0, starter: true, tags: ['risky', 'score', 'civ'],
    text: 'When you endure a crisis with 3+ civilizations, the Dragon devours the weakest. +3 mult on every play per civilization devoured.',
    lore: 'It asks for tribute, and it always grows.',
    score: (ctx, inst) => { if (inst.counter) ctx.add('legend', 'The Eternal Dragon', { mult: 3 * inst.counter }, `${inst.counter} devoured × 3`) },
    endure: (s, inst) => {
      if (s.civilizations.length < 3) return null
      const w = weakestCiv(s.civilizations)!
      s.civilizations = s.civilizations.filter((c) => c.id !== w.id)
      s.fallen = [...s.fallen, { ...w, tier: 0 }]
      inst.counter += 1
      return `The Eternal Dragon devoured ${w.name}.`
    },
  },
  sleepingGod: {
    id: 'sleepingGod', name: 'The Sleeping God', era: 0, starter: true, tags: ['crisis', 'risky'],
    text: 'The first crisis you would fail is endured instead, and the God wakes: from then on +4 mult on every play.',
    lore: 'It dreams of the world. Do not wake it for nothing.',
    score: (ctx, inst) => { if (inst.awake) ctx.add('legend', 'The Sleeping God', { mult: 4 }, 'awake') },
    prevent: (_s, inst) => { if (inst.awake) return false; inst.awake = true; return true },
  },
  titanForge: {
    id: 'titanForge', name: 'The Titan Forge', era: 0, starter: true, tags: ['industry', 'focus', 'score'],
    text: 'Each ♣ that scores is tempered: +2 chips permanently (up to +20 per card).',
    lore: 'Every blow on its anvil is remembered.',
    tempered: (c) => (c.s === 'C' && c.bonus < 20 ? 2 : 0),
  },
  cosmicLibrary: {
    id: 'cosmicLibrary', name: 'The Cosmic Library', era: 1, starter: true, tags: ['knowledge', 'focus', 'crisis'],
    text: 'Every crisis: +1 resilience per 2 Knowledge (Foresight).',
    lore: 'Every book that will ever be written, shelved in order.',
    crisis: (w, m) => { m.extraMitigations.push({ label: 'The Cosmic Library', amount: Math.floor(w.stats.knowledge / 2), detail: `Knowledge ${w.stats.knowledge} ÷ 2` }) },
  },
  architectMoon: {
    id: 'architectMoon', name: 'The Architect Moon', era: 1, starter: false, tags: ['score', 'relations'],
    text: 'Straights may wrap around (Q-K-A-2-3) and may skip one rank. Opposite regions border each other.',
    lore: 'Its tides redraw the coastlines every night.',
    mods: (m) => { m.straightWrap = true; m.straightGap = true; m.oppositeBorders = true },
  },
  silkRoad: {
    id: 'silkRoad', name: 'The Silk Road', era: 0, starter: true, tags: ['economy', 'civ', 'relations'],
    text: '+3 chips per civilization on every play. Each era you endure: +1 Influence per allied pair.',
    lore: 'A thread of caravans stitching the world together.',
    score: (ctx) => { if (ctx.civs.length) ctx.add('legend', 'The Silk Road', { chips: 3 * ctx.civs.length }, `${ctx.civs.length} civilizations × 3`) },
    eraEnd: (_s, r) => r.ally,
  },
  hydraCrown: {
    id: 'hydraCrown', name: 'The Hydra Crown', era: 1, starter: true, tags: ['balance', 'score'],
    text: '+1 mult on every play per 4 points of your LOWEST stat.',
    lore: 'Cut off one head and the others grow weaker.',
    score: (ctx) => {
      const lo = Math.min(...WORLD_STATS.map((k) => ctx.stats[k]))
      if (lo >= 4) ctx.add('legend', 'The Hydra Crown', { mult: Math.floor(lo / 4) }, `lowest stat ${lo} ÷ 4`)
    },
  },
  monolith: {
    id: 'monolith', name: 'The Monolith', era: 1, starter: true, tags: ['focus', 'risky', 'crisis'],
    text: 'Wherever a crisis tests your highest stat, it counts double. Strain from your highest stat also counts double.',
    lore: 'It asks one question, forever.',
    crisis: (w, m, id) => {
      const hi = highestStat(w.stats)
      let help = 0, harm = 0
      for (const f of CRISES[id].mitigations) if (f.kind === 'stat' && f.stat === hi) help += Math.floor((w.stats[hi] * (f.per ?? 1)) / (f.div ?? 1))
      for (const f of CRISES[id].pressures) if (f.kind === 'strain' && f.over === hi) harm += Math.max(0, w.stats[f.over] - w.stats[f.under]) * (f.per ?? 1)
      if (help) m.extraMitigations.push({ label: 'The Monolith', amount: help, detail: `${WORLD_STAT_LABEL[hi]} counts double` })
      if (harm) m.extraPressures.push({ label: 'The Monolith', amount: harm, detail: `strain from ${WORLD_STAT_LABEL[hi]} counts double` })
    },
  },
  everflame: {
    id: 'everflame', name: 'The Everflame', era: 0, starter: true, tags: ['small', 'score'],
    text: 'High Card and Pair hands score ×3 mult.',
    lore: 'A single spark, and it never goes out.',
    score: (ctx) => { if (ctx.category === 'high' || ctx.category === 'pair') ctx.add('legend', 'The Everflame', { xmult: 3 }, 'a small hand') },
  },
  gaiasHeart: {
    id: 'gaiasHeart', name: 'Gaia’s Heart', era: 0, starter: false, tags: ['terrain', 'vitality'],
    text: 'At the dawn of each era, your harshest region (wasteland, then tundra, then desert) turns to forest.',
    lore: 'The world remembers how to heal.',
    dawn: (s) => {
      const taken = new Set(s.civilizations.map((c) => c.home))
      for (const t of HARSH) {
        const r = s.regions.find((x) => x.terrain === t && !taken.has(x.id)) ?? s.regions.find((x) => x.terrain === t)
        if (r) { r.terrain = 'forest'; return `Gaia’s Heart turned region ${r.id} from ${t} to forest.` }
      }
      return null
    },
  },
  hourglass: {
    id: 'hourglass', name: 'The Hourglass of Ages', era: 0, starter: true, tags: ['score', 'risky'],
    text: '+2 hands every era. Every crisis has +15% pressure.',
    lore: 'More time — at a price paid later.',
    mods: (m) => { m.handsBonus += 2; m.crisis.pressurePct += 15 },
  },
  oraclesEye: {
    id: 'oraclesEye', name: 'The Oracle’s Eye', era: 0, starter: true, tags: ['discard', 'crisis'],
    text: '+2 discards every era. Each discard banks +1 Reserve for this era’s crisis.',
    lore: 'It sees which cards the future will not need.',
    mods: (m) => { m.discardsBonus += 2 },
    discard: (s) => { s.eraReserves += 1 },
  },
  starseed: {
    id: 'starseed', name: 'The Starseed', era: 2, starter: false, tags: ['civ', 'score'],
    text: '+1 hand every era for each Empire (tier 3 civilization).',
    lore: 'Plant it in a great people and watch it grow.',
    mods: (m, s) => { m.handsBonus += s.civilizations.filter((c) => c.tier >= 3).length },
  },
  philosophersStone: {
    id: 'philosophersStone', name: 'The Philosopher’s Stone', era: 1, starter: false, tags: ['balance'],
    text: 'At the dawn of each era, up to 5 points move from your highest stat to your lowest.',
    lore: 'Lead into gold; excess into need.',
    dawn: (s) => { const t = shift(s.stats, 5); return t ? `The Philosopher’s Stone: ${t}.` : null },
  },
  ironHeart: {
    id: 'ironHeart', name: 'The Iron Heart', era: 1, starter: false, tags: ['relations', 'risky', 'crisis'],
    text: 'Rivalries defend you: in conflict crises each rival pair gives +5 resilience instead of pressure. +1 more mult per rival pair.',
    lore: 'A realm forged by its enemies.',
    mods: (m) => { m.crisis.rivalPressure = 0 },
    crisis: (w, m, id) => {
      const rivals = w.relations.filter((r) => r.relation === 'rival').length
      if (CRISES[id].conflict && rivals) m.extraMitigations.push({ label: 'The Iron Heart', amount: 5 * rivals, detail: `${rivals} rival pairs × 5` })
    },
    score: (ctx) => {
      const rivals = ctx.relations.filter((r) => r.relation === 'rival').length
      if (rivals) ctx.add('legend', 'The Iron Heart', { mult: rivals }, `${rivals} rival pairs`)
    },
  },
  ouroboros: {
    id: 'ouroboros', name: 'The Ouroboros', era: 1, starter: false, tags: ['crisis', 'risky'],
    text: 'Each crisis you endure restores 1 Resolve (up to 3). Every crisis has +10% pressure.',
    lore: 'Every ending feeds a beginning.',
    mods: (m) => { m.crisis.pressurePct += 10 },
    endure: (s) => { if (s.resolve < 3) { s.resolve += 1; return 'The Ouroboros restored 1 Resolve.' } return null },
  },
}
export const LEGENDARY_ORDER: readonly LegendaryId[] = [
  'worldTree', 'eternalDragon', 'sleepingGod', 'titanForge', 'cosmicLibrary', 'architectMoon', 'silkRoad', 'hydraCrown',
  'monolith', 'everflame', 'gaiasHeart', 'hourglass', 'oraclesEye', 'starseed', 'philosophersStone', 'ironHeart', 'ouroboros',
]
