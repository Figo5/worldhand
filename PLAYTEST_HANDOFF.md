# Worldhand — Playtest Handoff (v2 core, three-epoch vertical slice)

## Status: READY FOR PLAYTEST (v2.2 bounded-calibrated balance + Drought legibility)

Commit replaces the v1 (8-epoch, one-card-per-play) contract with the corrected v2 core. The old contract was deliberately incompatible and has been removed.

## v3 presentation overhaul — 3D evolving planet + accessible card UI (worker, Sep 2026)

A presentation-only rework of the world view and the card interface; **the engine contract is untouched** (`src/engine/worldhand.ts`, `src/engine/poker.ts`, and their tests are unchanged).

### The 3D evolving planet (`src/components/Planet3D.tsx`)

- The old SVG planet disc is replaced by a genuine **three.js globe** mounted in the same planet panel: an ocean sphere with **12 terrain-coloured spherical caps** (one per region, colour from its terrain), a starfield and atmosphere around it.
- **Evolution icons per region**: forest groves (trees), food (farms/fields), industry (workshops), settlements (buildings), knowledge (observatories/telescopes by terrain) are scattered deterministically across each patch and **appear/grow with the region's development and awake state** — living regions render icons scaled by development; **dormant regions render dim, desaturated, unlit**. All of this is derived from engine region state (`development`, `dormant`, terrain) — **the world is simulated presentationally only; no engine mechanics were added**.
- The globe **auto-rotates slowly** so the world feels alive; under `prefers-reduced-motion` the rotation and icon bobbing are disabled (state changes apply instantly) and a global CSS rule kills transitions.
- **Selection**: hover changes the cursor and highlights a patch; a click (raycast, drag-safe) selects a region — gold emissive highlight + outline ring, adjacency neighbours drawn as bright link lines. The canvas is focusable and arrow keys walk the regions.
- **No-fiddly access**: a compact **region legend** under the globe (`.region-btn` buttons, Tab order, Enter/Space to select, ✓ marker on the selection) selects the same region in the 3D view. The region inspector keeps the `map-detail` class/testid and shows exact name/terrain/stability/development/adjacency/awake state.
- The canvas sizes responsively via ResizeObserver and fits 1280×800 and 420–480px widths without horizontal clipping.

### Card interface + HUD

- **Cards**: larger cards with a readable suit+rank, an action label (Roots/Bloom/Sow/Tend) under each card, and a strong selected state — **4px gold outline + ✓ glyph** (not colour-only). **Keyboard hand**: arrow keys move across the 8 cards, Enter/Space toggles selection, focus is visible; the 1–5 selection limit, Play/Discard/Advance controls, tie-suit buttons, and the exact preview panel (category, points, acting suit, effects, wake-drought warning) are unchanged.
- **HUD**: the top strip is consolidated into labelled `.hud-item` chips — Flourishing x/target, Stability x/target, Seeds, Plays, Discards, Living regions, Survival, and the Upcoming/live Drought item (all required data kept).
- Review-script selector notes: `.planet-svg`/`.region-node` are gone — qa.mjs and review-browser.mjs now wait on `canvas.planet3d-canvas` and click `.region-btn` (same flow, same coverage); `[data-testid=map-detail]` still asserts adjacency. New acceptance script: `node scripts/review-planet3d.mjs` (canvas mount, pixel sample, legend/keyboard selection → map-detail, reduced-motion rotation stop) capturing `shots-review/planet3d-wide.png` and `shots-review/planet3d-narrow.png`.
- Verified: `npx tsc --noEmit` clean; `npx vitest run` **77/77**; `npm run build` green; `node scripts/qa.mjs` ALL PLAYWRIGHT CHECKS PASSED at 1280×800 **and 480×800** (the narrow viewport was updated from 420×820 to 480×800), zero console/page errors, no horizontal overflow; `review-browser/fullrun/autosave/pvcommit/drought-legibility` all pass with zero errors.

## What a playtester should exercise

1. **Start** — enter any seed phrase (same seed = same world, tested). 12 regions on the planet disc; 4 awake.
2. **Play** — click 1–5 cards in the hand; the **Resolution preview** panel shows category, category points, acting suit, how the suit was decided (majority / tie / your tie choice), and the exact world effects. Press Play — the commit matches the preview exactly (the chosen tie suit rides the committed play as `suitChoice`; regression-tested).
3. **Tie-break** — select a tie (e.g. 2♥ + 2♦); the preview offers suit-choice buttons; your choice is what fires — in the preview *and* in the commit (previously the commit silently reverted to the S,H,D,C default; fixed).
4. **Discard** — select up to 5 cards, press Discard: the hand refills to 8 immediately; budget is 3 per epoch.
5. **Planet map** — click any region node (mouse or keyboard): terrain color, stability pips, development ring, and adjacency lines/detail appear. Dormant regions render dimmed with "z".
6. **Epoch flow** — 4 plays closes the epoch: target check, challenge, decay, income, market. Buy laws/upgrades/expansions with Seeds or continue. **Missing an epoch-1/2 target costs 1 Survival (start 3; 0 = run ends withered) and halves that epoch's Seed income** — the HUD target line is the bar to clear, not decoration.
7. **Epoch 3 Drought** — explicitly announced at epoch start in the log and HUD; keep every living region at stability 3+ through epoch end or the world withers.
8. **Save/Quit** — the game **auto-saves after every committed action** (the Save button remains as an explicit checkpoint); **Quit keeps the save** (menu → Load Saved World restores). Only "Clear Save" deletes. Rewards are applied once in the engine commit, so auto-saving cannot duplicate them.

