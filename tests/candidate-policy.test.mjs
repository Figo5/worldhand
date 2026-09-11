import { describe, it, expect } from 'vitest'
import { candidateSubsets } from '../scripts/lib/candidates.mjs'

const C = (r, s) => ({ r, s })

describe('bounded solver candidate policy', () => {
  it('LOOK=30 still includes deliberate 5-card poker shapes, not only shorts', () => {
    const hand = [
      C(14, 'H'), C(13, 'H'), C(11, 'H'), C(9, 'H'), C(7, 'H'),
      C(5, 'S'), C(6, 'D'), C(8, 'C'),
    ]
    const cands = candidateSubsets(hand, 30, 12345)
    expect(cands).toHaveLength(30)
    expect(cands.some((s) => s.length === 5 && s.every((i) => hand[i].s === 'H'))).toBe(true)
    expect(cands.some((s) => s.length > 2)).toBe(true)
  })

  it('with no LOOK cap it remains exhaustive for oracle checks', () => {
    const hand = Array.from({ length: 8 }, (_, i) => C(i + 2, 'S'))
    expect(candidateSubsets(hand, undefined, 1).length).toBe(218)
  })
})
