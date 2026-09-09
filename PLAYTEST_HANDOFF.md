# Worldhand — Playtest Handoff (Balatro-simple edition, three-epoch slice)

## Status: READY FOR PLAYTEST (no suit actions · auto-Seeds · lives · market shop)

This pass **executes the product owner's three decisions**: (1) remove all per-suit world actions — a play is now just "play a poker hand"; (2) auto-earn Seeds from hand quality on every play; (3) remove the Drought challenge and the stability-survival track entirely — survival is exactly Balatro-style lives. All emojis were removed from the UI. The poker evaluator, the deterministic plan pipeline, and the 3D globe are carried over; the four suit actions and their plumbing are deleted.

## The contract (what changed)

- **A play is just a poker hand**: select 1–5 cards, score them, bank one number. **No suit-decision, no region-choice, no tie-suit action selection.** `tieChoice`/`suitChoice`/`regionChoice` plumbing is gone from the engine, the UI, and the Action union.
- **AUTO-EARN SEEDS (the money loop)** — no Mine action. Exact formula, documented in RULES.md:
  `seedsGained = ceil(Growth × SEEDS_PER_GROWTH)`, `SEEDS_PER_GROWTH = 1/4` → **1 Seed per 4 Growth**, capped at the 30-Seeds cap. A 15-Growth hand pays 4 Seeds.
- **NO DROUGHT ANYWHERE**: the epoch-3 Drought, the stability-3+ requirement, `UPCOMING_DROUGHT_EPOCH`, `DROUGHT_PENALTY_PER_REGION`, the `challengeMet`/`Challenge` struct, and the per-region `stability` field's gameplay use are all removed. `development` stays (it drives the 3D planet's evolution icons + globe size) and the dormant flag stays. Stability only decays as cosmetic pressure.
- **Lives = Balatro lives**: start 3 (`state.lives`). Miss an epoch target → −1 life + halved epoch income; **0 → game over (withered)**. Winning = beat the epoch-3 target. The old Survival-pool loss gate (a miss drains the pool) is kept 1:1, just renamed `lives`.
- **HERO GROWTH score** — every play resolves to ONE loud number:
  `Growth = max(0, round(rankSum × CATEGORY_MULT[category]) × lawGrowthMult + lawGrowthFlat)`
  - poker base (chips × mult via `CATEGORY_MULT`, kept: high ×1 … straight-flush ×8)
  - **World-Law bonuses only** (Open Canals ×1.2 floored at 1; Canopy Choir +3 / Stone Masonry +6 flat). No region/drought modifiers exist.
  `Flourishing` is the cumulative Growth toward the single epoch target. **preview == commit** still holds exactly through the single `buildPlan` pipeline (plan carries `growth` + `growthParts { poker, laws }` + effects, regression-tested).
- **Market (Balatro shop)**: spend Seeds on poker-hand upgrades (Canopy Choir +3 flat, Stone Masonry +6 flat, Open Canals ×1.2 mult), **card additions** (Fourth Counsel → hand 9, Fifth Counsel → hand 10, new unique ids, deck conservation still exactly 52), **region expansion** (Wake Laguna/Brumal wake a dormant region → planet visibly grows), and **World Laws** (Mycorrhiza decay relief, Seed Vaults income, Barter Routes discount). All per-suit market items (Deep Taproots, Rich Soil, Communal Tending) are removed. **Max 5 owned items** with explicit removal (Remove buttons, no refund, buying blocked at the cap, no double-apply, no negative Seeds).
- **Epoch-end civilization growth (presentation only)**: every living region gains +1 development — this is what makes the planet's evolution icons appear and the globe itself scale up (globe scale = 50% awakened fraction + 50% total development, 1.00 → 1.22).

## Balance: how the targets were calibrated

