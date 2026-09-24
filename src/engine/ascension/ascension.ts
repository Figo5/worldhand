// Ascension: the run. Pure transitions — no DOM, no clock, no Math.random.
//
//   genesis ─► era: play / discard hands, grow the world, civilizations rise
//            └─ face the crisis (by choice, or when the hands run out)
//                 ├─ endured ─► Council (spend Influence) ─► next era
//                 ├─ failed  ─► −1 Resolve + a scar ─► Council ─► next era
//                 └─ final era: endured = the world ascends (won); failed = lost
//   Resolve 0 = lost.
//
// Boundaries (tests/engine-boundaries.test.ts): never imports Classic
// (worldhand.ts); shares only rng.ts, poker.ts and core/streams.ts. All
// randomness comes from named streams under 'ascension', each independent.
// Every transition returns a new state; an illegal action throws before
// anything changes, so the input state is never mutated.
import { hashSeed } from '../rng'
import { RANKS, SUITS, type Suit } from '../poker'
import { stream } from '../core/streams'
import { WORLD_STATS, generateRegions, noStats, highestStat, lowestStat, TERRAIN, REGION_NAMES, WORLD_STAT_LABEL, type Terrain, type WorldStat } from './world'
import { ARCHETYPES, emergeCivilization, grownTier, relations, TIER_LABEL, type Civilization } from './civilizations'
import { CRISES, evaluateCrisis, type CrisisEvaluation, type World, type ScarSpec } from './crises'
import { ERAS, FINAL_ERA } from './eras'
import { CARD_BY_ID, DECREE_BY_ID, type DecreeOp } from './content'
import { LEGENDARIES, weakestCiv, type RunMods } from './legendaries'
import { runMods, borders, startingResolve, omenActive, MAX_OMEN } from './rules'
import { evaluatePlay, evaluateDiscard, checkSelection, resolveStat } from './scoring'
import { openCouncil, marketOffers, rerollPrice, REMOVE_PRICE, SELL_REFUND } from './council'
import type { ChronicleEvent } from './chronicle'
import {
  HAND_SIZE, LEGENDARY_SLOTS, MAX_RESOLVE,
  type AscensionAction, type AscensionState, type CardInst, type CrisisOutcome, type RunSetup, type LegendaryInst,
} from './state'

/** Rules generation of Ascension state (independent of Classic's SAVE_VERSION).
 *  1–9: the prototype (see docs/development); 10 = the release ruleset: six
 *  eras of fixed hands and discards, scoring cards only, graded crises with
 *  Resolve and scars, Influence and the Council, world cards, decrees,
 *  legendaries, civilization tiers and relations, Omens and the Chronicle. */
export const ASCENSION_RULES_VERSION = 10
/** Never let a deck be thinned below this. */
export const MIN_DECK = 24

export type RunStatus = 'playing' | 'crisis' | 'council' | 'won' | 'lost'
/** playing: hands left; crisis: the hands ran out and the crisis must be faced now. */
export function runStatus(s: AscensionState): RunStatus {
  if (s.phase === 'won' || s.phase === 'lost' || s.phase === 'council') return s.phase
  return s.handsLeft > 0 ? 'playing' : 'crisis'
}

const clone = (s: AscensionState): AscensionState => structuredClone(s)
const log = (s: AscensionState, e: ChronicleEvent) => { s.chronicle.push(e) }
export const ownedCards = (s: AscensionState): CardInst[] => [...s.hand, ...s.drawPile, ...s.discardPile]

