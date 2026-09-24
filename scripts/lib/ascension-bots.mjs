// Ascension research bots, rule sets and ablations — harness-only, never game code.
//
// Every bot is a pure, deterministic policy (state → action) that only reads
// what the dev prototype shows the player. `drive` plays one run: while a
// crisis is forced the bot must face it; while one is ready the bot decides
// (naive bots face it at once); the run stops when it completes, fails, or
// passes the round cap.
import { actionCost, applyAscensionAction, crisisWorld, evaluatePlay, landAffinity, newAscensionGame, projectRoundEnd, runStatus, PLAYS_PER_ROUND, TERRAIN, WORLD_STATS } from '../../src/engine/ascension/ascension.ts'
import { ARCHETYPES } from '../../src/engine/ascension/civilizations.ts'
import { CRISES, CRISIS_RULES, evaluateCrisis } from '../../src/engine/ascension/crises.ts'
import { ERAS, ERA_BUDGET } from '../../src/engine/ascension/eras.ts'
import { Rng, hashSeed } from '../../src/engine/rng.ts'

export const ROUND_CAP = 60
/** every 1–5 card selection of an 8-card hand, in a fixed order */
export const SUBSETS = []
for (let m = 1; m < 256; m++) {
  const idx = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => m & (1 << i))
  if (idx.length <= 5) SUBSETS.push(idx)
}
const STAT = { H: 'vitality', D: 'prosperity', C: 'industry', S: 'knowledge' }
const SUIT = { vitality: 'H', prosperity: 'D', industry: 'C', knowledge: 'S' }
const byRank = (s, idxs, dir) => [...idxs].sort((a, b) => dir * (s.hand[a].r - s.hand[b].r) || a - b)
const plus = (st, card) => ({ ...st, [STAT[card.s]]: st[STAT[card.s]] + 1 })
const RESOLVE = { type: 'resolve' }
const play = (cards) => ({ type: 'play', cards })
const after = (s, r) => Object.fromEntries(WORLD_STATS.map((k) => [k, s.stats[k] + r.statDeltas[k]]))

/** Up to 5 cards picked one at a time, always the one with the lowest `key` (ties: higher rank, then hand order). */
const greedy = (s, key, stop = () => false) => {
  const chosen = []
  let st = { ...s.stats }
  while (chosen.length < 5) {
    const left = s.hand.map((_, j) => j).filter((j) => !chosen.includes(j))
    const i = left.sort((a, b) => key(a, st) - key(b, st) || s.hand[b].r - s.hand[a].r || a - b)[0]
    if (chosen.length && stop(i, st)) break
    chosen.push(i)
    st = plus(st, s.hand[i])
  }
  return chosen
}
/** The selection with the highest value (first in SUBSETS order on ties). */
const bestBy = (s, value) => {
  let top = SUBSETS[0], v = -Infinity
  for (const idx of SUBSETS) { const x = value(evaluatePlay(s, idx), idx); if (x > v) { v = x; top = idx } }
  return top
}
/** A naive player: faces a ready crisis the moment it can. */
const facesAtOnce = (policy) => (s) => (runStatus(s) === 'ready' ? RESOLVE : policy(s))

/** balanced: 5 cards, each time the one whose stat (current + already chosen) is lowest. */
const balancedPlay = (s) => play(greedy(s, (j, st) => st[STAT[s.hand[j].s]]))

