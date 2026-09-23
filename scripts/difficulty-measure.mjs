// DIFFICULTY MEASUREMENT — three FROZEN policies over two DISJOINT seed sets.
//
// This is a bounded-solver measurement, NOT a human win-rate estimate. It says
// how far a fixed, written-down strategy gets before the blinds outrun it.
//
// The three policies are declared here once and are not re-tuned per run. If a
// balance constant changes, the SAME policies are re-run and both seed sets are
// re-reported — the held-out set is never used to pick a constant.
//
//   P0 "no-shop"    greedy best play, buys NOTHING. The floor: how far raw
//                   poker alone reaches. If this survives deep, the game has no
//                   economy pressure at all.
//   P1 "scattered"  greedy best play + a CARELESS shop: each step, buy a
//                   uniformly random affordable option. A player clicking
//                   things because they are there. Seeded, so it reproduces.
//   P2 "cheapest"   greedy best play + buy the cheapest affordable thing of
//                   each kind in a fixed order. Naive but not stupid: cheap
//                   jokers happen to target common hands.
//   P3 "focused"    greedy best play biased toward ONE chosen hand category,
//                   plus a shop that prioritises pieces matching it, then
//                   spends the remainder. The committed build.
//   P4 "weak play"  the cheapest-first shop, but NO poker skill: always plays
//                   the single highest card in hand. Isolates play quality
//                   from shop quality — P4 vs P2 is worth exactly the poker.
//
// Shared, frozen play rule for all three: pick the highest-Growth legal
// selection; if it cannot keep pace with the target and a discard remains,
// dump the cards that play did not want and re-evaluate once.
//
// Run:
//   node --import ./scripts/ts-resolve.mjs scripts/difficulty-measure.mjs
//   ... --set dev | --set holdout | --seeds 40 | --cap 60 | --json out.json
import { writeFileSync } from 'node:fs'
import {
  newGame, applyAction, buildPlan, epochTarget, playSeedCap,
  boostWorldCost, planetCost, JOKER_SLOTS,
} from '../src/engine/worldhand.ts'
import { candidateSubsets } from './lib/candidates.mjs'

const argv = process.argv.slice(2)
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const SET = argOf('--set', 'both')
const N_SEEDS = Number(argOf('--seeds', '40'))
const EPOCH_CAP = Number(argOf('--cap', '60'))
const LOOK = Number(argOf('--look', process.env.LOOK || '30'))
const JSON_OUT = argOf('--json', null)
if (!Number.isInteger(LOOK) || LOOK < 1) throw new Error('--look/LOOK must be a positive integer')

// DEVELOPMENT seeds — the only ones a balance constant may be chosen against.
const DEV_SEEDS = Array.from({ length: N_SEEDS }, (_, i) => `probe-${i}`)
// HELD-OUT seeds — disjoint, never used to pick a constant.
const HOLDOUT_SEEDS = Array.from({ length: N_SEEDS }, (_, i) => `eval-${i}`)

// ---------------------------------------------------------------------------
// Frozen play rule (shared by every policy)
// ---------------------------------------------------------------------------
const ctxOf = (s) => ({
  jokers: s.jokers, planetLevels: s.planetLevels, consumables: s.consumables,
  worldLevel: s.worldLevel, vouchers: s.vouchers, epoch: s.epoch,
})

/** The highest-Growth legal selection, optionally biased toward `favour`:
 *  a play of the favoured category wins ties within BIAS of the best. */
const BIAS = 0.85
function bestPlay(s, favour) {
  let best = null
  for (const sel of candidateSubsets(s.hand, LOOK, hashString(`${s.seedText}:${s.epoch}:${s.playsLeft}:${s.discardsLeft}`))) {
    const plan = buildPlan(s.hand, sel, s.laws, s.regions, s.projects, ctxOf(s))
    if (!plan.valid) continue
    const favoured = favour !== null && plan.category === favour
    const rank = favoured ? plan.growth / BIAS : plan.growth
    if (!best || rank > best.rank) best = { sel, rank, growth: plan.growth, category: plan.category }
  }
  return best
}

/** Frozen discard rule: only when the current best cannot keep pace with the
 *  target over the plays that remain, and only if the redraw actually helps. */