// ---------------------------------------------------------------------------
// A new run.
// ---------------------------------------------------------------------------
export function newRun(setup: RunSetup): AscensionState {
  validateSetup(setup)
  const seed = hashSeed(setup.seedText)
  const regions = generateRegions(seed, setup.origin, omenActive(setup.omen, 2))
  const deck: CardInst[] = []
  for (const s of SUITS) for (const r of RANKS) deck.push({ id: deck.length, r, s, kind: null, bonus: 0 })
  const state: AscensionState = {
    mode: 'ascension', rulesVersion: ASCENSION_RULES_VERSION, setup: structuredClone(setup), seed, regions, phase: 'play', era: 0,
    crisisTrack: ERAS.map((e, i) => stream(seed, 'ascension', 'crisis', i).pick(e.pool)),
    handsLeft: 0, discardsLeft: 0, handsPlayed: 0, hand: [], drawPile: deck, discardPile: [], reshuffles: 0, nextCardId: deck.length,
    score: 0, eraScore: 0, eraPressure: 0, eraReserves: 0, next: { hands: 0, discards: 0, reserves: 0, treaty: false }, treaty: false,
    stats: noStats(), civilizations: [], fallen: [], nextCivId: 0, legendaries: [], influence: 0, resolve: startingResolve(setup.omen),
    crises: [], council: null, lastPlay: null, plays: 0, discards: 0, bestPlay: null, chronicle: [],
  }
  const land: Partial<Record<Terrain, number>> = {}
  for (const r of regions) land[r.terrain] = (land[r.terrain] ?? 0) + 1
  log(state, { t: 'genesis', era: 0, origin: setup.origin, land })
  startEra(state, 0)
  return state
}

export function validateSetup(setup: RunSetup): void {
  if (!setup || typeof setup.seedText !== 'string' || setup.seedText.length === 0 || setup.seedText.length > 200) throw new Error('a seed phrase of 1–200 characters is needed')
  if (!Number.isInteger(setup.omen) || setup.omen < 0 || setup.omen > MAX_OMEN) throw new Error(`omen must be 0–${MAX_OMEN}`)
  if (!['pangaea', 'archipelago', 'highlands', 'verdant', 'frontier'].includes(setup.origin)) throw new Error(`unknown origin ${String(setup.origin)}`)
  const p = setup.pool
  if (!p || ![p.cards, p.decrees, p.legendaries, p.archetypes].every(Array.isArray)) throw new Error('content pool missing')
  for (const id of p.cards) if (!CARD_BY_ID.has(id)) throw new Error(`unknown card ${String(id)}`)
  for (const id of p.decrees) if (!DECREE_BY_ID.has(id)) throw new Error(`unknown decree ${String(id)}`)
  for (const id of p.legendaries) if (!LEGENDARIES[id]) throw new Error(`unknown legendary ${String(id)}`)
  for (const a of p.archetypes) if (!ARCHETYPES[a]) throw new Error(`unknown archetype ${String(a)}`)
}

/** Begin era `era` on a draft: growth, dawn effects, hands, a fresh shuffle of every owned card. */
function startEra(s: AscensionState, era: number): void {
  s.era = era
  s.eraScore = 0
  s.eraPressure = 0
  s.eraReserves = s.next.reserves
  s.treaty = s.next.treaty
  if (era > 0) {
    log(s, { t: 'dawn', era })
    for (const c of s.civilizations) {
      const t = grownTier(c, s.stats, era)
      if (t > c.tier) { c.tier = t; log(s, { t: 'tier', era, civ: c.id, name: c.name, tier: t, cause: 'growth' }) }
    }
    for (const inst of s.legendaries) {
      const before = s.regions.map((r) => r.terrain)
      const text = LEGENDARIES[inst.id].dawn?.(s, inst)
      s.regions.forEach((r, i) => { if (r.terrain !== before[i]) log(s, { t: 'terraform', era, region: r.id, from: before[i], to: r.terrain, cause: LEGENDARIES[inst.id].name }) })
      if (text) log(s, { t: 'wonder', era, text })
    }
  }
  const m = runMods(s, era)
  s.handsLeft = Math.max(1, ERAS[era].hands + m.handsBonus + s.next.hands)
  s.discardsLeft = Math.max(0, ERAS[era].discards + m.discardsBonus + s.next.discards)
  s.next = { hands: 0, discards: 0, reserves: 0, treaty: false }
  s.handsPlayed = 0
  const all = ownedCards(s).sort((a, b) => a.id - b.id)
  s.drawPile = stream(s.seed, 'ascension', 'deal', era).shuffle(all)
  s.hand = []
  s.discardPile = []
  s.reshuffles = 0
  drawUp(s)
}