/** focus(suits): play up to 5 cards of these suits (highest first) once 3+ are in hand or discards are gone; else discard up to 5 others. */
const focus = (suits) => (s) => {
  const mine = s.hand.flatMap((c, i) => (suits.includes(c.s) ? [i] : []))
  const other = s.hand.flatMap((c, i) => (suits.includes(c.s) ? [] : [i]))
  if (mine.length >= 3 || s.discardsLeft === 0 || other.length === 0) return play(mine.length ? byRank(s, mine, -1).slice(0, 5) : byRank(s, other, 1).slice(0, 1))
  return { type: 'discard', cards: byRank(s, other, 1).slice(0, 5) }
}
/** adapt(main): focus a main suit plus only as many other suits as the current era's checklist asks for (most developed first). */
const adapt = (main) => (s) => {
  const m = typeof main === 'function' ? main(s) : main
  const i = WORLD_STATS.findIndex((k) => SUIT[k] === m)
  const others = [1, 2, 3].map((d) => WORLD_STATS[(i + d) % 4]).sort((a, b) => s.stats[b] - s.stats[a])
  return focus([m, ...others.slice(0, ERAS[s.era].needs.stats - 1).map((k) => SUIT[k])])(s)
}
/** the suit of the stat most of this world's land favours */
const landSuit = (s) => { const a = landAffinity(s.regions); return SUIT[WORLD_STATS.reduce((b, k) => (a[k] > a[b] ? k : b))] }

// --- forecast-aware players --------------------------------------------------
const margin = (e) => e.resilience - e.pressure
/** the crisis margin if this round ended with stats `st` (what the UI's "if this round ended now" shows) */
export const roundEndMargin = (s, st, score = s.score) => margin(projectRoundEnd(s, st, score).crisis)
/** the crisis margin if faced right now with stats `st` (what the UI shows once it is ready) */
export const faceMargin = (s, st = s.stats, score = s.score) => margin(evaluateCrisis(s.era, crisisWorld(s, st, score)))
/** the margin that matters for the next decision: once ready, facing now; before, facing at this round end */
export const outlook = (s, st = s.stats, score = s.score) => (s.crisis ? faceMargin(s, st, score) : roundEndMargin(s, st, score))
const SAFE = 10
/** Plays this era can still afford (Infinity without a budget; cards ≈ 5 per play). */
export const playsLeftInEra = (s) => {
  const { unit } = ERA_BUDGET
  if (unit === 'none') return Infinity
  if (unit === 'cards') return s.budget / 5
  if (unit === 'rounds') return (s.budget - 1) * PLAYS_PER_ROUND + s.playsLeft
  return s.budget
}
/** stat points still needed to meet the era's requirements (development shortfall included) */
const shortfall = (s, st = s.stats) => {
  const { stats: n, min, development = 0 } = ERAS[s.era].needs
  const gaps = WORLD_STATS.map((k) => Math.max(0, min - st[k])).sort((a, b) => a - b).slice(0, n).reduce((a, b) => a + b, 0)
  return Math.max(gaps, development - WORLD_STATS.reduce((a, k) => a + st[k], 0))
}
/** the budget left is only just enough to meet the requirements: stop holding back, build them first */
const hurried = (s) => !s.crisis && playsLeftInEra(s) <= Math.ceil(shortfall(s) / 4) + 1
/** requirement-first preference: cards that close the requirement gap (the stat nearest its minimum first) */
const needsFirst = (s, j, st) => {
  const k = STAT[s.hand[j].s], { min } = ERAS[s.era].needs
  return st[k] < min ? min - st[k] : 1000 + st[k]
}
/** Face a ready crisis once it would be survived; otherwise keep building (it strikes on its own at the deadline). */
const facesWhenSafe = (build) => (s) => (runStatus(s) === 'ready' && faceMargin(s) >= 0 ? RESOLVE : build(s))

/** Card-by-card builder: while the outlook is < +10 it picks the cards that most improve it, and holds back cards that
 *  would make the crisis ready at this round end before the outlook is safe (if every card would, it discards);
 *  once safe, it follows `prefer`. */
