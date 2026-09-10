# Worldhand — Rules (Balatro-simple edition)

## Objective

Play poker hands. Bank Growth. Beat each epoch's **per-epoch** Growth target to advance — **early advance**: the moment Growth banked THIS epoch reaches the target, the epoch closes immediately (unused plays and discards are forfeited, exactly as in Balatro). Growth banked resets at each epoch boundary; a separate **lifetime Flourishing** total keeps growing for score/display. Then shop, then the next epoch — **there is no fixed number of epochs**; the run ends when you can no longer keep up (lives run out or Flourishing collapses). Lose if your **3 lives** run out, or Flourishing collapses to 0. There is no drought, no per-suit actions, no region choices — just cards, money, and the shop.

## Lives (Balatro-style — every miss costs 1, unlimited epochs)

You start every run with **3 lives**. Each epoch has a single target (see *Epoch end*); **missing ANY epoch target costs 1 life** and also **halves that epoch's between-market Seed income**. At **0 lives the run ends withered**. With unlimited epochs, missing targets is the pressure that eventually ends the run — lives are the exhaustible resource, and "how far did I get" is the score. Three missed targets in ordinary play therefore drain exactly 3 lives (regression-tested).

## Turn structure

Each epoch:
1. A **hand of 8** (9/10 with card additions) is dealt from the 52-card deck.
2. You have **4 plays** and **3 discards** to spend in any order.
3. When the 4th play is made — **or the moment Growth banked THIS epoch reaches the epoch target (early advance)** — the epoch closes (decay, civilization growth, income). Unused plays and discards are forfeited on an early close, exactly as in Balatro.
4. After the market, the next epoch begins (or the world ends at a 0-lives boundary). **There is no fixed number of epochs** — the run ends only when lives run out or Flourishing collapses.

## Playing cards (1–5 selection) — no suit decisions

- Select **1 to 5** cards from your hand; the exact selection is your poker hand. **There is no acting suit, no tie choice, no region target** — the same cards score the same regardless of suit mix.
- **1–4 cards**: only partial categories apply — high card, pair, two pair, trips, quads. Straights and flushes require exactly 5 cards.
- **5 cards**: full poker evaluation with standard precedence: high < pair < two pair < trips < straight < flush < full house < quads < straight flush. The **Ace is low** in the wheel A-2-3-4-5.
- Keyboard-friendly: arrow keys move between cards, Enter/Space toggles; selection shows a thick gold outline plus a ✓ glyph.

## The Growth formula (the hero number)

Every play resolves to ONE number, **Growth**, computed in one shared pipeline (`buildPlan`) in a stable order:

1. **poker** = `round(rankSum × CATEGORY_MULT[category])` — high ×1, pair ×1.5, two-pair ×2, trips ×2.5, straight ×3, flush ×4, full-house ×5, quads ×6, straight-flush ×8.
2. **World Laws** = × owned `growthMult` (floored at 1; Open Canals ×1.2), then + owned `growthFlat` (Canopy Choir +3, Stone Masonry +6).
3. **Regions** = the sum of the regional bonuses of every **awake** region whose fixed `specialization` equals the played hand's **exact evaluated category** (dormant regions contribute **0**).