/** Refill the hand, reshuffling the discard pile when the draw pile runs out. */
function drawUp(s: AscensionState): void {
  while (s.hand.length < HAND_SIZE) {
    if (s.drawPile.length === 0) {
      if (s.discardPile.length === 0) return
      s.drawPile = stream(s.seed, 'ascension', 'reshuffle', s.era, s.reshuffles).shuffle([...s.discardPile].sort((a, b) => a.id - b.id))
      s.discardPile = []
      s.reshuffles += 1
    }
    s.hand.push(s.drawPile.pop() as CardInst)
  }
}

// ---------------------------------------------------------------------------
// The crisis.
// ---------------------------------------------------------------------------
/** The world the current crisis weighs. */
export function crisisWorld(s: AscensionState, m: RunMods = runMods(s)): World {
  return {
    regions: s.regions, stats: s.stats, civilizations: s.civilizations, relations: relations(s.civilizations, borders(s.regions, m)),
    eraScore: s.eraScore, eraPressure: s.eraPressure, eraReserves: s.eraReserves,
  }
}
/** An era's crisis weighed against the world as it stands now. For the
 *  current era this is the exact result `face` would give; for a later era it
 *  is an outlook (that era's score, reserves and pressure start at zero). */
export function forecast(s: AscensionState, era = s.era): CrisisEvaluation {
  const m = runMods(s, era)
  const w = crisisWorld(s, m)
  if (era !== s.era) { w.eraScore = 0; w.eraPressure = 0; w.eraReserves = 0 }
  const id = s.crisisTrack[era]
  for (const inst of s.legendaries) LEGENDARIES[inst.id].crisis?.(w, m.crisis, id, inst)
  return evaluateCrisis(id, w, m.crisis)
}

function pickCiv(s: AscensionState, spec: Extract<ScarSpec, { kind: 'civTier' }>, m: RunMods): Civilization | null {
  const civs = s.civilizations
  if (!civs.length) return null
  const strongest = (xs: Civilization[]) => xs.reduce<Civilization | null>((b, c) => (!b || c.tier > b.tier || (c.tier === b.tier && c.id < b.id) ? c : b), null)
  switch (spec.target) {
    case 'weakest': return weakestCiv(civs)
    case 'strongest': return strongest(civs)
    case 'onTerrain': return strongest(civs.filter((c) => (spec.terrains ?? []).includes(s.regions[c.home].terrain)))
    case 'mostRivals': {
      const rel = relations(civs, borders(s.regions, m))
      const n = (c: Civilization) => rel.filter((r) => r.relation === 'rival' && (r.a === c.id || r.b === c.id)).length
      const top = Math.max(...civs.map(n))
      return top > 0 ? strongest(civs.filter((c) => n(c) === top)) : strongest(civs)
    }
  }
}

/** A civilization loses a tier on a draft; at tier 0 it falls. */
function cutTier(s: AscensionState, civ: Civilization, cause: string): string {
  civ.tier -= 1
  if (civ.tier > 0) return `${civ.name} fell to ${TIER_LABEL[civ.tier]}.`
  s.civilizations = s.civilizations.filter((c) => c.id !== civ.id)
  s.fallen.push({ ...civ })
  log(s, { t: 'fall', era: s.era, civ: civ.id, name: civ.name, archetype: civ.archetype, cause })
  return `${civ.name} collapsed.`
}

