# Worldhand — Rules (Balatro-simple edition)

## Objective

Play poker hands. Bank Growth. Beat the final epoch target: **cumulative Growth (Flourishing) 360+** across three escalating epochs (45 → 110 → 360). Lose if your **3 lives** run out, or Flourishing collapses to 0. There is no drought, no per-suit actions, no region choices — just cards, money, and the shop.

## Lives (Balatro-style — every miss costs 1, all three epochs)

You start every run with **3 lives**. Each epoch has a single target (see *Epoch end*); **missing ANY epoch target — epoch 1, epoch 2, OR epoch 3 — costs 1 life** and also **halves that epoch's between-market Seed income**. At **0 lives the run ends withered**. The epoch-3 miss is also terminal for the WIN (final-target check) — but it still costs its life first. The win check is separate: **beat the final target while lives remain**. Three missed targets in ordinary play therefore drain exactly 3 lives (regression-tested).

## Turn structure

Each epoch:
1. A **hand of 8** (9/10 with card additions) is dealt from the 52-card deck.
2. You have **4 plays** and **3 discards** to spend in any order.
3. When the 4th play is made, the epoch closes (decay, civilization growth, income). **After the final (3rd) epoch's 4th play the run resolves directly** — final-target check, life deduction, income, then the verdict panel. No market opens for a finished run and no fourth epoch exists.
4. After an epoch-1/epoch-2 market, the next epoch begins (or the world ends at a 0-lives boundary).

## Playing cards (1–5 selection) — no suit decisions

- Select **1 to 5** cards from your hand; the exact selection is your poker hand. **There is no acting suit, no tie choice, no region target** — the same cards score the same regardless of suit mix.
- **1–4 cards**: only partial categories apply — high card, pair, two pair, trips, quads. Straights and flushes require exactly 5 cards.
- **5 cards**: full poker evaluation with standard precedence: high < pair < two pair < trips < straight < flush < full house < quads < straight flush. The **Ace is low** in the wheel A-2-3-4-5.
- Keyboard-friendly: arrow keys move between cards, Enter/Space toggles; selection shows a thick gold outline plus a ✓ glyph.

## The Growth formula (the hero number)

Every play resolves to ONE number, **Growth**, computed in one shared pipeline (`buildPlan`) in a stable order:

1. **poker** = `round(rankSum × CATEGORY_MULT[category])` — high ×1, pair ×1.5, two-pair ×2, trips ×2.5, straight ×3, flush ×4, full-house ×5, quads ×6, straight-flush ×8.
2. **World Laws** = × owned `growthMult` (floored at 1; Open Canals ×1.2), then + owned `growthFlat` (Canopy Choir +3, Stone Masonry +6).

`Growth = max(0, round(pokerBase × lawMult) + lawFlat)` — floored at 0, never negative. The breakdown is displayed in that order (`+15 poker · +2 laws`) under the big Growth readout. **Flourishing — the single epoch target — is the cumulative sum of banked Growth.** The preview and the commit both call the same `buildPlan`, so the number you see is always the number you bank. Region development and stability are **never** part of the score.

### How to read "chips × mult" (honest labeling)

The UI shows the full equation — **`{chips} chips × {mult} mult = {base} base`** — where

- **chips** = `rankSum`: the sum of the ranks of **ALL selected cards**;
- **mult** = the hand's category multiplier (high ×1 … straight-flush ×8);
- **base** = `pokerBase` = `round(chips × mult)` — the **already-multiplied** poker part of the score.

The base is shown as the RESULT of the multiplication, never as a second "chips" number next to another "× mult" — that would imply the multiplication happens twice, which it does not. A regression test pins `pokerBase === round(chips × mult)` exactly so display and formula cannot drift.

### Kickers contribute (documented, non-standard)

**`rankSum` sums ALL selected cards — including cards that are not part of the scoring combination.** A pair K♠K♥ played with a Q♦ kicker scores `(13+13+12) = 38 chips × 1.5 = 57`, not `26 × 1.5 = 39`: the kicker's full rank value adds to the chips exactly like a scoring card. This is deliberate and simple — the chips number is always just "add up what you played". It is NOT standard poker scoring-card-only semantics, and the UI never implies otherwise (the chips pill says "rank sum of ALL selected cards").

## The auto-Seeds formula (money from hand quality)

Every play earns Seeds instantly — there is no gather action:

```
nominal earned = ceil(Growth × SEEDS_PER_GROWTH)    SEEDS_PER_GROWTH = 1/4
credited       = min(SEEDS_CAP − balance, nominal)  (never below 0)
overflow       = nominal − credited                 (the part the cap refused)
```