Targets are **[45, 110, 360]**. The old [50, 120, 200] belonged to the region/drought-boosted Growth engine; under chips×mult-only Growth the exhaustive median final F is ~1246, so the ladder had to move up. Calibration uses the REFERENCE METHOD directly: `LOOK=30 npx vite-node scripts/solve.mjs` (bounded reference policy, heuristic **not** tuned):

| Policy | Result on shipped [45,110,360] |
|---|---|
| **LOOK=30** | **16/30 wins (53%) — in the 40–60% band** |
| LOOK=12 | 3/30 (10%) |
| Exhaustive | 30/30 (100%); final F min 1035 / median 1246 / max 1761 |

The epoch-3 rung was swept by the reference method (e1/e2 fixed at 45/110): e3 340 → 73%, 350 → 67%, **360 → 53%**, 370 → 50%, 380 → 37%, 390 → 23%. **360 lands cleanly in the intended 40–60% band by the reference itself.** (An earlier shipping of e3=335 measured **24/30 = 80%** by the reference method — out of band — so e3 was corrected to 360.) LOOK=12 at 10% and exhaustive at 100% bracket it as intended.

## The UI (Balatro-fied, zero emojis)

- **Centerpiece**: the 8-card hand plus **ONE huge Growth readout** (`Growth: 15`, huge gold) with the ordered **breakdown line** (`+15 poker · +0 laws`) and a clear **`15 chips × 1 mult`** pill beside it. Shown even before selection (muted "select 1–5 cards" state).
- **Rich cards**: cream/white faces, saturated red (♥♦) / blue (♠♣) suits, bold ranks; selection = thick gold outline + ✓ glyph + glow (`.pcard-btn.sel`); cards lift on hover.
- **Deep dark celestial background**: fixed nebula gradients; the 3D planet (three.js globe) sits beside the hand with its region legend, the new `planet-growth` caption (`0/40 development across 4 living regions — the planet grows with it`), and the `map-detail` inspector.
- **De-emphasized HUD**: small grey chips — Flourishing/target, Seeds, **Lives 3/3**, Plays, Discards, Living regions. No Drought HUD item (removed entirely).
- **ALL EMOJIS REMOVED**: HUD labels are plain text ("Flourishing", "Seeds", "Lives", …), effect chips show a text kind label (Law/Upgrade/…), market items show cost as "— 12 Seeds" and a kind tag, verdicts are "A Flourishing World" / "The World Withers", Save button shows "Saved" instead of "Saved ✓" (the ✓ kept on cards/legend is a typographic checkmark, not an emoji). `scripts/check-no-emoji.py` audits the rendered-UI sources (excludes suit glyphs + text checkmark by design) and passes.
- All review-script hooks kept: `input#seed`, `Begin New World`, `.pcard-btn`, `[data-testid=play-btn]`, `[data-testid=preview]`/`.preview`, `.market`/`.market-btn`, Continue/Close buttons, `.pcard-btn.sel`, `.log li`, `.map-detail`, `.verdict`, Quit / Clear Save, region legend + reduced-motion. `.tie-btn` remains in CSS for compat but no tie UI exists (nothing can tie anymore — suits don't act).

## Review-script selector changes (coverage preserved, nothing weakened)

- `scripts/review-probe.mjs` — rewritten for the new contract; the hardcoded expected-target string is now **`'45,110,360'`**; new probes: auto-Seeds formula, Growth laws, no-suit-choice, lives-zero; all 24 assertions true.
- `scripts/review-pvcommit.mjs` — summary regex `(Mine|Grow|Study|Settle)[^+]*\+(\d+)` → `Banks (\d+) Growth` (suit names are gone). Same extraction/assertion shape, `MATCH: true`.
- `scripts/review-browser.mjs` — preview-amount regex → `Banks (\d+) Growth`; `preview-equals-commit: true` at both viewports.
- `scripts/drought-legibility.mjs` — repurposed: now asserts the **absence** of any Drought text in UI/log across 3 seeds (`NO-DROUGHT ASSERTION: PASSED`).
- `scripts/solve.mjs` / `balance-sweep.mjs` — buildPlan call sites updated (no regions/tie args) + market buy order updated to the new item ids; **the solve heuristic/scoring is untouched**.
- `scripts/check-no-emoji.py` — new audit script.
- `scripts/qa.mjs`, `review-planet3d.mjs`, `review-autosave.mjs`, `review-fullrun.mjs` — **no selector changes needed**; all pass unchanged. (review-fullrun's epoch-end phase shows as "unknown" in its phase probe because that probe predates `data-testid="epoch-end"`; the Close/Continue fallback handles it and the run completes — verified separately that Continue advances the epoch.)

## What a playtester should exercise

1. **Start** — enter any seed phrase (same seed = same world, tested). 12 regions on the globe; 4 awake.
2. **Select 1–5 cards** — the **big Growth number** updates live (`poker → laws` breakdown + chips × mult); the committed play banks exactly the previewed number **and pays Seeds instantly** (watch the Seeds HUD tick up).
3. **Play hands** — try weak singles (high card, ×1) vs pairs (×1.5) vs a flush (×4): the Growth number and the Seed payout both scale with hand quality. No suit decision ever appears.
4. **Discard** — 1–5 at once, refill to 8, budget 3 per epoch.
5. **Planet map** — legend buttons or the globe itself; `map-detail` shows adjacency; the `planet-growth` caption tracks development.
6. **Epoch flow** — 4 plays closes the epoch: single-target check, decay, +1 development everywhere (watch the planet's icons and size grow), income, market. Miss a target → −1 life + halved income.
7. **Market** — buy Growth upgrades (watch every later play jump), a card addition (hand deals 9, conservation holds), or a Wake expansion (planet visibly grows). At 5 owned items buying locks until you Remove one.
8. **Lives** — miss three epoch targets → withered at 0 lives. Beat 360 at epoch 3 → flourishing win.
9. **Save/Quit** — auto-save after every action; Quit keeps the save; only "Clear Save" deletes.

## Verification performed (this pass)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **70/70** (worldhand suite rewritten for the new contract: no suit actions, auto-Seeds formula + cap, Growth=chips×mult+laws with preview==commit, lives decrement/game-over/win, deck conservation [52] incl. card additions, market slot cap/removal/no-double-apply; poker suite untouched and green). Before: 80/80 on the previous contract.
- `npm run build` — green.
- `node scripts/qa.mjs` — **ALL PLAYWRIGHT CHECKS PASSED at 1280×800 and 480×800**, zero console/page errors, no horizontal overflow.
- `node scripts/review-planet3d.mjs` — **PASSED** (canvas mount + pixel sample, legend → map-detail, keyboard, reduced-motion rotation stop, raycast) at both viewports, zero errors.
- `review-pvcommit / review-browser / review-autosave / review-fullrun / drought-legibility` — all pass, zero errors; `preview-equals-commit: true` both viewports; no Drought text anywhere.
- `python3 scripts/check-no-emoji.py` — PASSED (no emoji in rendered-UI sources).
- `LOOK=30` solve: **16/30 wins (53%)** on shipped targets; LOOK=12: 3/30; exhaustive: 30/30.
- Fresh screenshots: `shots-review/ui-wide-growth.png`, `ui-wide-growth-full.png`, `ui-narrow-growth.png`, `ui-narrow-growth-full.png` (card-first UI, big Growth number, chips×mult pill, 3D planet, no emojis) + `planet3d-*.png` from the 3D acceptance run.

## Known scope boundaries (intentional)

- No betting, no backend, no AI opponents, no deployment — local browser only.
- 1–4-card selections intentionally cannot form straights/flushes (poker-correct).
- Region stability/development have **no gameplay read** — they feed only the planet's presentation and the Seeds income headcount (living healthy regions). This is the intended Balatro-simplification.
- The LOOK=30 bounded win rate is **53% (in band)** at the shipped [45,110,360]; LOOK=12 at 10% and exhaustive at 100% bracket it as intended.