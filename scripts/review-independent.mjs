// Independent review probes (read-only against the engine; no edits).
// 1. save validation: legacy/obsolete/invalid states must be rejected
// 2. lives-reach-zero outcome path (engine)
// 3. growth = pokerBase + laws consistency sweep
import { newGame, applyAction, buildPlan, epochTarget } from '../src/engine/worldhand.ts'
import { evaluateSelection } from '../src/engine/poker.ts'

const results = []
const ok = (name, cond) => results.push({ name, pass: !!cond })

// ---- A. structural validation rejects malformed cards at the SAVE gate
// (the fix contract: buildPlan scores honest in-game selections; malformed
// cards can only arrive through a save, and validateState rejects them there —
// they can never enter a live game)
import { validateState, MARKET_ITEMS } from '../src/engine/worldhand.ts'
{
  const base = newGame('probe-validator')
  const clone = (mut) => { const s = JSON.parse(JSON.stringify(base)); mut(s); return s }
  ok('malformed card rank/suit rejected by validateState (not loaded, not scored)',
    validateState(clone(s => { s.hand = [{ r: 1, s: 'Z' }]; s.deckRest.pop() })) !== null)
  ok('rank 1 rejected by validateState',
    validateState(clone(s => { s.hand = [{ r: 1, s: 'H' }]; s.deckRest.pop() })) !== null)
  ok('suit X rejected by validateState',
    validateState(clone(s => { s.hand = [{ r: 5, s: 'X' }]; s.deckRest.pop() })) !== null)
  ok('valid fresh state accepted by validateState', validateState(base) === null)
}

// ---- B. lives reach zero (engine outcome path)
let s = newGame('lives-zero-review')
s.lives = 1
s.epoch = 2
s.flourishing = 3
// a deterministic 4-card hand of rank-4 clubs: each play banks 4 Growth, missing both targets
s = { ...s, hand: [] }
s.hand = [{ r: 4, s: 'C' }, { r: 4, s: 'C' }, { r: 4, s: 'C' }, { r: 4, s: 'C' }]
s.deckRest = s.deckRest.filter((c) => !(c.r === 4 && c.s === 'C')) // avoid dupes; conservation not under test here
for (let i = 0; i < 4; i++) {
  s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
  s = applyAction(s, { type: 'play' })
}
ok('miss with 1 life drains to 0', s.lives === 0)
s = applyAction(s, { type: 'endMarket' })
s = applyAction(s, { type: 'closeEpoch' })
ok('0 lives → game-over withered', s.phase === 'game-over' && s.outcome === 'withered')
ok('outcome reason mentions lives', /lives/i.test(s.outcomeReason))

// ---- C. growth = pokerBase + laws holds for a large sweep
let allConsistent = true
const mults = []
for (let n = 1; n <= 5; n++) {
  const hand = []
  const suits = ['S', 'H', 'D', 'C']
  for (let i = 0; i < n; i++) hand.push({ r: (6 + i * 2) % 15 || 6, s: suits[i % 4] })
  for (const lawSet of [[], [{ id: 'x', title: 'x', desc: '', cost: 1, kind: 'upgrade', growthMult: 1.2, growthFlat: 3 }]]) {
    const plan = buildPlan(hand, hand.map((_, i) => i), lawSet)
    if (!plan.valid) { allConsistent = false; break }
    const sum = plan.growthParts.poker + plan.growthParts.laws
    if (plan.growth !== Math.max(0, sum)) allConsistent = false
    if (plan.pokerBase !== Math.round(plan.rankSum * plan.mult)) allConsistent = false
    mults.push(plan.mult)
  }
}
ok('growth == max(0, poker + laws) and pokerBase == round(rankSum x mult) across sweep', allConsistent)

// category mults seen
const seenMults = new Set()
for (const sel of [[[{ r: 9, s: 'S' }]], [[{ r: 9, s: 'S' }, { r: 9, s: 'H' }]], [[{ r: 9, s: 'S' }, { r: 9, s: 'H' }, { r: 4, s: 'D' }]], [[{ r: 9, s: 'S' }, { r: 9, s: 'H' }, { r: 9, s: 'D' }, { r: 4, s: 'C' }]], [[{ r: 2, s: 'S' }, { r: 3, s: 'S' }, { r: 4, s: 'S' }, { r: 5, s: 'S' }, { r: 6, s: 'S' }]]]) {
  const p = buildPlan(sel[0], sel[0].map((_, i) => i), [])
  seenMults.add(`${p.category}:${p.mult}`)
}
ok('straight-flush mult 8 wired', seenMults.has('straight-flush:8'))

// ---- D. save envelope contents (what save.ts would receive)
const fresh = newGame('save-shape-review')
ok('fresh state carries version 4 + lives (v4 = regional-bonus rules generation)', fresh.version === 4 && fresh.lives === 3)

console.log(JSON.stringify({ results }, null, 2))
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} probes passed`)
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(' - ' + f.name) }