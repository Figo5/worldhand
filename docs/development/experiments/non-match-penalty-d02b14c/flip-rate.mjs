// FLIP-RATE — the permanent counterfactual acceptance metric for
// "the world affects poker choices" (added in the non-match-penalty pass).
//
// DEFINITION (measured at every play of a run):
//   1. pick the argmax selection WITH specializations ON (regions as they are);
//   2. re-pick on a CLONE of the same state with EVERY region's
//      `specialization` nulled to null (dormant/awake flags untouched);
//   3. record whether the chosen selection differs (FLIP) or not.
// The flip-rate is flips / plays. Two conditions are measured over the SAME
// seed set (the disjoint eval-* evaluation set, eval-0..29 — the same set
// scripts/solve.mjs reports on; documented bar: >=30 seeds, >=300 plays — the
// default run is 30 seeds x 12 plays = 360 plays per condition):
//   (a) AS-SHIPPED: Pair awake (Auralia), TwoPair + Flush dormant;
//   (b) ALL THREE AWAKE: Auralia + Pellucid + Vantage (dev grows as shipped).
// Every plan is scored by the engine's ONE shared buildPlan pipeline; the
// counterfactual only nulls `specialization` fields — nothing else.
//
// This is NOT a human win-rate or a strategy-quality measure: it measures how
// often the regional layer is the deciding factor in a selection.
//
// Usage: npx vite-node scripts/flip-rate.mjs [--seeds N] [--plays N] [--json]
//   --seeds N   seeds to play from the eval-* set (default 30)
//   --plays N   plays per seed (default 12 = the full 3-epoch run)
//   --json      machine-readable output
import { newGame, applyAction, buildPlan, TOTAL_EPOCHS } from '../src/engine/worldhand.ts'

// The disjoint EVALUATION seed set (never the probe-* calibration set).
const EVAL_SEEDS = Array.from({ length: 30 }, (_, i) => `eval-${i}`)

/** Greedy argmax over every legal 1..5-card selection of the current hand,
 *  scored by the engine's buildPlan against the given region list.
 *  Deterministic tie-break on the selection key for reproducibility. */
function argmaxSelection(state, regions) {
  const hand = state.hand
  const n = hand.length
  let best = null
  for (let m = 1; m < (1 << n); m++) {
    const sel = []
    for (let i = 0; i < n; i++) if (m & (1 << i)) sel.push(i)
    if (sel.length > 5) continue
    let plan
    try {
      plan = buildPlan(hand, sel, state.laws, state.seeds, regions)
    } catch {
      continue
    }
    if (!plan.valid) continue
    const key = sel.join(',')
    if (!best || plan.growth > best.growth || (plan.growth === best.growth && key < best.key)) {
      best = { sel: key, growth: plan.growth, selIdxs: sel }
    }
  }
  return best
}

function cloneWithRegions(state, mutate) {
  // structural clone (adjacency deep-copied) + a region mutation hook
  const regions = state.regions.map((r) => ({ ...r, adjacency: [...r.adjacency] }))
  mutate(regions)
  return { ...state, regions }
}

/** Play the FULL run of each seed under a condition, argmax-driving every
 *  play (no discards, no buys — pure selection), and count flips. */
function runCondition(seedText, awakeIds, playsPerSeed) {
  let s = newGame(seedText)
  s = { ...s, regions: s.regions.map((r) => (awakeIds.has(r.id) ? { ...r, dormant: false } : r)) }
  let plays = 0
  let flips = 0
  let guard = 0
  while (s.phase !== 'game-over' && guard++ < 400 && plays < playsPerSeed) {
    if (s.phase === 'market') { s = applyAction(s, { type: 'endMarket' }); continue }
    if (s.phase === 'epoch-end') { s = applyAction(s, { type: 'closeEpoch' }); continue }
    if (s.phase !== 'select' || s.playsLeft <= 0) break
    // 1. argmax WITH specializations on
    const best = argmaxSelection(s, s.regions)
    if (!best) break
    // 2. counterfactual re-pick on a CLONE with every specialization nulled
    const cf = cloneWithRegions(s, (rs) => { for (const r of rs) r.specialization = null })
    const bestCf = argmaxSelection(cf, cf.regions)
    plays += 1
    if (!bestCf || bestCf.sel !== best.sel) flips += 1
    // commit the on-play choice and continue the run
    let t = s
    for (const i of best.selIdxs) t = applyAction(t, { type: 'toggleCard', cardIdx: i })
    s = applyAction(t, { type: 'play' })
  }
  return { plays, flips }
}

/** The two documented conditions over the SAME seed set. */
export function measureFlipRate(seedTexts, playsPerSeed = 12) {
  const conds = [
    ['shipped', new Set([0])],      // Auralia (pair) awake — as shipped
    ['all3', new Set([0, 6, 11])],  // Auralia + Pellucid + Vantage — all awake
  ]
  const stats = {}
  for (const [key, awakeIds] of conds) {
    let plays = 0
    let flips = 0
    for (const seed of seedTexts) {
      const r = runCondition(seed, awakeIds, playsPerSeed)
      plays += r.plays
      flips += r.flips
    }
    stats[key] = { plays, flips, rate: plays === 0 ? 0 : flips / plays }
  }
  return stats
}

// ---- CLI -------------------------------------------------------------------
// (Top-level execution, matching scripts/solve.mjs's convention. The
// measureFlipRate export above remains available to tests/probes.)
const rawArgs = process.argv.slice(2)
let nSeeds = 30
let playsPerSeed = 12
let jsonOut = false
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--seeds') { nSeeds = Number(rawArgs[i + 1]); i++; continue }
  if (rawArgs[i].startsWith('--seeds=')) { nSeeds = Number(rawArgs[i].slice(8)); continue }
  if (rawArgs[i] === '--plays') { playsPerSeed = Number(rawArgs[i + 1]); i++; continue }
  if (rawArgs[i].startsWith('--plays=')) { playsPerSeed = Number(rawArgs[i].slice(8)); continue }
  if (rawArgs[i] === '--json') { jsonOut = true; continue }
}
if (!Number.isFinite(nSeeds) || nSeeds < 1 || nSeeds > EVAL_SEEDS.length) nSeeds = EVAL_SEEDS.length
if (!Number.isFinite(playsPerSeed) || playsPerSeed < 1 || playsPerSeed > 12) playsPerSeed = 12
const seedTexts = EVAL_SEEDS.slice(0, nSeeds)
const stats = measureFlipRate(seedTexts, playsPerSeed)
const pct = (s) => (100 * s.rate).toFixed(1) + '%'
if (jsonOut) {
  console.log(JSON.stringify({
    metric: 'flip-rate',
    seedSet: `${seedTexts[0]}..${seedTexts[seedTexts.length - 1]}`,
    seeds: seedTexts.length,
    playsPerSeed,
    shipped: stats.shipped,
    all3: stats.all3,
  }))
} else {
  console.log('FLIP-RATE — counterfactual: argmax selection with specializations ON')
  console.log('vs a re-pick on a clone with every region\'s specialization nulled.')
  console.log(`seed set: ${seedTexts[0]}..${seedTexts[seedTexts.length - 1]} (${seedTexts.length} seeds, eval-* evaluation set) x ${playsPerSeed} plays/seed`)
  console.log(`(a) as-shipped (Pair awake; TwoPair+Flush dormant): ${stats.shipped.flips}/${stats.shipped.plays} = ${pct(stats.shipped)}`)
  console.log(`(b) all-three-awake:                                ${stats.all3.flips}/${stats.all3.plays} = ${pct(stats.all3)}`)
}