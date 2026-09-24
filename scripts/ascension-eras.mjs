// ASCENSION ERA PACING — diagnostic only. Fixed, written-down bots play the
// real engine over a fixed seed set; this shows how the era requirements in
// eras.ts pace a run and where a fixed strategy gets stuck. It says nothing
// about balance or human play.
//
// Run: node --import ./scripts/ts-resolve.mjs scripts/ascension-eras.mjs [seeds=30]
import { newAscensionGame, applyAscensionAction, evaluatePlay, landAffinity, WORLD_STATS } from '../src/engine/ascension/ascension.ts'
import { ERAS, eraRequirements, isComplete } from '../src/engine/ascension/eras.ts'

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
const BOTS = {
  'focus-H': focus(['H']), 'focus-S': focus(['S']), 'focus-CS': focus(['C', 'S']), 'focus-HDC': focus(['H', 'D', 'C']),
  'adapt-H': adapt('H'), 'adapt-D': adapt('D'), 'adapt-C': adapt('C'), 'adapt-S': adapt('S'), 'adapt-land': adapt(landSuit),
  balanced, 'poker-max': best('pokerScore'), 'score-max': best('score'),
}

function run(seed, bot) {
  let s = newAscensionGame(seed)
  while (!isComplete(s.era) && s.round <= ROUND_CAP) s = applyAscensionAction(s, bot(s))
  return s
}
const dev = (st) => WORLD_STATS.reduce((n, k) => n + st[k], 0)
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[(b.length - 1) >> 1] : '-' }
const range = (a) => (a.length ? `${Math.min(...a)}/${med(a)}/${Math.max(...a)}` : '-')

console.log(`Era requirements (to leave; from eras.ts), ${SEEDS.length} seeds, cap ${ROUND_CAP} rounds:`)
for (const e of ERAS) console.log(`  ${e.label.padEnd(9)} civilizations ${e.needs.civilizations}, ${e.needs.stats} stats at ${e.needs.min}+`)
console.log('\nrounds = min/median/max round at which the transition happened; civs, dev = median at the transition')
const results = {}
for (const [name, bot] of Object.entries(BOTS)) {
  const runs = SEEDS.map((seed) => run(seed, bot))
  results[name] = runs
  const cols = ERAS.map((e, i) => {
    const adv = runs.map((r) => r.eraLog[i]).filter(Boolean)
    return `${e.label.slice(0, 3)}→ ${String(adv.length).padStart(2)} ${range(adv.map((a) => a.round)).padEnd(9)} civ ${med(adv.map((a) => a.civilizations))} dev ${med(adv.map((a) => dev(a.stats)))}`
  })
  const stuck = runs.filter((r) => !isComplete(r.era))
  const why = {}
  for (const r of stuck) {
    const k = `${ERAS[r.era].label}: ${eraRequirements(r.era, r.stats, r.civilizations).filter((q) => !q.met).map((q) => q.key).join('+')}`
    why[k] = (why[k] ?? 0) + 1
  }
  const prof = WORLD_STATS.map((k) => med(runs.map((r) => r.stats[k]))).join('/')
  console.log(`\n${name.padEnd(10)} ${cols.join(' | ')}`)
  console.log(`${''.padEnd(10)} complete ${runs.length - stuck.length}/${runs.length}; final V/P/I/K median ${prof}; civs median ${med(runs.map((r) => r.civilizations.length))}` +
    (stuck.length ? `; stuck at cap: ${Object.entries(why).map(([k, n]) => `${n}× ${k}`).join(', ')}` : ''))
}

console.log('\nSame bot, different worlds: round of each transition (- = not reached); adapt-land also lists its main stat and civilizations:')
for (const [i, seed] of SEEDS.slice(0, 5).entries()) {
  const at = (b) => ERAS.map((_, k) => results[b][i].eraLog[k]?.round ?? '-').join(',')
  const land = results['adapt-land'][i]
  console.log(`  ${seed.padEnd(10)} ${['adapt-H', 'adapt-D', 'adapt-C', 'adapt-S', 'balanced', 'score-max'].map((b) => `${b} ${at(b)}`).join(' · ')}`)
  console.log(`  ${''.padEnd(10)} adapt-land ${at('adapt-land')} main ${{ H: 'Vitality', D: 'Prosperity', C: 'Industry', S: 'Knowledge' }[landSuit(land)]} → ${land.civilizations.map((c) => `${c.archetype}@r${c.emergedRound}`).join(', ')}`)
}