## What changed vs the previous slice (v1 → v2)

- One-card suit action → **1–5 card poker selection** with exact scoring (cards + precedence + Ace-low wheel).
- Text-panel regions → **SVG planet map** with terrain/development/adjacency and accessible (tabbable, labeled) controls.
- Discard didn't refill → **discard 1–5 with refill** and a tested card-conservation invariant.
- Hidden challenge → **explicit previewed Drought** in epoch 3 (log + HUD + previewed every epoch long; shown as an *upcoming* condition from epoch 1).
- Fixed target → **three escalating targets** (12/20 → 24/30 → 32/40) on **capped** stats (stability 10, Seeds 30), recalibrated in v2.2 by `scripts/solve.mjs` under the **bounded LOOK=30 policy** so the reference bounded player lands in the 40–60% win band (17/30 = 57%; the old 20/36/52 gave a bounded player 0/30). A **Survival pool** (3, −1 per missed epoch-1/2 target, halved market income on a miss, withered at 0) makes every epoch target live.
- No preview/commit chain → one **deterministic ResolutionPlan** shared by preview and commit.
- Quit cleared save → **quit preserves the save**; version 2 envelope; v1 saves rejected, not mis-migrated.
- 8 epochs/4 hands → **3 epochs × (4 plays + 3 discards)** vertical slice.
- Market: **laws + upgrades + expansions** with Seed costs, Barter Routes discount, meaningful two-action depth per suit.

## Verification performed

- `npx vitest run` — **76 tests, all passing** (poker categories, precedence, wheel; selection scoring; majority/tie **incl. the tie-suit commit regression**; plan determinism preview==commit; discard/refill/conservation; 4 plays + 3 discards; targets **and their measured calibration**; **Survival pool costs**; drought; market; caps; withering; save version; Roots adjacency spread & development bonus/growth/cap).
- `node scripts/qa.mjs` — real Playwright runs at **1280×800 and 420×820**: new world → select 2 → preview → play (3/4) → discard (refill to 8, 2/3) → map click (adjacency detail) → save → quit → load; no console errors; no horizontal overflow.
- Screenshots in `shots/`: `before-*.png` (menu), `after-*-selected.png`, `after-*-map.png`.

## Coordinator (Luna) independent re-verification — post-fix

Re-run by the coordinator against the shipped tree (commit `a9768c8`), not taken on the worker's word:

- `npx tsc --noEmit` — clean. `npx vitest run` — **76/76**. `npm run build` — green. `node scripts/qa.mjs` — ALL PLAYWRIGHT CHECKS PASSED (1280×800 and 420×820), zero page/console errors, server HTTP 200 on 127.0.0.1:5177.
- `npx vite-node scripts/solve.mjs` (greedy all-subset policy, 30 `probe-*` seeds) — **21/30 wins (70%), final F min 46 / median 55 / max 68** vs epoch-3 target 52. Meaningfully below the pre-fix 30/30 (100%). Surviving losses are terminal and recorded (`Final Flourishing N fell short of 52`, or Survival-pool exhaustion).
- Tie-suit commit regression confirmed in source and tests: `worldhand.ts:450` `buildPlan(..., action.suitChoice ?? regionChoice)`, `App.tsx:254` dispatches `suitChoice: tieChoice`; tests assert `preview(s,'C')` effects equal a committed `play {suitChoice:'C'}`'s resolution, and that the choice genuinely overrides the default tie-break (`preview('D')` → D, default → H).
- Drought path confirmed untouched (diff against `1813787` shows only `survival <= 0` added to the loss gate).

## Drought legibility — browser playtest (coordinator, 3 seeds)

Played `bloom-1`, `bloom-2`, `bloom-3` (Bloom-heavy, single-card plays) to the epoch-3 verdict via real Playwright on the shipped build, capturing the exact preview/HUD/log text at every decision point. **Verdict: the Bloom↔Drought tension is NOT legible before the player loses to it — it only becomes obvious in hindsight.**