function maybeDiscard(s, best, favour) {
  if (!best || s.discardsLeft <= 0) return null
  const gap = Math.max(0, epochTarget(s.epoch) - s.epochGrowth)
  const pace = s.playsLeft > 0 ? gap / s.playsLeft : 0
  if (best.growth >= pace) return null
  const junk = s.hand.map((_, i) => i).filter((i) => !best.sel.includes(i)).slice(0, 5)
  if (!junk.length) return null
  let after
  try { after = applyAction(s, { type: 'discard', cardIdxs: junk }) } catch { return null }
  const post = bestPlay(after, favour)
  return post && post.growth > best.growth ? after : null
}

// ---------------------------------------------------------------------------
// Frozen shop policies
// ---------------------------------------------------------------------------
const CATEGORY_OF_CONDITION = {
  pair: 'pair', twopair: 'two-pair', trips: 'trips', straight: 'straight',
  flush: 'flush', fullhouse: 'full-house', 'high-card': 'high',
}

function shopNone() { /* P0 buys nothing */ }

/** Deterministic mulberry32 — the scattered policy must reproduce exactly. */
function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(text) {
  return [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
}

/** P1 — scattered: every step, pick a UNIFORMLY RANDOM affordable option from
 *  everything on the shelf and buy it. No ordering, no synergy, no saving up.
 *  This is the careless build; it spends its Seeds just as completely as the
 *  others, so the only thing it lacks is coherence. */
function shopScattered(s, tally) {
  const rand = tally.rand
  let guard = 0
  while (guard++ < 64) {
    const options = [
      ...s.jokerMarket.map((j) => ({ type: 'buyJoker', jokerId: j.id })),
      ...s.planetMarket.map((p) => ({ type: 'buyPlanet', planetId: p.id })),
      ...s.voucherMarket.map((v) => ({ type: 'buyVoucher', voucherId: v.id })),
      ...s.projectMarket.map((p) => ({ type: 'buyProject', projectId: p.id })),
      { type: 'boostWorld' },
    ]
    // try options in a random order; stop when none of them is affordable
    let bought = null
    const order = options.map((o, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const i of order) {
      try { bought = applyAction(s, options[i]); tally.buys++; break } catch { /* unaffordable or refused */ }
    }
    if (!bought) break
    s = bought
  }
  return s
}

/** P2 — cheapest-first: the cheapest affordable option of each kind, in a
 *  fixed order. Naive, but cheap jokers target COMMON hands, so this is a
 *  legitimately reasonable line — not the careless one. */
function shopCheapest(s, tally) {
  const buy = (action) => { try { const n = applyAction(s, action); tally.buys++; return n } catch { return null } }
  let progress = true, guard = 0
  while (progress && guard++ < 64) {
    progress = false
    for (const list of [
      [...s.jokerMarket].sort((a, b) => a.cost - b.cost).map((j) => ({ type: 'buyJoker', jokerId: j.id })),
      [...s.planetMarket].sort((a, b) => planetCost(a, s.planetLevels) - planetCost(b, s.planetLevels)).map((p) => ({ type: 'buyPlanet', planetId: p.id })),
      [...s.voucherMarket].sort((a, b) => a.cost - b.cost).map((v) => ({ type: 'buyVoucher', voucherId: v.id })),
      [{ type: 'boostWorld' }],
      [...s.projectMarket].map((p) => ({ type: 'buyProject', projectId: p.id })),
    ]) {
      for (const action of list) {
        const n = buy(action)
        if (n) { s = n; progress = true; break }
      }
      if (progress) break
    }
  }
  return s
}

/** P3 — focused: a single chosen category. Jokers that fire on it (or on every
 *  hand) first, Planet cards for it, vouchers, World Level, income projects —
 *  and THEN a fallback tier that spends whatever is left on anything at all.
 *  The fallback matters for a fair comparison: a policy that hoards Seeds is
 *  dominated, not "focused", so without it P2 would be measuring frugality
 *  rather than coherence. P1 and P2 both end a run near zero Seeds; the only
 *  difference between them is the ORDER they buy in. */
function shopFocused(s, tally, favour) {
  const buy = (action) => { try { const n = applyAction(s, action); tally.buys++; return n } catch { return null } }
  let progress = true, guard = 0
  while (progress && guard++ < 64) {
    progress = false
    const jokers = s.jokerMarket
      .filter((j) => j.condition === 'any' || CATEGORY_OF_CONDITION[j.condition] === favour)
      .sort((a, b) => b.mult - a.mult)
    const planets = s.planetMarket.filter((p) => p.category === favour)
    for (const list of [
      jokers.map((j) => ({ type: 'buyJoker', jokerId: j.id })),
      planets.map((p) => ({ type: 'buyPlanet', planetId: p.id })),
      [...s.voucherMarket].sort((a, b) => a.cost - b.cost).map((v) => ({ type: 'buyVoucher', voucherId: v.id })),
      [{ type: 'boostWorld' }],
      [...s.projectMarket].filter((p) => p.growthFlat || p.seedsPerEpoch).map((p) => ({ type: 'buyProject', projectId: p.id })),
      // fallback tier: never leave Seeds idle
      [...s.jokerMarket].sort((a, b) => a.cost - b.cost).map((j) => ({ type: 'buyJoker', jokerId: j.id })),
      [...s.planetMarket].sort((a, b) => planetCost(a, s.planetLevels) - planetCost(b, s.planetLevels)).map((p) => ({ type: 'buyPlanet', planetId: p.id })),
      [...s.projectMarket].map((p) => ({ type: 'buyProject', projectId: p.id })),
    ]) {
      for (const action of list) {
        const n = buy(action)
        if (n) { s = n; progress = true; break }
      }
      if (progress) break
    }
  }
  return s
}

// The focused build commits to FLUSH: highest base mult among the shapes an
// 8-card hand can realistically make, and the joker/planet pool supports it.
// Declared up front, never chosen per seed.
const FOCUS_CATEGORY = 'flush'

const POLICIES = {
  'P0 no-shop': { shop: shopNone, favour: null },
  'P4 weak play': { shop: shopCheapest, favour: null, weakPlay: true },
  'P1 scattered': { shop: shopScattered, favour: null },
  'P2 cheapest': { shop: shopCheapest, favour: null },
  'P3 focused': { shop: shopFocused, favour: FOCUS_CATEGORY },
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------
/** No poker skill at all: the single highest card in hand. */
function weakPlay(s) {
  let hi = 0
  s.hand.forEach((c, i) => { if (c.r > s.hand[hi].r) hi = i })
  const plan = buildPlan(s.hand, [hi], s.laws, s.regions, s.projects, ctxOf(s))
  return plan.valid ? { sel: [hi], growth: plan.growth, category: plan.category } : null
}

function runOne(seedText, policyName) {
  const { shop, favour, weakPlay: weak } = POLICIES[policyName]
  let s = newGame(seedText)
  // the scattered policy's RNG is seeded from the world seed, so a scattered
  // run is as reproducible as every other policy here
  const tally = { buys: 0, rand: mulberry32([...seedText].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)) }
  const epochs = []
  let guard = 0
  while (s.phase !== 'game-over' && s.epoch <= EPOCH_CAP && guard++ < 40000) {
    if (s.phase === 'select') {
      const b = weak ? weakPlay(s) : bestPlay(s, favour)
      if (!b) break
      const d = weak ? null : maybeDiscard(s, b, favour)
      if (d) { s = d; continue }
      const ep = s.epoch
      let row = epochs.find((e) => e.epoch === ep)
      if (!row) { row = { epoch: ep, target: epochTarget(ep), banked: 0, best: 0, plays: 0, seedsAfter: 0, buys: 0 }; epochs.push(row) }
      row.best = Math.max(row.best, b.growth)
      row.plays++
      for (const i of b.sel) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      const before = s.epochGrowth
      s = applyAction(s, { type: 'play' })
      row.banked = s.phase === 'select' ? s.epochGrowth : before + b.growth
    } else if (s.phase === 'market') {
      const row = epochs.find((e) => e.epoch === s.epoch)
      const b0 = tally.buys
      s = shop(s, tally, favour) ?? s
      if (row) { row.buys = tally.buys - b0; row.seedsAfter = s.seeds }
      s = applyAction(s, { type: 'endMarket' })
    } else if (s.phase === 'epoch-end') {
      s = applyAction(s, { type: 'closeEpoch' })
    } else break
  }
  const reachedCap = s.epoch > EPOCH_CAP
  return {
    seed: seedText,
    depth: s.epoch,
    reachedCap,
    lives: s.lives,
    seeds: s.seeds,
    worldLevel: s.worldLevel,
    jokers: s.jokers.length,
    vouchers: s.vouchers.length,
    projects: s.projects.length,
    planetTotal: Object.values(s.planetLevels).reduce((a, b) => a + b, 0),
    flourishing: s.flourishing,
    buys: tally.buys,
    epochs,
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
const pct = (xs, q) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))] }
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)

