# Worldhand — Playtest Handoff (simplified single-target edition, three-epoch slice)

## Status: READY FOR PLAYTEST (simplified engine + Balatro-style card-first UI)

This pass **replaces the two-target engine with a single-Flourishing-target engine and one action per suit**, and reworks the presentation to a **Balatro-inspired, card-first UI with one big Growth number**. The poker evaluator, the deterministic plan pipeline, and the 3D globe are carried over; the obsolete Roots/Bloom/Sow/Tend two-action contract and its tests were removed and rewritten for the new contract.

## The simplified contract (what changed)

- **ONE epoch target**: cumulative **Growth** (Flourishing) per epoch — **50 → 120 → 200** (strictly escalating). `STABILITY_SUM_TARGETS` is gone; per-region stability still exists and matters (the epoch-3 Drought needs every living region at 3+), it is just never an epoch target.
- **ONE action per suit** (4 total):
  - **♠ Study** — +1 development to the **weakest living region** (a `regionChoice` targets a specific living region; Deep Taproots → +2). Development feeds Growth (region part) and the planet's evolution icons.
  - **♥ Grow** — the Growth suit: banks the play's Growth; Q+ cards wake the first dormant region (wake = future Drought liability, stated in the preview).
  - **♦ Mine** — `max(1, round(rankSum/3))` Seeds, capped at 30 (Rich Soil → +2).
  - **♣ Settle** — +1 stability to **every** living region (Communal Tending → +2).
- **Growth — the hero score**: every play banks ONE number,
  `Growth = max(0, rankSum × CATEGORY_MULT[category] + floor(actingRegion.dev/3) + growBonus − 5 × living regions below stability 3)`.
  Breakdown order (displayed and computed): **poker → region → laws → drought**. `CATEGORY_MULT`: high ×1, pair ×1.5, two-pair ×2, trips ×2.5, straight ×3, flush ×4, full-house ×5, quads ×6, straight-flush ×8. `DROUGHT_PENALTY_PER_REGION = 5` (exported).
- The plan carries `growth` + ordered `growthParts`; **preview == commit** through the single `buildPlan` pipeline (regression-tested, including the tie-suit choice and the Growth number itself).
- Survival pool unchanged (3, −1 per missed epoch-1/2 target, halved market income on a miss, withered at 0). Epoch-3 Drought unchanged (every living region stability 3+, previewed from epoch 1 + wake warnings).

## Balance: how the targets were calibrated

`LOOK=30 npx vite-node scripts/solve.mjs` (bounded reference policy — all 1–2-card selections + seeded sample of longer ones, 30 `probe-*` seeds, heuristic untouched):

| Targets | LOOK=30 | LOOK=12 | Exhaustive |
|---|---|---|---|
| **[50, 120, 200] (shipped)** | **18/30 (60%) — in band** | 13/30 (43%) | 30/30 (100%) |
| [50, 120, 190] (proposed) | 20/30 (67%) | — | — |
| [50, 120, 205] | 15/30 (50%) | — | — |
| leftover garbage [160, 336, 80] | 30/30 (0% challenge) | — | final F min 110 / median 205 / max 282 |
| old chips-only [12, 24, 32] | — | — | belonged to the retired engine; not shipped |

The e3 ladder was walked until the bounded reference sat in the 40–60% band; e1/e2 were kept at the proposed 50/120 (their misses drain Survival but never end the run directly). **Balance assumption to state**: the calibration is measured against solve.mjs's greedy heuristic at LOOK=30 — human skill will vary around it; the band was verified at the bounded reference (exhaustive is intentionally 100%).

## The card-first UI (Balatro-inspired)

