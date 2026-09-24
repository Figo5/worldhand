// Ascension (rules v10) research bots — harness-only, never game code.
//
// Every bot is a pure, deterministic policy (state → action) that reads only
// what the game shows the player: the hand, previews of each play, the exact
// crisis forecast, the Council's offers. `drive` plays one run to the end.
import { applyAction, newRun, runStatus, forecast, eraEndInfluence } from '../../src/engine/ascension/ascension.ts'
import { evaluatePlay } from '../../src/engine/ascension/scoring.ts'
import { WORLD_STATS, landAffinity, STAT_SUIT } from '../../src/engine/ascension/world.ts'
import { CARD_BY_ID, DECREE_BY_ID } from '../../src/engine/ascension/content.ts'
import { LEGENDARIES } from '../../src/engine/ascension/legendaries.ts'
import { ERAS } from '../../src/engine/ascension/eras.ts'
import { FULL_POOL, STARTER_POOL } from '../../src/engine/ascension/pool.ts'
import { Rng, hashSeed } from '../../src/engine/rng.ts'
import { rerollPrice } from '../../src/engine/ascension/council.ts'
import { runMods } from '../../src/engine/ascension/rules.ts'

/** every 1–5 card selection of an 8-card hand, in a fixed order */
export const SUBSETS = []
for (let m = 1; m < 256; m++) {
  const idx = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => m & (1 << i))
  if (idx.length <= 5) SUBSETS.push(idx)
}
const FACE = { type: 'face' }
const LEAVE = { type: 'leave' }

/** The crisis margin if the world stood as after play result `r` (civilization emergence aside). */
export const marginAfter = (s, r) => {
  if (!r) return forecast(s).margin
  const stats = { ...s.stats }
  for (const k of WORLD_STATS) stats[k] = Math.max(0, stats[k] + r.statDeltas[k])
  const v = { ...s, stats, eraScore: s.eraScore + r.score, eraReserves: s.eraReserves + r.reserves, eraPressure: s.eraPressure + r.pressure }
  return forecast(v).margin
}
const plays = (s) => {
  const out = []
  for (const idx of SUBSETS) { if (idx.some((i) => i >= s.hand.length)) continue; out.push({ idx, r: evaluatePlay(s, idx) }) }
  return out
}
const best = (xs, value) => { let top = null, v = -Infinity; for (const x of xs) { const y = value(x); if (y > v) { v = y; top = x } } return top }

/** A discard that digs for a flush or pairs: keep the commonest suit and any pairs, throw up to 5 of the rest (lowest first). */
const digDiscard = (s, keepSuit) => {
  const counts = {}
  for (const c of s.hand) counts[c.s] = (counts[c.s] ?? 0) + 1
  const suit = keepSuit ?? Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
  const ranks = {}
  for (const c of s.hand) ranks[c.r] = (ranks[c.r] ?? 0) + 1
  const out = s.hand.map((c, i) => [c, i]).filter(([c]) => c.s !== suit && ranks[c.r] < 2).sort((a, b) => a[0].r - b[0].r).slice(0, 5).map(([, i]) => i)
  return out.length ? { type: 'discard', cards: out } : null
}

/** Play-phase policy from a value function over play results. Discards when the best play is weak (score below `weak`). */
const player = ({ value, faceAt = null, weak = 0, suit = null }) => (s) => {
  const opts = plays(s)
  const pick = best(opts, (o) => value(s, o.r, o.idx))
  if (faceAt !== null && s.handsLeft > 0 && forecast(s).margin >= faceAt(s)) return FACE
  if (weak && s.discardsLeft > 0 && s.handsLeft > 1 && pick.r.score < weak(s)) {
    const d = digDiscard(s, typeof suit === 'function' ? suit(s) : suit)
    if (d) return d
  }
  return { type: 'play', cards: pick.idx }
}
const eraWeak = (s) => 40 * (s.era + 1) // what a weak play scores this era

// value functions ------------------------------------------------------------
const scoreOnly = (s, r) => r.score
const statGain = (r, k) => r.statDeltas[k]
/** balanced: stat gains weighted by how far each stat trails the highest, plus a little score */
const balancedValue = (s, r) => {
  const hi = Math.max(...WORLD_STATS.map((k) => s.stats[k]))
  return WORLD_STATS.reduce((n, k) => n + r.statDeltas[k] * (1 + (hi - s.stats[k]) / 4), 0) * 100 + r.score / 10
}
/** The next era's crisis margin (as the world would stand after play result `r`, no reserves yet): the outlook the game shows. */
export const nextMarginAfter = (s, r) => {
  if (s.era + 1 >= s.crisisTrack.length) return 0
  const stats = { ...s.stats }
  for (const k of WORLD_STATS) stats[k] = Math.max(0, stats[k] + r.statDeltas[k])
  return forecast({ ...s, stats }, s.era + 1).margin
}
/** forecast-aware: first the crisis margin up to a safety cushion, then (with `ahead`) the next
 *  crisis's outlook as the tie-break of equal margins, then `then` */
