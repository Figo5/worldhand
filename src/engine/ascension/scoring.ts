// Ascension scoring: everything a play does, computed without changing
// anything. The UI preview and the committed `play` action both use this one
// result, so they cannot differ. Pure — no DOM, no clock, no Math.random.
//
//   hand       the poker category of the selected cards (Ascension's own
//              evaluator: legendaries may bend Flushes and Straights)
//   scoring    only the cards that make the hand score (a Pair's two cards,
//              a Flush's five...). Unscored cards are just spent.
//   chips      hand base + each scoring card's value (+ tempered bonus)
//              + land (one chip per region favouring the card's stat)
//   mult       hand base
//   world      each scoring card grows its suit's stat by 1
//   then       world cards (scored, then held), the era's rule,
//              civilizations, rivalries, legendaries
//   score      floor(chips × mult × xmult)
import type { Card, HandCategory, Rank, Suit } from '../poker'
import { categoryLabel } from '../poker'
import type { Region, WorldStat, WorldStats } from './world'
import { SUIT_STAT, WORLD_STATS, landAffinity, noStats, highestStat, lowestStat, countTerrain, SUIT_SYMBOL } from './world'
import type { Civilization, CivPair } from './civilizations'
import { ARCHETYPES, relations } from './civilizations'
import { CARD_BY_ID, type Cond, type Op, type Per, type StatTarget, type Effect } from './content'
import { CRISES } from './crises'
import { ERAS } from './eras'
import { LEGENDARIES, type RunMods } from './legendaries'
import { runMods, borders } from './rules'
import type { AscensionState, CardInst } from './state'
import { MAX_PLAY } from './state'

/** Base chips and mult for each poker hand. */
export const HAND_TABLE: Record<HandCategory, { chips: number; mult: number }> = {
  'high': { chips: 5, mult: 1 },
  'pair': { chips: 10, mult: 2 },
  'two-pair': { chips: 20, mult: 2 },
  'trips': { chips: 30, mult: 3 },
  'straight': { chips: 30, mult: 4 },
  'flush': { chips: 35, mult: 4 },
  'full-house': { chips: 40, mult: 4 },
  'quads': { chips: 60, mult: 7 },
  'straight-flush': { chips: 100, mult: 8 },
}
/** A card's chip value: 2–10 face value, J/Q/K 10, A 11. */
export const cardChips = (r: Rank) => (r <= 10 ? r : r === 14 ? 11 : 10)
export const cardLabel = (c: Card) => `${c.r === 14 ? 'A' : c.r === 13 ? 'K' : c.r === 12 ? 'Q' : c.r === 11 ? 'J' : String(c.r)}${SUIT_SYMBOL[c.s]}`

export type LineSource = 'hand' | 'cards' | 'land' | 'card' | 'held' | 'era' | 'civ' | 'relation' | 'legend'
export interface Effects { chips?: number; mult?: number; xmult?: number; stat?: Partial<WorldStats>; influence?: number; reserves?: number; pressure?: number }
export interface Line extends Effects { source: LineSource; label: string; detail: string }

export interface ScoreCtx {
  regions: readonly Region[]
  civs: readonly Civilization[]
  relations: readonly CivPair[]
  era: number
  handsPlayed: number
  lastHand: boolean
  cards: readonly CardInst[]
  scoring: readonly CardInst[]
  held: readonly CardInst[]
  category: HandCategory
  chips: number
  mult: number
  xmult: number
  /** the world stats as they stand during the play (after the gains so far) */
  stats: WorldStats
  statDeltas: WorldStats
  influence: number
  reserves: number
  pressure: number
  lines: Line[]
  add: (source: LineSource, label: string, e: Effects, detail: string) => void
}

export interface PlayResult {
  /** hand positions played, ascending */
  indices: number[]
  cards: CardInst[]
  /** hand positions of the cards that scored */
  scoring: number[]
  category: HandCategory
  label: string
  chips: number
  mult: number
  xmult: number
  score: number
  statDeltas: WorldStats
  influence: number
  reserves: number
  pressure: number
  lines: Line[]
  /** permanent chip bonuses the play gives cards (card id → new bonus) */
  tempered: { id: number; bonus: number }[]
}

// ---------------------------------------------------------------------------
// The Ascension hand evaluator (legendaries can bend Flushes and Straights).
// ---------------------------------------------------------------------------
function straightOf(ranks: number[], m: Pick<RunMods, 'straightWrap' | 'straightGap'>): boolean {
  if (ranks.length !== 5 || new Set(ranks).size !== 5) return false
  // positions 2→0 … A→12; the wheel (A-2-3-4-5) lets the ace sit below the 2
  const pos = ranks.map((r) => r - 2)
  const allowed = m.straightGap ? 5 : 4 // the span of five ranks (a gap widens it by one)
  const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
  if (span(pos) <= allowed || span(pos.map((p) => (p === 12 ? -1 : p))) <= allowed) return true
  if (!m.straightWrap) return false
  // wrapping: any run around the rank cycle (Q-K-A-2-3)
  return pos.some((start) => Math.max(...pos.map((p) => (p - start + 13) % 13)) <= allowed)
}

