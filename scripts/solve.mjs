// Headless balance probe: can a competent player reach the epoch targets?
// Greedy: each play, try candidate 1-5 card subsets, keep the one the heuristic likes.
// LOOK (env) / --look <n>: cap how many candidates are considered per play.
// Unset (or >= the full space, 218 for an 8-card hand) = exhaustive behaviour.
// The capped sample is deterministic (same world seed reproduces it exactly)
// and biased toward short selections: every length-1 and length-2 selection is
// considered first, and only the remaining budget is filled with a seeded
// random sample of longer selections.
import { newGame, applyAction, buildPlan, EPOCH_TARGETS, TOTAL_EPOCHS } from '../src/engine/worldhand.ts'
import { hashSeed } from '../src/engine/rng.ts'

// ---- LOOK: bounded candidate cap -------------------------------------------
// --look <n> flag overrides the LOOK env var; both accept a positive integer.
const rawArgs = process.argv.slice(2)
let LOOK = process.env.LOOK !== undefined && process.env.LOOK !== '' ? Number(process.env.LOOK) : undefined
const seedArgs = []
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--look') { LOOK = Number(rawArgs[i + 1]); i++; continue }
  if (rawArgs[i].startsWith('--look=')) { LOOK = Number(rawArgs[i].slice(7)); continue }
  seedArgs.push(rawArgs[i])
}
if (LOOK !== undefined && (!Number.isFinite(LOOK) || LOOK < 1 || !Number.isInteger(LOOK))) {
  console.error('LOOK/--look must be a positive integer')
  process.exit(1)
}

// Deterministic mulberry32 (matches src/engine/rng.ts) for the local sampler.
function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// World seed text + play counter seed the sampler, so the candidate sample
// varies from play to play but reproduces exactly for the same world seed.
let CURRENT_SEED_TEXT = ''
let PLAY_NO = 0
function sampleSalt() {
  return (hashSeed(CURRENT_SEED_TEXT) ^ Math.imul(PLAY_NO++ + 1, 0x9e3779b9)) >>> 0
}

const subsets = (n) => {
  const out = []
  for (let m = 1; m < (1 << n); m++) {
    const s = []
    for (let i = 0; i < n; i++) if (m & (1 << i)) s.push(i)
    if (s.length <= 5) out.push(s)
  }
  return out
}

// Candidate cap: short selections first, remainder sampled with a seeded rng.
function candidateSubsets(n, look, salt) {
  const all = subsets(n)
  if (!look || look >= all.length) return all
  const shorts = all.filter((s) => s.length <= 2)
  const longs = all.filter((s) => s.length > 2)
  const out = shorts.slice(0, look)
  if (out.length >= look) return out
  const rng = mulberry32(salt)
  const pool = longs.slice()
  const need = look - out.length
  for (let i = 0; i < need && i < pool.length; i++) {
    const j = i + Math.floor(rng() * (pool.length - i))
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t
  }
  out.push(...pool.slice(0, Math.min(need, pool.length)))
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
  for (const sel of candidateSubsets(state.hand.length, LOOK, sampleSalt())) {
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
  CURRENT_SEED_TEXT = seedText
  PLAY_NO = 0
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

const seeds = seedArgs.length ? seedArgs
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
console.log(`\n${wins}/${seeds.length} wins (need F>=${need}, LOOK=${LOOK ?? 'exhaustive'}). final F: min ${finals[0]}, median ${finals[finals.length >> 1]}, max ${finals[finals.length - 1]}`)