const forecastBuild = (prefer, safeAt = SAFE) => (s) => {
  if (hurried(s)) return play(greedy(s, (j, st) => needsFirst(s, j, st)))
  const safe = (st) => outlook(s, st) >= safeAt
  const risky = (j, st) => !s.crisis && !safe(st) && projectRoundEnd(s, plus(st, s.hand[j])).ready && roundEndMargin(s, plus(st, s.hand[j])) < 5
  const key = (j, st) => (risky(j, st) ? 1e6 : 0) + (safe(st) ? prefer(s, j, st) : -outlook(s, plus(st, s.hand[j])))
  const chosen = greedy(s, key, risky)
  if (chosen.length === 1 && risky(chosen[0], s.stats) && s.discardsLeft > 0) {
    return { type: 'discard', cards: s.hand.map((_, j) => j).filter((j) => risky(j, s.stats)).slice(0, 5) }
  }
  return play(chosen)
}
/** balanced preference: raise the lowest stat */
const lowestFirst = (s, j, st) => st[STAT[s.hand[j].s]]
/** lean(main): a focused player who reads the forecast. While the crisis outlook is < +5 it prepares like `prepared`;
 *  otherwise it plays only its main suit plus the suits the era checklist still needs (up to 5 cards, highest first),
 *  discarding the rest to dig for them; with nothing wanted and no discards left, one card of its lowest other stat. */
const lean = (main) => (s) => {
  if (outlook(s) < 5 || hurried(s)) return forecastBuild(lowestFirst)(s)
  const { stats: n, min, development = 0 } = ERAS[s.era].needs
  const have = WORLD_STATS.filter((x) => s.stats[x] >= min).length
  const total = WORLD_STATS.reduce((a, x) => a + s.stats[x], 0)
  const wanted = (k) => k === main || (have < n && s.stats[k] < min) || (have >= n && total < development && k === main)
  const mine = s.hand.flatMap((c, i) => (wanted(STAT[c.s]) ? [i] : []))
  const other = s.hand.flatMap((c, i) => (wanted(STAT[c.s]) ? [] : [i]))
  if (mine.length >= 3 || (mine.length && s.discardsLeft === 0) || !other.length) return play(mine.length ? byRank(s, mine, -1).slice(0, 5) : [other.sort((a, b) => s.stats[STAT[s.hand[a].s]] - s.stats[STAT[s.hand[b].s]] || a - b)[0]])
  if (s.discardsLeft > 0) return { type: 'discard', cards: byRank(s, other, 1).slice(0, 5) }
  return play([other.sort((a, b) => s.stats[STAT[s.hand[a].s]] - s.stats[STAT[s.hand[b].s]] || a - b)[0]])
}
/** resolute: prepared, but while the crisis outlook is < +5 it plays ONLY the suit that most improves it (fewer, better
 *  cards: every card adds development, and development can draw raiders), discarding the rest to dig for that suit. */
const resolute = (s) => {
  if (outlook(s) >= 5 || hurried(s)) return forecastBuild(lowestFirst)(s)
  const gain = (suit) => outlook(s, { ...s.stats, [STAT[suit]]: s.stats[STAT[suit]] + 1 })
  const suit = ['H', 'D', 'C', 'S'].sort((a, b) => gain(b) - gain(a))[0]
  const mine = s.hand.flatMap((c, i) => (c.s === suit ? [i] : []))
  if (mine.length >= 2 || (mine.length && !s.discardsLeft)) return play(byRank(s, mine, -1).slice(0, 5))
  if (s.discardsLeft) return { type: 'discard', cards: s.hand.flatMap((c, i) => (c.s === suit ? [] : [i])).slice(0, 5) }
  return forecastBuild(lowestFirst)(s)
}
/** planner: among all 218 plays, while the outlook is < +10 the play that most improves it (reserves included, so a
 *  strong poker hand can be the best preparation), never making the crisis ready early; once safe, the highest score. */
const plannerBuild = (s) => {
  if (hurried(s)) return play(greedy(s, (j, st) => needsFirst(s, j, st)))
  if (outlook(s) >= SAFE) return play(bestBy(s, (r) => r.score))
  return play(bestBy(s, (r) => {
    const st = after(s, r), sc = s.score + r.score
    const early = !s.crisis && s.playsLeft === 1 && projectRoundEnd(s, st, sc).ready && roundEndMargin(s, st, sc) < 5
    return (early ? -1e6 : 0) + outlook(s, st, sc) * 1e4 + r.score
  }))
}
/** thrifty: the planner, but judging every play per unit of era budget it costs (under a card budget a strong pair can
 *  beat five weak cards); while hurried it builds the requirements first. */
