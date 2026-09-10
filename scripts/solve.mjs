// Bounded solver probe for the CURRENT Balatro-simple contract (three epochs,
// poker-hand plays, auto-Seeds, market shop, lives = every missed target −1).
//
// NOT a human win-rate estimate: this is an automated BOUNDED SOLVER RESULT —
// a greedy policy over a bounded candidate set. Where this file (or the docs)
// says "bounded solver result", that is exactly what it is. Human playtest
// judgement is a separate, out-of-scope exercise.
//
// Policy (current mechanics ONLY — no drought/stability-era terms):
//   score(before, after) ranks a candidate play by what the live engine pays:
//     - Growth banked toward the epoch target: df (chips×mult + laws) —
//       primary term, and the target-shortfall penalty once the banked total
//       can no longer reach the current epoch target with the plays left.
//     - Seeds gained (ds), discounted when seeds are already near the cap.
//     - Lives state: losing a life is heavily penalized; staying alive at
//       0 lives pending the boundary is avoided.
//   Candidates span 1–5 cards across poker categories: all short selections
//   PLUS deliberate category candidates (pairs, trips, quads, straights,
//   flushes, full houses, 3/4/5-card hands) — an 8-card hand has 36 two-card
//   subsets, so a LOOK of 30 filled only with 1–2-card combos would never
//   evaluate a real poker hand. With LOOK unset the candidate list is the full
//   space (exhaustive oracle behaviour).
//   Discarding: when every candidate scores weak and a discard remains, the
//   policy dumps the cards the best play did NOT want (up to 5) and refills —
//   evaluated by re-running bestPlay after the discard and keeping it only if
//   the new best beats the old one by a margin.
//   Purchases (documented, deterministic priority order):
//     1. canopy-choir   — +3 flat Growth on EVERY play (12 plays/run): the
//                         cheapest per-play Growth per Seed.
//     2. seed-vaults    — +3 Seeds/epoch compounds the shop itself.
//     3. barter-routes  — −2 on all later purchases (discounts discount).
//     4. open-canals    — ×1.2 Growth every play: strongest late multiplier.
//     5. stone-masonry  — +6 flat every play: bought when Seeds allow.
//     6. fourth-counsel — 9-card hands find more/better poker shapes.
//     7. wake-pellucid / wake-vantage — the poker specializations DO pay toward
//        the Growth targets (since 785556a): an awake Pellucid adds +4 Growth
//        to EXACT Two Pair plays (+1 per 2 development, cap +4) and Vantage
//        +6 to EXACT Flush plays, while the non-match penalty (−3) makes every
//        non-matching play slightly cheaper to avoid. WAKE RULE (documented):
//        a wake-* specialization is bought when affordable (after the priority
//        list above) whenever its region is still dormant AND its category is
//        IN or NEAR the current hand (a pair/two-pair/flush shape is already
//        held or is ≤2 cards of the needed shape) — otherwise the Seeds are
//        kept. wake-laguna / wake-brumal remain skipped: no specialization, so
//        they pay no Growth and only add Seed-income headcount.
//   mycorrhiza / fifth-counsel are skipped (cosmetic decay relief / hand 10 is
//   not worth the Seeds under the Growth targets).
//
// Seeds:
//   - CALIBRATION seeds (default, `--set calib`): probe-0..14 — used when
//     sweeping epoch targets; never quoted as the headline result.
//   - EVALUATION seeds (`--set eval`): eval-0..19 — a DISJOINT set; the honest
//     reported bounded-solver result is measured here only.
//   - Default (no flags): runs BOTH sets and reports them separately.
import { newGame, applyAction, buildPlan, EPOCH_TARGETS, TOTAL_EPOCHS } from '../src/engine/worldhand.ts'
import { hashSeed } from '../src/engine/rng.ts'
import { evaluateSelection } from '../src/engine/poker.ts'

// ---- LOOK: bounded candidate cap -------------------------------------------
// --look <n> flag overrides the LOOK env var; both accept a positive integer.
const rawArgs = process.argv.slice(2)
let LOOK = process.env.LOOK !== undefined && process.env.LOOK !== '' ? Number(process.env.LOOK) : undefined
let SEED_SET = process.env.SEED_SET !== undefined && process.env.SEED_SET !== '' ? String(process.env.SEED_SET) : 'both'
const seedArgs = []
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--look') { LOOK = Number(rawArgs[i + 1]); i++; continue }
  if (rawArgs[i].startsWith('--look=')) { LOOK = Number(rawArgs[i].slice(7)); continue }
  if (rawArgs[i] === '--set') { SEED_SET = rawArgs[i + 1]; i++; continue }
  if (rawArgs[i].startsWith('--set=')) { SEED_SET = rawArgs[i].slice(6); continue }
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

