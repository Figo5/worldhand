// Shared bounded candidate generation for the probe scripts (extracted from
// scripts/solve.mjs so the difficulty measurement and the legacy solver
// evaluate the SAME candidate space — a policy comparison is only meaningful
// if both sides see the same moves).
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

function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Category-aware bounded candidate set. With LOOK unset, returns the exhaustive
 *  1–5-card oracle space. With LOOK set, deliberate poker shapes are kept before
 *  the seeded sample so a LOOK=30 player still sees flushes/straights/trips/etc.
 */
function candidateSubsets(hand, look, salt = 1) {
  const all = subsets(hand.length)
  if (!look || look >= all.length) return all
  const candsRaw = pokerCandidates(hand)
  const cands = [
    ...candsRaw.filter((s) => s.length >= 3),
    ...candsRaw.filter((s) => s.length < 3),
  ]
  const keyOf = (s) => [...s].sort((a, b) => a - b).join(',')
  const candKeys = new Set(cands.map(keyOf))
  const rest = all.filter((s) => !candKeys.has(keyOf(s)))
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

export { subsets, pokerCandidates, candidateSubsets }
