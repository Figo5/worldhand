// Independent review probe — v2 engine contract checks.
import { newGame, applyAction, preview, buildPlan, suitMajority, cardConservation,
  checkWithering, EPOCH_TARGETS, PLAYS_PER_EPOCH,
  HAND_SIZE, TOTAL_EPOCHS } from '../src/engine/worldhand.ts'
import { evaluateSelection, compareHands, CATEGORY_POINTS } from '../src/engine/poker.ts'

const out = []
const log = (k, v) => out.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)

// 1. Multi-card selection (1–5) + exact scoring-card/kicker behavior
{
  let s = newGame('probe-multiselect')
  for (let i = 0; i < 5; i++) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
  log('multi-select-5', s.selected.length === 5)
  s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
  log('multi-select-toggle-off', s.selected.length === 4)
  s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
  log('multi-select-toggle-on', s.selected.length === 5)
  try { applyAction(s, { type: 'toggleCard', cardIdx: 5 }); log('max5-enforced', false) }
  catch { log('max5-enforced', true) }
  // kicker exactness via evaluateSelection keys
  const p1 = evaluateSelection([{r:14,s:'S'},{r:14,s:'H'},{r:13,s:'D'},{r:12,s:'C'},{r:11,s:'S'}])
  const p2 = evaluateSelection([{r:14,s:'C'},{r:14,s:'D'},{r:13,s:'H'},{r:12,s:'S'},{r:10,s:'H'}])
  log('kicker-KQJ-beats-KQ10', compareHands(p1, p2) > 0)
  const t2 = evaluateSelection([{r:14,s:'C'},{r:14,s:'D'},{r:13,s:'H'},{r:12,s:'S'},{r:11,s:'H'}])
  log('tie-keys-equal', compareHands(p1, t2) === 0)
}

// 2. Tie influence choice
{
  const m1 = suitMajority([{r:5,s:'H'},{r:6,s:'D'}])            // default H (S,H,D,C order)
  const m2 = suitMajority([{r:5,s:'H'},{r:6,s:'D'}], 'D')       // explicit choice D
  log('tie-default-H', m1.suit === 'H' && m1.decision === 'tiebreak-first')
  log('tie-choice-D', m2.suit === 'D' && m2.decision === 'tiebreak-choice')
  // 2v2 tie among suits
  const m3 = suitMajority([{r:5,s:'H'},{r:6,s:'H'},{r:7,s:'C'},{r:8,s:'C'}])
  log('tie-2v2-default-C', m3.suit === 'C') // C later in S,H,D,C? No: H before C → H
  // plan-level tie choice affects effects
  const s0 = newGame('probe-tie')
  const pH = buildPlan([{r:5,s:'H'},{r:6,s:'D'}], [0,1], s0.regions, [], 'H')
  const pD = buildPlan([{r:5,s:'H'},{r:6,s:'D'}], [0,1], s0.regions, [], 'D')
  log('plan-tie-H-effect', pH.suit === 'H' && pH.effects[0].kind === 'flourishing')
  log('plan-tie-D-effect', pD.suit === 'D' && pD.effects[0].kind === 'seeds')
}

// 3. Preview equals commit
{
  let s = newGame('probe-pvcommit')
  s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
  s = applyAction(s, { type: 'toggleCard', cardIdx: 2 })
  const pv = preview(s)
  const before = { f: s.flourishing, seeds: s.seeds, stab: s.regions.map(r => r.stability) }
  const s2 = applyAction(s, { type: 'play' })
  const committed = s2.lastResolution
  log('preview-eq-commit-category', committed.category === pv.category)
  log('preview-eq-commit-suit', committed.suit === pv.suit)
  log('preview-eq-commit-effects', JSON.stringify(committed.effects) === JSON.stringify(pv.effects))
  const appliedOk = pv.effects.every(e => {
    if (e.kind === 'flourishing') return s2.flourishing === before.f + e.amount
    if (e.kind === 'seeds') return s2.seeds === Math.min(30, before.seeds + e.amount)
    if (e.kind === 'stability') return s2.regions[e.regionId].stability === Math.min(10, before.stab[e.regionId] + e.amount)
    return true
  })
  log('preview-eq-commit-applied', appliedOk)
  log('preview-summary', pv.summary)
}