export function classify(cards: readonly Card[], m: Pick<RunMods, 'wildSuit' | 'straightWrap' | 'straightGap'>): HandCategory {
  const rs = cards.map((c) => c.r)
  const counts = new Map<number, number>()
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.values()].sort((a, b) => b - a)
  const five = cards.length === 5
  const natural = cards.filter((c) => c.s !== m.wildSuit)
  const flush = five && (natural.length === 0 || natural.every((c) => c.s === natural[0].s))
  const straight = five && straightOf(rs, m)
  if (flush && straight) return 'straight-flush'
  if (groups[0] === 4) return 'quads'
  if (five && groups[0] === 3 && groups[1] === 2) return 'full-house'
  if (flush) return 'flush'
  if (straight) return 'straight'
  if (groups[0] === 3) return 'trips'
  if (groups[0] === 2 && groups[1] === 2) return 'two-pair'
  if (groups[0] === 2) return 'pair'
  return 'high'
}

/** Positions (into `cards`) of the cards that score for `category`. */
export function scoringPositions(cards: readonly Card[], category: HandCategory): number[] {
  const all = cards.map((_, i) => i)
  if (category === 'straight' || category === 'flush' || category === 'full-house' || category === 'straight-flush') return all
  const counts = new Map<number, number>()
  for (const c of cards) counts.set(c.r, (counts.get(c.r) ?? 0) + 1)
  if (category === 'high') {
    const top = Math.max(...cards.map((c) => c.r))
    return [cards.findIndex((c) => c.r === top)]
  }
  const need = category === 'quads' ? 4 : category === 'trips' ? 3 : 2
  return all.filter((i) => (counts.get(cards[i].r) ?? 0) >= need)
}

// ---------------------------------------------------------------------------
// The declarative effect vocabulary.
// ---------------------------------------------------------------------------
export function perCount(p: Per | undefined, ctx: Pick<ScoreCtx, 'regions' | 'civs' | 'relations' | 'stats' | 'scoring' | 'handsPlayed'>): number {
  if (!p) return 1
  switch (p.per) {
    case 'terrain': return countTerrain(ctx.regions, p.terrains)
    case 'civs': return ctx.civs.length
    case 'civTiers': return ctx.civs.reduce((n, c) => n + c.tier, 0)
    case 'stat': return Math.floor(ctx.stats[p.stat] / p.div)
    case 'scoring': return ctx.scoring.filter((c) => !p.suit || c.s === p.suit).length
    case 'relations': return ctx.relations.filter((r) => r.relation === p.relation).length
    case 'handsPlayed': return ctx.handsPlayed
  }
}

export interface CondCtx {
  regions: readonly Region[]; civs: readonly Civilization[]; stats: WorldStats; category: HandCategory | null
  played: number; scoring: readonly Card[]; lastHand: boolean; crisis: string
}
export function condHolds(c: Cond | undefined, x: CondCtx): boolean {
  if (!c) return true
  switch (c.if) {
    case 'terrain': return countTerrain(x.regions, c.terrains) >= c.atLeast
    case 'civ': return x.civs.some((v) => v.archetype === c.archetype)
    case 'statAbove': return x.stats[c.over] > x.stats[c.under]
    case 'category': return x.category !== null && c.in.includes(x.category)
    case 'played': return x.played <= c.atMost
    case 'scoringSuit': return x.scoring.filter((k) => k.s === c.suit).length >= c.atLeast
    case 'spread': {
      const v = WORLD_STATS.map((k) => x.stats[k]), d = Math.max(...v) - Math.min(...v)
      return (c.atMost === undefined || d <= c.atMost) && (c.atLeast === undefined || d >= c.atLeast)
    }
    case 'lastHand': return x.lastHand
    case 'crisis': return (c.kinds as readonly string[]).includes(CRISES[x.crisis as keyof typeof CRISES].kind)
  }
}

export function resolveStat(t: StatTarget, stats: WorldStats, suit?: Suit): WorldStat {
  if (t === 'suit') return SUIT_STAT[suit ?? 'H']
  if (t === 'lowest') return lowestStat(stats)
  if (t === 'highest') return highestStat(stats)
  return t
}

