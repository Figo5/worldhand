// Pure card / poker evaluation. No DOM, no React, fully deterministic given inputs.
export type Suit = 'S' | 'H' | 'D' | 'C'
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 // 11=J 12=Q 13=K 14=A
export interface Card {
  r: Rank
  s: Suit
}

export const SUITS: Suit[] = ['S', 'H', 'D', 'C']
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export function cardName(c: Card): string {
  const r = c.r === 14 ? 'A' : c.r === 13 ? 'K' : c.r === 12 ? 'Q' : c.r === 11 ? 'J' : String(c.r)
  const s = { S: '♠', H: '♥', D: '♦', C: '♣' }[c.s]
  return r + s
}

export function deck(): Card[] {
  const d: Card[] = []
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s })
  return d
}

export type HandCategory =
  | 'high'
  | 'pair'
  | 'two-pair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'quads'
  | 'straight-flush'

export const CATEGORY_ORDER: HandCategory[] = [
  'high', 'pair', 'two-pair', 'trips', 'straight', 'flush', 'full-house', 'quads', 'straight-flush',
]

export interface HandResult {
  category: HandCategory
  /** lexicographic-comparable rank key: [categoryIndex, kicker values...] */
  key: number[]
}

/** Evaluate the best 5-card hand from up to 7 cards. */
export function evaluate(cards: Card[]): HandResult {
  if (cards.length < 5) throw new Error('need at least 5 cards')
  let best: HandResult | null = null
  const n = cards.length
  const idx = [0, 1, 2, 3, 4]
  const combo = (start: number, depth: number) => {
    if (depth === 5) {
      const res = evalFive(idx.map((i) => cards[i]))
      if (!best || cmpKey(res.key, best.key) > 0) best = res
      return
    }
    for (let i = start; i <= n - (5 - depth); i++) {
      idx[depth] = i
      combo(i + 1, depth + 1)
    }
  }
  combo(0, 0)
  if (best === null) throw new Error('no 5-card subset evaluated') // unreachable for len>=5
  return best
}

function cmpKey(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function compareHands(a: HandResult, b: HandResult): number {
  return cmpKey(a.key, b.key)
}

function evalFive(cards: Card[]): HandResult {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a)
  const flush = cards.every((c) => c.s === cards[0].s)
  const uniq = [...new Set(rs)]
  let straightHigh = 0
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0]
    // wheel A-2-3-4-5
    if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5
  }
  const counts = new Map<Rank, number>()
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const isFlush = flush
  const isStraight = straightHigh > 0

  if (isFlush && isStraight) return { category: 'straight-flush', key: [8, straightHigh] }
  if (groups[0][1] === 4) return { category: 'quads', key: [7, groups[0][0], groups[1][0]] }
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: 'full-house', key: [6, groups[0][0], groups[1][0]] }
  if (isFlush) return { category: 'flush', key: [5, ...rs] }
  if (isStraight) return { category: 'straight', key: [4, straightHigh] }
  if (groups[0][1] === 3) return { category: 'trips', key: [3, groups[0][0], ...groups.slice(1).map((g) => g[0])] }
  if (groups[0][1] === 2 && groups[1][1] === 2) return { category: 'two-pair', key: [2, groups[0][0], groups[1][0], groups[2][0]] }
  if (groups[0][1] === 2) return { category: 'pair', key: [1, groups[0][0], ...groups.slice(1).map((g) => g[0])] }
  return { category: 'high', key: [0, ...rs] }
}