const planned = (then, safe = 6, ahead = false) => (s, r, idx) => {
  const m = marginAfter(s, r)
  return Math.min(m, safe) * 1e6 + (ahead ? Math.min(nextMarginAfter(s, r), 0) * 1e3 : 0) + then(s, r, idx)
}
const focusValue = (k) => (s, r) => statGain(r, k) * 1000 + r.score / 10
/** focus on `k`, but keep its counterweight `w` within `gap` below it (strain is what kills focused worlds) */
const duoValue = (k, w, gap = 4) => (s, r) => (s.stats[w] < s.stats[k] - gap ? statGain(r, w) * 1000 + statGain(r, k) * 300 : statGain(r, k) * 1000 + statGain(r, w) * 300) + r.score / 10
const landStat = (s) => { const a = landAffinity(s.regions); return WORLD_STATS.reduce((b, k) => (a[k] > a[b] ? k : b)) }
/** face with hands to spare only near the era's end, and only with a cushion (the hands left become Influence) */
const faceWhenSafe = (cushion, within = 2) => (s) => (s.handsLeft <= within ? cushion : Infinity)
/** face the moment the crisis is survivable with a cushion, however many hands are left */
const faceAtOnce = (cushion) => () => cushion

// council policies -----------------------------------------------------------
const TAGS = {
  balanced: ['balance', 'crisis', 'civ', 'relations'],
  score: ['score', 'economy', 'small'],
  vitality: ['vitality', 'focus', 'crisis'], prosperity: ['prosperity', 'economy', 'focus'], industry: ['industry', 'focus', 'crisis'], knowledge: ['knowledge', 'focus', 'crisis'],
  terrain: ['terrain', 'crisis'], civ: ['civ', 'relations', 'economy'],
}
const LEGEND_PREF = {
  balanced: ['hydraCrown', 'philosophersStone', 'cosmicLibrary', 'sleepingGod', 'oraclesEye', 'silkRoad'],
  score: ['everflame', 'eternalDragon', 'hourglass', 'titanForge', 'sleepingGod'],
  vitality: ['worldTree', 'monolith', 'sleepingGod', 'gaiasHeart'], prosperity: ['silkRoad', 'monolith', 'sleepingGod'],
  industry: ['titanForge', 'monolith', 'sleepingGod'], knowledge: ['cosmicLibrary', 'monolith', 'sleepingGod'],
  terrain: ['gaiasHeart', 'architectMoon', 'sleepingGod'], civ: ['starseed', 'silkRoad', 'ironHeart', 'eternalDragon'],
}
/** A Council policy for a style: take a legendary, buy what fits, leave. */
export const councilPolicy = (style, { buys = true } = {}) => (s) => {
  const c = s.council
  if (c.legendaryChoice) {
    const pref = LEGEND_PREF[style] ?? []
    const i = c.legendaryChoice.map((id) => pref.indexOf(id)).map((p, i) => [p < 0 ? 99 : p, i]).sort((a, b) => a[0] - b[0])[0][1]
    if (s.legendaries.length >= 4) return { type: 'legendary', pick: null }
    return { type: 'legendary', pick: i }
  }
  if (!buys) return LEAVE
  const tags = TAGS[style] ?? []
  const want = (o) => {
    if (o.sold || o.price > s.influence) return -1
    if (o.kind === 'legendary') return s.legendaries.length < 4 ? 50 : -1
    const def = o.kind === 'card' ? CARD_BY_ID.get(o.id) : DECREE_BY_ID.get(o.id)
    const fit = def.tags.filter((t) => tags.includes(t)).length
    if (o.kind === 'decree') {
      if (def.target === 'civ' && !s.civilizations.some((x) => x.tier < 3)) return -1
      if (def.target === 'region' && regionFor(s, o.id) === null) return -1
      if (o.id === 'rally' && s.resolve >= 3) return -1
      if (o.id === 'specialize' || o.id === 'harmonize') { const v = Object.values(s.stats); if (Math.max(...v) === Math.min(...v)) return -1 }
    }
    return fit ? 10 * fit - o.price : -1
  }
  const i = c.offers.map((o, i) => [want(o), i]).sort((a, b) => b[0] - a[0])[0]
  if (i && i[0] > 0) {
    const o = c.offers[i[1]]
    const target = o.kind === 'decree' ? targetFor(s, o.id, style) : undefined
    return { type: 'buy', offer: i[1], ...(target !== undefined ? { target } : {}) }
  }
  return LEAVE
}
const regionFor = (s, id) => {
  const d = DECREE_BY_ID.get(id)
  const op = d.ops.find((o) => o.op === 'terraform')
  if (!op) return null
  const r = s.regions.find((x) => op.from.includes(x.terrain))
  return r ? r.id : null
}
const targetFor = (s, id, style) => {
  const d = DECREE_BY_ID.get(id)
  if (d.target === 'region') return regionFor(s, id)
  if (d.target === 'civ') return s.civilizations.filter((c) => c.tier < 3).sort((a, b) => b.tier - a.tier)[0].id
  if (d.target === 'suit') return STAT_SUIT[['vitality', 'prosperity', 'industry', 'knowledge'].includes(style) ? style : WORLD_STATS.reduce((a, k) => (s.stats[k] > s.stats[a] ? k : a))]
  return undefined
}
const randomCouncil = (s) => {
  const c = s.council
  const rng = new Rng(hashSeed(`rc:${s.seed}:${s.era}:${s.influence}:${c.rerolls}:${c.offers.filter((o) => o.sold).length}`))
  if (c.legendaryChoice) return { type: 'legendary', pick: s.legendaries.length >= 4 ? null : rng.int(0, c.legendaryChoice.length) }
  const afford = c.offers.map((o, i) => [o, i]).filter(([o]) => !o.sold && o.price <= s.influence && o.kind !== 'legendary')
  if (afford.length && rng.next() < 0.6) {
    const [o, i] = rng.pick(afford)
    const t = o.kind === 'decree' ? targetFor(s, o.id, 'balanced') : undefined
    if (o.kind === 'decree' && DECREE_BY_ID.get(o.id).target !== 'none' && (t === null || t === undefined)) return LEAVE
    return { type: 'buy', offer: i, ...(t !== undefined ? { target: t } : {}) }
  }
  return LEAVE
}

