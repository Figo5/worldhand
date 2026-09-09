// Deterministic RNG — pure engine, no DOM dependencies.
export type Seed = number

export class Rng {
  private state: number
  constructor(seed: Seed) {
    this.state = (seed >>> 0) || 0x9e3779b9
  }
  /** mulberry32 */
  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive))
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)]
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1)
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
}

export function hashSeed(text: string): Seed {
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}