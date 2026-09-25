// REPRODUCTION PROBE — the runaway-economy baseline.
//
// Two halves, both bounded and deterministic:
//   A) FORENSICS on a supplied save file (read-only; the file is never
//      written). Prints the per-epoch trajectory (target vs best banked
//      Growth, purchases, World-Level boosts) and decomposes the final
//      resolution so the multiplicative chain is visible.
//   B) FRESH-RUN EXPLOIT: replays an "exploit" purchase policy from a NEW
//      game on fixed seeds to show the runaway is reachable from scratch
//      under the current rules, not a property of one save.
//
// Run:  node --import ./scripts/ts-resolve.mjs scripts/repro-runaway.mjs [--save <path>] [--epochs N]
import { readFileSync } from 'node:fs'
import {
  newGame, applyAction, buildPlan, epochTarget, worldLevelBonus,
} from '../src/engine/worldhand.ts'

const argv = process.argv.slice(2)
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}
const SAVE = argOf('--save', '/Users/giofiore/Downloads/README (1).md')
const EPOCH_CAP = Number(argOf('--epochs', '25'))

// ---------------------------------------------------------------------------
// A) Forensics on the supplied save
// ---------------------------------------------------------------------------
function forensics(path) {
  let raw
  try { raw = readFileSync(path, 'utf8') } catch { console.log(`\n(no save at ${path} — skipping forensics)`); return }
  const env = JSON.parse(raw)
  const s = env.state
  console.log('\n=== A) SUPPLIED SAVE — forensics (read-only) ===')
  console.log(`envelope: schema ${env.schema} rules v${env.version} savedAt ${env.savedAt}`)
  console.log(`epoch ${s.epoch}  phase ${s.phase}  lives ${s.lives}  seeds ${s.seeds.toLocaleString()}`)
  console.log(`flourishing ${s.flourishing.toLocaleString()}  worldLevel ${s.worldLevel}`)
  const count = (arr, key = 'id') => arr.reduce((m, x) => (m[x[key]] = (m[x[key]] ?? 0) + 1, m), {})
  console.log(`jokers(${s.jokers.length}): ${Object.entries(count(s.jokers)).map(([k, n]) => `${k}x${n}`).join(' ')}`)
  console.log(`vouchers(${s.vouchers.length}): ${Object.entries(count(s.vouchers)).map(([k, n]) => `${k}x${n}`).join(' ')}`)
  console.log(`projects(${s.projects.length}): ${Object.entries(count(s.projects)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}x${n}`).join(' ')} ...`)
  console.log(`planetLevels: ${JSON.stringify(s.planetLevels)}`)

  // per-epoch trajectory, rebuilt from the chronicle
  const by = {}
  for (const e of s.log) {
    const m = /^e(\d+)$/.exec(e.at); if (!m) continue
    const ep = +m[1]
    by[ep] ??= { best: 0, plays: 0, buys: 0, ups: 0 }
    const g = /^Played .*Banks (\d+) Growth/.exec(e.text)
    if (g) { by[ep].plays++; by[ep].best = Math.max(by[ep].best, +g[1]) }
    if (/^(Funded|Bought|Acquired) /.test(e.text)) by[ep].buys++
    if (/^World Level up/.test(e.text)) by[ep].ups++
  }
  console.log('\nepoch | target | best banked Growth |  x over target | plays | buys | WL boosts')
  for (const ep of Object.keys(by).map(Number).sort((a, b) => a - b)) {
    const b = by[ep], t = epochTarget(ep)
    console.log(
      `${String(ep).padStart(5)} | ${String(t).padStart(6)} | ${String(b.best).padStart(18)} | ` +
      `${(b.best / t).toFixed(1).padStart(14)} | ${String(b.plays).padStart(5)} | ${String(b.buys).padStart(4)} | ${String(b.ups).padStart(9)}`,
    )
  }

  // decompose the final resolution using the LIVE engine, not the stored text
  const lr = s.lastResolution
  if (lr) {
    const plan = buildPlan(lr.cards, lr.cards.map((_, i) => i), s.laws, s.regions, s.projects, {
      jokers: s.jokers, planetLevels: s.planetLevels, consumables: [],
      worldLevel: s.worldLevel, vouchers: s.vouchers,
    })
    const voucherJokerMult = s.vouchers.reduce((n, v) => n + (v.jokerMult ?? 0), 0)
    const projFlat = s.projects.reduce((n, p) => n + (p.growthFlat ?? 0), 0)
    console.log('\nlast play, recomputed by the live engine:')
    console.log(`  category       ${plan.categoryLabel} (${plan.cards.length} cards)`)
    console.log(`  chips          ${plan.chips}  x mult ${plan.mult}  -> pokerBase ${plan.pokerBase}`)
    console.log(`  + project flat ${projFlat}   (proj-growth bought ${s.projects.filter((p) => p.id === 'proj-growth').length}x)`)
    console.log(`  + world bonus  ${worldLevelBonus(s.worldLevel).growthPerPlay}   (worldLevel ${s.worldLevel}, +2/level)`)
    console.log(`  x joker mult   ${plan.jokerMult.toFixed(2)}   (+${voucherJokerMult} to EVERY joker from ${s.vouchers.filter((v) => v.jokerMult).length} stacked vouchers)`)
    console.log(`  = GROWTH       ${plan.growth.toLocaleString()}   -> Seeds ${Math.ceil(plan.growth / 4).toLocaleString()} on ONE play`)
    console.log(`  epoch target   ${epochTarget(s.epoch)}  -> overkill x${(plan.growth / epochTarget(s.epoch)).toFixed(0)}`)
  }
  // dead purchase: the +1 hand-size voucher is never read by handSizeOf(laws)
  const handVouchers = s.vouchers.filter((v) => v.handSize).length
  if (handVouchers) {
    console.log(`\n  DEAD PURCHASE: ${handVouchers}x "Bigger Hand" voucher owned; handSizeOf() reads laws only -> +0 cards.`)
  }
}

// ---------------------------------------------------------------------------
// B) Fresh-run exploit policy
// ---------------------------------------------------------------------------
// Competent poker play (greedy: the highest-Growth selection of 1-5 cards in
// the hand, no lookahead) paired with a greedy "buy every multiplier, then
// spam the unbounded sinks" shop policy. This is the loop under test: ordinary
// play quality plus an unrestrained shop.
function bestSelection(s) {
  const n = s.hand.length
  let best = null
  for (let m = 1; m < (1 << n); m++) {
    const sel = []
    for (let i = 0; i < n; i++) if (m & (1 << i)) sel.push(i)
    if (sel.length > 5) continue
    const plan = buildPlan(s.hand, sel, s.laws, s.regions, s.projects, {
      jokers: s.jokers, planetLevels: s.planetLevels, consumables: s.consumables,
      worldLevel: s.worldLevel, vouchers: s.vouchers,
    })
    if (!plan.valid) continue
    if (!best || plan.growth > best.growth) best = { sel, growth: plan.growth }
  }
  return best
}

function exploitRun(seedText, epochCap) {
  let s = newGame(seedText)
  const rows = []
  const rowFor = (ep) => {
    let r = rows.find((x) => x.ep === ep)
    if (!r) { r = { ep, target: epochTarget(ep), best: 0, buys: 0, ups: 0, seeds: 0 }; rows.push(r) }
    return r
  }
  let guard = 0
  while (s.phase !== 'game-over' && s.epoch <= epochCap && guard++ < 20000) {
    if (s.phase === 'select') {
      const b = bestSelection(s)
      if (!b) break
      const row = rowFor(s.epoch)
      row.best = Math.max(row.best, b.growth)
      for (const i of b.sel) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      s = applyAction(s, { type: 'play' })
    } else if (s.phase === 'market') {
      const row = rowFor(s.epoch)
      let progress = true
      let steps = 0
      while (progress && steps++ < 5000) {
        progress = false
        for (const v of [...s.voucherMarket]) {
          try { s = applyAction(s, { type: 'buyVoucher', voucherId: v.id }); row.buys++; progress = true } catch { /* unaffordable */ }
        }
        for (const j of [...s.jokerMarket]) {
          try { s = applyAction(s, { type: 'buyJoker', jokerId: j.id }); row.buys++; progress = true } catch { /* full or unaffordable */ }
        }
        for (const p of [...s.planetMarket]) {
          try { s = applyAction(s, { type: 'buyPlanet', planetId: p.id }); row.buys++; progress = true } catch { /* unaffordable */ }
        }
        // the two unbounded sinks: World Level and repeatable projects
        try { s = applyAction(s, { type: 'boostWorld' }); row.ups++; progress = true } catch { /* unaffordable */ }
        for (const p of [...s.projectMarket]) {
          try { s = applyAction(s, { type: 'buyProject', projectId: p.id }); row.buys++; progress = true } catch { /* unaffordable */ }
        }
      }
      row.seeds = s.seeds
      s = applyAction(s, { type: 'endMarket' })
    } else if (s.phase === 'epoch-end') {
      s = applyAction(s, { type: 'closeEpoch' })
    } else break
  }
  return { state: s, rows }
}

function fresh(epochCap) {
  console.log(`\n=== B) FRESH RUN, greedy play + unrestrained shop, capped at epoch ${epochCap} ===`)
  for (const seed of ['eval-0', 'eval-1', 'eval-2']) {
    const { state, rows } = exploitRun(seed, epochCap)
    console.log(`\n-- seed ${seed} -> reached epoch ${state.epoch}, lives ${state.lives}, seeds ${state.seeds.toLocaleString()}, worldLevel ${state.worldLevel}`)
    console.log('epoch | target |     best Growth |    x target | buys | WL boosts |      seeds after shop')
    for (const r of rows) {
      console.log(
        `${String(r.ep).padStart(5)} | ${String(r.target).padStart(6)} | ${String(r.best).padStart(15)} | ` +
        `${(r.best / r.target).toFixed(1).padStart(11)} | ${String(r.buys).padStart(4)} | ${String(r.ups).padStart(9)} | ${String(r.seeds).padStart(21)}`,
      )
    }
  }
}

forensics(SAVE)
fresh(EPOCH_CAP)
console.log('\nBASELINE VERDICT: see .hermes/worldhand-difficulty.md for the hypothesis this evidences.')
