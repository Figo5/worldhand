// Regression tests for the three playtest defects (TDD — written FIRST, before
// the fixes). Each describe block pins the corrected contract:
//   FIX 1 — Mycorrhiza decay: decayDelta −1 ⇒ living-region decay is exactly ZERO.
//   FIX 2 — truthful Seed credit: nominal vs credited vs overflow, ONE shared
//           contract (seedCredit) read by preview, commit and the chronicle.
//   FIX 3 — final-epoch flow: the last hand resolves target + life + verdict
//           EXACTLY ONCE, with no market phase and no advertised epoch 4.
import { describe, it, expect } from 'vitest'
import {
  newGame, applyAction, preview, buildPlan, seedCredit,
  SEEDS_PER_GROWTH, SEEDS_CAP, MARKET_ITEMS, EPOCH_TARGETS,
  STABILITY_BASE, SURVIVAL_START, TOTAL_EPOCHS, validateState,
  type GameState, type PlanEffect,
} from '../src/engine/worldhand'
import type { Card, Suit as PSuit } from '../src/engine/poker'

const C = (r: number, s: PSuit): Card => ({ r: r as Card['r'], s })

function forceHand(s: GameState, cards: Card[]): GameState {
  // conservation-legal swap: the displaced hand returns to the deck pool, an
  // equal number of real deck cards is removed — hand+deck+discard stays 52
  return { ...s, hand: [...cards], deckRest: [...s.hand, ...s.deckRest.slice(cards.length)] } as GameState
}

const seedsFx = (p: { effects: PlanEffect[] }) =>
  p.effects.find((e): e is Extract<PlanEffect, { kind: 'seeds' }> => e.kind === 'seeds')!

const MYCO = MARKET_ITEMS.find((m) => m.id === 'mycorrhiza')!

/** Four weak clubs-only plays → deterministically closes the epoch. */
function playOut(s: GameState): GameState {
  s = forceHand(s, [C(4, 'C'), C(4, 'C'), C(4, 'C'), C(4, 'C')])
  for (let i = 0; i < 4; i++) {
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    s = applyAction(s, { type: 'play' })
  }
  return s
}

/** Two pair 9♠9♥7♦7♣ = chips 32 × mult 2 = 64 Growth → nominal ceil(64/4) = 16 Seeds. */
const TWOPAIR16 = [C(9, 'S'), C(9, 'H'), C(7, 'D'), C(7, 'C')]

// ---------------------------------------------------------------------------
// FIX 1 — Mycorrhiza decay
// ---------------------------------------------------------------------------

describe('FIX 1: Mycorrhiza decay — living-region decay is ZERO with the law, exactly 1 without', () => {
  it('baseline: every living region loses exactly 1 stability at epoch end; dormant untouched', () => {
    let s = playOut(newGame('fix1-baseline'))
    expect(s.phase).toBe('market')
    for (const r of s.regions) {
      if (r.dormant) expect(r.stability).toBe(STABILITY_BASE)
      else expect(r.stability).toBe(STABILITY_BASE - 1)
    }
  })

  it('with Mycorrhiza: living regions lose ZERO stability — and never gain', () => {
    let s = newGame('fix1-mycorrhiza')
    s.laws = [{ ...MYCO }]
    s.regions[2].stability = 7
    s.regions[3].stability = 1
    s = playOut(s)
    for (const r of s.regions) {
      if (r.dormant) expect(r.stability).toBe(STABILITY_BASE)
      else if (r.id === 2) expect(r.stability).toBe(7) // zero decay: unchanged
      else if (r.id === 3) expect(r.stability).toBe(1) // zero decay: unchanged
      else expect(r.stability).toBe(STABILITY_BASE) // zero decay: unchanged
    }
  })

  it('dormant and zero-stability regions stay well-defined (never resurrected, never negative)', () => {
    let s = newGame('fix1-zero')
    s.laws = [{ ...MYCO }]
    s.regions[0].stability = 0
    s.regions[1].stability = 0
    s = playOut(s)
    expect(s.regions[0].stability).toBe(0)
    expect(s.regions[1].stability).toBe(0)
    for (const r of s.regions) expect(r.stability).toBeGreaterThanOrEqual(0)
  })

  it('a stability-1 living region survives an epoch WITH Mycorrhiza and hits 0 WITHOUT it', () => {
    const withM = newGame('fix1-survive-with')
    withM.laws = [{ ...MYCO }]
    withM.regions[1].stability = 1
    const without = newGame('fix1-survive-without')
    without.regions[1].stability = 1
    expect(playOut(withM).regions[1].stability).toBe(1)
    expect(playOut(without).regions[1].stability).toBe(0)
  })

  it('regional Seed income follows the resulting stability (stability is NOT purely cosmetic)', () => {
    // two of the four living regions sit at stability 1; flourishing is set
    // high so the target is MET and income is NOT halved:
    // with Mycorrhiza (decay 0) all four stay healthy  → income +4
    // without it (decay 1) the two die (stability 0)   → income +2
    let s = newGame('fix1-income')
    s.laws = [{ ...MYCO }]
    s.flourishing = 100
    s.regions[0].stability = 1
    s.regions[1].stability = 1
    s = playOut(s)
    expect(s.log.some((l) => l.text.includes('Epoch end: +4 Seeds (Credited 4; overflow 0)'))).toBe(true)
    let t = newGame('fix1-income-no')
    t.flourishing = 100
    t.regions[0].stability = 1
    t.regions[1].stability = 1
    t = playOut(t)
    expect(t.log.some((l) => l.text.includes('Epoch end: +2 Seeds (Credited 2; overflow 0)'))).toBe(true)
  })

  it('Mycorrhiza applies exactly once per epoch (stability 10 stays exactly 10 — no gain, no double-softening)', () => {
    let s = newGame('fix1-once')
    s.laws = [{ ...MYCO }]
    s.regions[2].stability = 10
    s = playOut(s)
    expect(s.regions[2].stability).toBe(10)
  })

  it('the market description states the real mechanic (decay 1 → 0), not a vague promise', () => {
    expect(MYCO.decayDelta).toBe(-1)
    expect(MYCO.desc).toContain('1 less')
    expect(MYCO.desc).toContain('0')
  })
})

