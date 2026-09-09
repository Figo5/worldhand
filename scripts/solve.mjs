// Headless balance probe: can a competent player reach Flourishing 12?
// Greedy: each play, try all 1-5 card subsets, keep the one the heuristic likes.
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
// Only two things decide the ending: final Flourishing >= 12, and the epoch-3
// drought (every living region at stability 3+). Score for exactly those.
function score(before, after) {
  const df = after.flourishing - before.flourishing
  const ds = after.seeds - before.seeds
  const stab = living(after).reduce((n, r) => n + r.stability, 0) - living(before).reduce((n, r) => n + r.stability, 0)
  const woke = living(after).length - living(before).length
  const droughtRisk = after.epoch === 3 ? living(after).filter((r) => r.stability < 4).length : 0
  // waking a region in epoch 3 is a drought liability, not a win
  const wakePenalty = after.epoch === 3 ? -60 * woke : 0.5 * woke
  if (after.epoch === 3) {
    // Flourishing 12 is already banked long before here; epoch 3 is the drought.
    const shortfall = living(after).reduce((n, r) => n + Math.max(0, 3 - r.stability), 0)
    return -shortfall * 100 + wakePenalty - droughtRisk * 5 + df * 2 + stab * 1.5
  }
  return df * 10 + stab * 1.2 + ds * 0.4 + wakePenalty - droughtRisk * 2
}

function bestPlay(state) {
  let best = null
  for (const sel of subsets(state.hand.length)) {
    const plan = buildPlan(state.hand, sel, state.regions, state.laws, undefined)
    if (!plan.valid) continue
    let next
    try {
      let s = state
      for (const i of sel) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      next = applyAction(s, { type: 'play' })
    } catch { continue }
    const v = score(state, next)
    if (!best || v > best.v) best = { v, sel, next }
  }
  return best
}

function playSeed(seedText) {
  let s = newGame(seedText)
  let guard = 0
  while (s.phase !== 'game-over' && guard++ < 400) {
    if (s.phase === 'select') {
      // spend a discard when the best play is weak and we can afford it
      const b = bestPlay(s)
      if (!b) break
      if (b.v < 6 && s.discardsLeft > 0) {
        // dump the cards the winning play didn't want, up to 5
        const junk = s.hand.map((_, i) => i).filter((i) => !b.sel.includes(i)).slice(0, 5)
        if (junk.length) { s = applyAction(s, { type: 'discard', cardIdxs: junk }); continue }
      }
      s = b.next
    } else if (s.phase === 'market') {
      let bought = true
      while (bought) {
        bought = false
        // flourishing-per-seed first; expansions only outside epoch 3
        const order = ['canopy-choir', 'seed-vaults', 'barter-routes', 'mycorrhiza', 'deep-taproots', 'communal-tending', 'rich-soil']
        for (const id of order) {
          const item = s.market.find((m) => m.id === id)
          if (!item) continue
          try { s = applyAction(s, { type: 'buy', itemId: id }); bought = true; break } catch {}
        }
      }
      s = applyAction(s, { type: 'endMarket' })
    } else if (s.phase === 'epoch-end') {
      s = applyAction(s, { type: 'closeEpoch' })
    } else break
  }
  return s
}

const seeds = process.argv.slice(2).length ? process.argv.slice(2)
  : Array.from({ length: 30 }, (_, i) => `probe-${i}`)
let wins = 0
const finals = []
for (const seed of seeds) {
  const s = playSeed(seed)
  finals.push(s.flourishing)
  if (s.outcome === 'flourishing') wins++
  console.log(`${seed.padEnd(10)} ${String(s.outcome).padEnd(11)} F=${String(s.flourishing).padStart(3)}  ${s.outcomeReason}`)
}
finals.sort((a, b) => a - b)
const need = EPOCH_TARGETS[TOTAL_EPOCHS - 1].need
console.log(`\n${wins}/${seeds.length} wins (need F>=${need}). final F: min ${finals[0]}, median ${finals[finals.length >> 1]}, max ${finals[finals.length - 1]}`)