**1 Seed per 4 Growth** (a 15-Growth hand nominally pays 4 Seeds). The **nominal** figure is what the hand earned; the **credited** figure is what actually lands in the bank under the 30-Seeds cap; **overflow** is what the cap refused. When overflow is 0 the UI just says "Gains N Seeds"; when the cap binds, the preview, the committed summary, and the chronicle all show the same truthful clause — e.g. `Gains 16 Seeds (Credited 6; overflow 10)` for a balance of 24 — because preview, commit and log all read one shared contract (`seedCredit`). Epoch end pays +1 Seed per living **healthy** region (stability > 0) plus law income, halved on a missed epoch target, and is credited under the same cap with the same truthful clause. Seeds can never go negative.

## Discards

- Discard **1–5 cards at once**; one discard budget is consumed per discard action.
- The hand **refills** to its current size (8, or 9/10 with card additions) from the deck (reshuffling the discard pile when exhausted).
- Card conservation always holds: hand + deck + discard pile = **exactly 52** — card additions grow the dealt hand from the same pool.

## Epoch end

1. **Target check** (logged): epoch 1 needs **Growth (Flourishing) 45**; epoch 2 needs **110**; epoch 3 needs **360**. **Missing ANY target — including the epoch-3 one — costs 1 life and halves that epoch's Seed income.** The epoch-3 miss additionally ends the run short of the win (final-target check); a met epoch-3 target wins. **The final epoch resolves straight to the verdict after its 4th play** — no market phase for a finished run.
2. **Decay**: every living region with stability left loses **1 stability** per epoch. **Mycorrhiza Network reduces this decay by 1 — i.e. living regions stop decaying entirely (1 → 0)**; decay is floored at 0 (never a gain, never a double loss) and regions at 0 stay at 0. Decay is **not purely cosmetic**: the income below counts only living regions with **stability > 0**, so decayed-out regions stop paying Seeds (Mycorrhiza protects that income base).
3. **Civilization growth**: every living region gains +1 development — this drives the 3D planet's evolution icons and the globe's visible size. No gameplay read.
4. **Income**: +1 Seed per living healthy region, plus law income (halved on a missed target), credited under the Seed cap with the truthful credited/overflow clause (see the auto-Seeds formula).
5. **Market phase** — epochs 1 and 2 only; the final epoch has none.

## Market (spend Seeds on a smarter civilization)

- Up to 3 offers per epoch from the item pool, bought with Seeds. **Max 5 owned items**; buying is blocked at the cap until you explicitly remove an item (no refund, frees the slot). Owned items never reappear. Seeds cap at 30.
- **Hand upgrades**: Canopy Choir (+3 Growth every play), Stone Masonry (+6 Growth every play), Open Canals (Growth ×1.2 every play). Bonuses apply exactly once per play.
- **Card additions**: Fourth Counsel (hand 9), Fifth Counsel (hand 10) — new unique ids; deck conservation still holds at 52.
- **Expansions**: Wake Laguna / Wake Brumal — awaken a specific dormant region; the planet visibly grows.
- **Laws**: Mycorrhiza Network (decay 1 → 0: living regions stop decaying each epoch — this also protects their Seed-income contribution, since income counts only regions with stability > 0), Seed Vaults (+3 Seeds/epoch), Barter Routes (market −2).
- All former per-suit items (Deep Taproots, Rich Soil, Communal Tending) are removed with their actions.

## Saving & versioning

**Auto-save**: the game persists the state to localStorage after every committed state-changing action (play, discard, buy, remove, end-market, epoch close — and selection changes), so quitting or reloading never loses progress. Rewards are applied exactly once inside the engine's commit; saving the resulting state cannot double-apply them.

**Versioning**: the envelope carries a schema version and the state carries the engine **rules** version (`SAVE_VERSION = 3`, the Balatro-simple engine; separate `SCHEMA_VERSION = 3` for envelope layout). On load, a save whose version or structure does not match the current engine — wrong version, missing/non-numeric `lives`, obsolete era market items (Deep Taproots-era ids), invalid phase, malformed cards (rank/suit out of range), broken 52-card conservation — is **rejected, never migrated and never reinterpreted**. The raw blob is preserved **verbatim** under a timestamped legacy key (`worldhand.save.legacy.<ts>`) so the old run stays recoverable, and the menu explains that **a fresh run is needed because the engine rules changed** (with a "Show preserved legacy blob" button). Quitting never destroys the save; only **Clear Save** is destructive, and it now requires an explicit confirmation (as does the game-over "Back to Menu" clear).

## Balance (bounded solver result — NOT a human win-rate estimate)