/** Apply ops to a ctx-like accumulator. */
export function applyOps(ops: readonly Op[], ctx: ScoreCtx, source: LineSource, label: string, suit?: Suit): void {
  const e: Effects = {}
  const bits: string[] = []
  for (const op of ops) {
    const per = 'per' in op ? op.per : undefined
    const k = perCount(per, ctx)
    switch (op.op) {
      case 'chips': e.chips = (e.chips ?? 0) + op.n * k; break
      case 'mult': e.mult = (e.mult ?? 0) + op.n * k; break
      case 'xmult': e.xmult = (e.xmult ?? 1) * op.n; break
      case 'influence': e.influence = (e.influence ?? 0) + op.n * k; break
      case 'reserves': e.reserves = (e.reserves ?? 0) + op.n; break
      case 'pressure': e.pressure = (e.pressure ?? 0) + op.n; break
      case 'stat': {
        const st = resolveStat(op.stat, ctx.stats, suit)
        e.stat = { ...e.stat, [st]: (e.stat?.[st] ?? 0) + op.n * k }
        break
      }
    }
    if (per) bits.push(`${op.n} × ${k}`)
  }
  ctx.add(source, label, e, bits.join(', '))
}

function makeCtx(base: Omit<ScoreCtx, 'add' | 'lines'>): ScoreCtx {
  const ctx = base as ScoreCtx
  ctx.lines = []
  ctx.add = (source, label, e, detail) => {
    const empty = !e.chips && !e.mult && (e.xmult ?? 1) === 1 && !e.influence && !e.reserves && !e.pressure && !(e.stat && WORLD_STATS.some((k) => e.stat![k]))
    if (empty) return
    if (e.chips) ctx.chips += e.chips
    if (e.mult) ctx.mult += e.mult
    if (e.xmult) ctx.xmult *= e.xmult
    if (e.influence) ctx.influence += e.influence
    if (e.reserves) ctx.reserves += e.reserves
    if (e.pressure) ctx.pressure += e.pressure
    if (e.stat) for (const k of WORLD_STATS) if (e.stat[k]) { ctx.stats[k] += e.stat[k]!; ctx.statDeltas[k] += e.stat[k]! }
    ctx.lines.push({ source, label, detail, ...e })
  }
  return ctx
}