const thriftyBuild = (s) => {
  if (hurried(s)) return play(greedy(s, (j, st) => needsFirst(s, j, st)))
  const per = (r, idx) => Math.max(1, actionCost({ type: 'play', cards: idx }))
  if (outlook(s) >= SAFE) return play(bestBy(s, (r, idx) => r.score / per(r, idx)))
  const now = outlook(s)
  return play(bestBy(s, (r, idx) => {
    const st = after(s, r), sc = s.score + r.score
    const early = !s.crisis && s.playsLeft === 1 && projectRoundEnd(s, st, sc).ready && roundEndMargin(s, st, sc) < 5
    return (early ? -1e6 : 0) + ((outlook(s, st, sc) - now) * 1e4 + r.score) / per(r, idx)
  }))
}
const civSynergy = (s) => (s.civilizations.length ? play(bestBy(s, (r) => r.civBonus * 1e4 + r.score)) : balancedPlay(s))
const random = (s) => {
  const rng = new Rng(hashSeed(`random:${s.seedText}:${s.round}:${s.playsLeft}:${s.discardsLeft}:${s.score}`))
  const cards = rng.shuffle(s.hand.map((_, j) => j)).slice(0, rng.int(1, 6))
  return s.discardsLeft > 0 && rng.next() < 0.25 ? { type: 'discard', cards } : play(cards)
}

export const BOTS = {
  'poker-max': { family: 'score', doc: 'highest poker score (chips × mult); ignores the world; faces crises at once', policy: facesAtOnce((s) => play(bestBy(s, (r) => r.pokerScore))) },
  'score-max': { family: 'score', doc: 'highest total immediate score; faces crises at once', policy: facesAtOnce((s) => play(bestBy(s, (r) => r.score))) },
  balanced: { family: 'balanced', doc: '5 cards, always raising the lowest stat; faces crises at once', policy: facesAtOnce(balancedPlay) },
  terrain: { family: 'focused', doc: 'focuses the stat its land favours most, plus what the era checklist asks for; faces at once', policy: facesAtOnce(adapt(landSuit)) },
  'civ-synergy': { family: 'score', doc: 'maximises civilization passives once it has civilizations (balanced before); faces at once', policy: facesAtOnce(civSynergy) },
  'focus-V': { family: 'focused', doc: 'naive: Vitality plus what the checklist asks for; faces at once', policy: facesAtOnce(adapt('H')) },
  'focus-P': { family: 'focused', doc: 'naive: Prosperity plus what the checklist asks for; faces at once', policy: facesAtOnce(adapt('D')) },
  'focus-I': { family: 'focused', doc: 'naive: Industry plus what the checklist asks for; faces at once', policy: facesAtOnce(adapt('C')) },
  'focus-K': { family: 'focused', doc: 'naive: Knowledge plus what the checklist asks for; faces at once', policy: facesAtOnce(adapt('S')) },
  random: { family: 'weak', doc: 'seeded random legal play/discard; faces at once', policy: facesAtOnce(random) },
  patient: { family: 'balanced', doc: 'balanced play, but faces a ready crisis only once it would survive (or when it strikes)', policy: facesWhenSafe(balancedPlay) },
  prepared: { family: 'balanced', doc: 'balanced + reads the forecast: fixes what it lacks, holds back the checkpoint, faces when it would survive', policy: facesWhenSafe(forecastBuild(lowestFirst)) },
  resolute: { family: 'balanced', doc: 'reads the forecast; while short, plays only the suit that most improves it (discarding the rest); otherwise like prepared', policy: facesWhenSafe(resolute) },
  planner: { family: 'score', doc: 'reads the forecast (reserves included): prepares with the best-margin play, otherwise the best score; faces when it would survive', policy: facesWhenSafe(plannerBuild) },
  thrifty: { family: 'score', doc: 'the planner, judging each play per unit of era budget it costs (hand size can matter)', policy: facesWhenSafe(thriftyBuild) },
  'lean-V': { family: 'focused', doc: 'reads the forecast; when safe plays only Vitality (then what the checklist needs)', policy: facesWhenSafe(lean('vitality')) },
  'lean-P': { family: 'focused', doc: 'reads the forecast; when safe plays only Prosperity (then what the checklist needs)', policy: facesWhenSafe(lean('prosperity')) },
  'lean-I': { family: 'focused', doc: 'reads the forecast; when safe plays only Industry (then what the checklist needs)', policy: facesWhenSafe(lean('industry')) },
  'lean-K': { family: 'focused', doc: 'reads the forecast; when safe plays only Knowledge (then what the checklist needs)', policy: facesWhenSafe(lean('knowledge')) },
}

