// Ascension research bots and rule ablations — harness-only, never game code.
//
// Every bot is a pure, deterministic policy (state → action) that only reads
// what the dev prototype shows the player. `drive` plays one run: the bot
// acts, each crisis is resolved the moment it strikes, the run stops when it
// completes, fails, or passes the round cap.
import { applyAscensionAction, evaluatePlay, landAffinity, newAscensionGame, projectRoundEnd, runStatus, TERRAIN, WORLD_STATS } from '../../src/engine/ascension/ascension.ts'
import { ARCHETYPES } from '../../src/engine/ascension/civilizations.ts'
import { CRISES } from '../../src/engine/ascension/crises.ts'
import { ERAS } from '../../src/engine/ascension/eras.ts'
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
const play = (cards) => ({ type: 'play', cards })

/** balanced: 5 cards, each time the one whose stat (current + already chosen) is lowest. */
const balanced = (s) => play(greedy(s, (j, st) => st[STAT[s.hand[j].s]]))

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

/** resilience − pressure of the current era's crisis if this round ended with stats `st` (what the UI forecast shows). */
export const crisisMargin = (s, st) => { const e = projectRoundEnd(s, st).crisis; return e.resilience - e.pressure }
/** would the era's requirements hold (and so the crisis strike) if this round ended with stats `st`? */
const wouldTrigger = (s, st) => projectRoundEnd(s, st).strikes

/** prepared (crisis-forecast-aware): balanced, but while the coming crisis would be lost or won by < 10 it picks
 *  the cards that most improve the forecast, and holds back cards that would meet the era's requirements (and so
 *  bring the crisis at this round end) before the forecast is safe; if every card would, it discards instead. */
const prepared = (s) => {
  const ready = (st) => crisisMargin(s, st) >= 10
  const risky = (j, st) => !ready(st) && wouldTrigger(s, plus(st, s.hand[j])) && crisisMargin(s, plus(st, s.hand[j])) < 5
  const key = (j, st) => (risky(j, st) ? 1e6 : 0) + (ready(st) ? st[STAT[s.hand[j].s]] : -crisisMargin(s, plus(st, s.hand[j])))
  const chosen = greedy(s, key, risky)
  if (chosen.length === 1 && risky(chosen[0], s.stats) && s.discardsLeft > 0) {
    return { type: 'discard', cards: s.hand.map((_, j) => j).filter((j) => risky(j, s.stats)).slice(0, 5) }
  }
  return play(chosen)
}
/** civ-synergy: before any civilization, balanced; then the play that earns the most from civilization passives (ties: total score). */
const civSynergy = (s) => (s.civilizations.length ? play(bestBy(s, (r) => r.civBonus * 1e4 + r.score)) : balanced(s))
/** random: a seeded random legal action (1–5 random cards; a discard 25% of the time while discards remain). */
const random = (s) => {
  const rng = new Rng(hashSeed(`random:${s.seedText}:${s.round}:${s.playsLeft}:${s.discardsLeft}:${s.score}`))
  const cards = rng.shuffle(s.hand.map((_, j) => j)).slice(0, rng.int(1, 6))
  return s.discardsLeft > 0 && rng.next() < 0.25 ? { type: 'discard', cards } : play(cards)
}

export const BOTS = {
  'poker-max': { doc: 'highest poker score (chips × mult); ignores the world', policy: (s) => play(bestBy(s, (r) => r.pokerScore)) },
  'score-max': { doc: 'highest total immediate score (poker + land + civilization passives)', policy: (s) => play(bestBy(s, (r) => r.score)) },
  balanced: { doc: '5 cards, always raising the currently lowest stat', policy: balanced },
  'terrain': { doc: 'focuses the stat its land favours most, plus what the era checklist asks for', policy: adapt(landSuit) },
  prepared: { doc: 'balanced, but reads the crisis forecast: builds what it lacks and holds back the checkpoint until safe', policy: prepared },
  'civ-synergy': { doc: 'maximises civilization passive bonuses once it has civilizations; balanced before', policy: civSynergy },
  'focus-V': { doc: 'focuses Vitality (♥) plus what the era checklist asks for', policy: adapt('H') },
  'focus-P': { doc: 'focuses Prosperity (♦) plus what the era checklist asks for', policy: adapt('D') },
  'focus-I': { doc: 'focuses Industry (♣) plus what the era checklist asks for', policy: adapt('C') },
  'focus-K': { doc: 'focuses Knowledge (♠) plus what the era checklist asks for', policy: adapt('S') },
  random: { doc: 'seeded random legal play/discard (weak baseline)', policy: random },
}

/** One run. `onStep(before, action, after)` sees every transition (for audits). */
export function drive(seedText, policy, onStep) {
  let s = newAscensionGame(seedText)
  for (;;) {
    const st = runStatus(s)
    if (st === 'complete' || st === 'failed' || s.round > ROUND_CAP) return s
    const action = st === 'crisis' ? { type: 'resolve' } : policy(s)
    const next = applyAscensionAction(s, action)
    onStep?.(s, action, next)
    s = next
  }
}

// ---------------------------------------------------------------------------
// Ablations: switch one rule off by patching the engine's data tables in this
// process only (restored afterwards). They measure what each layer contributes.
// ---------------------------------------------------------------------------
const STRAIN = new Set(['Cleared forests', 'Trade outruns medicine', 'A lopsided realm'])
const CIV_FACTORS = new Set(['Nature Keepers', 'Nomads', 'Merchants', 'Scholars', 'Allied civilizations', 'Empire Builders'])
const zeroFactors = (labels) => {
  const saved = CRISES.map((c) => c.test)
  CRISES.forEach((c, i) => {
    c.test = (w) => { const t = saved[i](w); const z = (f) => (labels.has(f.label) ? { ...f, amount: 0 } : f); return { pressures: t.pressures.map(z), mitigations: t.mitigations.map(z) } }
  })
  return () => CRISES.forEach((c, i) => { c.test = saved[i] })
}
export const ABLATIONS = {
  full: { doc: 'the game as it is', apply: () => () => {} },
  'no-terrain-bonus': {
    doc: 'land bonus is 0 (terrain still shapes homes and crises)',
    apply: () => { const saved = Object.fromEntries(Object.entries(TERRAIN).map(([t, v]) => [t, v.stat])); for (const t in TERRAIN) TERRAIN[t].stat = 'none'; return () => { for (const t in saved) TERRAIN[t].stat = saved[t] } },
  },
  'no-passives': {
    doc: 'civilization passives give 0',
    apply: () => { const saved = Object.fromEntries(Object.entries(ARCHETYPES).map(([a, v]) => [a, v.passive.bonus])); for (const a in ARCHETYPES) ARCHETYPES[a].passive.bonus = () => ({ amount: 0, detail: '' }); return () => { for (const a in saved) ARCHETYPES[a].passive.bonus = saved[a] } },
  },
  'no-strain': { doc: 'crisis strain factors are 0', apply: () => zeroFactors(STRAIN) },
  'no-civ-in-crises': { doc: 'civilizations add nothing to crises (pressure or resilience)', apply: () => zeroFactors(CIV_FACTORS) },
  'no-crises': { doc: 'every crisis is survived (pure era pacing)', apply: () => { const saved = CRISES.map((c) => c.test); CRISES.forEach((c) => { c.test = () => ({ pressures: [], mitigations: [] }) }); return () => CRISES.forEach((c, i) => { c.test = saved[i] }) } },
}
