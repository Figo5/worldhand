# Worldhand — Rules (v2.1, three-epoch vertical slice)

## Objective

Grow a **Flourishing World**: meet the final epoch target — Flourishing 52+ and total living stability 40+ — across three escalating epochs. Lose if your **Survival pool** runs dry, Flourishing collapses to 0, the Drought challenge fails, or 5 living regions wither to 0 stability.

## Survival (the run-level resource)

You start every run with **3 Survival**. Each epoch has a target (see *Epoch end*); **missing an epoch-1 or epoch-2 target costs 1 Survival** and also **halves that epoch's between-market Seed income**. If Survival reaches **0, the run ends withered**. Missing the epoch-3 target costs no Survival — that miss is already terminal (final-target check). Targets are calibrated against measured competent play: a greedy all-subsets policy across 30 seeds wins ~70% of runs (see `scripts/solve.mjs` / `scripts/balance-sweep.mjs`).

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
- On a tie (e.g. 2♥ + 2♦), the preview shows the default tie-break (♠ → ♥ → ♦ → ♣ order) and offers **buttons to choose the acting suit yourself** — the committed play uses exactly the choice you previewed. The chosen suit is carried on the committed play (`suitChoice`) and fed back into the same scoring pipeline the preview used, so preview and commit can never disagree. (For ♠ Roots plays, a targeted region id may ride the same slot — it only applies when the acting suit is already ♠.)

## Actions per suit

- **♠ Roots** — stability to a living region, `1 + floor(rankSum/4)` (+ law bonuses + `floor(development/3)` development bonus). The weakest living region is targeted unless specified. Caps at stability 10.
  - **Adjacency matters**: living neighbors of the target each gain `floor(gain/2)` stability ("roots spread"). Dormant neighbors gain nothing.
  - **Development matters**: the play adds +1 development to the target (capped at 10); every 3 development on a target grants +1 stability on future Roots plays there.
- **♥ Bloom** — `1 + floor(rankSum/5)` Flourishing (+ law bonuses). If **any Q+ card** is in the selection, the first dormant region wakes.
- **♦ Sow** — `1 + floor(rankSum/3)` Seeds (+ law bonuses). Caps at 30 Seeds.
- **♣ Tend** — +1 stability to *every* living region (+ Communal Tending upgrade makes it +2).

## Discards

- Discard **1–5 cards at once**; one discard budget is consumed per discard action.
- The hand **refills to 8** from the deck (reshuffling the discard pile when exhausted).
- Card conservation always holds: hand + deck + discard pile = 52.

## Epoch end

1. **Target check** (logged): epoch 1 needs Flourishing 20 + stability 20; epoch 2 needs 36 + 30; epoch 3 needs 52 + 40. **Missing an epoch-1/2 target costs 1 Survival and halves that epoch's Seed income.** Missing the epoch-3 target ends the run short of the win (no Survival cost — it's terminal already).
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

## Saving

**Auto-save**: the game persists the state to localStorage after every committed state-changing action (play, discard, buy, end-market, epoch close — and selection changes), so quitting or reloading never loses progress. Rewards are applied exactly once inside the engine's commit; saving the resulting state cannot double-apply them. Quit still never clears the save — only "Clear Save" is destructive.