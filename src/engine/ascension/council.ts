// Ascension Council: what the world is offered between eras. Pure.
//
// After a crisis the Council opens: a market of world cards and decrees
// (bought with Influence), a paid reroll, card removal, and — after the
// Tribal, Medieval and Information crises — a free choice of one legendary
// (after Ancient and Industrial one legendary is for sale instead). Offers
// come from the named stream ('ascension','council', era, reroll), so they
// depend only on the seed, the era and how often the player rerolled.
import { stream } from '../core/streams'
import type { Rng } from '../rng'
import { CARD_BY_ID, DECREE_BY_ID, RARITY_PRICE, type Rarity } from './content'
import { LEGENDARIES } from './legendaries'
import type { RunMods } from './legendaries'
import type { AscensionState, CouncilState, LegendaryId, Offer } from './state'

export const LEGENDARY_PICK_AFTER: readonly number[] = [0, 2, 4]
export const LEGENDARY_SALE_AFTER: readonly number[] = [1, 3]
export const LEGENDARY_PRICE = 9
export const REMOVE_PRICE = 3
export const SELL_REFUND = 3
/** Wealth: every this much Prosperity makes each offer 1 Influence cheaper (never below 1). */
export const WEALTH_STEP = 20
export const wealthDiscount = (s: AscensionState) => Math.floor(s.stats.prosperity / WEALTH_STEP)
const cheaper = (s: AscensionState, price: number) => Math.max(1, price - wealthDiscount(s))
const RARITY_WEIGHT: Record<Rarity, number> = { common: 6, uncommon: 3, rare: 1 }

function weightedPick<T extends { rarity: Rarity }>(rng: Rng, items: readonly T[]): T | null {
  const total = items.reduce((n, x) => n + RARITY_WEIGHT[x.rarity], 0)
  if (!total) return null
  let roll = rng.int(0, total)
  return items.find((x) => (roll -= RARITY_WEIGHT[x.rarity]) < 0) ?? null
}

/** The market after the crisis of era `era` (for the era after it), reroll number `reroll`. */
export function marketOffers(s: AscensionState, era: number, reroll: number, m: RunMods): Offer[] {
  const rng = stream(s.seed, 'ascension', 'council', era, reroll)
  const cards = s.setup.pool.cards.map((id) => CARD_BY_ID.get(id)!).filter((c) => c && c.era <= era + 1)
  const decrees = s.setup.pool.decrees.map((id) => DECREE_BY_ID.get(id)!).filter((d) => d && d.era <= era + 1)
  const offers: Offer[] = []
  const take = <T extends { id: string; rarity: Rarity }>(from: T[], kind: Offer['kind'], price: (x: T) => number) => {
    const left = from.filter((x) => !offers.some((o) => o.id === x.id))
    const x = weightedPick(rng, left)
    if (x) offers.push({ kind, id: x.id, price: price(x), sold: false })
  }
  for (let i = 0; i < m.marketSlots - 2; i++) take(cards, 'card', (c) => cheaper(s, RARITY_PRICE[c.rarity]))
  for (let i = 0; i < 2; i++) take(decrees, 'decree', (d) => cheaper(s, d.price))
  if (LEGENDARY_SALE_AFTER.includes(era)) {
    const owned = new Set(s.legendaries.map((l) => l.id))
    const left = s.setup.pool.legendaries.filter((id) => !owned.has(id) && LEGENDARIES[id].era <= era)
    if (left.length) offers.push({ kind: 'legendary', id: stream(s.seed, 'ascension', 'legend-sale', era).pick(left), price: cheaper(s, LEGENDARY_PRICE), sold: false })
  }
  return offers
}

/** Up to three legendaries to choose one from, free (none after most eras). */
export function legendaryChoice(s: AscensionState, era: number): LegendaryId[] | null {
  if (!LEGENDARY_PICK_AFTER.includes(era)) return null
  const owned = new Set(s.legendaries.map((l) => l.id))
  const left = s.setup.pool.legendaries.filter((id) => !owned.has(id) && LEGENDARIES[id].era <= era)
  const rng = stream(s.seed, 'ascension', 'legendary', era)
  const out: LegendaryId[] = []
  while (out.length < 3 && left.length) out.push(left.splice(rng.int(0, left.length), 1)[0])
  return out.length ? out : null
}

export function openCouncil(s: AscensionState, era: number, m: RunMods): CouncilState {
  return { offers: marketOffers(s, era, 0, m), rerolls: 0, legendaryChoice: legendaryChoice(s, era) }
}
export const rerollPrice = (c: CouncilState, m: RunMods) => m.rerollBase + c.rerolls
