import { describe, it, expect } from 'vitest'
import { stream } from '../src/engine/core/streams'
import { Rng, hashSeed } from '../src/engine/rng'

const take = (r: Rng, n = 8) => Array.from({ length: n }, () => r.next())

describe('named RNG streams (core/streams.ts)', () => {
  it('the same seed and key always produce the same sequence', () => {
    expect(take(stream(42, 'ascension', 'deal', 3))).toEqual(take(stream(42, 'ascension', 'deal', 3)))
  })

  it('a stream is a pure function of (seed, key): other streams cannot shift it', () => {
    const alone = take(stream(7, 'deal', 1))
    const noise = stream(7, 'shop', 1)
    take(noise, 100)
    const a = stream(7, 'deal', 1)
    take(stream(7, 'deal', 2), 50)
    expect(take(a)).toEqual(alone)
  })

  it('different seeds or keys give different sequences, with no ambiguous keys', () => {
    const first = (...args: Parameters<typeof stream>) => take(stream(...args), 4).join()
    const variants = [
      first(1, 'deal', 1),
      first(2, 'deal', 1),         // seed
      first(1, 'deal', 2),         // index
      first(1, 'shop', 1),         // name
      first(1, 1, 'deal'),         // order
      first(1, 'deal', '1'),       // number vs string
      first(1, 'a|b'),             // separator inside a part...
      first(1, 'a', 'b'),          // ...vs two parts
      first(1),                    // empty key
    ]
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('1000 sibling keys do not collide', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(take(stream(123, 'ascension', 'deal', i), 2).join())
    expect(seen.size).toBe(1000)
  })

  it('normalizes the seed to uint32 exactly like Rng', () => {
    expect(take(stream(-1, 'k'))).toEqual(take(stream(0xffffffff, 'k')))
  })

  it('is built only from the shared rng.ts primitives', () => {
    expect(take(stream(5, 'deal', 0))).toEqual(take(new Rng(hashSeed(JSON.stringify([5, 'deal', 0])))))
  })

  // Pinned outputs: if these change, every seed of every mode that uses
  // streams deals differently. Change them only as a deliberate rules change.
  it('pinned outputs', () => {
    expect(take(stream(12345, 'ascension', 'deal', 0), 3)).toEqual([0.6900679024402052, 0.32701269048266113, 0.038748425198718905])
    const r = stream(0, 'x')
    expect([r.int(0, 52), r.int(0, 52)]).toEqual([17, 13])
  })
})
