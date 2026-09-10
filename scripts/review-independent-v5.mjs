// Independent v5 review probes (reviewer-added, read-only; no source edits).
// Constructions are the reviewer's own (different seeds/balances/paths from the
// implementation worker's tests):
//   A. Mycorrhiza decay: baseline exactly 1; Mycorrhiza exactly 0 (never a
//      gain); dormant/zero-stability well-defined; income follows stability.
//   B. uncapped Seed accumulation: every play banks the full nominal earn
//      (no credited/overflow split), end-to-end (preview == commit == log ==
//      balance), and the epoch-end income line.
//   C. Final-epoch flow: exactly-once resolution, no market, no epoch 4,
//      epochs 1–2 unchanged, legacy epoch-end state, reload inert.
//   D. buildPlan contract (no balance param — the plan is balance-agnostic).
import { newGame, applyAction, preview, buildPlan,
  validateState, MARKET_ITEMS, EPOCH_TARGETS, STABILITY_BASE,
  SURVIVAL_START, TOTAL_EPOCHS } from '../src/engine/worldhand.ts'

const results = []
const ok = (name, cond, note) => results.push({ name, pass: !!cond, note })
const C = (r, s) => ({ r, s })

const MYCO = MARKET_ITEMS.find((m) => m.id === 'mycorrhiza')