/** Apply a failed crisis's scar on a draft; returns what happened, in words. */
function applyScar(s: AscensionState, specs: readonly ScarSpec[], shortfall: number, m: RunMods, cause: string): string[] {
  const out: string[] = []
  const tree = s.legendaries.some((l) => l.id === 'worldTree')
  for (const spec of specs) {
    if (spec.kind === 'stat') {
      const k: WorldStat = spec.stat === 'highest' ? highestStat(s.stats) : spec.stat
      if (tree && k === 'vitality') { out.push('The World Tree kept Vitality whole.'); continue }
      const loss = Math.min(s.stats[k], Math.round(shortfall * spec.share))
      if (loss > 0) { s.stats[k] -= loss; out.push(`${WORLD_STAT_LABEL[k]} −${loss}.`) }
    } else if (spec.kind === 'civTier') {
      const c = pickCiv(s, spec, m)
      if (c) out.push(cutTier(s, c, `broken by the ${cause}`))
    } else if (spec.kind === 'terraform') {
      const taken = new Set(s.civilizations.map((c) => c.home))
      const r = s.regions.filter((x) => spec.from.includes(x.terrain) && !taken.has(x.id)).sort((a, b) => a.neighbors.length - b.neighbors.length || a.id - b.id)[0]
      if (r) {
        log(s, { t: 'terraform', era: s.era, region: r.id, from: r.terrain, to: spec.to, cause })
        out.push(`${REGION_NAMES[r.id]} became ${TERRAIN[spec.to].label.toLowerCase()}.`)
        r.terrain = spec.to
      }
    } else if (spec.kind === 'influence') {
      const loss = Math.min(s.influence, spec.amount)
      if (loss) { s.influence -= loss; out.push(`Influence −${loss}.`) }
    }
  }
  return out
}

/** Influence for enduring the current era's crisis (without the triumph bonus). */
export function eraEndInfluence(s: AscensionState, m: RunMods = runMods(s)): number {
  const rel = relations(s.civilizations, borders(s.regions, m))
  const counts = { ally: rel.filter((r) => r.relation === 'ally').length, rival: rel.filter((r) => r.relation === 'rival').length }
  return ERAS[s.era].reward + s.handsLeft
    + s.civilizations.filter((c) => c.archetype === 'merchants').reduce((n, c) => n + c.tier, 0)
    + s.legendaries.reduce((n, l) => n + (LEGENDARIES[l.id].eraEnd?.(s, counts) ?? 0), 0)
}
/** Treasury: every era's end pays +1 Influence per this much Prosperity, endured or not. */
export const TREASURY_STEP = 10
export const treasury = (s: AscensionState) => Math.floor(s.stats.prosperity / TREASURY_STEP)
export const TRIUMPH_BONUS = 3
export const FAIL_INFLUENCE = 2
export const isTriumph = (ev: CrisisEvaluation) => ev.result === 'endured' && ev.margin >= Math.ceil(ev.pressure / 4)

function face(state: AscensionState): AscensionState {
  const s = clone(state)
  const m = runMods(s)
  const ev = forecast(s)
  const era = s.era
  let result = ev.result
  let prevented = false
  if (result === 'failed') {
    for (const inst of s.legendaries) {
      if (LEGENDARIES[inst.id].prevent?.(s, inst)) { prevented = true; result = 'endured'; break }
    }
  }
  const triumph = isTriumph(ev)
  let influence: number
  const scars: string[] = []
  if (result === 'endured') {
    influence = era === FINAL_ERA ? 0 : eraEndInfluence(s, m) + (triumph ? TRIUMPH_BONUS : 0)
  } else {
    s.resolve -= 1
    influence = FAIL_INFLUENCE
    scars.push(...applyScar(s, CRISES[ev.crisis].scar, -ev.margin, m, CRISES[ev.crisis].label))
  }
  if (era !== FINAL_ERA) influence += treasury(s)
  s.influence += influence
  const outcome: CrisisOutcome = { ...ev, result, era, handsLeft: s.handsLeft, triumph, prevented, influence, scars }
  s.crises.push(outcome)
  log(s, { t: 'crisis', era, crisis: ev.crisis, result, margin: ev.margin, triumph, prevented })
  for (const text of scars) log(s, { t: 'scar', era, text })
  if (result === 'endured' && era !== FINAL_ERA) {
    for (const inst of s.legendaries) { const text = LEGENDARIES[inst.id].endure?.(s, inst); if (text) log(s, { t: 'wonder', era, text }) }
  }
  s.handsLeft = 0
  if (era === FINAL_ERA) {
    s.phase = result === 'endured' ? 'won' : 'lost'
    log(s, { t: 'end', era, result: s.phase, reason: s.phase === 'won' ? 'ascended' : `${CRISES[ev.crisis].label} was not endured, so the world did not ascend.` })
  } else if (s.resolve <= 0) {
    s.phase = 'lost'
    log(s, { t: 'end', era, result: 'lost', reason: `${CRISES[ev.crisis].label} broke its last Resolve.` })
  } else {
    s.phase = 'council'
    s.drawPile = ownedCards(s).sort((a, b) => a.id - b.id)
    s.hand = []
    s.discardPile = []
    s.council = openCouncil(s, era, runMods(s, era))
  }
  return s
}