/** One run. `onStep(before, action, after)` sees every transition (for audits). */
export function drive(seedText, policy, onStep) {
  let s = newAscensionGame(seedText)
  for (;;) {
    const st = runStatus(s)
    if (st === 'complete' || st === 'failed' || s.round > ROUND_CAP) return s
    let action = st === 'crisis' ? RESOLVE : policy(s)
    // a budget can make an action unaffordable: play what it allows (never more than the budget)
    if (ERA_BUDGET.unit !== 'none' && actionCost(action) > s.budget) action = action.type === 'play' ? play(action.cards.slice(0, Math.max(1, s.budget))) : play([0])
    const next = applyAscensionAction(s, action)
    onStep?.(s, action, next)
    s = next
  }
}

// ---------------------------------------------------------------------------
// Rule sets and ablations: patch the engine's data tables in this process only
// (restored afterwards). A rule set is a whole design; an ablation switches one
// layer off on top of it.
// ---------------------------------------------------------------------------
export const patch = (obj, values) => { const saved = Object.fromEntries(Object.keys(values).map((k) => [k, obj[k]])); Object.assign(obj, values); return () => Object.assign(obj, saved) }
export const compose = (...fs) => () => { const undo = fs.map((f) => f()); return () => undo.reverse().forEach((u) => u()) }
const lands = (w, ts) => w.regions.filter((r) => ts.includes(r.terrain)).length
/** the rules-v7 Invasion: 50 + 2/open + (highest − lowest stat) vs Industry + 5/civ + 3/mountain + 10 Empire Builders */
export const invasionV7 = (w) => {
  const v = Object.values(w.stats), hi = Math.max(...v), lo = Math.min(...v)
  const eb = w.civilizations.some((c) => c.archetype === 'empireBuilders')
  return {
    pressures: [{ label: 'The invasion', amount: 50, detail: 'base' }, { label: 'Open land', amount: 2 * lands(w, ['plains', 'desert', 'coast']), detail: '' }, { label: 'A lopsided realm', amount: hi - lo, detail: '' }],
    mitigations: [{ label: 'Arms and walls', amount: w.stats.industry, detail: '' }, { label: 'Allied civilizations', amount: 5 * w.civilizations.length, detail: '' }, { label: 'Mountain passes', amount: 3 * lands(w, ['mountains']), detail: '' }, { label: 'Empire Builders', amount: eb ? 10 : 0, detail: '' }],
  }
}
export const withInvasion = (test) => () => { const saved = CRISES[2].test; CRISES[2].test = test; return () => { CRISES[2].test = saved } }
export const withMedieval = (needs) => () => patch(ERAS[2].needs, needs)
/** a crisis with a different base pressure (its first factor) */
export const withBase = (era, amount) => () => { const saved = CRISES[era].test; CRISES[era].test = (w) => { const t = saved(w); return { ...t, pressures: [{ ...t.pressures[0], amount }, ...t.pressures.slice(1)] } }; return () => { CRISES[era].test = saved } }
export const withRules = (values) => () => patch(CRISIS_RULES, values)
/** an era budget; with one, the waiting cost and grace are off (the budget is the deadline) */
export const withBudget = (budget) => compose(() => patch(ERA_BUDGET, { unit: 'none', perEra: [0, 0, 0], discardCost: 0, carryOver: false, ...budget }), budget.unit === 'none' ? withRules({ gatherPerRound: 4, graceRounds: 2 }) : withRules({ gatherPerRound: 0 }))

