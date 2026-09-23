// CLASSIC REPLAY FIXTURES — records deterministic action logs of whole Classic
// runs into tests/fixtures/classic-replays.json. tests/classic-replays.test.ts
// replays every log through the engine and requires the same state hash at
// every epoch boundary and the same final state.
//
// The fixture is the Classic regression fence: re-record ONLY for a deliberate
// rules change (bump SAVE_VERSION and say so in the commit), never to make a
// failing replay pass.
//
// Policies (frozen; all seeded, all bounded at EPOCH_CAP):
//   greedy-noshop     best play (shared candidate space) + pace discard, buys nothing
//   greedy-cheapest   same play + cheapest-affordable-first shop
//   greedy-scattered  same play + seeded random affordable purchases (laws included)
//   exerciser         seeded mix of every action type (toggle/clear, random
//                     discards, all shelves, consumables, removeLaw) around greedy
//                     play. It never removes an expansion law: that path has
//                     its own unit test.
//
// Run: node --import ./scripts/ts-resolve.mjs scripts/record-classic-replays.mjs
import { writeFileSync } from 'node:fs'
import {
  newGame, applyAction, buildPlan, epochTarget, planetCost, worldScore,
  SAVE_VERSION, SCHEMA_VERSION,
} from '../src/engine/worldhand.ts'
import { Rng, hashSeed } from '../src/engine/rng.ts'
import { candidateSubsets } from './lib/candidates.mjs'
import { encodeAction, stateHash } from './lib/replay-codec.mjs'

const OUT = 'tests/fixtures/classic-replays.json'
const SEEDS = Array.from({ length: 10 }, (_, i) => `replay-${i}`)
const POLICIES = ['greedy-noshop', 'greedy-cheapest', 'greedy-scattered', 'exerciser']
const LOOK = 30
const EPOCH_CAP = 25

const ctxOf = (s) => ({
  jokers: s.jokers, planetLevels: s.planetLevels, consumables: s.consumables,
  worldLevel: s.worldLevel, vouchers: s.vouchers, epoch: s.epoch,
})

function bestPlay(s) {
  let best = null
  for (const sel of candidateSubsets(s.hand, LOOK, hashSeed(`${s.seedText}:${s.epoch}:${s.playsLeft}:${s.discardsLeft}`))) {
    const plan = buildPlan(s.hand, sel, s.laws, s.regions, s.projects, ctxOf(s))
    if (plan.valid && (!best || plan.growth > best.growth)) best = { sel, growth: plan.growth }
  }
  return best
}

const shelfActions = (s) => [
  ...s.market.map((m) => ({ type: 'buy', itemId: m.id })),
  ...s.jokerMarket.map((j) => ({ type: 'buyJoker', jokerId: j.id })),
  ...s.planetMarket.map((p) => ({ type: 'buyPlanet', planetId: p.id })),
  ...s.voucherMarket.map((v) => ({ type: 'buyVoucher', voucherId: v.id })),
  ...s.projectMarket.map((p) => ({ type: 'buyProject', projectId: p.id })),
  ...s.consumableMarket.map((c) => ({ type: 'buyConsumable', consumableId: c.id })),
  { type: 'boostWorld' },
]

function record(seedText, policy) {
  let s = newGame(seedText)
  const rng = new Rng(hashSeed(`${policy}:${seedText}`))
  const actions = []
  const epochHashes = []
  const act = (a) => {
    s = applyAction(s, a) // throws before assignment on an illegal action
    actions.push(encodeAction(a))
    if (a.type === 'closeEpoch') epochHashes.push(stateHash(s))
  }
  const tryAct = (a) => { try { act(a); return true } catch { return false } }

  const greedyPlay = () => {
    const b = bestPlay(s)
    const pace = s.playsLeft > 0 ? Math.max(0, epochTarget(s.epoch) - s.epochGrowth) / s.playsLeft : 0
    if (b.growth < pace && s.discardsLeft > 0) {
      const junk = s.hand.map((_, i) => i).filter((i) => !b.sel.includes(i)).slice(0, 5)
      if (junk.length && tryAct({ type: 'discard', cardIdxs: junk })) return
    }
    for (const i of b.sel) act({ type: 'toggleCard', cardIdx: i })
    act({ type: 'play' })
  }

  const select = () => {
    if (policy !== 'exerciser') return greedyPlay()
    const r = rng.next()
    if (r < 0.1) { act({ type: 'toggleCard', cardIdx: rng.int(0, s.hand.length) }); act({ type: 'clearSelection' }); return }
    if (r < 0.25 && s.discardsLeft > 0) {
      const idxs = rng.shuffle(s.hand.map((_, i) => i)).slice(0, rng.int(1, 4))
      act({ type: 'discard', cardIdxs: idxs })
      return
    }
    greedyPlay()
  }

  const market = () => {
    if (policy === 'greedy-cheapest') {
      for (let progress = true, guard = 0; progress && guard < 64; guard++) {
        progress = [
          [...s.jokerMarket].sort((a, b) => a.cost - b.cost).map((j) => ({ type: 'buyJoker', jokerId: j.id })),
          [...s.planetMarket].sort((a, b) => planetCost(a, s.planetLevels) - planetCost(b, s.planetLevels)).map((p) => ({ type: 'buyPlanet', planetId: p.id })),
          [...s.voucherMarket].sort((a, b) => a.cost - b.cost).map((v) => ({ type: 'buyVoucher', voucherId: v.id })),
          [{ type: 'boostWorld' }],
          s.projectMarket.map((p) => ({ type: 'buyProject', projectId: p.id })),
        ].some((list) => list.some(tryAct))
      }
    } else if (policy === 'greedy-scattered') {
      for (let guard = 0; guard < 64; guard++) {
        if (!rng.shuffle(shelfActions(s)).some(tryAct)) break
      }
    } else if (policy === 'exerciser') {
      for (let i = 0; i < 6; i++) {
        const removable = s.laws.filter((l) => l.kind !== 'expansion')
        if (removable.length && rng.next() < 0.15) act({ type: 'removeLaw', lawId: rng.pick(removable).id })
        else tryAct(rng.pick(shelfActions(s)))
      }
    }
    act({ type: 'endMarket' })
  }

  for (let guard = 0; s.phase !== 'game-over' && s.epoch <= EPOCH_CAP && guard < 20000; guard++) {
    if (s.phase === 'select') select()
    else if (s.phase === 'market') market()
    else if (s.phase === 'epoch-end') act({ type: 'closeEpoch' })
  }
  return {
    policy, seed: seedText, actions: actions.join(' '), epochHashes,
    final: {
      hash: stateHash(s), epoch: s.epoch, phase: s.phase, lives: s.lives,
      flourishing: s.flourishing, seeds: s.seeds, worldScore: worldScore(s),
    },
  }
}

const runs = POLICIES.flatMap((p) => SEEDS.map((seed) => record(seed, p)))
writeFileSync(OUT, JSON.stringify({
  about: 'Classic regression fence. Generated by scripts/record-classic-replays.mjs; replayed by tests/classic-replays.test.ts. Re-record only for a deliberate rules change.',
  engine: { SAVE_VERSION, SCHEMA_VERSION },
  runs,
}, null, 1) + '\n')
for (const p of POLICIES) {
  const rs = runs.filter((r) => r.policy === p)
  console.log(`${p.padEnd(17)} epochs ${rs.map((r) => r.final.epoch).join(' ')}  actions ${rs.reduce((n, r) => n + r.actions.split(' ').length, 0)}`)
}
console.log(`wrote ${OUT} (${runs.length} runs)`)