/** Poker-category candidates: deliberate hand shapes across 1–5 cards, not
 *  just all 1–2-card combinations. Built purely from the dealt hand's ranks/
 *  suits (deterministic; the same hand always yields the same candidates):
 *   - every length-1 and length-2 selection (cheap, exact);
 *   - every pair/trips/quads group (all cards sharing a rank, up to 4);
 *   - two-pair candidates (two ranks, all their cards);
 *   - 5-card flushes (4+ same-suit cards + the best filler) and every
 *     5-card same-suit subset if the suit has exactly 5;
 *   - straights: consecutive-rank runs of 5 (+ ace-low wheels), best suits;
 *   - full-house candidates (trips rank + pair rank);
 *   - straight-flush attempts (same-suit runs).
 *  The list is deduped and capped: when LOOK < list length, the cap keeps
 *  shorts first, then category candidates in the order above, then a seeded
 *  random sample of whatever remains. */
function pokerCandidates(hand) {
  const seen = new Set()
  const out = []
  const add = (idxs) => {
    if (idxs.length < 1 || idxs.length > 5) return
    const k = [...idxs].sort((a, b) => a - b).join(',')
    if (seen.has(k)) return
    seen.add(k)
    out.push(idxs)
  }
  const n = hand.length
  // all 1- and 2-card selections first (cheap, exact, the shorts bias)
  for (let i = 0; i < n; i++) add([i])
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) add([i, j])
  // rank groups: pairs / trips / quads (+ two-pair, + full-house)
  const byRank = new Map()
  hand.forEach((c, i) => {
    if (!byRank.has(c.r)) byRank.set(c.r, [])
    byRank.get(c.r).push(i)
  })
  const groups = [...byRank.values()].sort((a, b) => b.length - a.length)
  for (const g of groups) {
    if (g.length >= 2) add(g.slice(0, Math.min(4, g.length)))
  }
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      if (groups[a].length >= 2 && groups[b].length >= 2) add([...groups[a], ...groups[b]].slice(0, 5))
      if (groups[a].length >= 3 && groups[b].length >= 2) add([...groups[a], ...groups[b]].slice(0, 5))
    }
  }
  // flushes: group indices by suit; 5-card same-suit subsets
  const bySuit = new Map()
  hand.forEach((c, i) => {
    if (!bySuit.has(c.s)) bySuit.set(c.s, [])
    bySuit.get(c.s).push(i)
  })
  for (const suitIdxs of bySuit.values()) {
    if (suitIdxs.length >= 5) {
      // best 5 by rank + one straight-flush attempt (lowest ranks keep runs)
      const sorted = [...suitIdxs].sort((x, y) => hand[y].r - hand[x].r)
      add(sorted.slice(0, 5))
      add([...suitIdxs].sort((x, y) => hand[x].r - hand[y].r).slice(0, 5))
    }
  }
  // straights: consecutive runs of distinct ranks (incl. ace-low wheel)
  const rankIdx = new Map()
  hand.forEach((c, i) => {
    if (!rankIdx.has(c.r)) rankIdx.set(c.r, [])
    rankIdx.get(c.r).push(i)
  })
  const uniqRanks = [...rankIdx.keys()].sort((a, b) => a - b)
  for (let start = 0; start < uniqRanks.length; start++) {
    const run = [uniqRanks[start]]
    for (let j = start + 1; j < uniqRanks.length && run.length < 5; j++) {
      if (uniqRanks[j] === run[run.length - 1] + 1) run.push(uniqRanks[j])
    }
    if (run.length === 5) {
      // prefer suited cards for a straight-flush chance, else highest ranks
      const idxs = run.map((r) => rankIdx.get(r)[0])
      const suited = run.map((r) => {
        const cards = rankIdx.get(r)
        const suitCount = new Map()
        for (const ci of cards) suitCount.set(hand[ci].s, (suitCount.get(hand[ci].s) ?? 0) + 1)
        const bestSuit = [...suitCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
        return cards.find((ci) => hand[ci].s === bestSuit)
      })
      add(idxs)
      const flushable = suited.every((ci, k) => k === 0 || hand[ci].s === hand[suited[0]].s)
      if (!flushable) add(suited)
    }
  }
  // ace-low wheel A-2-3-4-5
  const wheel = [14, 2, 3, 4, 5].filter((r) => rankIdx.has(r))
  if (wheel.length === 5) {
    const idxs = wheel.map((r) => rankIdx.get(r)[0])
    add(idxs)
    const suitCount = new Map()
    for (const ci of idxs) suitCount.set(hand[ci].s, (suitCount.get(hand[ci].s) ?? 0) + 1)
    const bestSuit = [...suitCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const suited = wheel.map((r) => (rankIdx.get(r).find((ci) => hand[ci].s === bestSuit) ?? rankIdx.get(r)[0]))
    add(suited)
  }
  // generic 3/4/5-card fillers so longer shapes are actually represented
  const sortedByRank = hand.map((_, i) => i).sort((a, b) => hand[b].r - hand[a].r)
  add(sortedByRank.slice(0, 3))
  add(sortedByRank.slice(0, 4))
  add(sortedByRank.slice(0, 5))
  return out
}

// Candidate cap: category candidates first, then seeded sample of the rest.
function candidateSubsets(hand, look, salt) {
  const all = subsets(hand.length)
  const cands = pokerCandidates(hand)
  const candKeys = new Set(cands.map((s) => s.sort((a, b) => a - b).join(',')))
  const rest = all.filter((s) => !candKeys.has(s.sort((a, b) => a - b).join(',')))
  if (!look || look >= all.length) return all
  const out = cands.slice(0, look)
  if (out.length >= look) return out
  const rng = mulberry32(salt)
  const pool = rest.slice()
  const need = look - out.length
  for (let i = 0; i < need && i < pool.length; i++) {
    const j = i + Math.floor(rng() * (pool.length - i))
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t
  }
  out.push(...pool.slice(0, Math.min(need, pool.length)))
  return out
}

// ---- CURRENT-mechanics scoring ----------------------------------------------
// Everything scored here exists in the live engine: banked Growth toward the
// epoch target (chips×mult + laws), Seeds gained, lives state. No stability,
// no drought, no wake terms — those mechanics do not exist anymore.
const needOf = (epoch) => EPOCH_TARGETS[Math.min(epoch, TOTAL_EPOCHS) - 1].need
function score(before, after) {
  const df = after.flourishing - before.flourishing // Growth banked this play
  const ds = after.seeds - before.seeds             // Seeds gained this play
  const dl = after.lives - before.lives             // lives change (usually 0)
  const need = needOf(after.epoch)
  const playsLeft = after.playsLeft
  // banked-Growth potential: can the epoch target still be reached?
  const gap = Math.max(0, need - after.flourishing)
  const reachable = playsLeft > 0 ? gap <= playsLeft * 40 : gap <= 0 // ~40/play practical ceiling
  const reachPenalty = reachable ? 0 : 300
  // seeds are only worth so much once near the 30 cap
  const seedsWorth = after.seeds >= 30 ? ds * 0.1 : ds * 0.4
  // a life is precious: losing one here is bad; a second loss (0 lives) is terminal-ish
  const lifePenalty = dl < 0 ? (after.lives === 0 ? 400 : 120) : 0
  // surplus above the target is worth much less than closing a gap
  const surplus = after.flourishing >= need ? Math.min(df, 30) : 0
  return df * 3 + surplus * 0.5 + seedsWorth - reachPenalty - lifePenalty
}

function bestPlay(state) {
  let best = null
  for (const sel of candidateSubsets(state.hand, LOOK, sampleSalt())) {
    const plan = buildPlan(state.hand, sel, state.laws)
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

// Discard evaluation: when the best play is weak and a discard remains, dump
// the cards the winning play did NOT want (up to 5), refill, and re-evaluate.
// The discard is kept only if the post-refill best play clearly beats the
// pre-discard one — otherwise the (known) play is preferred over a gamble.
function maybeDiscard(state, best) {
  if (!best || best.v >= 12 || state.discardsLeft <= 0) return null
  const junk = state.hand.map((_, i) => i).filter((i) => !best.sel.includes(i)).slice(0, 5)
  if (!junk.length) return null
  let after
  try { after = applyAction(state, { type: 'discard', cardIdxs: junk }) } catch { return null }
  const post = bestPlay(after)
  if (!post) return null
  return post.v > best.v + 8 ? after : null
}

function playSeed(seedText) {
  CURRENT_SEED_TEXT = seedText
  PLAY_NO = 0
  let s = newGame(seedText)
  let guard = 0
  while (s.phase !== 'game-over' && guard++ < 400) {
    if (s.phase === 'select') {
      const b = bestPlay(s)
      if (!b) break
      const afterDiscard = maybeDiscard(s, b)
      if (afterDiscard) { s = afterDiscard; continue }
      s = b.next
    } else if (s.phase === 'market') {
      // documented purchase policy (see header): priority order below, bought
      // greedily while affordable. The poker-specialization wakes (wake-
      // pellucid / wake-vantage) ARE purchasable by the category-in-hand rule:
      // their regions pay +4/+6 Growth on exact Two Pair / Flush plays toward
      // the Growth targets (since 785556a), so "expansions pay nothing" is
      // STALE — only the non-specialized wakes (wake-laguna/brumal) stay
      // skipped, and mycorrhiza/fifth-counsel stay skipped as before.
      let bought = true
      while (bought) {
        bought = false
        const order = ['canopy-choir', 'seed-vaults', 'barter-routes', 'open-canals', 'stone-masonry', 'fourth-counsel']
        for (const id of order) {
          const item = s.market.find((m) => m.id === id)
          if (!item) continue
          try { s = applyAction(s, { type: 'buy', itemId: id }); bought = true; break } catch {}
        }
        if (bought) continue
        // specialization wakes: buy when affordable AND the corresponding
        // category is IN or NEAR the current hand (2 cards of the shape away
        // or less, at any point in the run). Pellucid pays Two Pair (+4),
        // Vantage pays Flush (+6) — both exceed the wake's Seed cost over the
        // remaining plays when their category shows up even a few times.
        for (const [id, specKind] of [['wake-pellucid', 'twopair'], ['wake-vantage', 'flush']]) {
          const item = s.market.find((m) => m.id === id)
          if (!item) continue
          const r = s.regions.find((x) => x.id === item.wakeRegionId)
          if (!r || !r.dormant) continue // already awake — nothing to buy
          const cost = 12 - s.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
          if (s.seeds < Math.max(1, cost)) continue
          const hand = s.hand
          const suitGroups = new Map()
          for (const c of hand) suitGroups.set(c.s, (suitGroups.get(c.s) ?? 0) + 1)
          const rankGroups = new Map()
          for (const c of hand) rankGroups.set(c.r, (rankGroups.get(c.r) ?? 0) + 1)
          let near = false
          if (specKind === 'twopair') {
            // two pair IN hand (two ranks doubled) or NEAR (one doubled rank + any 2 cards to come)
            let doubled = 0
            for (const n of rankGroups.values()) if (n >= 2) doubled++
            near = doubled >= 2 || (doubled >= 1 && hand.length >= 5)
          } else {
            // flush IN hand (4+ same suit) or NEAR (3 same suit + draws to come)
            for (const n of suitGroups.values()) if (n >= 3) near = true
          }
          if (!near) continue
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

// ---- Calibration vs evaluation seeds (DISJOINT sets) ------------------------
const CALIB_SEEDS = Array.from({ length: 30 }, (_, i) => `probe-${i}`)   // target-sweep set
const EVAL_SEEDS = Array.from({ length: 30 }, (_, i) => `eval-${i}`)     // headline set

function pickSeeds() {
  if (seedArgs.length) return { set: 'explicit', seeds: seedArgs }
  if (SEED_SET === 'calib') return { set: 'calibration (probe-*)', seeds: CALIB_SEEDS }
  if (SEED_SET === 'eval') return { set: 'evaluation (eval-*)', seeds: EVAL_SEEDS }
  return { set: 'both', seeds: null }
}

function runSet(seedList, label) {
  console.log(`\n=== ${label} — bounded solver result (NOT a human win-rate estimate) ===`)
  let wins = 0
  const finals = []
  for (const seed of seedList) {
    const s = playSeed(seed)
    finals.push(s.flourishing)
    if (s.outcome === 'flourishing') wins++
    console.log(`${seed.padEnd(10)} ${String(s.outcome).padEnd(11)} F=${String(s.flourishing).padStart(3)}  lives=${s.lives}  ${s.outcomeReason}`)
  }
  finals.sort((a, b) => a - b)
  const need = EPOCH_TARGETS[TOTAL_EPOCHS - 1].need
  console.log(`${wins}/${seedList.length} wins (${(100 * wins / seedList.length).toFixed(0)}%) — bounded solver (LOOK=${LOOK ?? 'exhaustive'}, need F>=${need}). final F: min ${finals[0]}, median ${finals[finals.length >> 1]}, max ${finals[finals.length - 1]}`)
  return wins
}

const picked = pickSeeds()
if (picked.seeds) {
  runSet(picked.seeds, `${picked.set} seed set`)
} else {
  const calibWins = runSet(CALIB_SEEDS, 'CALIBRATION (probe-*) — for target sweeps only')
  const evalWins = runSet(EVAL_SEEDS, 'EVALUATION (eval-*) — the reported result')
  console.log(`\nSummary: calibration ${calibWins}/30, evaluation ${evalWins}/30 (disjoint seed sets; LOOK=${LOOK ?? 'exhaustive'}).`)
}