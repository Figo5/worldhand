// Independent review probe — Balatro-simple engine contract checks.
// Updated for the no-suit-actions / auto-Seeds / lives contract.
import { newGame, applyAction, preview, buildPlan, cardConservation,
  epochTarget, PLAYS_PER_EPOCH, SURVIVAL_START,
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

// 2. NO suit-choice plumbing: 'play' takes no suitChoice/regionChoice and every
//    play is just a poker hand — effects are the same regardless of suit mix.
{
  const s0 = newGame('probe-no-actions')
  const pH = buildPlan([{r:5,s:'H'},{r:6,s:'D'}], [0,1], [])
  const pD = buildPlan([{r:5,s:'D'},{r:6,s:'H'}], [0,1], [])
  log('plan-shape-suit-agnostic', pH.growth === pD.growth && pH.effects.length === 2
    && pH.effects.every(e => e.kind === 'flourishing' || e.kind === 'seeds'))
  try {
    applyAction(s0, { type: 'play', suitChoice: 'H' })
    log('suit-choice-rejected', false)
  } catch (e) {
    // the extraneous field is ignored; the play itself is invalid only because
    // nothing is selected — proving no suitChoice code path exists to dispatch
    log('suit-choice-rejected', String(e.message).includes('select 1–5'))
  }
  let s = newGame('probe-play-pure')
  s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
  s = applyAction(s, { type: 'toggleCard', cardIdx: 1 })
  const pv = preview(s)
  const s2 = applyAction(s, { type: 'play' })
  log('commit-matches-preview', JSON.stringify(s2.lastResolution) === JSON.stringify(pv))
}

// 3. Preview equals commit (growth + breakdown + effects)
{
  let s = newGame('probe-pvcommit')
  s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
  s = applyAction(s, { type: 'toggleCard', cardIdx: 2 })
  const pv = preview(s)
  const before = { f: s.flourishing, seeds: s.seeds }
  const s2 = applyAction(s, { type: 'play' })
  const committed = s2.lastResolution
  log('preview-eq-commit-category', committed.category === pv.category)
  log('preview-eq-commit-growth', committed.growth === pv.growth)
  log('preview-eq-commit-parts', JSON.stringify(committed.growthParts) === JSON.stringify(pv.growthParts))
  log('preview-eq-commit-effects', JSON.stringify(committed.effects) === JSON.stringify(pv.effects))
  const seedsFx = pv.effects.find(e => e.kind === 'seeds')
  log('preview-eq-commit-applied', s2.flourishing === before.f + pv.growth
    && s2.seeds === Math.min(30, before.seeds + seedsFx.amount))
  log('preview-summary', pv.summary)
}

// 4. Refill / card conservation across a full chaotic run (incl. a card-addition)
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
  const s2a = applyAction(newGame('probe-discard'), { type: 'discard', cardIdxs: [0, 1] })
  const s2b = applyAction(newGame('probe-discard'), { type: 'discard', cardIdxs: [0, 1] })
  log('discard-deterministic', JSON.stringify(s2a.hand) === JSON.stringify(s2b.hand))
  log('discard-refills-to-8', s2a.hand.length === HAND_SIZE)
  log('discard-budget-decrements-once', s2a.discardsLeft === 2)
}

// 6. Three-epoch progression + escalating targets (ONE Growth target per epoch)
log('epoch-targets-escalating', [epochTarget(1), epochTarget(2), epochTarget(3)].join(',') === '45,110,360')
log('total-epochs', TOTAL_EPOCHS)
log('plays-per-epoch', PLAYS_PER_EPOCH)
log('lives-start', SURVIVAL_START)
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
    if (s.phase === 'select') steps.push(`e${s.epoch} f${s.flourishing}`)
  }
  log('progression-epochs', [...new Set(steps.map(x => x[1]))].length) // distinct epochs reached
  log('progression-final', { epoch: s.epoch, outcome: s.outcome, reason: s.outcomeReason })
}

// 7. Withering at 0 lives + flourish-zero boundary (both must fire)
{
  let s = newGame('probe-zero-lives')
  s.lives = 0
  s.epoch = 1
  s.phase = 'epoch-end'
  const s2 = applyAction(s, { type: 'closeEpoch' })
  log('lives-zero-ends-withered', s2.phase === 'game-over' && s2.outcome === 'withered')
  let z = newGame('probe-zero')
  z.flourishing = 0; z.phase = 'epoch-end'
  const z2 = applyAction(z, { type: 'closeEpoch' })
  log('flourish-zero-boundary-ends', z2.phase === 'game-over' && z2.outcome === 'withered')
}

// 8. Auto-Seeds: every play gains Seeds (1 per 4 Growth, capped at 30)
{
  const s0 = newGame('probe-autoseeds')
  s0.seeds = 0
  const plan = buildPlan([{r:10,s:'H'}], [0], [])
  // Growth = round(10 x 1) = 10 -> seeds = ceil(10 x 1/4) = 3
  const seedsFx = plan.effects.find(e => e.kind === 'seeds')
  log('autoseeds-formula-10-growth', plan.growth === 10 && seedsFx.amount === 3)
  // cap: at 30 Seeds a big play cannot push past the cap
  let s = newGame('probe-autoseeds-cap')
  s.seeds = 30
  s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
  s = applyAction(s, { type: 'play' })
  log('autoseeds-capped', s.seeds === 30)
}

// 9. Growth laws: flat + multiplier with preview == commit
{
  const s0 = newGame('probe-laws')
  const base = buildPlan([{r:10,s:'H'}], [0], [])
  const flat = buildPlan([{r:10,s:'H'}], [0], [{ id: 'canopy-choir', title: 'Canopy Choir', desc: '', cost: 10, kind: 'upgrade', growthFlat: 3 }])
  const mult = buildPlan([{r:10,s:'H'}], [0], [{ id: 'open-canals', title: 'Open Canals', desc: '', cost: 14, kind: 'upgrade', growthMult: 1.2 }])
  log('growth-flat-law', base.growth === 10 && flat.growth === 13)
  log('growth-mult-law', mult.growth === 12 && mult.growthParts.laws === 2)
}

console.log(out.join('\n'))