// ---------------------------------------------------------------------------
// FIX 2 — truthful Seed credit
// ---------------------------------------------------------------------------

describe('FIX 2: truthful Seed credit — nominal vs credited vs overflow via ONE shared contract', () => {
  const nominal = (growth: number) => Math.ceil(growth * SEEDS_PER_GROWTH)

  it('seedCredit contract table: mid / boundary / at-cap / zero / partial', () => {
    expect(seedCredit(8, 16)).toEqual({ credited: 16, overflow: 0 })
    expect(seedCredit(24, 16)).toEqual({ credited: 6, overflow: 10 })
    expect(seedCredit(SEEDS_CAP, 16)).toEqual({ credited: 0, overflow: 16 })
    expect(seedCredit(8, 0)).toEqual({ credited: 0, overflow: 0 })
    expect(seedCredit(29, 3)).toEqual({ credited: 1, overflow: 2 })
  })

  it('the plan itself carries nominal, credited AND overflow for the live balance (preview reads them)', () => {
    let s = newGame('fix2-plan')
    s.seeds = 24
    s = forceHand(s, TWOPAIR16)
    for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
    const pv = preview(s)
    const fx = seedsFx(pv)
    expect(fx.amount).toBe(16)
    expect(fx.credited).toBe(6)
    expect(fx.overflow).toBe(10)
    expect(pv.summary).toContain('Gains 16 Seeds')
    expect(pv.summary).toContain('Credited 6')
    expect(pv.summary).toContain('overflow 10')
  })

  it('task examples: 8+16→24 · 24+16→+6 overflow 10 · 30+16→+0 overflow 16', () => {
    const run = (seeds: number) => {
      let s = newGame('fix2-examples')
      s.seeds = seeds
      s = forceHand(s, TWOPAIR16)
      for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      const pv = preview(s)
      const committed = applyAction(s, { type: 'play' })
      return { pv, committed, fx: seedsFx(pv), cfx: seedsFx(committed.lastResolution!) }
    }
    const a = run(8)
    expect(a.fx.amount).toBe(16)
    expect(a.fx.credited).toBe(16)
    expect(a.fx.overflow).toBe(0)
    expect(a.committed.seeds).toBe(24)
    const b = run(24)
    expect(b.fx.credited).toBe(6)
    expect(b.fx.overflow).toBe(10)
    expect(b.committed.seeds).toBe(30)
    expect(b.pv.summary).toContain('(Credited 6; overflow 10)')
    expect(b.committed.lastResolution!.summary).toBe(b.pv.summary)
    expect(b.committed.log.at(-1)!.text).toContain('(Credited 6; overflow 10)')
    const c = run(SEEDS_CAP)
    expect(c.fx.credited).toBe(0)
    expect(c.fx.overflow).toBe(16)
    expect(c.committed.seeds).toBe(SEEDS_CAP)
    expect(c.committed.log.at(-1)!.text).toContain('(Credited 0; overflow 16)')
  })

  it('mid balance: credited == nominal, no overflow clause, balance applies exactly once', () => {
    let s = newGame('fix2-mid')
    s.seeds = 8
    s = forceHand(s, [C(10, 'H')])
    s = applyAction(s, { type: 'toggleCard', cardIdx: 0 })
    const pv = preview(s)
    const fx = seedsFx(pv)
    expect(fx.amount).toBe(3)
    expect(fx.credited).toBe(3)
    expect(fx.overflow).toBe(0)
    const committed = applyAction(s, { type: 'play' })
    expect(committed.seeds).toBe(11)
    expect(committed.log.at(-1)!.text).toContain('Gains 3 Seeds')
    expect(committed.log.at(-1)!.text).not.toContain('overflow')
  })

  it('preview == commit == log agree on nominal/credited/overflow across balances', () => {
    for (const bal of [0, 8, 24, 29, 30]) {
      let s = newGame('fix2-agree' + bal)
      s.seeds = bal
      s = forceHand(s, TWOPAIR16)
      for (const i of [0, 1, 2, 3]) s = applyAction(s, { type: 'toggleCard', cardIdx: i })
      const pv = preview(s)
      const committed = applyAction(s, { type: 'play' })
      const pfx = seedsFx(pv)
      const cfx = seedsFx(committed.lastResolution!)
      expect(cfx.amount).toBe(pfx.amount)
      expect(cfx.credited).toBe(pfx.credited)
      expect(cfx.overflow).toBe(pfx.overflow)
      expect(pv.summary).toBe(committed.lastResolution!.summary)
      // log echoes the plan's truthful summary (the clause appears exactly
      // when overflow > 0 — the credited figure is always present when it is)
      if (cfx.overflow > 0) {
        expect(committed.log.at(-1)!.text).toContain(`(Credited ${cfx.credited}; overflow ${cfx.overflow})`)
      } else {
        expect(committed.log.at(-1)!.text).toContain('Gains 16 Seeds')
        expect(committed.log.at(-1)!.text).not.toContain('overflow')
      }
      expect(committed.seeds).toBe(bal + cfx.credited)
      expect(committed.seeds).toBeLessThanOrEqual(SEEDS_CAP)
    }
  })

  it('epoch-end income is capped honestly: at cap the chronicle says Credited 0 / overflow N', () => {
    // clubs-only singles bank 43 total → the epoch-1 target (45) is MISSED, so
    // the nominal income 4 is halved to 2; at cap the credit is 0, overflow 2
    let s = newGame('fix2-epochend')
    s.seeds = SEEDS_CAP
    s = playOut(s)
    expect(s.seeds).toBe(SEEDS_CAP)
    const line = s.log.find((l) => l.text.startsWith('Epoch end: +'))!
    expect(line.text).toContain('(Credited 0; overflow 2)')
  })

  it('epoch-end partial credit at a met target: 28 + 4 → +2 credited, overflow 2', () => {
    // 24 + 1 Seed per weak play (Growth 4 → ceil(4/4) = 1) ×4 = 28 at epoch end
    let s = newGame('fix2-epochend2')
    s.seeds = 24
    s.flourishing = 100 // target met → income not halved
    s = playOut(s)
    expect(s.seeds).toBe(30)
    const line = s.log.find((l) => l.text.startsWith('Epoch end: +'))!
    expect(line.text).toContain('(Credited 2; overflow 2)')
  })

  it('the nominal figure stays in the summary; credited is carried alongside (buildPlan requires the balance)', () => {
    const plan = buildPlan([C(10, 'H')], [0], [], 8)
    expect(plan.summary).toMatch(/Gains 3 Seeds/)
    const fx = seedsFx(plan)
    expect(fx.amount).toBe(3)
    expect(fx.credited).toBe(3)
    expect(fx.overflow).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// FIX 3 — final-epoch flow
// ---------------------------------------------------------------------------

describe('FIX 3: final-epoch flow resolves the run exactly once — no market, no epoch 4', () => {
  it('final miss with lives remaining: the 4th play at epoch 3 goes straight to game-over (no market phase)', () => {
    let s = newGame('fix3-miss')
    s.epoch = 3
    s.flourishing = 1
    s.lives = 2
    s.phase = 'select'
    s = playOut(s)
    expect(s.phase).toBe('game-over')
    expect(s.lives).toBe(1) // the miss still cost its life
    expect(s.outcome).toBe('withered')
    expect(s.outcomeReason).toContain('fell short')
    expect(s.market).toEqual([]) // no market is pushed for a finished run
    // resolved EXACTLY once: one life-lost line, one income line for e3
    expect(s.log.filter((l) => l.text.includes('a life is lost'))).toHaveLength(1)
    expect(s.log.filter((l) => l.text.startsWith('Epoch end: +'))).toHaveLength(1)
  })

  it('final win: verdict directly, outcome flourishing, no epoch-4 advertisement anywhere in the chronicle', () => {
    let s = newGame('fix3-win')
    s.epoch = 3
    s.flourishing = 500 // comfortably past the 360 final target
    s.lives = 3
    s.phase = 'select'
    s = playOut(s)
    expect(s.phase).toBe('game-over')
    expect(s.outcome).toBe('flourishing')
    expect(s.outcomeReason).toContain('flourishes')
    expect(s.lives).toBe(SURVIVAL_START)
    expect(JSON.stringify(s.log)).not.toMatch(/[Ee]poch 4/)
  })

  it('zero-lives loss at the final epoch resolves once with the lives reason', () => {
    let s = newGame('fix3-zero')
    s.epoch = 3
    s.flourishing = 1
    s.lives = 1
    s.phase = 'select'
    s = playOut(s)
    expect(s.phase).toBe('game-over')
    expect(s.lives).toBe(0)
    expect(s.outcome).toBe('withered')
    expect(s.outcomeReason).toContain('Out of lives')
    expect(s.log.filter((l) => l.text.includes('a life is lost'))).toHaveLength(1)
    expect(s.log.filter((l) => l.text.startsWith('Epoch end: +'))).toHaveLength(1)
  })

  it('epochs 1–2 keep the exact existing flow: market → endMarket → epoch-end → closeEpoch → next epoch', () => {
    let s = playOut(newGame('fix3-early'))
    expect(s.phase).toBe('market')
    expect(s.epoch).toBe(1)
    s = applyAction(s, { type: 'endMarket' })
    expect(s.phase).toBe('epoch-end')
    s = applyAction(s, { type: 'closeEpoch' })
    expect(s.epoch).toBe(2)
    expect(s.phase).toBe('select')
    // and epoch 2 still ends into a market phase (only the FINAL epoch skips it)
    s = playOut(s)
    expect(s.phase).toBe('market')
  })

  it('reload cannot duplicate rewards or the life deduction (game-over state is valid and inert)', () => {
    let s = newGame('fix3-reload')
    s.epoch = 3
    s.flourishing = 1
    s.lives = 2
    s.phase = 'select'
    s = playOut(s)
    expect(s.phase).toBe('game-over')
    // the committed state is structurally valid → a reload restores exactly it
    const j = JSON.parse(JSON.stringify(s))
    expect(validateState(j)).toBeNull()
    const reloaded = j as GameState
    expect(reloaded.seeds).toBe(s.seeds)
    expect(reloaded.lives).toBe(s.lives)
    expect(reloaded.flourishing).toBe(s.flourishing)
    // any further action on the finished run is a no-op — nothing double-applies
    const after = applyAction(reloaded, { type: 'closeEpoch' })
    expect(after.log.length).toBe(reloaded.log.length)
    expect(after.seeds).toBe(reloaded.seeds)
    expect(after.lives).toBe(reloaded.lives)
    expect(after.flourishing).toBe(reloaded.flourishing)
    expect(after.outcome).toBe(reloaded.outcome)
    // exactly-once bookkeeping in the chronicle
    expect(s.log.filter((l) => l.text.startsWith('Epoch end: +'))).toHaveLength(1)
    expect(s.log.filter((l) => l.text.includes('a life is lost'))).toHaveLength(1)
  })

  it('a crafted legacy epoch-end state at the final epoch still resolves to the verdict (no epoch 4)', () => {
    const s = newGame('fix3-legacy')
    s.epoch = 3
    s.phase = 'epoch-end'
    s.flourishing = EPOCH_TARGETS[TOTAL_EPOCHS - 1].need + 1
    const s2 = applyAction(s, { type: 'closeEpoch' })
    expect(s2.phase).toBe('game-over')
    expect(s2.outcome).toBe('flourishing')
    expect(JSON.stringify(s2.log)).not.toMatch(/[Ee]poch 4/)
  })
})