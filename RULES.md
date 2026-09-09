# Worldhand — Rules (v2, three-epoch vertical slice)

## Objective

Grow a **Flourishing World**: meet the final epoch target — Flourishing 12+ and total living stability 30+ — across three escalating epochs. Lose if Flourishing collapses to 0, the Drought challenge fails, or 5 living regions wither to 0 stability.

## Turn structure

Each epoch:
1. **Hand of 8** is dealt from the 52-card deck.
2. You have **4 plays** and **3 discards** to spend in any order.
3. When the 4th play is made, the epoch closes (decays, income, market).
4. After the market, the next epoch begins (or the world ends).

## Playing cards (1–5 selection)

- Select **1 to 5** cards from your hand; the exact selection is your poker hand.
- **1–4 cards**: only partial categories apply — high card, pair, two pair, trips, quads. Straights and flushes require exactly 5 cards.
- **5 cards**: full poker evaluation with standard precedence: high < pair < two pair < trips < straight < flush < full house < quads < straight flush. Category points scale 1–9 and are shown in the preview.
- **Ace is low** in the wheel A-2-3-4-5 (a 5-high straight, weaker than 6-high).
- Hand strength drives **magnitude**: effects scale with the rank sum of the selection and its category points.

## Suit majority and ties

- The **majority suit** among selected cards decides the action. A 1-card play is that suit.
- On a tie (e.g. 2♥ + 2♦ + 3♠), the preview shows the default tie-break (♠ → ♥ → ♦ → ♣ order) and offers **buttons to choose the acting suit yourself** — the committed play uses exactly the choice you previewed.

## Actions per suit

- **♠ Roots** — stability to a living region, `1 + floor(rankSum/4)` (+ law bonuses). The weakest living region is targeted unless specified. Caps at stability 10.
- **♥ Bloom** — `1 + floor(rankSum/5)` Flourishing (+ law bonuses). If **any Q+ card** is in the selection, the first dormant region wakes.
- **♦ Sow** — `1 + floor(rankSum/3)` Seeds (+ law bonuses). Caps at 30 Seeds.
- **♣ Tend** — +1 stability to *every* living region (+ Communal Tending upgrade makes it +2).

## Discards

- Discard **1–5 cards at once**; one discard budget is consumed per discard action.
- The hand **refills to 8** from the deck (reshuffling the discard pile when exhausted).
- Card conservation always holds: hand + deck + discard pile = 52.

## Epoch end

1. **Target check** (logged): epoch 1 needs Flourishing 5 + stability 14; epoch 2 needs 8 + 22; epoch 3 needs 12 + 30.
2. **Challenge resolution**: met → +2 Flourishing; failed → −2 Flourishing (and the epoch-3 Drought failure ends the world).
3. **Decay**: every living region loses 1 stability (Mycorrhiza reduces this). Regions at 0 stay at 0.
4. **Income**: +1 Seed per living healthy region, plus law income.
5. **Market phase**.

## Challenge: the epoch-3 Drought (previewed)

When epoch 3 begins, the game announces it in the World Chronicle and the HUD: **every living region must hold stability 3+ at epoch 3's end.** It is visible the whole epoch, so you can plan Roots plays around it. Fail it and the world withers.

## Market

- Up to 3 offers per epoch from the item pool, bought with Seeds.
- **Laws** (persistent): Mycorrhiza Network (decay −1), Seed Vaults (+3 Seeds/epoch), Barter Routes (market −2).
- **Upgrades**: Canopy Choir (+1 Bloom), Deep Taproots (+1 Roots), Rich Soil (+1 Sow), Communal Tending (+1 Tend).
- **Expansions**: Wake Laguna / Wake Brumal — awaken a specific dormant region.
- Owned items never reappear. Seeds are capped at 30.

## Determinism

Same seed phrase → identical world, shuffles, deals, and chronicle. All randomness flows from the hashed seed; the engine is pure (no DOM, no clock, no Math.random).