function forceHand(s, cards) {
  // conservation-legal hand swap (displaced cards return to the deck pool)
  return { ...s, hand: [...cards], deckRest: [...s.hand, ...s.deckRest.slice(cards.length)] }
}
const seedsFx = (p) => p.effects.find((e) => e.kind === 'seeds')
function playOut(s) {
  s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
  for (let i = 0; i < 4; i++) {
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
  }
  return s
}
// strong two pair: chips 32 x 2 = 64 Growth -> nominal 16
const TWOPAIR = [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')]

// ---------------- A. Mycorrhiza decay ----------------
{
  let s = playOut(newGame('v5-decay-baseline'))
  ok('A1 baseline: living decay exactly 1, dormant frozen',
    s.regions.every((r) => r.dormant ? r.stability === STABILITY_BASE : r.stability === STABILITY_BASE - 1),
    `stab=${s.regions.map((r) => r.stability).join(',')}`)

  // decay=0 means EVERY region's stability is untouched (living AND dormant):
  // snapshot before, compare after — 9 stays 9, dormant stays frozen
  let m = newGame('v5-decay-myco-xyz')
  m.laws = [{ ...MYCO }]
  m.regions[2].stability = 9 // id 2 = Calder, one of the 4 AWAKE regions
  m.regions[7].stability = 5 // id 7 = Harrow, dormant
  const before = m.regions.map((r) => r.stability)
  m = playOut(m)
  ok('A2 Mycorrhiza: decay exactly 0 — every stability untouched (living 9 stays 9, not 8, not 10)',
    m.regions.every((r, i) => r.stability === before[i])
    && m.regions[2].stability === 9 && m.regions[7].stability === 5)

  let z = newGame('v5-decay-zero')
  z.laws = [{ ...MYCO }]
  z.regions[0].stability = 0
  z.regions[7].stability = 0
  z = playOut(z)
  ok('A3 dormant/zero-stability well-defined (0 stays 0, all >= 0)',
    z.regions[0].stability === 0 && z.regions[7].stability === 0 && z.regions.every((r) => r.stability >= 0))

  let w = newGame('v5-income-myco')
  w.laws = [{ ...MYCO }]
  w.flourishing = 100 // target met -> no halving
  w.regions[0].stability = 1
  w.regions[1].stability = 1
  w = playOut(w)
  let n = newGame('v5-income-plain')
  n.flourishing = 100
  n.regions[0].stability = 1
  n.regions[1].stability = 1
  n = playOut(n)
  const wi = (w.log.find((l) => l.text.startsWith('Epoch end: +')) || {}).text || ''
  const ni = (n.log.find((l) => l.text.startsWith('Epoch end: +')) || {}).text || ''
  ok('A4 income reads resulting stability: Myco +4 vs plain +2 (decayed-out regions stop paying)',
    wi.includes('Epoch end: +4 Seeds') && ni.includes('Epoch end: +2 Seeds'), `myco="${wi}" plain="${ni}"`)
  ok('A5 market desc states the real mechanic (1 less / 0)',
    MYCO.desc.includes('1 less') && MYCO.desc.includes('0'), `"${MYCO.desc}"`)
}

// ---------------- B. uncapped Seed accumulation ----------------
{
  ok('B1 every play banks the full nominal earn (no credited/overflow split)',
    seedsFx(buildPlan([C(10, 'H')], [0], [])).amount === 3)

  const run = (seeds) => {
    let s = newGame(`v5-credit-${seeds}-zz`)
    s.seeds = seeds
    s = forceHand(s, TWOPAIR)
    for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    const pv = preview(s)
    const committed = applyAction(s, { type: 'play' })
    return { pv, committed, pvFx: seedsFx(pv), cFx: seedsFx(committed.lastResolution) }
  }
  const a = run(8)
  ok('B2 balance 8 + nominal 16 -> balance 24, no overflow clause',
    a.pvFx.amount === 16 && a.committed.seeds === 24 && !a.pv.summary.includes('overflow')
    && a.pv.summary.includes('Gains 16 Seeds'))
  const b = run(24)
  ok('B3 balance 24 + nominal 16 -> balance 40 (uncapped), identical text everywhere',
    b.pvFx.amount === 16 && b.committed.seeds === 40
    && b.pv.summary === b.committed.lastResolution.summary
    && b.pv.summary.includes('Gains 16 Seeds')
    && !b.pv.summary.includes('overflow'))
  const c = run(30)
  ok('B4 balance 30 + nominal 16 -> balance 46 (uncapped, no credited/overflow)',
    c.pvFx.amount === 16 && c.committed.seeds === 46
    && !c.pv.summary.includes('overflow'))

  const d = run(29)
  ok('B5 balance 29 + nominal 16 -> balance 45 (uncapped)',
    d.pvFx.amount === 16 && d.committed.seeds === 45)

  let e = newGame('v5-epochend-uncapped')
  e.seeds = 30
  e.flourishing = 100
  e = playOut(e)
  const el = (e.log.find((l) => l.text.startsWith('Epoch end: +')) || {}).text || ''
  ok('B6 epoch-end income is banked in full (no cap, no overflow clause)',
    e.seeds === 30 + 4 + 4 && el.includes('Epoch end: +4 Seeds') && !el.includes('overflow'), `"${el}" seeds=${e.seeds}`)
}

// ---------------- C. final-epoch flow ----------------
{
  let s = newGame('v5-final-miss')
  s.epoch = 3; s.flourishing = 1; s.lives = 2; s.phase = 'select'
  s = playOut(s)
  ok('C1 final miss -> game-over directly, market empty, life cost exactly once',
    s.phase === 'game-over' && s.outcome === 'withered' && s.lives === 1 && s.market.length === 0
    && s.log.filter((l) => l.text.includes('a life is lost')).length === 1
    && s.log.filter((l) => l.text.startsWith('Epoch end: +')).length === 1)

  let w = newGame('v5-final-win')
  w.epoch = 3; w.flourishing = 400; w.phase = 'select'
  w = playOut(w)
  ok('C2 final win -> flourishing verdict, no "epoch 4" text anywhere',
    w.phase === 'game-over' && w.outcome === 'flourishing'
    && !/epoch 4/i.test(JSON.stringify(w.log)) && !/epoch 4/i.test(w.outcomeReason))

  let z = newGame('v5-final-zero')
  z.epoch = 3; z.flourishing = 1; z.lives = 1; z.phase = 'select'
  z = playOut(z)
  ok('C3 0-lives final miss -> withered exactly once (one deduction, one income line)',
    z.phase === 'game-over' && z.outcome === 'withered' && z.lives === 0
    && z.log.filter((l) => l.text.includes('a life is lost')).length === 1
    && z.log.filter((l) => l.text.startsWith('Epoch end: +')).length === 1)

  let e1 = playOut(newGame('v5-early-flow'))
  const m1 = e1.phase === 'market' && e1.epoch === 1
  e1 = applyAction(e1, { type: 'endMarket' })
  e1 = applyAction(e1, { type: 'closeEpoch' })
  const adv1 = e1.epoch === 2 && e1.phase === 'select'
  let e2 = playOut(e1)
  const m2 = e2.phase === 'market' && e2.epoch === 2
  e2 = applyAction(e2, { type: 'endMarket' })
  e2 = applyAction(e2, { type: 'closeEpoch' })
  const adv2 = e2.epoch === 3 && e2.phase === 'select'
  ok('C4 epochs 1–2 keep the exact market -> epoch-end -> advance flow', m1 && adv1 && m2 && adv2,
    `m1=${m1} adv1=${adv1} m2=${m2} adv2=${adv2}`)

  const lg = newGame('v5-legacy-end')
  lg.epoch = 3; lg.phase = 'epoch-end'; lg.flourishing = EPOCH_TARGETS[2].need + 7
  const lg2 = applyAction(lg, { type: 'closeEpoch' })
  ok('C5 legacy epoch-end@3 closeEpoch -> verdict, no epoch 4',
    lg2.phase === 'game-over' && lg2.outcome === 'flourishing'
    && !/epoch 4/i.test(JSON.stringify(lg2.log)))

  const done = newGame('v5-reload-inert')
  done.epoch = 3; done.flourishing = 420; done.phase = 'select'
  const fin = playOut(done)
  const j = JSON.parse(JSON.stringify(fin)) // simulates the save/reload round-trip
  const valid = validateState(j) === null
  // inertness = CONTENT invariance: applyAction clones by design, so compare
  // the fields that a duplicated reward/deduction would move (plus phase/outcome/log)
  const after1 = applyAction(j, { type: 'play' })
  const after2 = applyAction(j, { type: 'closeEpoch' })
  const after3 = applyAction(j, { type: 'buy', itemId: 'canopy-choir' })
  const same = (a) => JSON.stringify([a.phase, a.outcome, a.seeds, a.lives, a.flourishing, a.log]) === JSON.stringify([j.phase, j.outcome, j.seeds, j.lives, j.flourishing, j.log])
  ok('C6 reload: finished state valid + inert (play/closeEpoch/buy change nothing, nothing duplicated)',
    valid && same(after1) && same(after2) && same(after3),
    `valid=${valid} seeds=${j.seeds} lives=${j.lives} f=${j.flourishing}`)
}

// ---------------- D. buildPlan contract (no balance param) ----------------
{
  const p = buildPlan([C(10, 'H')], [0], [])
  const fx = seedsFx(p)
  ok('D1 buildPlan: balance-agnostic plan (amount=3, no credited/overflow)',
    fx.amount === 3 && fx.credited === undefined && fx.overflow === undefined)
}

const failed = results.filter((r) => !r.pass)
console.log(results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.note && !r.pass ? ` :: ${r.note}` : ''}`).join('\n'))
console.log(`\n${results.length - failed.length}/${results.length} independent v5 probes passed`)
if (failed.length) process.exit(1)