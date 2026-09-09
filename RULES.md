# Worldhand — Rules

Worldhand is a single-player, deterministic planet-building roguelike. There is **no
betting, no gambling, and no opponents**: poker hands are used purely as a strength
meter for your world-shaping actions.

## Components

- **Regions** (max 6): each has a terrain, a **stability** score (0–10), and may be
  **fractured** or hold a **Wonder**.
- **Order** 🪙: the world's currency. Start with 10.
- **The deck**: a standard 52-card deck. Each epoch you draw an **8-card hand**.
- **Epochs**: the game runs at most **15 epochs**.
- **Laws**: permanent modifiers, one enacted per epoch from a draft of two.

## The 8-card hand

At the start of each epoch, 8 cards are dealt from the (seeded, deterministic) deck.
Your **best 5-card poker hand** from those 8 cards determines your **strength tier**:

| Best hand       | Strength |
|-----------------|----------|
| high card       | 0        |
| pair            | 1        |
| two pair        | 2        |
| three of a kind | 3        |
| straight        | 4        |
| flush           | 5        |
| full house      | 6        |
| four of a kind  | 7        |
| straight flush  | 8        |

Strength scales Prosper gains and Fortify amounts, and is a hard requirement for Wonders.
Discarding cards (via the market/discard action) reshapes your hand before you act.

## World Actions

You get **3 World Actions per epoch** (laws may add more). On each:

- **Prosper (region)** — gain `3 + strength × 2` Order. Disabled on fractured regions.
- **Fortify (region)** — stability `+2 + strength` (cap 10). On a fractured region this
  instead **repairs** it to stability 3.
- **Survey** — reveal a new region with probability `0.45 + strength × 0.05`
  (always succeeds under *Sky Watch*). On failure (or a full world): +2 Order salvage.
- **Trade** — open a market of **3 random cards**, each purchasable for 6 Order
  (2 less under *Open Markets*, minimum cost 1). Bought cards go into the world deck,
  improving future hands.
- **Wonder (region)** — costs **12 Order**, requires region stability ≥ 6, no wonder
  present, not fractured, and **strength ≥ 5** (flush or better).

Spending your last action ends the epoch immediately. You may also **End Actions** early.

## Epoch end

1. **Income**: +1 per healthy region, plus law income (e.g. *Terra Fee* +2).
2. **Decay**: every healthy region loses `1 + decay modifiers` stability. A region
   reaching 0 **fractures** permanently (until repaired).
3. **Law draft**: enact one of two offered laws (when any remain):

| Law             | Effect                                             |
|-----------------|----------------------------------------------------|
| Terra Fee       | +2 Order every epoch end                           |
| Deep Roots      | decay reduced by 1                                 |
| Open Markets    | market cards cost 2 less                           |
| Sky Watch       | surveys always succeed                             |
| Great Works     | +1 World Action every epoch                        |
| Stone Covenant  | +3 Order each epoch, but decay +1 (aggressive)     |

## Win / Loss

- **Win**: raise **3 Wonders** (or finish epoch 15 with ≥ 2 wonders).
- **Lose**: **3 regions fracture** (or finish epoch 15 with < 2 wonders).

## Determinism & saves

- All randomness flows from a seeded mulberry32 RNG keyed by seed phrase + epoch.
- Same seed ⇒ same starting regions, hands, markets, law drafts, and survey rolls.
- Saves are versioned `{version, savedAt, state}` envelopes in `localStorage`
  under key `worldhand.save`. Older versions migrate forward; newer versions are ignored.