`Growth = max(0, round(pokerBase × lawMult) + lawFlat + totalRegionBonus)` — floored at 0, never negative. The breakdown is displayed in that order (`+15 poker · +2 laws · +7 regions`) under the big Growth readout. **The epoch target is PER-EPOCH**: you must bank `need(n)` Growth DURING that epoch; Growth banked resets at each boundary. A separate **lifetime Flourishing** total (the planet's score) keeps growing across epochs. The preview and the commit both call the same `buildPlan`, so the number you see is always the number you bank.

### Regional bonus (v4 — the planet's poker specialization)

Each of **three** regions carries ONE fixed `specialization` — an exact evaluated poker category — mapped deterministically in the region data (same seed → same mapping, terrain identity untouched, never rerolled):

| Region | Terrain | Specialization | Starts | Base bonus |
|---|---|---|---|---|
| **Auralia** (id 0) | meadow | **Pair** | **awake** | +3 |
| **Pellucid** (id 6) | meadow | **Two Pair** | dormant | +4 |
| **Vantage** (id 11) | wetland | **Flush** | dormant | +6 |

The other nine regions have no specialization. Exact matching only: a Pair-specialized region pays on an exact **Pair** — **not** on trips, two pair, or any other hand that merely contains a pair. The specialization never changes the cards' category.

**Formula** (constants declared in code as exported consts, pinned by tests):

```
regionBonus = BASE + min(DEV_BONUS_CAP, floor(development / DEV_STEP))
PAIR_BASE = 3 · TWOPAIR_BASE = 4 · FLUSH_BASE = 6 · DEV_STEP = 2 · DEV_BONUS_CAP = 4
```

A **Pair** region with development 4 therefore grants 3 + 2 = **5**. The development share caps at **+4** (floor(10/2) = 5 → min(4, 5) = 4), so a maxed Pair region pays 7, a maxed Two-Pair region 8, a maxed Flush region 10. **Dormant specialized regions contribute exactly 0.**

**Stacking & order**: bonuses stack **additively** across all awake regions whose specialization matches the played category (two awake Pair regions add; never a multiplicative chain). The regional total is applied **once**, AFTER the existing law-adjusted Growth — the law multiplier never re-multiplies the regional bonus: `Growth = max(0, round(pokerBase × lawMult) + lawFlat + totalRegionBonus)`. A hand earning a regional bonus also earns its Seeds off the full number (`ceil(Growth / 4)`).

**How the two dormant specializations become obtainable**: the existing wake-* expansions — **Wake Pellucid (12 Seeds)** and **Wake Vantage (12 Seeds)**, matching the existing Wake Laguna / Wake Brumal 12-Seed convention — awaken their advertised region and activate its bonus; the market offers state which poker category benefits, the current bonus, and how development scales it. No new interface, no new economy.

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
```

**1 Seed per 4 Growth** (a 15-Growth hand nominally pays 4 Seeds). Seeds **accumulate without ceiling** — every play banks the full nominal earn, so the preview, the committed summary, and the chronicle all read the same single `amount` (no credited/overflow split). Epoch end pays +1 Seed per living **healthy** region (stability > 0) plus law income, halved on a missed epoch target, and is banked in full. Seeds can never go negative.

## Discards

- Discard **1–5 cards at once**; one discard budget is consumed per discard action.
- The hand **refills** to its current size (8, or 9/10 with card additions) from the deck (reshuffling the discard pile when exhausted).
- Card conservation always holds: hand + deck + discard pile = **exactly 52** — card additions grow the dealt hand from the same pool.

## Epoch end

1. **Target check** (logged): each epoch you must bank **`need(n)` Growth DURING that epoch** — `need(n) = 100 + (n−1) + 0.1·(n−1)²`, escalating indefinitely (epoch 1 = 100). **Missing ANY target costs 1 life and halves that epoch's Seed income.** A met target advances immediately (early advance). **Every epoch opens the market** — there is no fixed final epoch; the run ends only when lives run out or Flourishing collapses. Growth banked resets at each boundary, so a miss costs a life but leaves the run recoverable — the deficit is NOT carried forward.
2. **Decay**: every living region with stability left loses **1 stability** per epoch. **Mycorrhiza Network reduces this decay by 1 — i.e. living regions stop decaying entirely (1 → 0)**; decay is floored at 0 (never a gain, never a double loss) and regions at 0 stay at 0. Decay is **not purely cosmetic**: the income below counts only living regions with **stability > 0**, so decayed-out regions stop paying Seeds (Mycorrhiza protects that income base).
3. **Civilization growth**: every living region gains +1 development — this drives the 3D planet's evolution icons and the globe's visible size. No gameplay read.
4. **Income**: +1 Seed per living healthy region, plus law income (halved on a missed target), banked in full (uncapped).
5. **Market phase** — every epoch (met or missed) opens the market; there is no fixed final epoch.

## Market (spend Seeds on a smarter civilization)

- Up to 3 offers per epoch from the item pool, bought with Seeds. **Max 5 owned items**; buying is blocked at the cap until you explicitly remove an item (no refund, frees the slot). Owned items never reappear. Seeds accumulate without ceiling.
- **Hand upgrades**: Canopy Choir (+3 Growth every play), Stone Masonry (+6 Growth every play), Open Canals (Growth ×1.2 every play). Bonuses apply exactly once per play.
- **Card additions**: Fourth Counsel (hand 9), Fifth Counsel (hand 10) — new unique ids; deck conservation still holds at 52.
- **Expansions**: Wake Laguna / Wake Brumal — awaken a specific dormant region; the planet visibly grows. **Wake Pellucid / Wake Vantage (12 Seeds each, same convention)** — awaken the Two-Pair / Flush-specialized region and activate its regional Growth bonus (see *Regional bonus* above).
- **Laws**: Mycorrhiza Network (decay 1 → 0: living regions stop decaying each epoch — this also protects their Seed-income contribution, since income counts only regions with stability > 0), Seed Vaults (+3 Seeds/epoch), Barter Routes (market −2).
- All former per-suit items (Deep Taproots, Rich Soil, Communal Tending) are removed with their actions.

## Saving & versioning

**Auto-save**: the game persists the state to localStorage after every committed state-changing action (play, discard, buy, remove, end-market, epoch close — and selection changes), so quitting or reloading never loses progress. Rewards are applied exactly once inside the engine's commit; saving the resulting state cannot double-apply them.

**Versioning**: the envelope carries a schema version and the state carries the engine **rules** version (`SAVE_VERSION = 5`, the per-epoch-targets engine; separate `SCHEMA_VERSION = 3` for envelope layout). On load, a save whose version or structure does not match the current engine — wrong version, missing/non-numeric `lives`, obsolete era market items (Deep Taproots-era ids), invalid phase, malformed cards (rank/suit out of range), broken 52-card conservation, an invalid region `specialization` (must be `null | 'pair' | 'twopair' | 'flush'`) — is **rejected, never migrated and never reinterpreted**. The raw blob is preserved **verbatim** under a timestamped legacy key (`worldhand.save.legacy.<ts>`) so the old run stays recoverable, and the menu explains that **a fresh run is needed because the engine rules changed** (with a "Show preserved legacy blob" button). Quitting never destroys the save; only **Clear Save** is destructive, and it now requires an explicit confirmation (as does the game-over "Back to Menu" clear).

## Balance (bounded solver result — NOT a human win-rate estimate)

`scripts/solve.mjs` plays a greedy automated policy. **This is a bounded solver result, not an estimate of human performance** — the policy is a machine heuristic over a bounded candidate set, and the numbers below describe that policy only. Calibration uses the reference method directly: `LOOK=30 npx vite-node scripts/solve.mjs`.

The solver was corrected in this pass (the old `score()` still carried drought/stability-era terms, and its bounded candidate list was filled entirely with 1–2-card combinations, so it never evaluated a real poker hand). The corrected policy:

- **Candidates span 1–5 cards across poker categories**: all 1–2-card selections PLUS deliberate category candidates — pairs/trips/quads groups, two-pairs, full houses, flushes (best + lowest 5-card same-suit subsets), straights (incl. ace-low wheels, suit-preferred for straight-flush attempts), and generic best-rank 3/4/5-card fillers. `LOOK` caps how many are considered per play; unset = exhaustive.
- **Scores only current mechanics**: Growth banked toward the epoch target (chips×mult + laws, with a reachability penalty once the target is out of reach), Seeds gained, and lives (a lost life is heavily penalized). No drought/stability terms exist.
- **Discards sensibly**: when every candidate scores weak, it dumps the cards the best play did not want (≤5), refills, and keeps the discard only if the post-refill best play clearly beats the pre-discard one.
- **Buys in a documented priority order**: canopy-choir (+3 flat on every play, cheapest Growth/Seed) → seed-vaults (+3 Seeds/epoch) → barter-routes (−2 all purchases) → open-canals (×1.2 every play) → stone-masonry (+6 flat) → fourth-counsel (9-card hands). Specialized wakes are considered when affordable and their category is in/near the current hand: Wake Pellucid activates Two Pair (+4 base) and Wake Vantage activates Flush (+6 base). Non-specialized wakes, Mycorrhiza, and Fifth Counsel remain skipped by this bounded policy.
- **Calibration and evaluation seeds are disjoint**: `--set calib` runs the `probe-0..29` set (used only for target sweeps); `--set eval` runs the `eval-0..29` set (the reported result); no flags run both. Output is labeled **bounded solver result** everywhere.

The per-epoch target formula measures on the eval-* set (calibration set in parentheses):

| Policy | Result (bounded solver) |
|---|---|
| LOOK=30 (bounded reference) | **16/30 (53%)** (20/30, 67% calib) — pre-v4 baseline |
| LOOK=12 (very bounded) | 0/30 (0%) (1/30, 3% calib) |
| Exhaustive (oracle) | 30/30 (100%) both sets |

**Per-epoch re-measure (targets are per-epoch, not cumulative)**: the target formula `100 + (n−1) + 0.1·(n−1)²` is fit so a bounded policy at LOOK=30 gets a smooth depth distribution. On the eval-* set: **max 4/30 (13%) at any single epoch, no empty gap after a spike**; on the calib set: **max 6/30 (20%)**. The previous cumulative curve (fit to running totals) was far too high per-epoch and produced a bimodal cliff (11/30 died at exactly epoch 5); per-epoch targets remove that cliff. Reported as measured — not band-forced.

**Honest note, not tuned to a band**: the corrected policy is substantially stronger than the old mis-focused one (the old LOOK=30 measured 53% because the bounded list never saw a 3+ card hand). The per-epoch target formula is fit to the measured bank rate so runs end naturally via lives — reported honestly, with balance judgement left to human playtest rather than forcing a 40–60% band.

## Determinism

Same seed phrase → identical world, shuffles, deals, and chronicle. All randomness flows from the hashed seed; the engine is pure (no DOM, no clock, no Math.random).

## Known ceilings past epoch ~10 (reported, not fixed)

These are real limits on "make the planet as good as possible" that matter once runs go past ~epoch 10, but they are a separate decision and are NOT addressed in this pass:

- **Only 8 of 12 regions can ever wake**: 4 start awake + exactly 4 wake items (Wake Laguna→4, Wake Brumal→9, Wake Pellucid→6, Wake Vantage→11). Regions 5, 7, 8, 10 have no wake item and are permanently dormant.
- **Development caps at 10 per region** (`STABILITY_MAX`), so the planet fully maxes around epoch 10.
- **The shop empties permanently after ~12 epochs**: `MARKET_ITEMS` has 12 entries and owned items never re-offer, so once all are owned the market is empty.

At LOOK=30 the bounded solver reaches median epoch 10 / max 14, so a typical run brushes against the development cap and the shop-drain ceiling. These are recorded here for a future decision, not silently patched.

## Interface & motion (card-first, one big number, zero emojis)

- **Play area**: the 8-card hand and the **big Growth number** for the current selection are the centerpiece, with the ordered breakdown (`poker · laws`) and the honest **`chips × mult = base`** readout underneath. Cards are rich cream/white with saturated red/blue suits and bold ranks; selection glows gold (`.pcard-btn.sel`); panels sit on a deep dark celestial background beside the 3D planet.
- **HUD**: one quiet, grey status strip (Flourishing/target, Seeds, Lives, Plays, Discards, Living regions) — deliberately de-emphasized.
- **No emojis anywhere in the rendered UI** — labels are plain text; suit symbols are typographic glyphs. `scripts/check-no-emoji.py` audits the rendered-UI sources.
- **Animations are skippable**: under `prefers-reduced-motion` the globe's auto-rotation and icon bobbing stop (state changes apply instantly) and CSS transitions are globally disabled.

## The 3D planet (the world you can read)

The globe is the world hero: 12 terrain patches, evolution icons (groves, farms, workshops, settlements, observatories) that appear and grow with each region's **development**, dormant regions dim and desaturated. **The globe visibly grows**: its scale blends the awakened fraction (50%) and total development (50%) of the planet. Every living region gains +1 development per epoch. Hover highlights, click selects (raycast), a keyboard-accessible legend reaches every region, and the inspector shows exact values.

**Specializations are legible everywhere**: the region legend shows each specialized region's poker-category badge ("Pair" / "Two Pair" / "Flush", dimmed while dormant), the globe tooltip/inspector (`map-detail`) states which category benefits, the CURRENT bonus, how development changes it (`+1 per 2 development, cap +4`), and whether the region is dormant (contributes 0) or active. On the market, Wake Pellucid / Wake Vantage offers carry a poker-bonus note (category, base bonus, development scaling, dormant/awake state). **When a previewed hand's exact category matches an awake specialization, the matching regions get pulsing gold rings on the globe, a gold "Regional bonus active" banner names them with their current bonus, and a globe tooltip repeats the bonus — all visible without any extra click before playing.**

## Saving

See *Saving & versioning* above. Short version: auto-save after every action; quit never destroys the save; incompatible saves are preserved as recoverable legacy data (never erased, never reinterpreted); "Clear Save" and the game-over "Back to Menu" are the only destructive paths and both require explicit confirmation.

## Rejected non-match-penalty experiment (2026-09-10)

The proposed contrastive rule (`NON_MATCH_PENALTY=3`) was tested without formula iteration and rejected. Its hypothesis was that penalizing hands matching no awake specialization would make regional influence monotonic as regions awaken. On the same 30-seed/360-play metric, the experiment measured **25/360 = 6.9%** with the starting build and **7/360 = 1.9%** with all three awake; therefore the monotonicity prediction failed. The exact diff and artifacts are preserved under `.hermes/experiments/non-match-penalty-d02b14c/`. The default game remains the additive v4 behavior above. The retained `scripts/flip-rate.mjs` measures a changed selection, not necessarily a changed poker category or strict preference reversal; identical frozen hands/states are required for causal comparisons, since same seed alone does not ensure identical trajectories. The restored default re-measured **14/360 = 3.9%** as-shipped and **5/360 = 1.4%** all-awake. These figures are evidence that the current bonus is usually low-impact, not a balance claim.