// ---------------------------------------------------------------------------
// Plays and discards.
// ---------------------------------------------------------------------------
function assertPlaying(s: AscensionState): void {
  const st = runStatus(s)
  if (st === 'won' || st === 'lost') throw new Error('the run is over')
  if (st === 'council') throw new Error('the Council is in session: leave it to begin the next era')
  if (st === 'crisis') throw new Error('no hands left: face the crisis')
}

function play(state: AscensionState, idxs: number[]): AscensionState {
  assertPlaying(state)
  const r = evaluatePlay(state, idxs)
  const s = clone(state)
  const out = new Set(r.indices)
  s.discardPile.push(...s.hand.filter((_, i) => out.has(i)))
  s.hand = s.hand.filter((_, i) => !out.has(i))
  for (const t of r.tempered) { const c = s.discardPile.find((x) => x.id === t.id); if (c) c.bonus = t.bonus }
  s.score += r.score
  s.eraScore += r.score
  for (const k of WORLD_STATS) s.stats[k] = Math.max(0, s.stats[k] + r.statDeltas[k])
  s.influence += r.influence
  s.eraReserves += r.reserves
  s.eraPressure += r.pressure
  s.handsLeft -= 1
  s.handsPlayed += 1
  s.plays += 1
  s.lastPlay = r
  if (!s.bestPlay || r.score > s.bestPlay.score) {
    if (s.bestPlay && r.score >= 1.5 * s.bestPlay.score && r.score >= 500) log(s, { t: 'record', era: s.era, play: s.plays, score: r.score, label: r.label })
    s.bestPlay = { score: r.score, label: r.label, era: s.era }
  }
  const civ = emergeCivilization(s.seed, s.plays, s.era, s.regions, s.stats, s.civilizations, s.setup.pool.archetypes, s.nextCivId)
  if (civ) {
    s.civilizations.push(civ)
    s.nextCivId += 1
    log(s, { t: 'civ', era: s.era, play: s.plays, civ: civ.id, name: civ.name, archetype: civ.archetype, home: civ.home, terrain: s.regions[civ.home].terrain, rebirth: s.fallen.some((f) => f.archetype === civ.archetype) })
  }
  drawUp(s)
  return s
}

function discard(state: AscensionState, idxs: number[]): AscensionState {
  assertPlaying(state)
  if (state.discardsLeft <= 0) throw new Error('no discards left this era')
  const d = evaluateDiscard(state, idxs)
  const s = clone(state)
  const out = new Set(idxs)
  s.discardPile.push(...s.hand.filter((_, i) => out.has(i)))
  s.hand = s.hand.filter((_, i) => !out.has(i))
  for (const k of WORLD_STATS) s.stats[k] = Math.max(0, s.stats[k] + d.statDeltas[k])
  s.influence += d.influence
  s.eraReserves += d.reserves
  s.eraPressure += d.pressure
  s.discardsLeft -= 1
  s.discards += 1
  for (const inst of s.legendaries) LEGENDARIES[inst.id].discard?.(s, inst, idxs.length)
  drawUp(s)
  return s
}