function report(setName, seeds) {
  console.log(`\n${'='.repeat(78)}\n${setName} (${seeds.length} seeds, epoch cap ${EPOCH_CAP})\n${'='.repeat(78)}`)
  const out = {}
  for (const name of Object.keys(POLICIES)) {
    const runs = seeds.map((sd) => runOne(sd, name))
    const depths = runs.map((r) => r.depth)
    const hist = {}
    for (const d of depths) hist[d] = (hist[d] ?? 0) + 1
    out[name] = { runs, depths }
    console.log(`\n--- ${name} ---`)
    console.log(`run depth (epochs reached): min ${Math.min(...depths)}  p25 ${pct(depths, 0.25)}  median ${pct(depths, 0.5)}  p75 ${pct(depths, 0.75)}  max ${Math.max(...depths)}  mean ${mean(depths).toFixed(1)}`)
    const bars = Object.keys(hist).map(Number).sort((a, b) => a - b)
      .map((d) => `${d}:${'#'.repeat(hist[d])}(${hist[d]})`).join('  ')
    console.log(`depth distribution: ${bars}`)
    const capped = runs.filter((r) => r.reachedCap).length
    console.log(`hit the epoch cap without dying: ${capped}/${runs.length}${capped ? '   <-- NOT BOUNDED' : ''}`)
    console.log(`end state (mean): seeds ${mean(runs.map((r) => r.seeds)).toFixed(0)}  worldLevel ${mean(runs.map((r) => r.worldLevel)).toFixed(1)}  jokers ${mean(runs.map((r) => r.jokers)).toFixed(1)}/${JOKER_SLOTS}  vouchers ${mean(runs.map((r) => r.vouchers)).toFixed(1)}  planets +${mean(runs.map((r) => r.planetTotal)).toFixed(1)} mult  projects ${mean(runs.map((r) => r.projects)).toFixed(1)}  purchases ${mean(runs.map((r) => r.buys)).toFixed(1)}`)
    // margin: banked / target, by epoch, averaged across seeds that reached it
    const byEpoch = new Map()
    for (const r of runs) for (const e of r.epochs) {
      if (!byEpoch.has(e.epoch)) byEpoch.set(e.epoch, [])
      byEpoch.get(e.epoch).push(e)
    }
    const marks = [...byEpoch.keys()].sort((a, b) => a - b).filter((e) => e % 3 === 1 || e <= 3)
    console.log('epoch |  target |  mean banked | banked/target | mean seeds after shop | runs alive')
    for (const e of marks.slice(0, 14)) {
      const rows = byEpoch.get(e)
      const mb = mean(rows.map((x) => x.banked))
      console.log(
        `${String(e).padStart(5)} | ${String(epochTarget(e)).padStart(7)} | ${mb.toFixed(0).padStart(12)} | ` +
        `${(mb / epochTarget(e)).toFixed(2).padStart(13)} | ${mean(rows.map((x) => x.seedsAfter)).toFixed(0).padStart(21)} | ${String(rows.length).padStart(10)}`,
      )
    }
  }
  // skill spread: the whole point — does building well actually buy epochs?
  const d = (k) => mean(out[k].depths)
  console.log(`  poker skill alone (same shop, P2 - P4): ${(d('P2 cheapest') - d('P4 weak play')).toFixed(1)} epochs`)
  console.log(`\nSKILL LADDER  no-shop ${d('P0 no-shop').toFixed(1)}  ->  scattered ${d('P1 scattered').toFixed(1)}  ->  cheapest ${d('P2 cheapest').toFixed(1)}  ->  focused ${d('P3 focused').toFixed(1)}`)
  console.log(`  careless cost: scattered gives up ${(d('P2 cheapest') - d('P1 scattered')).toFixed(1)} epochs vs cheapest-first, ${(d('P3 focused') - d('P1 scattered')).toFixed(1)} vs a committed build`)
  return out
}

const results = {}
if (SET === 'dev' || SET === 'both') results.dev = report('DEVELOPMENT seeds (probe-*) — constants may be chosen here', DEV_SEEDS)
if (SET === 'holdout' || SET === 'both') results.holdout = report('HELD-OUT seeds (eval-*) — never used to pick a constant', HOLDOUT_SEEDS)
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(results, null, 1))
  console.log(`\nwrote ${JSON_OUT}`)
}