- **At the moment of waking**, the preview shows only e.g. `Bloom: +3 Flourishing. Laguna wakes.` / `Ozurn wakes.` — a pure reward. Nothing states the newly awake region must later hold stability 3+, or that the wake raises the Drought bar.
- **The `⚔ Drought — on track/at risk` HUD item exists but only renders while `state.challenge` is set, which is only during epoch 3** (`App.tsx:125-129`; `state.challenge = droughtChallenge(3)` is set in `advanceToNextEpoch` at epoch 3 only). During the epochs where Bloom decisions happen, the threat is not displayed at all. It materializes only once those decisions are locked in.
- **Outcome under the new targets:** all three naive-Bloom seeds died at epoch 3 with `Final Flourishing 16/17 fell short of 52` — a direct, reproducible instance of "the wake decisions felt like pure upside, then turned out to be a Drought liability only in hindsight."
- **Concrete fix direction (implemented in v2.2 below):** the Bloom preview should state the wake's drought implication at the point of decision (e.g. append `— Laguna will need stability 3+ during Drought`, or show a projected `regions needing stability 3+ : X` while a wake is pending). This is the single highest-value readability change for the one mechanic that "works."

## Known scope boundaries (intentional)

- No betting, no backend, no AI opponents, no deployment — local browser only.
- Development is now mechanical on Roots plays: each Roots play adds +1 development to its target, and every 3 development grants +1 stability on future Roots plays there; living neighbors receive half the Roots amount (adjacency spread). Other suits' development economy remains post-slice.
- 1–4-card selections intentionally cannot form straights/flushes (poker-correct).

## v2.2 — bounded recalibration + Drought legibility (worker, Sep 2026)

### LOOK — the bounded reference policy

`scripts/solve.mjs` now accepts `LOOK=<n>` (env) or `--look <n>`: per play it considers at most `n` candidate card-selections — **all length-1 and length-2 selections first** (8 + 28 = 36 of them when the hand is full), topped up to `n` with a seeded random sample of the longer selections. The sample is **deterministic**: it is keyed on the world seed text plus a per-play counter (mulberry32, same generator as the engine), so the same seed reproduces the exact same run, while different plays see different longer-selection samples. Unset (or `LOOK=218` for an 8-card hand) keeps the old exhaustive behaviour; `score()`/`bestPlay()` are untouched — only the candidate list they scan is capped.

**LOOK=30 is the bounded-human reference: it sees every 1–2 card play plus 17 sampled 3–5 card plays per decision — the working memory a human holding one hand of 8 can actually scan, an order of magnitude less than the oracle's 218.**

### Sweep (full grid) — every candidate set × LOOK=30 / LOOK=12 / exhaustive

`LOOK=30 npx vite-node scripts/solve.mjs` (and LOOK=12 / unset) per candidate; targets written to `EPOCH_TARGETS`/`STABILITY_SUM_TARGETS`, Survival pool and the Drought untouched, loss gate at `worldhand.ts:624` untouched. Wins/30 on the `probe-0..29` seeds:

| Flourishing need | Stability sums | LOOK=30 | LOOK=12 | exhaustive |
|---|---|---|---|---|
| [12,22,30] | [10,18,26] | 21/30 (70%) | 8/30 | 30/30 |
| [12,22,30] | [20,30,40] | 21/30 (70%) | 8/30 | 30/30 |
| [12,23,31] | [20,30,40] | 20/30 (67%) | 5/30 | 30/30 |
| [12,24,31] | [20,30,40] | 20/30 (67%) | 5/30 | 30/30 |
| **[12,24,32]** | **[20,30,40]** | **17/30 (57%)** | **3/30 (10%)** | **30/30 (100%)** |
| [12,23,32] | [20,30,40] | 17/30 (57%) | 3/30 | 30/30 |
| [12,24,32] | [16,26,36] | 16/30 (53%) | 3/30 | 30/30 |
| [12,24,32] | [10,16,22] | 17/30 (57%) | 3/30 | 30/30 |
| [12,24,32] | [26,36,46] | 17/30 (57%) | 3/30 | 30/30 |
| [12,24,32] | [0,0,0] (probe) | 17/30 (57%) | 3/30 | 30/30 |
| [12,24,33] | [20,30,40] | 14/30 (47%) | 3/30 | 30/30 |
| [12,25,33] | [20,30,40] | 14/30 (47%) | 3/30 | 30/30 |
| [13,25,33] | [20,30,40] | 14/30 (47%) | 3/30 | 30/30 |
| [13,26,34] | [20,30,40] | 8/30 (27%) | 1/30 | 30/30 |
| [14,24,34] | [20,30,40] | 8/30 (27%) | 1/30 | 30/30 |
| [14,26,34] | [14,22,30] | 8/30 (27%) | 1/30 | 30/30 |
| [14,26,34] | [20,30,40] | 8/30 (27%) | 1/30 | 30/30 |
| [16,26,34] | [12,20,28] | 8/30 (27%) | 0/30 | 30/30 |
| [16,28,36] | [16,24,32] | 3/30 (10%) | 0/30 | 30/30 |
| [16,28,36] | [20,30,40] | 3/30 (10%) | 0/30 | 30/30 |
| [12,24,36] | [16,24,32] | 3/30 (10%) | 0/30 | 30/30 |
| [18,30,38] | [18,26,34] | 1/30 (3%) | 0/30 | 30/30 |
| [20,32,40] | [20,28,36] | 0/30 | 0/30 | 30/30 |
| [20,32,40] | [20,30,40] | 0/30 | 0/30 | 30/30 |
| [20,36,52] (old) | [20,30,40] | 0/30 | 0/30 | 21/30 (70%) |

