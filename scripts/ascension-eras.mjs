// ASCENSION ERAS + CRISES — diagnostic only. Fixed, written-down bots play the
// real engine over a fixed seed set; this shows how the era requirements
// (eras.ts) pace a run, how often each era's crisis (crises.ts) is survived,
// why runs fail, and where a fixed strategy gets stuck. It says nothing about
// balance or human play. Crises are resolved as soon as they strike.
//
// Run: node --import ./scripts/ts-resolve.mjs scripts/ascension-eras.mjs [seeds=30]
import { newAscensionGame, applyAscensionAction, evaluatePlay, landAffinity, runStatus, WORLD_STATS } from '../src/engine/ascension/ascension.ts'
import { ERAS, eraRequirements, canAdvance } from '../src/engine/ascension/eras.ts'
import { CRISES, evaluateCrisis } from '../src/engine/ascension/crises.ts'

const SEEDS = Array.from({ length: Number(process.argv[2] ?? 30) }, (_, i) => `era-sim-${i}`)
const ROUND_CAP = 60
const SUBSETS = [] // every 1–5 card selection of an 8-card hand, fixed order
for (let m = 1; m < 256; m++) {
  const idx = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => m & (1 << i))
  if (idx.length <= 5) SUBSETS.push(idx)
}
const byRank = (s, idxs, dir) => [...idxs].sort((a, b) => dir * (s.hand[a].r - s.hand[b].r) || a - b)
const suitOf = { H: 'vitality', D: 'prosperity', C: 'industry', S: 'knowledge' }

/** Play up to 5 focus cards (highest first) once 3+ are in hand or discards are gone; else discard up to 5 others (lowest first). */
const focus = (suits) => (s) => {
  const mine = s.hand.flatMap((c, i) => (suits.includes(c.s) ? [i] : []))
  const other = s.hand.flatMap((c, i) => (suits.includes(c.s) ? [] : [i]))
  if (mine.length >= 3 || s.discardsLeft === 0 || other.length === 0) {
    return { type: 'play', cards: mine.length ? byRank(s, mine, -1).slice(0, 5) : byRank(s, other, 1).slice(0, 1) }
  }
  return { type: 'discard', cards: byRank(s, other, 1).slice(0, 5) }
}
/** 5 cards, each time the one whose stat (current + already chosen) is lowest; ties: higher rank, then hand order. */
const balanced = (s) => {
  const chosen = [], add = { ...s.stats }
  while (chosen.length < 5) {
    const i = s.hand.map((_, j) => j).filter((j) => !chosen.includes(j))
      .sort((a, b) => add[suitOf[s.hand[a].s]] - add[suitOf[s.hand[b].s]] || s.hand[b].r - s.hand[a].r || a - b)[0]
    chosen.push(i); add[suitOf[s.hand[i].s]] += 1
  }
  return { type: 'play', cards: chosen }
}
/** The selection maximising `key` of evaluatePlay (first max in SUBSETS order). */
const best = (key) => (s) => {
  let top = null, v = -1
  for (const idx of SUBSETS) { const r = evaluatePlay(s, idx)[key]; if (r > v) { v = r; top = idx } }
  return { type: 'play', cards: top }
}
/** A focused player who reads the checklist: its main suit plus only as many
 *  other suits as the current era asks for (the most developed ones first). */
const SUIT = { vitality: 'H', prosperity: 'D', industry: 'C', knowledge: 'S' }
const adapt = (main) => (s) => {
  const m = typeof main === 'function' ? main(s) : main
  const need = ERAS[s.era].needs.stats
  const i = WORLD_STATS.findIndex((k) => SUIT[k] === m) // ties: the stats after the main one, in stat order
  const others = [1, 2, 3].map((d) => WORLD_STATS[(i + d) % 4]).sort((a, b) => s.stats[b] - s.stats[a])
  return focus([m, ...others.slice(0, need - 1).map((k) => SUIT[k])])(s)
}
/** main suit = the stat most of this world's land favours (first in stat order on ties) */
const landSuit = (s) => { const a = landAffinity(s.regions); return SUIT[WORLD_STATS.reduce((b, k) => (a[k] > a[b] ? k : b))] }
/** A player who reads the crisis forecast: balanced, but while the coming crisis
 *  would be lost (or won by < 10) it picks, card by card, whatever most improves
 *  resilience − pressure, and holds back cards that would meet the era's
 *  requirements (and so bring the crisis) before the world is ready. */
const prepared = (s) => {
  const margin = (st) => { const e = evaluateCrisis(s.era, { ...s, stats: st }); return e.resilience - e.pressure }
  const chosen = [], add = { ...s.stats }
  while (chosen.length < 5) {
    const with1 = (j) => ({ ...add, [suitOf[s.hand[j].s]]: add[suitOf[s.hand[j].s]] + 1 })
    const ready = margin(add) >= 10
    const gain = (j) => (ready ? 0 : margin(with1(j)) - (canAdvance(s.era, with1(j), s.civilizations) ? 1000 : 0))
    const i = s.hand.map((_, j) => j).filter((j) => !chosen.includes(j))
      .sort((a, b) => gain(b) - gain(a) || add[suitOf[s.hand[a].s]] - add[suitOf[s.hand[b].s]] || s.hand[b].r - s.hand[a].r || a - b)[0]
    if (chosen.length && gain(i) < -500) break // every remaining card would bring the crisis too early
    chosen.push(i); add[suitOf[s.hand[i].s]] += 1
  }
  return { type: 'play', cards: chosen }
}
const BOTS = {
  'focus-H': focus(['H']), 'focus-CS': focus(['C', 'S']),
  'adapt-H': adapt('H'), 'adapt-D': adapt('D'), 'adapt-C': adapt('C'), 'adapt-S': adapt('S'), 'adapt-land': adapt(landSuit),
  balanced, prepared, 'poker-max': best('pokerScore'), 'score-max': best('score'),
}

