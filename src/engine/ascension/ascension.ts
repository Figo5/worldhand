// Ascension ruleset: engine skeleton. Pure — no DOM, no clock, no Math.random.
//
// Seam scope only: deal a seeded 52-card deck, play or discard 1–5 cards,
// score plays with the shared poker evaluator. Rounds of 4 plays / 3 discards
// roll over forever. No world, no saves, no content yet.
//
// Boundaries (enforced by tests/engine-boundaries.test.ts): this module never
// imports the Classic ruleset (worldhand.ts). It shares only rng.ts, poker.ts
// and core/streams.ts. All randomness comes from named streams under the
// 'ascension' namespace, so a seed phrase deals differently here than in
// Classic, and each shuffle is independent of every other.
import { hashSeed, type Seed } from '../rng'
import { deck, evaluateSelection, categoryLabel, CATEGORY_MULT, type Card, type HandCategory } from '../poker'
import { stream } from '../core/streams'

/** Rules generation of Ascension state. Independent of Classic's SAVE_VERSION. */
export const ASCENSION_RULES_VERSION = 1
export const HAND_SIZE = 8
export const PLAYS_PER_ROUND = 4
export const DISCARDS_PER_ROUND = 3

export interface PlayResult {
  cards: Card[]
  category: HandCategory
  label: string
  /** rank sum of all played cards */
  chips: number
  mult: number
  /** round(chips × mult) */
  score: number
}

export interface AscensionState {
  mode: 'ascension'
  rulesVersion: number
  seed: Seed
  seedText: string
  round: number
  playsLeft: number
  discardsLeft: number
  hand: Card[]
  drawPile: Card[]
  discardPile: Card[]
  /** how many times the discard pile has been reshuffled; keys the next shuffle's stream */
  reshuffles: number
  score: number
  lastPlay: PlayResult | null
}

/** Card indices refer to positions in `hand`. */
export type AscensionAction =
  | { type: 'play'; cards: number[] }
  | { type: 'discard'; cards: number[] }

export function newAscensionGame(seedText: string): AscensionState {
  const seed = hashSeed(seedText)
  const s: AscensionState = {
    mode: 'ascension',
    rulesVersion: ASCENSION_RULES_VERSION,
    seed,
    seedText,
    round: 1,
    playsLeft: PLAYS_PER_ROUND,
    discardsLeft: DISCARDS_PER_ROUND,
    hand: [],
    drawPile: stream(seed, 'ascension', 'deck').shuffle(deck()),
    discardPile: [],
    reshuffles: 0,
    score: 0,
    lastPlay: null,
  }
  drawUp(s)
  return s
}

/** Score a selection without changing anything: preview and commit both use it. */
export function scorePlay(hand: readonly Card[], idxs: readonly number[]): PlayResult {
  checkSelection(hand, idxs)
  const cards = idxs.map((i) => hand[i])
  const { category } = evaluateSelection(cards)
  const chips = cards.reduce((n, c) => n + c.r, 0)
  const mult = CATEGORY_MULT[category]
  return { cards, category, label: categoryLabel(category), chips, mult, score: Math.round(chips * mult) }
}

/** Pure transition. An illegal action throws before anything is built, so the
 *  input state is never changed. */
export function applyAscensionAction(state: AscensionState, action: AscensionAction): AscensionState {
  if (action.type === 'play') {
    if (state.playsLeft <= 0) throw new Error('no plays left this round')
    const result = scorePlay(state.hand, action.cards)
    const s = moveToDiscard(state, action.cards)
    s.score += result.score
    s.lastPlay = result
    s.playsLeft -= 1
    if (s.playsLeft === 0) {
      s.discardPile.push(...s.hand)
      s.hand = []
      s.round += 1
      s.playsLeft = PLAYS_PER_ROUND
      s.discardsLeft = DISCARDS_PER_ROUND
    }
    drawUp(s)
    return s
  }
  if (action.type === 'discard') {
    if (state.discardsLeft <= 0) throw new Error('no discards left this round')
    checkSelection(state.hand, action.cards)
    const s = moveToDiscard(state, action.cards)
    s.discardsLeft -= 1
    drawUp(s)
    return s
  }
  throw new Error(`unknown action ${JSON.stringify((action as { type?: unknown }).type)}`)
}

function checkSelection(hand: readonly Card[], idxs: readonly number[]): void {
  if (!Array.isArray(idxs) || idxs.length < 1 || idxs.length > 5) throw new Error('select 1–5 cards')
  if (new Set(idxs).size !== idxs.length) throw new Error('a card was selected twice')
  for (const i of idxs) {
    if (!Number.isInteger(i) || i < 0 || i >= hand.length) throw new Error(`no card at position ${String(i)}`)
  }
}

/** A copy of `state` with the selected hand cards moved to the discard pile. */
function moveToDiscard(state: AscensionState, idxs: readonly number[]): AscensionState {
  return {
    ...state,
    hand: state.hand.filter((_, i) => !idxs.includes(i)),
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile, ...idxs.map((i) => state.hand[i])],
  }
}

/** Refill the hand to HAND_SIZE, reshuffling the discard pile into the draw
 *  pile when it runs out. Mutates `s`, which must be a fresh copy. */
function drawUp(s: AscensionState): void {
  while (s.hand.length < HAND_SIZE) {
    if (s.drawPile.length === 0) {
      if (s.discardPile.length === 0) return
      s.drawPile = stream(s.seed, 'ascension', 'reshuffle', s.reshuffles).shuffle(s.discardPile)
      s.discardPile = []
      s.reshuffles += 1
    }
    s.hand.push(s.drawPile.pop() as Card)
  }
}