/** experiment: forests also defend against the Invasion (+k per forest region) */
export const withForestCover = (k) => () => { const saved = CRISES[2].test; CRISES[2].test = (w) => { const t = saved(w); const f = w.regions.filter((r) => r.terrain === 'forest').length; return { ...t, mitigations: [...t.mitigations, { label: 'Forest cover', amount: k * f, detail: '' }] } }; return () => { CRISES[2].test = saved } }
/** experiment: the Invasion with its terrain weights as parameters (base, per open region, per mountain, per forest) */
export const invasionShape = ({ base, open, mountain, forest }) => (w) => {
  const dev = Object.values(w.stats).reduce((a, b) => a + b, 0), n = (ts) => lands(w, ts)
  const eb = w.civilizations.some((c) => c.archetype === 'empireBuilders')
  return {
    pressures: [{ label: 'The invasion', amount: base, detail: '' }, { label: 'Open land', amount: open * n(['plains', 'desert', 'coast']), detail: '' },
      { label: 'Riches to plunder', amount: Math.floor(dev / 4), detail: '' }, { label: 'Undefended wealth', amount: Math.max(0, w.stats.prosperity - w.stats.industry), detail: '' }],
    mitigations: [{ label: 'Arms and walls', amount: w.stats.industry, detail: '' }, { label: 'Allied civilizations', amount: 5 * w.civilizations.length, detail: '' },
      { label: 'Mountain passes', amount: mountain * n(['mountains']), detail: '' }, { label: 'Forest cover', amount: forest * n(['forest']), detail: '' }, { label: 'Empire Builders', amount: eb ? 10 : 0, detail: '' }],
  }
}
const K70 = withBudget({ unit: 'cards', perEra: [70, 70, 90], discardCost: 2, carryOver: true })
/** the v8 Invasion (40 + 2/open, no forest cover): what the scarcity candidates were measured with */
const V8_INVASION = withInvasion(invasionShape({ base: 40, open: 2, mountain: 3, forest: 0 }))
export const RULESETS = {
  v7: {
    doc: 'rules v7 (before): crises strike at once, no reserves, Plague base 30, lopsided-realm Invasion, Medieval all 4 stats at 50',
    apply: compose(withBudget({ unit: 'none' }), withRules({ graceRounds: 0, reserveRate: Infinity, gatherPerRound: 0 }), withBase(1, 30), withInvasion(invasionV7), withMedieval({ stats: 4, min: 50, development: undefined })),
  },
  v8: { doc: 'rules v8: ready crises (+4 per round waited, strike after 2), no era budget, Invasion 40 + 2/open, no forest cover', apply: compose(withBudget({ unit: 'none' }), V8_INVASION) },
  v9: { doc: 'rules v9 (as shipped): 70/70/90 cards per era (a card played costs 1, a discard 2, unspent carry over); Invasion 43 + 1/open, forests +2 each', apply: () => () => {} },
  // scarcity candidates: v8 (its Invasion included) plus an era budget, which replaces the waiting cost and the 2-round grace
  'A-plays': { doc: 'A: 16/16/20 plays per era (discards free), unspent plays carry over', apply: compose(V8_INVASION, withBudget({ unit: 'plays', perEra: [16, 16, 20], discardCost: 0, carryOver: true })) },
  'B-actions': { doc: 'B: 18/18/22 actions per era (a play or a discard costs 1), carry over', apply: compose(V8_INVASION, withBudget({ unit: 'actions', perEra: [18, 18, 22], discardCost: 1, carryOver: true })) },
  'C-clock': { doc: 'C: 4/4/5 rounds per era from its start, carry over', apply: compose(V8_INVASION, withBudget({ unit: 'rounds', perEra: [4, 4, 5], discardCost: 0, carryOver: true })) },
  'D-upkeep': { doc: 'D: v8, but every round of an era costs 150 of its score before the rest becomes Reserves', apply: compose(withBudget({ unit: 'none' }), V8_INVASION, withRules({ upkeep: 150 })) },
  'K-cards-65': { doc: 'cards: 65/65/85 cards per era (each card played costs 1, a discard costs 1), carry over', apply: compose(V8_INVASION, withBudget({ unit: 'cards', perEra: [65, 65, 85], discardCost: 1, carryOver: true })) },
  'K-cards-70': { doc: 'cards: 70/70/90 cards per era (each card played costs 1, a discard costs 2), carry over', apply: compose(V8_INVASION, withBudget({ unit: 'cards', perEra: [70, 70, 90], discardCost: 2, carryOver: true })) },
  'B+forest2': { doc: 'B with forests defending the Invasion (+2 each)', apply: compose(V8_INVASION, withBudget({ unit: 'actions', perEra: [18, 18, 22], discardCost: 1, carryOver: true }), withForestCover(2)) },
  'K70+forest2': { doc: 'cards-70 with forests defending the Invasion (+2 each)', apply: compose(V8_INVASION, withBudget({ unit: 'cards', perEra: [70, 70, 90], discardCost: 2, carryOver: true }), withForestCover(2)) },
  'v9-65': { doc: 'v9 with 65/65/85 cards per era', apply: withBudget({ unit: 'cards', perEra: [65, 65, 85], discardCost: 2, carryOver: true }) },
  'v9-67': { doc: 'v9 with 67/67/87 cards per era', apply: withBudget({ unit: 'cards', perEra: [67, 67, 87], discardCost: 2, carryOver: true }) },
  'K70-X2': { doc: 'cards-70 with the v9 Invasion shape but base 40 (open 1 / mountain 3 / forest 2)', apply: compose(K70, withInvasion(invasionShape({ base: 40, open: 1, mountain: 3, forest: 2 }))) },
}