// 4. Refill / card conservation across a full chaotic run
{
  let s = newGame('probe-conservation')
  const totals = new Set()
  const checks = { play: 0, discard: 0, buy: 0, violations: 0 }
  let guard = 0
  while (s.phase !== 'game-over' && guard < 400) {
    guard++
    totals.add(s.hand.length + s.deckRest.length + s.discardPile.length)
    if (!cardConservation(s)) checks.violations++
    if (s.phase === 'select') {
      if (s.discardsLeft > 0 && s.hand.length >= 3) {
        s = applyAction(s, { type: 'discard', cardIdxs: [0, 1, 2] }); checks.discard++
      } else {
        s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
        s = applyAction(s, { type: 'play' }); checks.play++
      }
    } else if (s.phase === 'market') {
      if (s.market.length && s.seeds >= 15) { s = applyAction(s, { type: 'buy', itemId: s.market[0].id }); checks.buy++ }
      else s = applyAction(s, { type: 'endMarket' })
    } else if (s.phase === 'epoch-end') s = applyAction(s, { type: 'closeEpoch' })
    else break
  }
  log('conservation-totals', [...totals]) // expect [52]
  log('conservation-violations', checks.violations)
  log('conservation-actions', checks)
  log('conservation-terminated', s.phase + ' e' + s.epoch)
}

// 5. Discard replacement determinism
{
  let s = newGame('probe-discard')
  const s2a = applyAction(newGame('probe-discard'), { type: 'discard', cardIdxs: [0, 1] })
  const s2b = applyAction(newGame('probe-discard'), { type: 'discard', cardIdxs: [0, 1] })
  log('discard-deterministic', JSON.stringify(s2a.hand) === JSON.stringify(s2b.hand))
  log('discard-refills-to-8', s2a.hand.length === HAND_SIZE)
  log('discard-budget-decrements-once', s2a.discardsLeft === 2)
}

// 6. Three-epoch progression + escalating targets (ONE Growth target per epoch)
log('epoch-targets-escalating', EPOCH_TARGETS.map(t => t.need).join(',') === '50,120,200')
log('total-epochs', TOTAL_EPOCHS)
log('plays-per-epoch', PLAYS_PER_EPOCH)
{
  let s = newGame('probe-progression')
  const steps = []
  let guard = 0
  while (s.phase !== 'game-over' && guard < 300) {
    guard++
    if (s.phase === 'select') {
      s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
      s = applyAction(s, { type: 'play' })
    } else if (s.phase === 'market') s = applyAction(s, { type: 'endMarket' })
    else if (s.phase === 'epoch-end') s = applyAction(s, { type: 'closeEpoch' })
    else break
    if (s.phase === 'select') steps.push(`e${s.epoch} f${s.flourishing} stab${s.regions.filter(r=>!r.dormant).reduce((n,r)=>n+r.stability,0)}`)
  }
  log('progression-epochs', [...new Set(steps.map(x => x[1]))].length) // distinct epochs reached
  log('progression-final', { epoch: s.epoch, outcome: s.outcome, reason: s.outcomeReason })
}

// 7. Withering + flourish-zero boundary (both must fire)
{
  let s = newGame('probe-wither')
  s.regions[4].dormant = false; s.regions[5].dormant = false
  for (const r of s.regions) if (!r.dormant) r.stability = 0
  log('withering-fires', checkWithering(s).phase === 'game-over')
  let z = newGame('probe-zero')
  z.flourishing = 0; z.phase = 'epoch-end'
  const z2 = applyAction(z, { type: 'closeEpoch' })
  log('flourish-zero-boundary-ends', z2.phase === 'game-over' && z2.outcome === 'withered')
}

console.log(out.join('\n'))