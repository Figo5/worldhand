import { newGame, applyAction, buildPlan } from '../src/engine/worldhand.ts'

const LOOK = 30
function candidateSubsets(hand, look) {
  const out = []
  const n = hand.length
  for (let mask = 1; mask < (1 << n); mask++) {
    const sel = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sel.push(i)
    if (sel.length > 5) continue
    out.push(sel)
  }
  out.sort((a, b) => a.length - b.length)
  return out.slice(0, look)
}
function bestPlay(state) {
  let best = null
  for (const sel of candidateSubsets(state.hand, LOOK)) {
    const plan = buildPlan(state.hand, sel, state.laws)
    if (!plan.valid) continue
    let next
    try {
      let s = state
      for (const i of sel) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      next = applyAction(s, { type: 'play' })
    } catch { continue }
    if (!best || plan.growth > best.growth) best = { sel, next, growth: plan.growth }
  }
  return best
}
function playSeed(seedText) {
  let s = newGame(seedText)
  let guard = 0
  const banked = []
  while (s.phase !== 'game-over' && guard++ < 2000) {
    if (s.phase === 'select') {
      const b = bestPlay(s)
      if (!b) break
      s = b.next
    } else if (s.phase === 'market') {
      s = applyAction(s, { type: 'endMarket' })
    } else if (s.phase === 'epoch-end') {
      banked.push(s.epochGrowth)
      s = applyAction(s, { type: 'closeEpoch' })
    } else break
  }
  return { epoch: s.epoch, banked }
}
const all = []
for (let i = 0; i < 30; i++) all.push(playSeed('eval-' + i))
const perEpoch = {}
for (const r of all) {
  r.banked.forEach((b, idx) => {
    const e = idx + 1
    if (!perEpoch[e]) perEpoch[e] = []
    perEpoch[e].push(b)
  })
}
for (const e of Object.keys(perEpoch).sort((a, b) => a - b)) {
  const arr = perEpoch[e].sort((a, b) => a - b)
  const med = arr[arr.length >> 1]
  console.log(`epoch ${e}: n=${arr.length} min=${arr[0]} med=${med} max=${arr[arr.length - 1]}`)
}