const STRAIN = new Set(['Cleared forests', 'Trade outruns medicine', 'A lopsided realm', 'Undefended wealth'])
const CIV_FACTORS = new Set(['Nature Keepers', 'Nomads', 'Merchants', 'Scholars', 'Allied civilizations', 'Empire Builders'])
const zeroFactors = (labels) => {
  const saved = CRISES.map((c) => c.test)
  CRISES.forEach((c, i) => {
    c.test = (w) => { const t = saved[i](w); const z = (f) => (labels.has(f.label) ? { ...f, amount: 0 } : f); return { pressures: t.pressures.map(z), mitigations: t.mitigations.map(z) } }
  })
  return () => CRISES.forEach((c, i) => { c.test = saved[i] })
}
export const ABLATIONS = {
  full: { doc: 'the rule set as it is', apply: () => () => {} },
  'no-terrain-bonus': {
    doc: 'land bonus is 0 (terrain still shapes homes and crises)',
    apply: () => { const saved = Object.fromEntries(Object.entries(TERRAIN).map(([t, v]) => [t, v.stat])); for (const t in TERRAIN) TERRAIN[t].stat = 'none'; return () => { for (const t in saved) TERRAIN[t].stat = saved[t] } },
  },
  'no-passives': {
    doc: 'civilization passives give 0',
    apply: () => { const saved = Object.fromEntries(Object.entries(ARCHETYPES).map(([a, v]) => [a, v.passive.bonus])); for (const a in ARCHETYPES) ARCHETYPES[a].passive.bonus = () => ({ amount: 0, detail: '' }); return () => { for (const a in saved) ARCHETYPES[a].passive.bonus = saved[a] } },
  },
  'no-reserves': { doc: 'score gives no reserves', apply: withRules({ reserveRate: Infinity }) },
  'no-strain': { doc: 'crisis strain factors are 0', apply: () => zeroFactors(STRAIN) },
  'no-civ-in-crises': { doc: 'civilizations add nothing to crises', apply: () => zeroFactors(CIV_FACTORS) },
}
