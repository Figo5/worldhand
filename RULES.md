# Worldhand — Rules (simplified single-target edition)

## The world (3D planet presentation)

The planet is rendered as a **3D globe** (three.js): 12 terrain-coloured patches on an ocean sphere under a starfield, each patch carrying **evolution icons** — forest groves, farms, workshops, settlements, observatories — that appear and grow as a region's **development** rises. Dormant regions render dim and desaturated. The globe auto-rotates slowly (disabled under `prefers-reduced-motion`); hover highlights a region, clicking it selects it, the selected region glows with an outline and its neighbours light up as link lines. A **region legend** below the globe lists all 12 regions as keyboard-selectable buttons, so every region is reachable without rotating the globe; the selected region's exact values (terrain, stability, development, adjacency, awake/dormant) are shown in the inspector panel. **This presentation is simulated only** — all region state comes from the engine; the globe adds no mechanics.

## Objective

Grow a **Flourishing World**: meet the final epoch target — **cumulative Growth (Flourishing) 200+** across three escalating epochs (50 → 120 → 200). Lose if your **Survival pool** runs dry, Flourishing collapses to 0, the Drought challenge fails, or 5 living regions wither to 0 stability.

## Survival (the run-level resource)

You start every run with **3 Survival**. Each epoch has a single target (see *Epoch end*); **missing an epoch-1 or epoch-2 target costs 1 Survival** and also **halves that epoch's between-market Seed income**. If Survival reaches **0, the run ends withered**. Missing the epoch-3 target costs no Survival — that miss is already terminal (final-target check). Targets are calibrated against measured bounded play: `LOOK=30 npx vite-node scripts/solve.mjs` (see *Balance*) puts a competent bounded player at 18/30 wins (60%) on the shipped targets.

## Turn structure

Each epoch:
1. **Hand of 8** is dealt from the 52-card deck.
2. You have **4 plays** and **3 discards** to spend in any order.
3. When the 4th play is made, the epoch closes (decays, income, market).
4. After the market, the next epoch begins (or the world ends).

## Playing cards (1–5 selection)

- Select **1 to 5** cards from your hand; the exact selection is your poker hand. The hand is **keyboard-friendly**: arrow keys move between the 8 cards, Enter/Space toggles a card's selection, and the selected state is shown with a thick gold outline **plus a ✓ glyph** (visible without relying on colour). Each card is labelled with the action its suit drives (Study / Grow / Mine / Settle).
- **1–4 cards**: only partial categories apply — high card, pair, two pair, trips, quads. Straights and flushes require exactly 5 cards.
- **5 cards**: full poker evaluation with standard precedence: high < pair < two pair < trips < straight < flush < full house < quads < straight flush. The category multiplier (below) scales with hand strength and is shown in the preview.
- **Ace is low** in the wheel A-2-3-4-5 (a 5-high straight, weaker than 6-high).
- Hand strength drives **magnitude**: every play banks Growth = rankSum × category multiplier (+ region + laws − drought parts, below).

## Suit majority and ties

- The **majority suit** among selected cards decides the action. A 1-card play is that suit.
- On a tie (e.g. 2♥ + 2♦), the preview shows the default tie-break (♠ → ♥ → ♦ → ♣ order) and offers **buttons to choose the acting suit yourself** — the committed play uses exactly the choice you previewed. The chosen suit is carried on the committed play (`suitChoice`) and fed back into the same scoring pipeline the preview used, so preview and commit can never disagree. (For ♠ Study plays, a targeted region id may ride the same slot — it only applies when the acting suit is already ♠.)

## Actions per suit — one action each

- **♠ Study** — +1 development to the **weakest living region** (lowest stability; ties → lowest id). A targeted region id (`regionChoice`) overrides the default. The Deep Taproots upgrade makes it +2. Development feeds Growth (below) and the planet's evolution icons.
- **♥ Grow** — the Growth suit: its play's whole score is banked as Growth (every play banks Growth, but Grow is the one whose upgrades amplify it directly). If **any Q+ card** is in the selection, the first dormant region wakes — a wake is a Drought liability, and the plan summary says so at decision time.
- **♦ Mine** — `max(1, round(rankSum / 3))` Seeds (Rich Soil: +2), capped at 30. Seeds fund the market.
- **♣ Settle** — +1 stability to **every** living region (Communal Tending: +2). Stability 3+ is what the Drought demands and what keeps the Growth drought part at 0.

## The Growth score (the hero number)

Every play — regardless of suit — resolves to ONE number, **Growth**, computed in one shared pipeline (`buildPlan`) in a stable order:

1. **poker** = rankSum ("chips") × `CATEGORY_MULT[category]`: high ×1, pair ×1.5, two-pair ×2, trips ×2.5, straight ×3, flush ×4, full-house ×5, quads ×6, straight-flush ×8.
2. **region** = `+floor(acting region's development / 3)` — the Study loop; 0 when no region applies.
3. **laws** = `+growBonus` from owned upgrades (Grow plays only).
4. **drought** = `−5` Growth per living region below stability 3 (`DROUGHT_PENALTY_PER_REGION`).

`Growth = max(0, poker + region + laws + drought)` — never negative. The breakdown is displayed in that order (`+15 poker · 0 region · 0 laws · 0 drought`) under the big Growth readout, and **Flourishing — the single epoch target — is the cumulative sum of banked Growth.** The preview and the commit both call the same `buildPlan`, so the number you see is always the number you bank.

## Discards

- Discard **1–5 cards at once**; one discard budget is consumed per discard action.
- The hand **refills to 8** from the deck (reshuffling the discard pile when exhausted).
- Card conservation always holds: hand + deck + discard pile = 52.

## Epoch end

1. **Target check** (logged): epoch 1 needs **Growth (Flourishing) 50**; epoch 2 needs **120**; epoch 3 needs **200**. ONE target per epoch — there is no separate stability-sum target (per-region stability still matters: the Drought). **Missing an epoch-1/2 target costs 1 Survival and halves that epoch's Seed income.** Missing the epoch-3 target ends the run short of the win (no Survival cost — it's terminal already).
2. **Challenge resolution**: met → +2 Flourishing; failed → −2 Flourishing (and the epoch-3 Drought failure ends the world).
3. **Decay**: every living region loses 1 stability (Mycorrhiza reduces this). Regions at 0 stay at 0.
4. **Income**: +1 Seed per living healthy region, plus law income.
5. **Market phase**.

## Challenge: the epoch-3 Drought (previewed)

When epoch 3 begins, the game announces it in the World Chronicle and the HUD: **every living region must hold stability 3+ at epoch 3's end.** It is visible the whole epoch, so you can plan Settle plays around it. Fail it and the world withers. The upcoming condition is shown in the HUD from epoch 1, and every wake preview states the awakened region's future obligation.

## Market

- Up to 3 offers per epoch from the item pool, bought with Seeds.
- **Laws** (persistent): Mycorrhiza Network (decay −1), Seed Vaults (+3 Seeds/epoch), Barter Routes (market −2).
- **Upgrades**: Canopy Choir (+3 Growth on Grow plays), Deep Taproots (+1 development on Study plays), Rich Soil (+2 Seeds on Mine plays), Communal Tending (+1 stability on Settle plays).
- **Expansions**: Wake Laguna / Wake Brumal — awaken a specific dormant region.
- Owned items never reappear. Seeds are capped at 30.

## Balance (how the targets were calibrated)

`scripts/solve.mjs` plays a greedy policy over 30 `probe-*` seeds. `LOOK=<n>` bounds its working memory to n candidate selections per play (all 1–2-card selections first, plus a seeded random sample of longer ones) — **LOOK=30 is the bounded-human reference**; unset is exhaustive (oracle). The shipped [50, 120, 200] ladder measures:

| Policy | Result |
|---|---|
| LOOK=30 (bounded reference) | **18/30 wins (60%) — in the 40–60% band** |
| LOOK=12 (very bounded) | 13/30 (43%) |
| Exhaustive (oracle) | 30/30 (100%) |

The solve heuristic is fixed — targets move, the probe doesn't. The old chips-only [12, 24, 32] targets belonged to the retired engine and are gone.

## Determinism

Same seed phrase → identical world, shuffles, deals, and chronicle. All randomness flows from the hashed seed; the engine is pure (no DOM, no clock, no Math.random).

## Interface & motion (card-first, one big number)

- **Play area**: the 8-card hand and the **big Growth number** for the current selection are the centerpiece, with the small ordered breakdown line (poker → region → laws → drought) underneath and the acting suit named beside it. Cards are rich cream/white with saturated red/blue suits, bold ranks, and a glowing gold selection state (`.pcard-btn.sel`); panels are rounded on a deep dark celestial background beside the 3D planet.
- **HUD**: one quiet, grey status strip (`.hud-item` chips) carrying Flourishing/target, Seeds, Plays, Discards, Living regions, Survival, and the Upcoming/live Drought line — deliberately de-emphasized so cards + Growth number + planet stay the heroes.
- **Animations are skippable**: transitions are short, and under `prefers-reduced-motion` the globe's auto-rotation and icon bobbing stop (state changes apply instantly) and CSS transitions are globally disabled. Nothing in the game requires watching an animation.

## Saving

**Auto-save**: the game persists the state to localStorage after every committed state-changing action (play, discard, buy, end-market, epoch close — and selection changes), so quitting or reloading never loses progress. Rewards are applied exactly once inside the engine's commit; saving the resulting state cannot double-apply them. Quit still never clears the save — only "Clear Save" is destructive.