Reading: the band edge is sharp — Flourishing need dominates (stability sums from [10,16,22] to [26,36,46] barely move the numbers; the [0,0,0] probe confirms they are non-binding on this policy). Exactly one grid point sits in the 40–60% band: **[12,24,32]**.

### Before / after (the shipped targets)

| Policy | Old targets [20,36,52]/[20,30,40] | New targets [12,24,32]/[20,30,40] |
|---|---|---|
| LOOK=30 (bounded reference) | 0/30 (0%) | **17/30 (57%) — in band** |
| LOOK=12 (very bounded) | 0/30 (0%) | 3/30 (10%) |
| Exhaustive (LOOK unset / 218) | 21/30 (70%) | 30/30 (100%) |

The LOOK=30 win rate is itself in band — the targets are **not** only reachable by exhaustive search (exhaustive is 100%, trivially above band; the band is verified at the bounded reference). Note the band is intentionally asymmetric across policies: bounded players miss more, exhaustive play now always wins — the challenge lives where humans actually are.

### Drought legibility — implemented

- **Wake cost at decision time** (`buildPlan`, worldhand.ts:252-260 — shared by preview and commit): a Bloom play that wakes a region now summarizes e.g. `Bloom: +3 Flourishing. Laguna wakes - it will need stability 3+ during the epoch-3 Drought.` Regression-tested for every wake order (`tests/worldhand.test.ts` — the plan must carry the warning whenever a wake effect is present).
- **Upcoming Drought HUD from epoch 1** (`App.tsx`): when `state.challenge` is unset (epochs 1–2) the HUD shows a dashed `⚔ Upcoming: Drought in epoch 3 — keep every living region at stability 3+` item; the live `⚔ Drought — on track/at risk` item still renders only in epoch 3. Engine export `UPCOMING_DROUGHT_EPOCH = 3` keeps the number truthful in one place.
- **Browser re-run** (`node scripts/drought-legibility.mjs`, dev server 127.0.0.1:5177): all three naive-Bloom seeds now see the wake cost **before losing** — every wake preview carries the warning from play 1 (epoch 1). Exact captured preview text (Playwright, zero console errors):
  - `bloom-1` play 1: `Resolution preview ♥ High Card +1 pts single card K♥ Bloom: +3 Flourishing. Laguna wakes - it will need stability 3+ during the epoch-3 Drought.`
  - `bloom-2` play 1: `Resolution preview ♥ High Card +1 pts single card A♥ Bloom: +3 Flourishing. Laguna wakes - it will need stability 3+ during the epoch-3 Drought.`
  - `bloom-3` play 12 (first wake): `Resolution preview ♥ High Card +1 pts single card A♥ Bloom: +3 Flourishing. Laguna wakes - it will need stability 3+ during the epoch-3 Drought.` (and play 13: `...Ozurn wakes - it will need stability 3+ during the epoch-3 Drought.`)
  - Verdicts unchanged in kind: all three naive-Bloom runs still wither at epoch 3 (`Final Flourishing 17/16/18 fell short of 32`) — but now with the cost visible at every decision that created the liability, and the Drought HUD present from epoch 1. The earlier "fixed fix direction" note above is now implemented.

### Verification (v2.2)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **77/77** (76 + 1 new wake-warning regression test; the two target-value assertions updated 20/36/52 → 12/24/32 with the measurement comment rewritten around LOOK=30; assertions not weakened).
- `node scripts/qa.mjs` — ALL PLAYWRIGHT CHECKS PASSED at 1280×800 and 420×820, zero console/page errors, no horizontal overflow.

### Disposition

Balanced for the bounded reference (LOOK=30, 57%), not for the oracle. Survival pool, loss gate, Drought, and all scoring internals untouched. Commit: `balance+legibility: LOOK-bounded recalibration (12/24/32) + Drought wake-cost preview warning + upcoming-Drought HUD`.