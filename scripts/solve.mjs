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
import { newGame, applyAction, buildPlan, epochTarget } from '../src/engine/worldhand.ts'
import { hashSeed } from '../src/engine/rng.ts'
import { evaluateSelection } from '../src/engine/poker.ts'
import { subsets, pokerCandidates } from './lib/candidates.mjs'

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

// candidate generation lives in scripts/lib/candidates.mjs (shared with
// scripts/difficulty-measure.mjs so both evaluate the same move space).
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
const needOf = (epoch) => epochTarget(epoch)
function score(before, after) {
  const df = after.flourishing - before.flourishing // Growth banked this play
  const ds = after.seeds - before.seeds             // Seeds gained this play
  const dl = after.lives - before.lives             // lives change (usually 0)
  const need = needOf(after.epoch)
  const playsLeft = after.playsLeft
  // banked-Growth potential: can the PER-EPOCH target still be reached this
  // epoch? (Growth banked this epoch, not the lifetime total)
  const gap = Math.max(0, need - after.epochGrowth)
  // v8: reachability is measured against this epoch's own per-play share, not
  // a hardcoded 40/play ceiling from the pre-World-Level era.
  const perPlay = need / 4
  const reachable = playsLeft > 0 ? gap <= playsLeft * perPlay * 3 : gap <= 0
  const reachPenalty = reachable ? 0 : 300
  // v8: there is no Seed balance cap; per-PLAY income is capped instead
  // (playSeedCap), so the marginal Seed is worth a flat amount here.
  const seedsWorth = ds * 0.4
  // a life is precious: losing one here is bad; a second loss (0 lives) is terminal-ish
  const lifePenalty = dl < 0 ? (after.lives === 0 ? 400 : 120) : 0
  // surplus above the target is worth much less than closing a gap
  const surplus = after.epochGrowth >= need ? Math.min(df, 30) : 0
  return df * 3 + surplus * 0.5 + seedsWorth - reachPenalty - lifePenalty
}

function bestPlay(state) {
  let best = null
  for (const sel of candidateSubsets(state.hand, LOOK, sampleSalt())) {
    const plan = buildPlan(state.hand, sel, state.laws, [], [], {
      jokers: state.jokers, planetLevels: state.planetLevels, consumables: state.consumables,
      worldLevel: state.worldLevel, vouchers: state.vouchers,
    })
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
  while (s.phase !== 'game-over' && guard++ < 2000) {
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
      let marketBuys = 0
      while (bought && marketBuys < 8) {
        bought = false
        marketBuys++
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
        if (bought) continue
        // Jokers: buy the cheapest affordable joker (build a scaling engine).
        let bestJoker = null
        for (const j of s.jokerMarket) {
          if (s.seeds >= j.cost && (!bestJoker || j.cost < bestJoker.cost)) bestJoker = j
        }
        if (bestJoker) {
          try { s = applyAction(s, { type: 'buyJoker', jokerId: bestJoker.id }); bought = true } catch {}
        }
        if (bought) continue
        // Planet cards: buy the cheapest affordable planet (raise a hand mult).
        let bestPlanet = null
        for (const p of s.planetMarket) {
          if (s.seeds >= p.cost && (!bestPlanet || p.cost < bestPlanet.cost)) bestPlanet = p
        }
        if (bestPlanet) {
          try { s = applyAction(s, { type: 'buyPlanet', planetId: bestPlanet.id }); bought = true } catch {}
        }
        if (bought) continue
        // World Projects: buy the cheapest affordable project (repeatable
        // Seed-sink — growth/score/dev projects all improve the world).
        let bestProj = null
        for (const p of s.projectMarket) {
          const owned = s.projects.filter((x) => x.id === p.id).length
          const cost = p.baseCost + owned * p.costGrowth
          if (s.seeds >= cost && (!bestProj || cost < bestProj.cost)) bestProj = { p, cost }
        }
        if (bestProj) {
          try { s = applyAction(s, { type: 'buyProject', projectId: bestProj.p.id }); bought = true } catch {}
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
  const depths = []
  for (const seed of seedList) {
    const s = playSeed(seed)
    depths.push(s.epoch)
    console.log(`${seed.padEnd(10)} ended at epoch ${String(s.epoch).padStart(2)}  F=${String(s.flourishing).padStart(5)}  lives=${s.lives}  ${s.outcomeReason}`)
  }
  depths.sort((a, b) => a - b)
  const min = depths[0], med = depths[depths.length >> 1], max = depths[depths.length - 1]
  console.log(`run depth (epochs reached): min ${min}, median ${med}, max ${max} — bounded solver (LOOK=${LOOK ?? 'exhaustive'}).`)
  return depths
}

const picked = pickSeeds()
if (picked.seeds) {
  runSet(picked.seeds, `${picked.set} seed set`)
} else {
  const calibWins = runSet(CALIB_SEEDS, 'CALIBRATION (probe-*) — for target sweeps only')
  const evalWins = runSet(EVAL_SEEDS, 'EVALUATION (eval-*) — the reported result')
  console.log(`\nSummary: calibration ${calibWins}/30, evaluation ${evalWins}/30 (disjoint seed sets; LOOK=${LOOK ?? 'exhaustive'}).`)
}