import { describe, it, expect } from 'vitest'
import { newGame, applyAction, worldScore, SAVE_VERSION, SCHEMA_VERSION, type GameState } from '../src/engine/worldhand'
import { decodeAction, encodeAction, stateHash, ACTION_TYPES } from '../scripts/lib/replay-codec.mjs'
import fixture from './fixtures/classic-replays.json'

// The Classic regression fence: every recorded run must replay to the same
// state hash at every epoch boundary and the same final state. A failure here
// means Classic rules changed. Re-record (scripts/record-classic-replays.mjs)
// only for a deliberate rules change with a SAVE_VERSION bump.

describe('Classic replay fixtures', () => {
  it('were recorded under the current engine rules', () => {
    expect(fixture.engine).toEqual({ SAVE_VERSION, SCHEMA_VERSION })
  })

  it('exercise every Action type', () => {
    const seen = new Set<string>()
    for (const r of fixture.runs) for (const code of r.actions.split(' ')) seen.add(decodeAction(code).type)
    expect([...seen].sort()).toEqual([...ACTION_TYPES].sort())
  })

  it('codec round-trips', () => {
    for (const r of fixture.runs.slice(0, 4)) {
      for (const code of r.actions.split(' ')) expect(encodeAction(decodeAction(code))).toBe(code)
    }
  })

  for (const run of fixture.runs) {
    it(`${run.policy} ${run.seed} replays identically`, () => {
      let s: GameState = newGame(run.seed)
      let boundary = 0
      for (const code of run.actions.split(' ')) {
        s = applyAction(s, decodeAction(code))
        if (code === 'x') {
          expect(stateHash(s), `state at the start of epoch ${s.epoch}`).toBe(run.epochHashes[boundary])
          boundary++
        }
      }
      expect(boundary).toBe(run.epochHashes.length)
      expect({
        hash: stateHash(s), epoch: s.epoch, phase: s.phase, lives: s.lives,
        flourishing: s.flourishing, seeds: s.seeds, worldScore: worldScore(s),
      }).toEqual(run.final)
    })
  }
})