const randomPlay = (s) => {
  const rng = new Rng(hashSeed(`rp:${s.seed}:${s.plays}:${s.discards}:${s.era}`))
  const cards = rng.shuffle(s.hand.map((_, j) => j)).slice(0, rng.int(1, 6))
  return s.discardsLeft > 0 && rng.next() < 0.2 ? { type: 'discard', cards } : { type: 'play', cards }
}

export const BOTS = {
  'poker-max': { family: 'score', doc: 'highest score every hand; never discards; faces when the hands run out', play: player({ value: scoreOnly }), council: councilPolicy('score') },
  'poker-dig': { family: 'score', doc: 'highest score; discards to dig when the best hand is weak', play: player({ value: scoreOnly, weak: eraWeak }), council: councilPolicy('score') },
  balanced: { family: 'balanced', doc: 'raises the trailing stats; ignores the forecast', play: player({ value: balancedValue }), council: councilPolicy('balanced') },
  planner: { family: 'balanced', doc: 'reads the forecast: secures the crisis margin, then the best score; faces early when safe', play: player({ value: planned(scoreOnly, 6, true), faceAt: faceWhenSafe(4), weak: eraWeak }), council: councilPolicy('balanced') },
  hasty: { family: 'balanced', doc: 'the planner, but faces as soon as the crisis is survivable (+4), banking every hand left as Influence', play: player({ value: planned(scoreOnly), faceAt: faceAtOnce(4), weak: eraWeak }), council: councilPolicy('balanced') },
  'planner-late': { family: 'balanced', doc: 'the planner, but always spends every hand', play: player({ value: planned(scoreOnly), weak: eraWeak }), council: councilPolicy('balanced') },
  'lean-V': { family: 'focused', doc: 'forecast-aware; when safe, grows Vitality', play: player({ value: planned(focusValue('vitality'), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak, suit: 'H' }), council: councilPolicy('vitality') },
  'lean-P': { family: 'focused', doc: 'forecast-aware; when safe, grows Prosperity', play: player({ value: planned(focusValue('prosperity'), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak, suit: 'D' }), council: councilPolicy('prosperity') },
  'lean-I': { family: 'focused', doc: 'forecast-aware; when safe, grows Industry', play: player({ value: planned(focusValue('industry'), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak, suit: 'C' }), council: councilPolicy('industry') },
  'lean-K': { family: 'focused', doc: 'forecast-aware; when safe, grows Knowledge', play: player({ value: planned(focusValue('knowledge'), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak, suit: 'S' }), council: councilPolicy('knowledge') },
  'duo-IV': { family: 'focused', doc: 'forecast-aware; grows Industry while keeping Vitality within 4 of it (no forest-clearing strain)', play: player({ value: planned(duoValue('industry', 'vitality'), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak }), council: councilPolicy('industry') },
  'duo-PK': { family: 'focused', doc: 'forecast-aware; grows Prosperity while keeping Knowledge within 4 of it (no trade-outruns-medicine strain)', play: player({ value: planned(duoValue('prosperity', 'knowledge'), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak }), council: councilPolicy('prosperity') },
  'arc-I': { family: 'focused', doc: 'Industry (kept above strain) until the Information age, then rounds the world out for the final crisis', play: player({ value: planned((s, r, i) => (s.era >= 4 ? balancedValue(s, r) : duoValue('industry', 'vitality')(s, r, i)), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak }), council: councilPolicy('industry') },
  'arc-P': { family: 'focused', doc: 'Prosperity (kept above strain) until the Information age, then rounds the world out', play: player({ value: planned((s, r, i) => (s.era >= 4 ? balancedValue(s, r) : duoValue('prosperity', 'knowledge')(s, r, i)), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak }), council: councilPolicy('prosperity') },
  'arc-V': { family: 'focused', doc: 'Vitality until the Information age, then rounds the world out', play: player({ value: planned((s, r) => (s.era >= 4 ? balancedValue(s, r) : focusValue('vitality')(s, r)), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak, suit: 'H' }), council: councilPolicy('vitality') },
  'arc-K': { family: 'focused', doc: 'Knowledge until the Information age, then rounds the world out', play: player({ value: planned((s, r) => (s.era >= 4 ? balancedValue(s, r) : focusValue('knowledge')(s, r)), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak, suit: 'S' }), council: councilPolicy('knowledge') },
  'focus-I': { family: 'naive', doc: 'naive: always the most Industry, ignores the forecast', play: player({ value: focusValue('industry'), weak: eraWeak, suit: 'C' }), council: councilPolicy('industry') },
  terrain: { family: 'focused', doc: 'forecast-aware; when safe, grows the stat its land favours', play: player({ value: planned((s, r) => focusValue(landStat(s))(s, r), 6, true), faceAt: faceWhenSafe(4), weak: eraWeak }), council: councilPolicy('terrain') },
  civ: { family: 'score', doc: 'forecast-aware; when safe, maximises civilization bonuses', play: player({ value: planned((s, r) => r.lines.filter((l) => l.source === 'civ').reduce((n, l) => n + (l.chips ?? 0) + 10 * (l.mult ?? 0), 0) * 10 + r.score / 10), faceAt: faceWhenSafe(4), weak: eraWeak }), council: councilPolicy('civ') },
  mediocre: { family: 'weak', doc: 'a middling player: the balanced heuristic, a Council that buys little, no discards', play: player({ value: balancedValue }), council: councilPolicy('balanced', { buys: false }) },
  sampler: { family: 'balanced', doc: 'the planner, taking a random legendary at each choice (for unbiased legendary lift)', play: player({ value: planned(scoreOnly, 6, true), faceAt: faceWhenSafe(4), weak: eraWeak }), council: (s) => (s.council.legendaryChoice && s.legendaries.length < 4 ? { type: 'legendary', pick: new Rng(hashSeed(`lg:${s.seed}:${s.era}`)).int(0, s.council.legendaryChoice.length) } : councilPolicy('balanced')(s)) },
  'sampler-poker': { family: 'score', doc: 'poker-dig play, taking a random legendary at each choice', play: player({ value: scoreOnly, weak: eraWeak }), council: (s) => (s.council.legendaryChoice && s.legendaries.length < 4 ? { type: 'legendary', pick: new Rng(hashSeed(`lg:${s.seed}:${s.era}`)).int(0, s.council.legendaryChoice.length) } : councilPolicy('score')(s)) },
  random: { family: 'weak', doc: 'seeded random plays and discards; random Council buys', play: randomPlay, council: randomCouncil },
}

export const POOLS = { full: FULL_POOL, starter: STARTER_POOL }

/** One run. `onStep(before, action, after)` sees every transition. */
export function drive(setup, bot, onStep) {
  let s = newRun(setup)
  for (let guard = 0; guard < 2000; guard++) {
    const st = runStatus(s)
    if (st === 'won' || st === 'lost') return s
    let a
    if (st === 'crisis') a = FACE
    else if (st === 'council') a = bot.council(s)
    else a = bot.play(s)
    let next
    try { next = applyAction(s, a) } catch (e) {
      // a bot's Council choice can be illegal (e.g. a decree target); leaving is always legal
      if (st === 'council') { a = LEAVE; next = applyAction(s, a) } else throw e
    }
    onStep?.(s, a, next)
    s = next
  }
  throw new Error(`run did not end: ${setup.seedText}`)
}
export { ERAS, LEGENDARIES, rerollPrice, runMods, eraEndInfluence }
