// One-shot balance calibration probe: greedy policy across the default 30 seeds,
// sweeping candidate epoch-target triples. Reports wins + final-F distribution.
// Usage: npx vite-node scripts/balance-sweep.mjs [targetA,targetB,targetC ...]
import { newGame, applyAction, buildPlan, EPOCH_TARGETS, TOTAL_EPOCHS } from '../src/engine/worldhand.ts'

const subsets = (n) => {
  const out = []
  for (let m = 1; m < (1 << n); m++) {
    const s = []
    for (let i = 0; i < n; i++) if (m & (1 << i)) s.push(i)
    if (s.length <= 5) out.push(s)
  }
  return out
}
const living = (s) => s.regions.filter((r) => !r.dormant)
function score(before, after) {
  const df = after.flourishing - before.flourishing
  const ds = after.seeds - before.seeds
  const stab = living(after).reduce((n, r) => n + r.stability, 0) - living(before).reduce((n, r) => n + r.stability, 0)
  const woke = living(after).length - living(before).length
  const droughtRisk = after.epoch === 3 ? living(after).filter((r) => r.stability < 4).length : 0
  const wakePenalty = after.epoch === 3 ? -60 * woke : 0.5 * woke
  if (after.epoch === 3) {
    const shortfall = living(after).reduce((n, r) => n + Math.max(0, 3 - r.stability), 0)
    return -shortfall * 100 + wakePenalty - droughtRisk * 5 + df * 2 + stab * 1.5
  }
  return df * 10 + stab * 1.2 + ds * 0.4 + wakePenalty - droughtRisk * 2
}
function bestPlay(state) {
  let best = null
  for (const sel of subsets(state.hand.length)) {
    const plan = buildPlan(state.hand, sel, state.laws)
    if (!plan.valid) continue
    let next
    try { let s = state; for (const i of sel) s = applyAction(s, { type: 'toggleCard', cardIdx: i }); next = applyAction(s, { type: 'play' }) } catch { continue }
    const v = score(state, next)
    if (!best || v > best.v) best = { v, next }
  }
  return best
}
function playSeed(seedText) {
  let s = newGame(seedText); let guard = 0
  while (s.phase !== 'game-over' && guard++ < 400) {
    if (s.phase === 'select') {
      const b = bestPlay(s); if (!b) break
      if (b.v < 6 && s.discardsLeft > 0) {
        const junk = s.hand.map((_, i) => i).filter((i) => i !== (b.sel ? b.sel[0] : -1)).slice(0, 5)
        if (junk.length) { s = applyAction(s, { type: 'discard', cardIdxs: junk }); continue }
      }
      s = b.next
    } else if (s.phase === 'market') {
      let bought = true
      while (bought) {
        bought = false
        const order = ['canopy-choir', 'seed-vaults', 'barter-routes', 'mycorrhiza', 'open-canals', 'stone-masonry']
        for (const id of order) {
          const item = s.market.find((m) => m.id === id); if (!item) continue
          try { s = applyAction(s, { type: 'buy', itemId: id }); bought = true; break } catch {}
        }
      }
      s = applyAction(s, { type: 'endMarket' })
    } else if (s.phase === 'epoch-end') s = applyAction(s, { type: 'closeEpoch' })
    else break
  }
  return s
}
// target override: rewrite module constants for the sweep (single Growth target)
function setTargets(vals) {
  EPOCH_TARGETS.length = 0
  vals.forEach((need, i) => EPOCH_TARGETS.push({ epoch: i + 1, desc: `Growth ${need}`, need }))
}
const argTargets = process.argv.slice(2)
const candidates = argTargets.length
  ? argTargets.map((s) => s.split(',').map(Number))
  : [[30, 80, 150], [40, 90, 160], [50, 100, 180], [60, 120, 200], [25, 70, 140], [35, 85, 155]]
const seeds = Array.from({ length: 30 }, (_, i) => `probe-${i}`)
for (const t of candidates) {
  setTargets(t)
  let wins = 0; const finals = []
  for (const seed of seeds) { const s = playSeed(seed); finals.push(s.flourishing); if (s.outcome === 'flourishing') wins++ }
  finals.sort((a, b) => a - b)
  console.log(`targets [${t.join(',')}] -> ${wins}/${seeds.length} wins; final F min ${finals[0]} / median ${finals[finals.length >> 1]} / max ${finals[finals.length - 1]}`)
}