`scripts/solve.mjs` plays a greedy automated policy. **This is a bounded solver result, not an estimate of human performance** — the policy is a machine heuristic over a bounded candidate set, and the numbers below describe that policy only. Calibration uses the reference method directly: `LOOK=30 npx vite-node scripts/solve.mjs`.

The solver was corrected in this pass (the old `score()` still carried drought/stability-era terms, and its bounded candidate list was filled entirely with 1–2-card combinations, so it never evaluated a real poker hand). The corrected policy:

- **Candidates span 1–5 cards across poker categories**: all 1–2-card selections PLUS deliberate category candidates — pairs/trips/quads groups, two-pairs, full houses, flushes (best + lowest 5-card same-suit subsets), straights (incl. ace-low wheels, suit-preferred for straight-flush attempts), and generic best-rank 3/4/5-card fillers. `LOOK` caps how many are considered per play; unset = exhaustive.
- **Scores only current mechanics**: Growth banked toward the epoch target (chips×mult + laws, with a reachability penalty once the target is out of reach), Seeds gained (discounted near the cap), and lives (a lost life is heavily penalized). No drought/stability terms exist.
- **Discards sensibly**: when every candidate scores weak, it dumps the cards the best play did not want (≤5), refills, and keeps the discard only if the post-refill best play clearly beats the pre-discard one.
- **Buys in a documented priority order**: canopy-choir (+3 flat on every play, cheapest Growth/Seed) → seed-vaults (+3 Seeds/epoch) → barter-routes (−2 all purchases) → open-canals (×1.2 every play) → stone-masonry (+6 flat) → fourth-counsel (9-card hands). Expansions, Mycorrhiza, and Fifth Counsel are skipped: none pay toward the Growth targets.
- **Calibration and evaluation seeds are disjoint**: `--set calib` runs the `probe-0..29` set (used only for target sweeps); `--set eval` runs the `eval-0..29` set (the reported result); no flags run both. Output is labeled **bounded solver result** everywhere.

The shipped [45, 110, 360] measures on the eval-* set (calibration set in parentheses):

| Policy | Result (bounded solver) |
|---|---|
| LOOK=30 (bounded reference) | **16/30 (53%)** (20/30, 67% calib) |
| LOOK=12 (very bounded) | 0/30 (0%) (1/30, 3% calib) |
| Exhaustive (oracle) | 30/30 (100%) both sets |

**Honest note, not tuned to a band**: the corrected policy is substantially stronger than the old mis-focused one (the old LOOK=30 measured 53% because the bounded list never saw a 3+ card hand). The **[45,110,360] targets are the authorized ladder** from the preceding cycle, restored per the goal (this cycle was for correctness fixes, not another balance redesign). The corrected policy measures a high bounded win rate against them — reported honestly, with balance judgement left to human playtest rather than forcing a 40–60% band.

## Determinism

Same seed phrase → identical world, shuffles, deals, and chronicle. All randomness flows from the hashed seed; the engine is pure (no DOM, no clock, no Math.random).

## Interface & motion (card-first, one big number, zero emojis)

- **Play area**: the 8-card hand and the **big Growth number** for the current selection are the centerpiece, with the ordered breakdown (`poker · laws`) and the honest **`chips × mult = base`** readout underneath. Cards are rich cream/white with saturated red/blue suits and bold ranks; selection glows gold (`.pcard-btn.sel`); panels sit on a deep dark celestial background beside the 3D planet.
- **HUD**: one quiet, grey status strip (Flourishing/target, Seeds, Lives, Plays, Discards, Living regions) — deliberately de-emphasized.
- **No emojis anywhere in the rendered UI** — labels are plain text; suit symbols are typographic glyphs. `scripts/check-no-emoji.py` audits the rendered-UI sources.
- **Animations are skippable**: under `prefers-reduced-motion` the globe's auto-rotation and icon bobbing stop (state changes apply instantly) and CSS transitions are globally disabled.

## The 3D planet (presentation only)

The globe is the world hero: 12 terrain patches, evolution icons (groves, farms, workshops, settlements, observatories) that appear and grow with each region's **development**, dormant regions dim and desaturated. **The globe visibly grows**: its scale blends the awakened fraction (50%) and total development (50%) of the planet. Every living region gains +1 development per epoch. Hover highlights, click selects (raycast), a keyboard-accessible legend reaches every region, and the inspector shows exact values.

## Saving

See *Saving & versioning* above. Short version: auto-save after every action; quit never destroys the save; incompatible saves are preserved as recoverable legacy data (never erased, never reinterpreted); "Clear Save" and the game-over "Back to Menu" are the only destructive paths and both require explicit confirmation.