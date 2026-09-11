# Worldhand — Rules (v8, bounded economy)

## Objective

Play poker hands. Bank Growth. Beat each epoch's **per-epoch** Growth target to advance — **early advance**: the moment Growth banked THIS epoch reaches the target, the epoch closes immediately (unused plays and discards are forfeited, exactly as in Balatro). Growth banked resets at each epoch boundary; a separate **lifetime Flourishing** total keeps growing for score/display. Then shop, then the next epoch — **there is no fixed number of epochs**; the run ends when you can no longer keep up (lives run out or Flourishing collapses). **The goal is the World Score** — make the world as good as you can before your 3 lives run out. **The blinds escalate fast, so you must build a scaling engine (Jokers, Planet cards, World Level) to survive.** There is no drought, no per-suit actions, no region choices — just cards, money, and the shop.

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

1. **poker** = `round(rankSum × mult)` where `mult = CATEGORY_MULT[category] + planetBoosts` — high ×1, pair ×1.5, two-pair ×2, trips ×2.5, straight ×3, flush ×4, full-house ×5, quads ×6, straight-flush ×8. Planet cards permanently raise a hand type's `mult`.
2. **World Laws** = × owned `growthMult` (floored at 1; Open Canals ×1.2), then + owned `growthFlat` (Canopy Choir +3, Stone Masonry +6).
3. **World Level** = +2 Growth/play per level above 1 (the simplified worldbuilding number).
4. **Regions** = the sum of the regional bonuses of every **awake** region whose fixed `specialization` equals the played hand's **exact evaluated category** (dormant regions contribute **0**).
5. **Jokers** = × the product of `(1 + mult)` over every joker whose condition the hand meets (stack multiplicatively; Vouchers add to all joker mult).
6. **Consumables** = × the product of the queued one-shot boosts (applied to the next hand, then consumed).