function run(seed, bot) {
  let s = newAscensionGame(seed)
  const atCrisis = [] // the world each time a crisis struck
  for (;;) {
    const st = runStatus(s)
    if (st === 'complete' || st === 'failed' || s.round > ROUND_CAP) return { s, atCrisis }
    if (st === 'crisis') { atCrisis.push(s); s = applyAscensionAction(s, { type: 'resolve' }) } else s = applyAscensionAction(s, bot(s))
  }
}
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[(b.length - 1) >> 1] : '-' }
const range = (a) => (a.length ? `${Math.min(...a)}/${med(a)}/${Math.max(...a)}` : '-')
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-')
const ABBR = { natureKeepers: 'NK', nomads: 'No', merchants: 'Me', empireBuilders: 'EB', scholars: 'Sc', technocrats: 'Te' }
/** why a crisis was lost: its largest non-base pressure, or the thinnest defence if none */
const reason = (o) => {
  const w = o.pressures.slice(1).filter((f) => f.amount > 0).sort((a, b) => b.amount - a.amount)[0]
  return w ? `${w.label} +${w.amount}` : 'no weakness; defences too thin'
}

console.log(`${SEEDS.length} seeds, cap ${ROUND_CAP} rounds. Era requirements (to face the crisis):`)
for (const [i, e] of ERAS.entries()) console.log(`  ${e.label.padEnd(9)} civilizations ${e.needs.civilizations}, ${e.needs.stats} stats at ${e.needs.min}+  → ${CRISES[i].label}`)
console.log('\nper crisis: faced → survived (rate); round struck min/median/max; median V/P/I/K when struck; civilizations present when struck (% of faced)')
const results = {}
for (const [name, bot] of Object.entries(BOTS)) {
  const runs = SEEDS.map((seed) => run(seed, bot))
  results[name] = runs
  const done = runs.filter((r) => runStatus(r.s) === 'complete').length
  const failed = runs.filter((r) => runStatus(r.s) === 'failed')
  const stuck = runs.filter((r) => ['playing', 'crisis'].includes(runStatus(r.s)))
  console.log(`\n${name}: complete ${done}/${runs.length} · failed ${failed.length} · stuck ${stuck.length}` +
    (stuck.length ? ` (${[...new Set(stuck.map((r) => `${ERAS[r.s.era].label}: ${eraRequirements(r.s.era, r.s.stats, r.s.civilizations).filter((q) => !q.met).map((q) => q.key).join('+')}`))].join(', ')})` : ''))
  for (const [i, c] of CRISES.entries()) {
    const faced = runs.filter((r) => r.s.crises[i])
    if (!faced.length) { console.log(`  ${c.label.padEnd(13)} never faced`); continue }
    const won = faced.filter((r) => r.s.crises[i].result === 'survived').length
    const worlds = faced.map((r) => r.atCrisis[i])
    const prof = WORLD_STATS.map((k) => med(worlds.map((w) => w.stats[k]))).join('/')
    const civs = Object.entries(ABBR).map(([a, ab]) => [ab, worlds.filter((w) => w.civilizations.some((x) => x.archetype === a)).length]).filter(([, n]) => n).map(([ab, n]) => `${ab} ${pct(n, faced.length)}`).join(' ')
    const why = {}
    for (const r of faced) if (r.s.crises[i].result === 'failed') { const k = reason(r.s.crises[i]); why[k.replace(/\+\d+/, '')] = (why[k.replace(/\+\d+/, '')] ?? 0) + 1 }
    console.log(`  ${c.label.padEnd(13)} ${String(faced.length).padStart(3)} → ${String(won).padStart(3)} (${pct(won, faced.length).padStart(4)}) round ${range(faced.map((r) => r.s.crises[i].round)).padEnd(8)} V/P/I/K ${prof.padEnd(12)} ${civs}` +
      (Object.keys(why).length ? `\n  ${''.padEnd(13)} failed by: ${Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.trim()} ×${n}`).join(', ')}` : ''))
  }
}

const trivial = Object.entries(results).filter(([, runs]) => runs.every((r) => runStatus(r.s) === 'complete')).map(([n]) => n)
const lost = SEEDS.filter((_, i) => !Object.values(results).some((runs) => runStatus(runs[i].s) === 'complete'))
console.log(`\nBots that complete every seed: ${trivial.join(', ') || 'none'}`)
console.log(`Seeds no bot completes: ${lost.length}/${SEEDS.length}${lost.length ? ` (${lost.slice(0, 8).join(', ')}${lost.length > 8 ? ', …' : ''})` : ''}`)
console.log('\nSame seed, different strategies (per crisis: S survived, F failed, - not faced):')
for (const [i, seed] of SEEDS.slice(0, 6).entries()) {
  console.log(`  ${seed.padEnd(11)} ` + Object.keys(BOTS).filter((b) => !b.startsWith('focus')).map((b) => `${b} ${CRISES.map((_, k) => results[b][i].s.crises[k]?.result[0].toUpperCase() ?? '-').join('')}`).join(' · '))
}
