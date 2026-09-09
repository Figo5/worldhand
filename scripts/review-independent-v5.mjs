// Independent v5 review probes (reviewer-added, read-only; no source edits).
// Constructions are the reviewer's own (different seeds/balances/paths from the
// implementation worker's tests):
//   A. Mycorrhiza decay: baseline exactly 1; Mycorrhiza exactly 0 (never a
//      gain); dormant/zero-stability well-defined; income follows stability.
//   B. seedCredit truth table + worked examples 8+16 / 24+16 / 30+16
//      end-to-end (preview == commit == log == balance), partial credit,
//      and the epoch-end income clause.
//   C. Final-epoch flow: exactly-once resolution, no market, no epoch 4,
//      epochs 1–2 unchanged, legacy epoch-end state, reload inert.
//   D. buildPlan default-balance contract (nominal-only plan) documented.
import { newGame, applyAction, preview, buildPlan, seedCredit,
  validateState, MARKET_ITEMS, EPOCH_TARGETS, STABILITY_BASE,
  SEEDS_CAP, SURVIVAL_START, TOTAL_EPOCHS } from '../src/engine/worldhand.ts'

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

// ---------------- B. truthful Seed credit ----------------
{
  ok('B1 seedCredit table (8,16)/(24,16)/(30,16)/(8,0)/(29,3)',
    JSON.stringify(seedCredit(8, 16)) === '{"credited":16,"overflow":0}'
    && JSON.stringify(seedCredit(24, 16)) === '{"credited":6,"overflow":10}'
    && JSON.stringify(seedCredit(30, 16)) === '{"credited":0,"overflow":16}'
    && JSON.stringify(seedCredit(8, 0)) === '{"credited":0,"overflow":0}'
    && JSON.stringify(seedCredit(29, 3)) === '{"credited":1,"overflow":2}')

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
  ok('B2 balance 8 + nominal 16 -> credited 16, balance 24, no overflow clause',
    a.pvFx.amount === 16 && a.pvFx.credited === 16 && a.pvFx.overflow === 0
    && a.committed.seeds === 24 && !a.pv.summary.includes('overflow')
    && a.pv.summary.includes('Gains 16 Seeds'))
  const b = run(24)
  ok('B3 balance 24 + nominal 16 -> credited 6 overflow 10, balance 30, identical text everywhere',
    b.pvFx.credited === 6 && b.pvFx.overflow === 10 && b.committed.seeds === 30
    && b.pv.summary === b.committed.lastResolution.summary
    && b.pv.summary.includes('Gains 16 Seeds (Credited 6; overflow 10)')
    && ((b.committed.log.at(-1) || {}).text || '').includes('(Credited 6; overflow 10)'))
  const c = run(30)
  ok('B4 balance 30 + positive -> credited 0 overflow 16, balance stays 30',
    c.pvFx.credited === 0 && c.pvFx.overflow === 16 && c.committed.seeds === 30
    && c.pv.summary.includes('(Credited 0; overflow 16)'))

  const d = run(29)
  ok('B5 balance 29 + nominal 16 -> credited 1 overflow 15, balance 30',
    d.pvFx.credited === 1 && d.pvFx.overflow === 15 && d.committed.seeds === 30)

  let e = newGame('v5-epochend-cap')
  e.seeds = SEEDS_CAP
  e.flourishing = 100
  e = playOut(e)
  const el = (e.log.find((l) => l.text.startsWith('Epoch end: +')) || {}).text || ''
  ok('B6 epoch-end income at cap: credited 0, overflow = nominal, balance unchanged',
    e.seeds === 30 && el.includes('(Credited 0; overflow 4)'), `"${el}"`)
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

// ---------------- D. buildPlan default-balance contract ----------------
{
  const p = buildPlan([C(10, 'H')], [0], [])
  const fx = seedsFx(p)
  ok('D1 buildPlan without balance: nominal-only plan (amount=3, credited=3, overflow=0)',
    fx.amount === 3 && fx.credited === 3 && fx.overflow === 0)
  const p8 = buildPlan([C(10, 'H')], [0], [], 8)
  ok('D2 buildPlan with balance 8: credited 3 overflow 0', seedsFx(p8).credited === 3)
  const p29 = buildPlan([C(10, 'H')], [0], [], 29)
  ok('D3 buildPlan with balance 29: credited 1 overflow 2', seedsFx(p29).credited === 1 && seedsFx(p29).overflow === 2)
}

const failed = results.filter((r) => !r.pass)
console.log(results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.note && !r.pass ? ` :: ${r.note}` : ''}`).join('\n'))
console.log(`\n${results.length - failed.length}/${results.length} independent v5 probes passed`)
if (failed.length) process.exit(1)