// ---------------------------------------------------------------------------
// The Council.
// ---------------------------------------------------------------------------
function spend(s: AscensionState, price: number): void {
  if (s.influence < price) throw new Error(`not enough Influence: this costs ${price}, you have ${s.influence}`)
  s.influence -= price
}

/** Apply a decree on a draft. Returns a label for its target (for the chronicle). */
function applyDecree(s: AscensionState, ops: readonly DecreeOp[], target: number | Suit | undefined): string | null {
  let label: string | null = null
  for (const op of ops) {
    switch (op.op) {
      case 'terraform': {
        const r = typeof target === 'number' ? s.regions[target] : undefined
        if (!r) throw new Error('choose a region')
        if (!op.from.includes(r.terrain)) throw new Error(`${REGION_NAMES[r.id]} is ${TERRAIN[r.terrain].label.toLowerCase()}; this needs ${op.from.map((t) => TERRAIN[t].label.toLowerCase()).join(' or ')}`)
        log(s, { t: 'terraform', era: s.era, region: r.id, from: r.terrain, to: op.to, cause: 'a decree' })
        r.terrain = op.to
        label = REGION_NAMES[r.id]
        break
      }
      case 'stat': s.stats[resolveStat(op.stat, s.stats)] += op.n; break
      case 'shift': {
        const from = op.from === 'highest' ? highestStat(s.stats) : lowestStat(s.stats)
        const to = op.to === 'highest' ? highestStat(s.stats) : lowestStat(s.stats)
        if (from === to || s.stats[from] === 0) throw new Error('there is nothing to move')
        const n = Math.min(op.n, s.stats[from])
        s.stats[from] -= n
        s.stats[to] += n
        break
      }
      case 'tier': {
        const c = s.civilizations.find((x) => x.id === target)
        if (!c) throw new Error('choose a living civilization')
        if (c.tier >= 3) throw new Error(`${c.name} is already an Empire`)
        c.tier += 1
        log(s, { t: 'tier', era: s.era, civ: c.id, name: c.name, tier: c.tier, cause: 'patronage' })
        label = c.name
        break
      }
      case 'resolve':
        if (s.resolve >= MAX_RESOLVE) throw new Error('Resolve is already full')
        s.resolve = Math.min(MAX_RESOLVE, s.resolve + op.n)
        break
      case 'hands': s.next.hands += op.n; break
      case 'discards': s.next.discards += op.n; break
      case 'reserves': s.next.reserves += op.n; break
      case 'treaty': s.next.treaty = true; break
      case 'recruit': {
        if (typeof target !== 'string' || !SUITS.includes(target as Suit)) throw new Error('choose a suit')
        const cards = s.drawPile.filter((c) => c.s !== target).sort((a, b) => a.r - b.r || a.id - b.id).slice(0, op.n)
        if (!cards.length) throw new Error('every card is already that suit')
        for (const c of cards) c.s = target as Suit
        label = target
        break
      }
    }
  }
  return label
}

