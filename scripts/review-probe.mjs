// Independent review probe — exercises engine contracts from the task checklist.
// Writes results to stdout; no engine modifications.
import { newGame, applyAction, checkWithering, challengeMet, legalActions,
  TOTAL_EPOCHS, HANDS_PER_EPOCH, HAND_SIZE, DISCARDS_PER_HAND, FLOURISH_TARGET } from '../src/engine/worldhand.ts'
import { evaluate, compareHands, deck, cardName } from '../src/engine/poker.ts'
import { Rng, hashSeed } from '../src/engine/rng.ts'

const out = []
const log = (k, v) => out.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)

// 1. Multi-card selection + exact scoring-card/kicker behavior
// evaluate() picks best 5-of-8; there is no multi-card play path in applyAction ('play' takes one cardIdx).
const h = [
  {r:14,s:'S'},{r:14,s:'H'},{r:9,s:'D'},{r:9,s:'C'},{r:9,s:'S'},{r:2,s:'H'},{r:3,s:'D'},{r:7,s:'C'},
]
const ev = evaluate(h)
log('best-5-of-8', ev) // expect full-house 9s over 9s
// kicker exactness: pair of A w/ KQJ kickers vs pair of A w/ KQ10
const p1 = evaluate([{r:14,s:'S'},{r:14,s:'H'},{r:13,s:'D'},{r:12,s:'C'},{r:11,s:'S'}])
const p2 = evaluate([{r:14,s:'C'},{r:14,s:'D'},{r:13,s:'H'},{r:12,s:'S'},{r:10,s:'H'}])
log('kicker-KQJ-vs-KQ10', compareHands(p1, p2)) // expect > 0
// tie: identical ranks different suits → compare 0
const t1 = evaluate([{r:14,s:'S'},{r:14,s:'H'},{r:13,s:'D'},{r:12,s:'C'},{r:11,s:'S'}])
const t2 = evaluate([{r:14,s:'C'},{r:14,s:'D'},{r:13,s:'H'},{r:12,s:'S'},{r:11,s:'H'}])
log('tie-key-equal', compareHands(t1, t2))

// 2. Card conservation over a full scripted run
{
  let s = newGame('conservation-probe')
  const total = () => s.hand.length + s.deckRest.length + s.discardPile.length + s.market.length
  let deviations = []
  let guard = 0
  const counts = new Set()
  while (s.phase !== 'game-over' && guard < 500) {
    guard++
    counts.add(total())
    if (s.phase === 'law') s = applyAction(s, { type: 'skipLaw' })
    else if (s.phase === 'hand') {
      // mix: discard first card if budget allows, buy if affordable, else advance
      if (s.discardsLeft > 0 && s.hand.length) s = applyAction(s, { type: 'discard', cardIdx: 0 })
      else if (s.market.length && s.seeds >= 10) s = applyAction(s, { type: 'buyCard', offerIdx: 0 })
      else s = applyAction(s, { type: 'advance' })
    }
    if (total() !== 52) deviations.push({ epoch: s.epoch, total: total() })
  }
  log('card-conservation-total', [...counts]) // should be exactly [52]
  log('card-conservation-deviations', deviations.length)
  log('run-terminated', s.phase)
  log('epochs-reached', s.epoch)
}

// 3. Deck refill / reshuffle determinism: force a tiny deck state
{
  let s = newGame('refill-probe')
  // drain deck to 1 card, put rest in discard, then deal
  s.deckRest = [{r:2,s:'S'}]
  s.discardPile = deck().filter(c => !(c.r === 2 && c.s === 'S'))
  const before = s.discardPile.length
  const s2 = applyAction(s, { type: 'advance' }) // pushes hand to discard, deals next hand
  log('refill-hand-size', s2.hand.length) // expect 8
  log('refill-discard-consumed', before - s2.discardPile.length >= 0)
  log('refill-deck-rest', s2.deckRest.length)
  log('refill-total', s2.hand.length + s2.deckRest.length + s2.discardPile.length + s2.market.length)
}

// 4. Three-epoch progression with escalating targets
{
  let s = newGame('progression-probe')
  const targets = []
  let prevFlourish = s.flourishing
  for (let ep = 1; ep <= 3; ep++) {
    while (s.phase !== 'game-over' && s.epoch <= ep && guardOK(s)) {
      if (s.phase === 'law') s = applyAction(s, { type: 'skipLaw' })
      else if (s.phase === 'hand') s = applyAction(s, { type: 'advance' })
      else break
    }
    targets.push({ epoch: s.epoch, phase: s.phase, flourishing: s.flourishing })
    prevFlourish = s.flourishing
    if (s.phase === 'game-over') break
  }
  log('three-epoch-progression', targets)
  log('target-constant-12', FLOURISH_TARGET) // escalation check: target never changes → no escalation mechanic
}
function guardOK(s) { return s.phase === 'hand' || s.phase === 'law' }

// 5. Flourishing <= 0 boundary rule (documented but per prior review unimplemented)
{
  let s = newGame('flourish-zero-probe')
  s.flourishing = 0
  const s2 = applyAction(s, { type: 'advance' })
  log('flourish-zero-ends-game', s2.phase === 'game-over') // RULES.md says it should
}

// 6. Withering organic reachability: force decay without tending
{
  let s = newGame('wither-probe')
  // wake all dormant, zero stability, then advance an epoch boundary
  s.regions.forEach(r => { r.dormant = false; r.stability = 0 })
  const s2 = checkWithering(s)
  log('withering-fires-on-5-dead', s2.phase === 'game-over')
}

// 7. Quit-preserving save semantics (save.ts is localStorage; engine side can't test here)
log('legalActions-discard-only', legalActions(newGame('legal2')).every(a => a.type === 'discard'))

// 8. Determinism double-check across newGame twice
log('determinism-equal', JSON.stringify(newGame('det-x')) === JSON.stringify(newGame('det-x')))

console.log(out.join('\n'))