- **Centerpiece**: the 8-card hand plus **one large Growth readout for the current selection** (`Growth: 15`, huge gold number) with the small ordered **breakdown line** underneath (`+15 poker · 0 region · 0 laws · 0 drought`) and the acting suit named beside it. Shown even before selection (as a muted "select 1–5 cards to bank Growth toward N" state).
- **Rich cards**: cream/white faces, saturated red (♥♦) / blue (♠♣) suits, bold ranks; selection = thick gold outline + ✓ glyph + glow (`.pcard-btn.sel`), cards lift on hover.
- **Deep dark celestial background**: fixed nebula gradients; the 3D planet (three.js globe, untouched from the previous pass) sits beside the hand with its region legend and `map-detail` inspector.
- **De-emphasized HUD**: small grey chips, out of the hero lane. The old hardcoded "Stability /14|22|30" HUD item is gone (that target no longer exists).
- All review-script hooks kept: `input#seed`, `Begin New World`, `.pcard-btn`, `[data-testid=play-btn]`, `[data-testid=preview]`/`.preview`, `.tie-btn`, `.market`/`.market-btn`, Continue/Close buttons, `.pcard-btn.sel`, `.log li`, `.map-detail`, `.verdict`, `.hud-item`, Quit / Clear Save, region legend + reduced-motion.

## Review-script selector changes (coverage preserved, nothing weakened)

- `scripts/review-probe.mjs` — the hardcoded expected-target string synced `'30,80,150'` → `'50,120,200'`.
- `scripts/review-pvcommit.mjs` — the summary-amount regex matched the obsolete suit names `(Sow|Bloom|Roots|Tend)`; updated to `(Mine|Grow|Study|Settle)`. Same extraction, same assertions, `MATCH: true`.
- `scripts/qa.mjs`, `review-planet3d.mjs`, `review-browser.mjs`, `review-autosave.mjs`, `review-fullrun.mjs`, `drought-legibility.mjs` — **no selector changes needed**; all pass unchanged. (A `text-transform: uppercase` on panel headings was dropped from the CSS because qa.mjs reads heading text case-sensitively — styling-only change.)
- `scripts/balance-sweep.mjs` — note: it is an **exhaustive-only** sweep (no LOOK support); bounded calibration must use `scripts/solve.mjs` with `LOOK`.

## What a playtester should exercise

1. **Start** — enter any seed phrase (same seed = same world, tested). 12 regions on the globe; 4 awake.
2. **Select 1–5 cards** — the **big Growth number** updates live with the poker → region → laws → drought breakdown; tie offers suit buttons; the committed play banks exactly the previewed number.
3. **Suits** — try each: Study (watch development + the region Growth part rise), Grow (bank big, wake with Q+ and read the Drought warning), Mine (Seeds for the market), Settle (all living regions +1; the drought breakdown part reflects regions below 3).
4. **Discard** — 1–5 at once, refill to 8, budget 3 per epoch.
5. **Planet map** — legend buttons or the globe itself; `map-detail` shows adjacency.
6. **Epoch flow** — 4 plays closes the epoch: single-target check, decay, income, market. Miss an epoch-1/2 target → −1 Survival + halved income.
7. **Epoch 3 Drought** — announced in log + HUD; every living region must hold stability 3+ through epoch end.
8. **Save/Quit** — auto-save after every action; Quit keeps the save; only "Clear Save" deletes.

## Verification performed (this pass)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **80/80** (worldhand suite rewritten for the new contract: single target [50,120,200], four suit actions, Growth/growthParts order + preview==commit, Drought penalty + floor, wake warnings; poker suite untouched and green). Before: 10 obsolete tests failing out of 77.
- `npm run build` — green.
- `node scripts/qa.mjs` — **ALL PLAYWRIGHT CHECKS PASSED at 1280×800 and 480×800**, zero console/page errors, no horizontal overflow.
- `node scripts/review-planet3d.mjs` — **PASSED** (canvas mount + pixel sample, legend → map-detail, keyboard, reduced-motion rotation stop, raycast) at both viewports, zero errors.
- `review-pvcommit / review-browser / review-autosave / review-fullrun / drought-legibility` — all pass, zero errors (naive-Bloom seeds still wither, now visibly short of 200, with the wake costs shown at every decision).
- Fresh screenshots: `shots-review/ui-wide-growth.png`, `ui-wide-growth-full.png`, `ui-narrow-growth.png`, `ui-narrow-growth-full.png` (card-first UI, big Growth number, 3D planet) + `planet3d-*.png` from the 3D acceptance run.

## Known scope boundaries (intentional)

- No betting, no backend, no AI opponents, no deployment — local browser only.
- 1–4-card selections intentionally cannot form straights/flushes (poker-correct).
- The Growth region part uses the acting region only (Study target for ♠, `living[0]` placeholder for ♣, none for ♥/♦) — deliberate simplicity, documented in RULES.md.