/** Everything a play of hand positions `idxs` would do. Throws on an illegal selection. */
export function evaluatePlay(state: AscensionState, idxs: readonly number[]): PlayResult {
  checkSelection(state.hand, idxs)
  const m = runMods(state)
  const indices = [...idxs].sort((a, b) => a - b)
  const cards = indices.map((i) => state.hand[i])
  const category = classify(cards, m)
  const scoringPos = scoringPositions(cards, category)
  const scoring = scoringPos.map((p) => cards[p])
  const regions = borders(state.regions, m)
  const civs = state.civilizations
  const rel = relations(civs, regions)
  const era = ERAS[state.era]
  const ctx = makeCtx({
    regions, civs, relations: rel, era: state.era, handsPlayed: state.handsPlayed, lastHand: state.handsLeft === 1,
    cards, scoring, held: state.hand.filter((_, i) => !indices.includes(i)), category,
    chips: 0, mult: 0, xmult: 1, stats: { ...state.stats }, statDeltas: noStats(), influence: 0, reserves: 0, pressure: 0,
  })
  const base = HAND_TABLE[category]
  ctx.add('hand', categoryLabel(category), { chips: base.chips, mult: base.mult }, `base ${base.chips} × ${base.mult}`)

  // scoring cards: value, world growth, land
  const affinity = landAffinity(state.regions)
  const value = scoring.reduce((n, c) => n + cardChips(c.r) + c.bonus, 0)
  const growth = noStats()
  for (const c of scoring) growth[SUIT_STAT[c.s]] += 1
  ctx.add('cards', 'Scoring cards', { chips: value, stat: growth }, scoring.map((c) => cardLabel(c) + (c.bonus ? `+${c.bonus}` : '')).join(' '))
  const land = scoring.reduce((n, c) => n + affinity[SUIT_STAT[c.s]], 0)
  ctx.add('land', 'Land', { chips: land }, 'one chip per region favouring each scoring card’s stat')

  // world cards: scored, then held
  const condCtx = (): CondCtx => ({ regions, civs, stats: ctx.stats, category, played: cards.length, scoring, lastHand: ctx.lastHand, crisis: state.crisisTrack[state.era] })
  for (const c of scoring) {
    const def = c.kind ? CARD_BY_ID.get(c.kind) : undefined
    if (def) for (const eff of def.effects) if (eff.when === 'scored' && condHolds(eff.cond, condCtx())) applyOps(eff.ops, ctx, 'card', def.name, c.s)
  }
  for (const c of ctx.held) {
    const def = c.kind ? CARD_BY_ID.get(c.kind) : undefined
    if (def) for (const eff of def.effects) if (eff.when === 'held' && condHolds(eff.cond, condCtx())) applyOps(eff.ops, ctx, 'held', `${def.name} (held)`, c.s)
  }

  // the era's rule
  const count = (s: Suit) => scoring.filter((c) => c.s === s).length
  if (era.rule === 'gatherers' && (category === 'high' || category === 'pair')) ctx.add('era', era.ruleName, { stat: growth }, 'a small hand: its stats again')
  if (era.rule === 'writing' && count('S')) ctx.add('era', era.ruleName, { chips: 4 * count('S') }, `${count('S')} ♠ × 4`)
  if (era.rule === 'levies' && civs.length) ctx.add('era', era.ruleName, { mult: civs.length }, `${civs.length} civilizations`)
  if (era.rule === 'steam' && count('C')) ctx.add('era', era.ruleName, { stat: { industry: count('C') } }, `${count('C')} ♣`)
  if (era.rule === 'network' && rel.length) ctx.add('era', era.ruleName, { mult: 2 * rel.length }, `${rel.length} pairs × 2`)
  if (era.rule === 'escape' && ['straight', 'flush', 'full-house', 'quads', 'straight-flush'].includes(category)) ctx.add('era', era.ruleName, { xmult: 1.5 }, 'a Straight or better')

  // civilizations, then rivalries, then legendaries
  for (const civ of civs) ARCHETYPES[civ.archetype].passive.apply(ctx, civ.tier, regions[civ.home])
  const rivals = rel.filter((r) => r.relation === 'rival').length
  if (rivals) ctx.add('relation', 'Rivalries', { mult: rivals }, `${rivals} rival pair${rivals === 1 ? '' : 's'}`)
  for (const inst of state.legendaries) LEGENDARIES[inst.id].score?.(ctx, inst)

  const tempered: { id: number; bonus: number }[] = []
  for (const inst of state.legendaries) {
    const t = LEGENDARIES[inst.id].tempered
    if (t) for (const c of scoring) { const d = t(c); if (d) tempered.push({ id: c.id, bonus: Math.min(20, c.bonus + d) }) }
  }
  const score = Math.floor(ctx.chips * ctx.mult * ctx.xmult)
  return {
    indices, cards: [...cards], scoring: scoringPos.map((p) => indices[p]), category, label: categoryLabel(category),
    chips: ctx.chips, mult: ctx.mult, xmult: ctx.xmult, score, statDeltas: ctx.statDeltas,
    influence: ctx.influence, reserves: ctx.reserves, pressure: ctx.pressure, lines: ctx.lines, tempered,
  }
}

/** Effects of discarding hand positions `idxs` (world cards with 'discarded' effects). */
export function evaluateDiscard(state: AscensionState, idxs: readonly number[]): { lines: Line[]; statDeltas: WorldStats; influence: number; reserves: number; pressure: number } {
  checkSelection(state.hand, idxs)
  const m = runMods(state)
  const regions = borders(state.regions, m)
  const cards = [...idxs].sort((a, b) => a - b).map((i) => state.hand[i])
  const ctx = makeCtx({
    regions, civs: state.civilizations, relations: relations(state.civilizations, regions), era: state.era, handsPlayed: state.handsPlayed, lastHand: false,
    cards, scoring: [], held: [], category: 'high', chips: 0, mult: 0, xmult: 1, stats: { ...state.stats }, statDeltas: noStats(), influence: 0, reserves: 0, pressure: 0,
  })
  const cc: CondCtx = { regions, civs: state.civilizations, stats: ctx.stats, category: null, played: cards.length, scoring: [], lastHand: false, crisis: state.crisisTrack[state.era] }
  for (const c of cards) {
    const def = c.kind ? CARD_BY_ID.get(c.kind) : undefined
    if (def) for (const eff of def.effects as readonly Effect[]) if (eff.when === 'discarded' && condHolds(eff.cond, cc)) applyOps(eff.ops, ctx, 'card', def.name, c.s)
  }
  return { lines: ctx.lines, statDeltas: ctx.statDeltas, influence: ctx.influence, reserves: ctx.reserves, pressure: ctx.pressure }
}

export function checkSelection(hand: readonly CardInst[], idxs: readonly number[]): void {
  if (!Array.isArray(idxs) || idxs.length < 1 || idxs.length > MAX_PLAY) throw new Error(`select 1–${MAX_PLAY} cards`)
  if (new Set(idxs).size !== idxs.length) throw new Error('a card was selected twice')
  for (const i of idxs) if (!Number.isInteger(i) || i < 0 || i >= hand.length) throw new Error(`no card at position ${String(i)}`)
}