function council(state: AscensionState, a: AscensionAction): AscensionState {
  if (state.phase !== 'council' || !state.council) throw new Error('the Council is not in session')
  const s = clone(state)
  const c = s.council!
  const m = runMods(s)
  switch (a.type) {
    case 'buy': {
      const o = c.offers[a.offer]
      if (!o) throw new Error('no such offer')
      if (o.sold) throw new Error('already bought')
      if (o.kind === 'legendary' && s.legendaries.length >= LEGENDARY_SLOTS) throw new Error(`all ${LEGENDARY_SLOTS} legendary slots are full: give one up first`)
      spend(s, o.price)
      o.sold = true
      if (o.kind === 'card') {
        const def = CARD_BY_ID.get(o.id)!
        s.drawPile.push({ id: s.nextCardId, r: def.rank, s: def.suit, kind: def.id, bonus: 0 })
        s.nextCardId += 1
        log(s, { t: 'card', era: s.era, id: o.id })
      } else if (o.kind === 'decree') {
        const label = applyDecree(s, DECREE_BY_ID.get(o.id)!.ops, a.target)
        log(s, { t: 'decree', era: s.era, id: o.id, target: label })
      } else {
        s.legendaries.push({ id: o.id as LegendaryInst['id'], counter: 0, awake: false })
        log(s, { t: 'legendary', era: s.era, id: o.id as LegendaryInst['id'], how: 'bought' })
      }
      return s
    }
    case 'reroll': {
      spend(s, rerollPrice(c, m))
      c.rerolls += 1
      c.offers = marketOffers(s, s.era, c.rerolls, m)
      return s
    }
    case 'remove': {
      const i = s.drawPile.findIndex((x) => x.id === a.card)
      if (i < 0) throw new Error('no such card in your deck')
      if (s.drawPile.length <= MIN_DECK) throw new Error(`your deck cannot be thinned below ${MIN_DECK} cards`)
      spend(s, REMOVE_PRICE)
      s.drawPile.splice(i, 1)
      return s
    }
    case 'legendary': {
      if (!c.legendaryChoice) throw new Error('no legendary is offered at this Council')
      if (a.pick !== null) {
        const id = c.legendaryChoice[a.pick]
        if (!id) throw new Error('no such legendary')
        if (s.legendaries.length >= LEGENDARY_SLOTS) {
          if (a.replace === undefined || !s.legendaries[a.replace]) throw new Error(`all ${LEGENDARY_SLOTS} legendary slots are full: choose one to give up`)
          const gone = s.legendaries.splice(a.replace, 1)[0]
          log(s, { t: 'legendary', era: s.era, id: gone.id, how: 'sold' })
        }
        s.legendaries.push({ id, counter: 0, awake: false })
        log(s, { t: 'legendary', era: s.era, id, how: 'chosen' })
      }
      c.legendaryChoice = null
      return s
    }
    case 'sell': {
      const l = s.legendaries[a.slot]
      if (!l) throw new Error('no legendary in that slot')
      s.legendaries.splice(a.slot, 1)
      s.influence += SELL_REFUND
      log(s, { t: 'legendary', era: s.era, id: l.id, how: 'sold' })
      return s
    }
    case 'leave': {
      s.council = null
      s.phase = 'play'
      startEra(s, s.era + 1)
      return s
    }
    default: throw new Error(`${a.type} is not a Council action`)
  }
}

/** The one transition function. Pure: returns a new state, or throws. */
export function applyAction(state: AscensionState, a: AscensionAction): AscensionState {
  switch (a?.type) {
    case 'play': return play(state, a.cards)
    case 'discard': checkSelection(state.hand, a.cards); return discard(state, a.cards)
    case 'face': {
      const st = runStatus(state)
      if (st !== 'playing' && st !== 'crisis') throw new Error(st === 'council' ? 'the crisis is behind you' : 'the run is over')
      return face(state)
    }
    case 'buy': case 'reroll': case 'remove': case 'legendary': case 'sell': case 'leave': return council(state, a)
    default: throw new Error(`unknown action ${JSON.stringify((a as { type?: unknown } | null)?.type)}`)
  }
}

/** Rebuild a run from its setup and actions. Throws (naming the action) on any illegal one. */
export function replay(setup: RunSetup, actions: readonly AscensionAction[]): AscensionState {
  let s = newRun(setup)
  actions.forEach((a, i) => {
    try { s = applyAction(s, a) } catch (e) { throw new Error(`action ${i + 1} (${String(a?.type)}): ${e instanceof Error ? e.message : String(e)}`) }
  })
  return s
}