`Growth = max(0, round((pokerBase × lawMult + lawFlat + worldBonus + totalRegionBonus) × jokerMult × consumableMult))` — floored at 0, never negative. The breakdown is displayed in that order (`+15 poker · +2 laws · +4 world · +7 regions ×1.5 joker`) under the big Growth readout. **The epoch target is PER-EPOCH**: you must bank `need(n)` Growth DURING that epoch; Growth banked resets at each boundary. A separate **lifetime Flourishing** total (the planet's score) keeps growing across epochs. The preview and the commit both call the same `buildPlan`, so the number you see is always the number you bank.

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

## The auto-Seeds formula (money from hand quality, BOUNDED)

Every play earns Seeds instantly — there is no gather action:

```
nominal = ceil(Growth × SEEDS_PER_GROWTH)           SEEDS_PER_GROWTH = 1/4
earned  = min(nominal, playSeedCap(epoch))          playSeedCap = 4 + epoch
```

**1 Seed per 4 Growth, up to `4 + epoch` Seeds on any single play.** This cap is
the load-bearing rule of the whole economy, and it does two things:

1. **Income is decoupled from score.** Beating a blind by 900× pays exactly what
   beating it by 2× pays. (Balatro works the same way: a blind's payout does not
   scale with your chips.) Without this, `Growth → Seeds → multipliers → Growth`
   is a loop whose gain exceeds 1 and never comes back — which is precisely what
   v7 did, reaching World Level 4009 and 107 million Seeds.
2. **Income grows linearly while the blinds grow geometrically.** Seeds get
   scarcer relative to the difficulty every epoch, so the market stays a real
   decision in the late game instead of a formality.

A capped play is marked `(capped)` in the preview, the committed summary and the
chronicle — the number the UI shows is always the number that is banked.

Epoch end pays +1 Seed per living **healthy** region (stability > 0) plus law,
project, voucher and World-Level income, halved on a missed target. A **met**
target additionally pays **+1 Seed per unused play** (Balatro's $1-per-unused-hand),
so clearing a blind early is a reward rather than a loss of income. Seeds can
never go negative.

## Discards

- Discard **1–5 cards at once**; one discard budget is consumed per discard action.
- The hand **refills** to its current size (8, or 9/10 with card additions) from the deck (reshuffling the discard pile when exhausted).
- Card conservation always holds: hand + deck + discard pile = **exactly 52** — card additions grow the dealt hand from the same pool.

## Epoch end

1. **Target check** (logged): each epoch you must bank **`need(n)` Growth DURING that epoch** — `need(n) = round(100 × 1.40^(n−1))`, a **geometric** blind curve (epoch 1 = 100, epoch 10 ≈ 2,072, epoch 20 ≈ 60,000). It is geometric on purpose: a player's engine grows *polynomially* (5 joker slots, one-time vouchers, superlinear Planet/World-Level prices), so a geometric curve always wins eventually. The skill is how long you hold the lead. **Missing ANY target costs 1 life and halves that epoch's Seed income.** A met target advances immediately (early advance). **Every epoch opens the market** — there is no fixed final epoch; the run ends only when lives run out or Flourishing collapses. Growth banked resets at each boundary, so a miss costs a life but leaves the run recoverable — the deficit is NOT carried forward.
2. **Decay**: every living region with stability left loses **1 stability** per epoch. **Mycorrhiza Network reduces this decay by 1 — i.e. living regions stop decaying entirely (1 → 0)**; decay is floored at 0 (never a gain, never a double loss) and regions at 0 stay at 0. Decay is **not purely cosmetic**: the income below counts only living regions with **stability > 0**, so decayed-out regions stop paying Seeds (Mycorrhiza protects that income base).
3. **Civilization growth**: every living region gains +1 development — this drives the 3D planet's evolution icons and the globe's visible size. No gameplay read.
4. **Income**: +1 Seed per living healthy region, plus law/project/voucher/World-Level income (halved on a missed target), plus **+1 per unused play when the target was met**.
5. **Market phase** — every epoch (met or missed) opens the market; there is no fixed final epoch.

## Market (spend Seeds on a smarter civilization)

**One market visit is one opportunity, not an unbounded loop.** v7 allowed
unlimited repeat purchases inside a single visit — one epoch-14 market in the
reference save saw 6,077 purchases. v8 limits per visit:

| Shelf | Per visit | Price behaviour |
|---|---|---|
| Laws / upgrades / expansions | 3 offered, one each | flat, −2 with Barter Routes; **5 owned slots** |
| Jokers | 3 offered, one each | flat; **5 owned slots**, duplicates stack |
| Planet cards | 3 offered, one each | the **n-th copy of a category costs `base × n`** |
| Consumables | 2 offered, one each | flat; **2 queued slots** |
| Vouchers | 2 offered, one each | flat; **ONE COPY EVER** — an owned voucher never returns to the shelf |
| World Projects | 3 offered, **one copy per visit** | `base + owned × costGrowth`, rises every time |
| World Level boost | **once per visit** | `10 × current level` (quadratic total spend for linear power) |

- Up to 3 offers per epoch from the item pool, bought with Seeds. **Max 5 owned items**; buying is blocked at the cap until you explicitly remove an item (no refund, frees the slot). Owned items never reappear.
- **Hand upgrades**: Canopy Choir (+3 Growth every play), Stone Masonry (+6 Growth every play), Open Canals (Growth ×1.2 every play). Bonuses apply exactly once per play.
- **Card additions**: Fourth Counsel (hand 9), Fifth Counsel (hand 10) — new unique ids; deck conservation still holds at 52.
- **Expansions**: Wake Laguna / Wake Brumal — awaken a specific dormant region; the planet visibly grows. **Wake Pellucid / Wake Vantage (12 Seeds each, same convention)** — awaken the Two-Pair / Flush-specialized region and activate its regional Growth bonus (see *Regional bonus* above).
- **Laws**: Mycorrhiza Network (decay 1 → 0: living regions stop decaying each epoch — this also protects their Seed-income contribution, since income counts only regions with stability > 0), Seed Vaults (+3 Seeds/epoch), Barter Routes (market −2).
- All former per-suit items (Deep Taproots, Rich Soil, Communal Tending) are removed with their actions.

## Saving & versioning

**Auto-save**: the game persists the state to localStorage after every committed state-changing action (play, discard, buy, remove, end-market, epoch close — and selection changes), so quitting or reloading never loses progress. Rewards are applied exactly once inside the engine's commit; saving the resulting state cannot double-apply them.

**Versioning**: the envelope carries a schema version and the state carries the engine **rules** version (`SAVE_VERSION = 8`, the bounded-economy engine; separate `SCHEMA_VERSION = 4` for envelope layout). **v7 saves — including runs made on the currently deployed build — are rejected, preserved verbatim as legacy data, and exportable to a file; they are never re-scored under v8 rules and never erased.** See `RELEASE_MIGRATION_v8.md`. On load, a save whose version or structure does not match the current engine — wrong version, missing/non-numeric `lives`, obsolete era market items (Deep Taproots-era ids), invalid phase, malformed cards (rank/suit out of range), broken 52-card conservation, an invalid region `specialization` (must be `null | 'pair' | 'twopair' | 'flush'`) — is **rejected, never migrated and never reinterpreted**. The raw blob is preserved **verbatim** under a timestamped legacy key (`worldhand.save.legacy.<ts>`) so the old run stays recoverable, and the menu explains that **a fresh run is needed because the engine rules changed** (with a "Show preserved legacy blob" button). Quitting never destroys the save; only **Clear Save** is destructive, and it now requires an explicit confirmation (as does the game-over "Back to Menu" clear).

## Balance (bounded solver measurement — NOT a human win-rate estimate)

`scripts/difficulty-measure.mjs` runs **five frozen policies** over two
**disjoint** seed sets. These are automated heuristics; they say how far a
written-down strategy gets, not how a person will do.

| Policy | What it is |
|---|---|
| **P0 no-shop** | greedy best play, buys nothing — the floor |
| **P4 weak play** | the cheapest-first shop, but always plays the single highest card — isolates poker skill |
| **P1 scattered** | greedy play + a uniformly random affordable purchase each step (careless, but spends everything) |
| **P2 cheapest** | greedy play + cheapest-affordable-of-each-kind in a fixed order |
| **P3 focused** | greedy play biased to one category + a shop that prioritises pieces matching it, then spends the remainder |

`TARGET_GROWTH` was chosen on the **development** set (`probe-*`) via
`scripts/target-sweep.mjs`; the **held-out** set (`eval-*`) was never used to
pick a constant. Both are reported.

**Run depth, 40 seeds each, epoch cap 60:**

| Policy | dev median (mean) | held-out median (mean) | held-out range |
|---|---|---|---|
| P4 weak play | 3 (3.0) | 3 (3.0) | 3–3 |
| P0 no-shop | 9 (8.8) | 9 (8.8) | 7–10 |
| P1 scattered | 16 (16.1) | 15 (15.1) | 12–19 |
| P2 cheapest | 17 (16.6) | 15 (15.4) | 12–19 |
| P3 focused | 17 (17.1) | 17 (16.4) | 12–20 |

**0 of 400 runs reached the epoch cap.** Every policy, on every seed, on both
sets, eventually dies. Under v7 the same harness could not kill a run at all.

What the numbers say about skill:

- **Poker play is the dominant lever: ~12–13 epochs.** Same shop policy, weak
  play dies at epoch 3, competent play at 15.
- **Shopping at all is worth ~6–8 epochs** (no-shop 8.8 → shopping ~15–17).
- **Build coherence is worth ~1 epoch** on held-out seeds (scattered 15.1 →
  focused 16.4), i.e. several builds are viable and the committed one is
  modestly ahead. Reported as measured, not band-forced.

The banked/target margin for a shopping policy sits at 1.4–2.6× through the
early epochs, crosses 1.5× around **epoch 10**, and goes under 1.0× in the
high teens — the back half of a run is genuinely in doubt.

`scripts/solve.mjs` remains as the older single-policy probe; its two stale
scoring terms (a 30-Seed balance cap and a 40-Growth/play ceiling, neither of
which exists) were corrected, and it now shares
`scripts/lib/candidates.mjs` with the measurement so both evaluate the same
move space.

## What a player actually has to choose (and how careless builds lose)

The strategy is entirely in the market and the hand, exactly as the brief asks.

**1. Your five joker slots are the run.** The pool is nine jokers for five
slots, and slots cannot be freed — so what you buy early locks out what you buy
late. The mults are tiered by how hard the condition is to hit: All-In (fires on
every hand) is ×1.4 and the *worst* Growth per Seed; Full House is ×5 and fires
seldom. **Committing to a rare shape is worth many times more than hedging — if
you can actually make that shape.** Three Flush jokers is ×42 on a flush and
×1 on everything else.

**2. Seeds are scarce, permanently.** A play earns at most `4 + epoch` Seeds,
so income grows linearly while the blinds grow at 1.40× per epoch. You cannot
buy your way out of a bad build; by epoch 12 you are choosing between a joker,
a Planet card and a World Level, not buying all three.

**3. Repeat power gets expensive on purpose.** The n-th Planet card in a
category costs `base × n`; the World Level costs `10 × level` and can be raised
**once per market visit**. Stacking one axis forever is not a strategy any more —
it is a way to run out of Seeds.

**4. Vouchers are a one-shot decision.** Three exist, each buyable once. Joker
Power (+0.5 to every joker) is worth most to a build with expensive conditional
jokers; Bigger Hand (+1 card, and in v8 it actually works) is worth most to a
build chasing flushes and straights; Seed Income is worth most early.

**How careless builds lose, concretely:**

- **Play badly and you die at epoch 3.** No shop compensates for not making
  poker hands — the measurement is unambiguous.
- **Fill your joker slots with cheap conditionals you never play** and they sit
  dead while the blinds compound; you cannot sell them.
- **Spread Planet cards across six categories** and each one is on its
  expensive third copy while nothing is on its cheap first — the same Seeds buy
  roughly half the multiplier a focused buyer gets.
- **Clear the blind on play 1 every epoch** and you cap your income four times
  over; conversely, **deliberately stalling** does not help either, because a
  met target pays +1 Seed per unused play.
- **Bank a 400-million Growth hand** and you get `4 + epoch` Seeds for it, the
  same as a hand that just cleared the bar. Overkill is not currency.

## World Score & the Balatro-hard shop (the goal)

**World Score** is the run's goal — how good you made the world. It's shown in the HUD and is what you maximize before your 3 lives run out:

```
World Score = 5 × World Level
            + 15 × owned laws/upgrades
            + 10 × owned Jokers
            + 5 × total Planet-card boosts
            + 8 × owned Vouchers
            + floor(lifetime Flourishing / 10)
```

**World Level** is the simplified worldbuilding number — one clear value instead of the old region map. It auto-grows +1 each epoch and can be boosted with Seeds. Each level above 1 adds **+2 Growth/play, +1 Seed/epoch, +5 World Score**.

**The shop is Balatro-style** — four rotating card types plus the World Level boost:

- **Jokers** (max 5) — conditional multipliers that define your build: "×1.5 Growth when you play a Pair," "×2 on a Flush," "×1.5 if no face cards," "×1.25 on every hand." They stack multiplicatively.
- **Planet cards** — permanently raise a hand type's base mult (build toward one hand).
- **Consumables** — one-shot boosts queued before a hand ("next hand ×2").
- **Vouchers** — permanent globals (+1 hand size, all jokers +0.5 mult, +2 Seeds/epoch).
- **World Level boost** — spend Seeds to raise the world level.

**The blinds escalate fast** (`100 + 40·(n−1) + 5·(n−1)²`), so raw hands alone can't keep up past ~epoch 5 — you must build a scaling engine to survive, but the blinds keep outrunning it. Measured at LOOK=30: runs end around **epoch 8–18** (max 6/30 = 20% at any single epoch, no gaps).

## Determinism

Same seed phrase → identical world, shuffles, deals, and chronicle. All randomness flows from the hashed seed; the engine is pure (no DOM, no clock, no Math.random).

## Known limits (reported, not fixed)

- **The first ~8 epochs are rarely in doubt** for a player who both makes poker
  hands and shops. With 3 lives and 4 plays per epoch, the early curve is a
  ramp, not a threat; tension measurably begins around epoch 10.
- **Build coherence is worth only ~1 epoch** in the bounded measurement
  (scattered 15.1 → focused 16.4 on held-out seeds). Several builds are viable,
  which is healthy, but the *shape* of your build matters much less than
  whether you shop at all and far less than how well you play the cards.
- **Seeds can still pool late in a long run**: once the shop's per-visit shelf
  is exhausted there is nothing left to spend on that epoch. This is now a
  small, bounded surplus rather than v7's 107 million.
- **World Level income (`level − 1` Seeds/epoch) is still the largest passive
  source.** It is bounded — at most one bought boost per visit plus one free
  per epoch, so `worldLevel ≤ 2·epoch + 1` — but it is the piece most likely to
  need attention if the curve is retuned again.
- These are a bounded-solver measurement, not human playtesting. A person who
  discards better than the frozen rule will go deeper than the table says.

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