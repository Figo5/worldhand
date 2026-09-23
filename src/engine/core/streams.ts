// Named, independent RNG streams: shared engine infrastructure for rulesets
// other than Classic. Pure — no DOM, no clock, no Math.random.
//
// Classic does NOT use this. It keeps its own `rngFor` in worldhand.ts so every
// recorded Classic run (tests/fixtures/classic-replays.json) stays identical.
import { Rng, hashSeed, type Seed } from '../rng'

/** A fresh RNG for one named purpose of one run, e.g.
 *  `stream(runSeed, 'ascension', 'deal', epoch, reshuffle)`.
 *
 *  The run seed and key parts are serialized with JSON.stringify — so the
 *  number 1 and the string '1', or ('a|b') and ('a', 'b'), are different keys
 *  — hashed with the shared FNV-1a `hashSeed`, and used to seed the shared
 *  mulberry32 `Rng`. Each key therefore has its own sequence, and a stream is
 *  a pure function of (seed, key): adding or consuming another stream can
 *  never shift the numbers this one produces. */
export function stream(seed: Seed, ...key: (string | number)[]): Rng {
  return new Rng(hashSeed(JSON.stringify([seed >>> 0, ...key])))
}
