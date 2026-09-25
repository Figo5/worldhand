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
import { WORLD_STATS, SUIT_STAT, highestStat, lowestStat, WORLD_STAT_LABEL } from './world'
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
    text: '♥ cards are wild for Flushes: five cards are a Flush when all the others share one suit (at least three of them).',
    lore: 'Its roots drink from every river at once.',
    mods: (m) => { m.wildSuit = 'H' },
  },
  eternalDragon: {
    id: 'eternalDragon', name: 'The Eternal Dragon', era: 0, starter: true, tags: ['risky', 'score', 'civ'],
    text: 'When you endure a crisis with 3+ civilizations, the Dragon devours a Settlement (never a Kingdom or Empire). +8 mult on every play per civilization devoured.',
    lore: 'It asks for tribute, and it always grows.',
    score: (ctx, inst) => { if (inst.counter) ctx.add('legend', 'The Eternal Dragon', { mult: 8 * inst.counter }, `${inst.counter} devoured × 8`) },
    endure: (s, inst) => {
      if (s.civilizations.length < 3) return null
      const w = weakestCiv(s.civilizations)!
      if (w.tier > 1) return null
      s.civilizations = s.civilizations.filter((c) => c.id !== w.id)
      s.fallen = [...s.fallen, { ...w, tier: 0 }]
      s.chronicle.push({ t: 'fall', era: s.era, civ: w.id, name: w.name, archetype: w.archetype, cause: 'devoured by the Eternal Dragon' })
      inst.counter += 1
      return `The Eternal Dragon devoured ${w.name}.`
    },
  },
  sleepingGod: {
    id: 'sleepingGod', name: 'The Sleeping God', era: 0, starter: true, tags: ['crisis', 'risky'],
    text: 'The first crisis you would fail is endured instead, and the God wakes: from then on +4 mult on every play, but every crisis has +10% pressure.',
    lore: 'It dreams of the world. Do not wake it for nothing.',
    mods: (m, _s, inst) => { if (inst.awake) m.crisis.pressurePct += 10 },
    score: (ctx, inst) => { if (inst.awake) ctx.add('legend', 'The Sleeping God', { mult: 4 }, 'awake') },
    prevent: (_s, inst) => { if (inst.awake) return false; inst.awake = true; return true },
  },
  titanForge: {
    id: 'titanForge', name: 'The Titan Forge', era: 0, starter: true, tags: ['score'],
    text: 'Every card that scores is tempered: +8 chips permanently (up to +80 per card).',
    lore: 'Every blow on its anvil is remembered.',
    tempered: (c) => (c.bonus < 80 ? 8 : 0),
  },
  cosmicLibrary: {
    id: 'cosmicLibrary', name: 'The Cosmic Library', era: 1, starter: true, tags: ['knowledge', 'focus', 'crisis'],
    text: 'Every crisis: +1 resilience per 3 Knowledge (Foresight).',
    lore: 'Every book that will ever be written, shelved in order.',
    crisis: (w, m) => { m.extraMitigations.push({ label: 'The Cosmic Library', amount: Math.floor(w.stats.knowledge / 3), detail: `Knowledge ${w.stats.knowledge} ÷ 3` }) },
  },
  architectMoon: {
    id: 'architectMoon', name: 'The Architect Moon', era: 1, starter: false, tags: ['score', 'relations'],
    text: 'Straights may wrap around (Q-K-A-2-3) and may skip one rank. Opposite regions border each other.',
    lore: 'Its tides redraw the coastlines every night.',
    mods: (m) => { m.straightWrap = true; m.straightGap = true; m.oppositeBorders = true },
  },
  silkRoad: {
    id: 'silkRoad', name: 'The Silk Road', era: 0, starter: true, tags: ['economy', 'civ', 'relations'],
    text: '+2 mult per civilization on every play. Each era you endure: +1 Influence per civilization.',
    lore: 'A thread of caravans stitching the world together.',
    score: (ctx) => { if (ctx.civs.length) ctx.add('legend', 'The Silk Road', { mult: 2 * ctx.civs.length }, `${ctx.civs.length} civilizations × 2`) },
    eraEnd: (s) => s.civilizations.length,
  },
  hydraCrown: {
    id: 'hydraCrown', name: 'The Hydra Crown', era: 1, starter: true, tags: ['balance', 'score'],
    text: '+1 mult on every play per 2 points of your LOWEST stat.',
    lore: 'Cut off one head and the others grow weaker.',
    score: (ctx) => {
      const lo = Math.min(...WORLD_STATS.map((k) => ctx.stats[k]))
      if (lo >= 2) ctx.add('legend', 'The Hydra Crown', { mult: Math.floor(lo / 2) }, `lowest stat ${lo} ÷ 2`)
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
    text: 'High Card and Pair hands score ×2 mult, and a High Card grows its stat twice.',
    lore: 'A single spark, and it never goes out.',
    score: (ctx) => {
      if (ctx.category !== 'high' && ctx.category !== 'pair') return
      const again: Partial<WorldStats> = {}
      if (ctx.category === 'high') for (const c of ctx.scoring) again[SUIT_STAT[c.s]] = (again[SUIT_STAT[c.s]] ?? 0) + 1
      ctx.add('legend', 'The Everflame', { xmult: 2, stat: again }, 'a small hand')
    },
  },
  gaiasHeart: {
    id: 'gaiasHeart', name: 'Gaia’s Heart', era: 0, starter: false, tags: ['terrain', 'vitality'],
    text: 'At the dawn of each era, your harshest region (wasteland, then tundra, then desert) turns to forest, and each forest gives +1 Vitality.',
    lore: 'The world remembers how to heal.',
    dawn: (s) => {
      const taken = new Set(s.civilizations.map((c) => c.home))
      for (const t of HARSH) {
        const r = s.regions.find((x) => x.terrain === t && !taken.has(x.id)) ?? s.regions.find((x) => x.terrain === t)
        if (r) { r.terrain = 'forest'; break }
      }
      const forests = s.regions.filter((x) => x.terrain === 'forest').length
      s.stats.vitality += forests
      return `Gaia’s Heart: the forests grew (+${forests} Vitality).`
    },
  },
  hourglass: {
    id: 'hourglass', name: 'The Hourglass of Ages', era: 0, starter: true, tags: ['score', 'risky'],
    text: '+2 hands every era. Every crisis has +10% pressure.',
    lore: 'More time — at a price paid later.',
    mods: (m) => { m.handsBonus += 2; m.crisis.pressurePct += 10 },
  },
  oraclesEye: {
    id: 'oraclesEye', name: 'The Oracle’s Eye', era: 0, starter: true, tags: ['discard', 'crisis'],
    text: '+2 discards every era. Each discard banks +2 Reserves for this era’s crisis.',
    lore: 'It sees which cards the future will not need.',
    mods: (m) => { m.discardsBonus += 2 },
    discard: (s) => { s.eraReserves += 2 },
  },
  starseed: {
    id: 'starseed', name: 'The Starseed', era: 2, starter: false, tags: ['civ', 'score'],
    text: '+1 hand every era, and one more for each Empire (tier 3 civilization).',
    lore: 'Plant it in a great people and watch it grow.',
    mods: (m, s) => { m.handsBonus += 1 + s.civilizations.filter((c) => c.tier >= 3).length },
  },
  philosophersStone: {
    id: 'philosophersStone', name: 'The Philosopher’s Stone', era: 1, starter: false, tags: ['balance'],
    text: 'At the dawn of each era, up to 5 points move from your highest stat to your lowest.',
    lore: 'Lead into gold; excess into need.',
    dawn: (s) => { const t = shift(s.stats, 5); return t ? `The Philosopher’s Stone: ${t}.` : null },
  },
  ironHeart: {
    id: 'ironHeart', name: 'The Iron Heart', era: 1, starter: false, tags: ['relations', 'risky', 'crisis'],
    text: 'Rivalries defend you: in every crisis each rival pair gives +5 resilience instead of pressure. +2 more mult per rival pair.',
    lore: 'A realm forged by its enemies.',
    mods: (m) => { m.crisis.rivalPressure = 0 },
    crisis: (w, m, id) => {
      const rivals = w.relations.filter((r) => r.relation === 'rival').length
      void id
      if (rivals) m.extraMitigations.push({ label: 'The Iron Heart', amount: 5 * rivals, detail: `${rivals} rival pairs × 5` })
    },
    score: (ctx) => {
      const rivals = ctx.relations.filter((r) => r.relation === 'rival').length
      if (rivals) ctx.add('legend', 'The Iron Heart', { mult: 2 * rivals }, `${rivals} rival pairs × 2`)
    },
  },
  ouroboros: {
    id: 'ouroboros', name: 'The Ouroboros', era: 1, starter: false, tags: ['crisis', 'risky'],
    text: 'Each crisis you endure restores 1 Resolve — up to 4, one more than any other world can hold — and gives +3 Influence.',
    lore: 'Every ending feeds a beginning.',
    endure: (s) => { s.influence += 3; if (s.resolve < 4) { s.resolve += 1; return 'The Ouroboros restored 1 Resolve.' } return null },
  },
}
export const LEGENDARY_ORDER: readonly LegendaryId[] = [
  'worldTree', 'eternalDragon', 'sleepingGod', 'titanForge', 'cosmicLibrary', 'architectMoon', 'silkRoad', 'hydraCrown',
  'monolith', 'everflame', 'gaiasHeart', 'hourglass', 'oraclesEye', 'starseed', 'philosophersStone', 'ironHeart', 'ouroboros',
]
