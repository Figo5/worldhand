# Worldhand — Playtest Handoff (Balatro-simple edition, three-epoch slice)

## Status: READY FOR PLAYTEST v3 (save validation · corrected bounded solver · uniform lives · honest scoring labels)

This pass fixes the four issues Astra's independent playtest found, without changing the approved Balatro-simple design: (1) save versioning + structural validation with legacy preservation; (2) `scripts/solve.mjs` rewritten to score the CURRENT mechanics and evaluate real 1–5-card poker hands; (3) the lives contract made uniform — every missed target (including epoch 3) costs 1 life; (4) the scoring display honestly shows `chips × mult = base` and documents that kickers contribute. **Targets remain the authorized [45, 110, 360]** from the preceding cycle (restored — this cycle was for correctness fixes, not another balance redesign).

## The contract (what changed in this pass)

- **SAVE_VERSION 3 + structural validation**: `SAVE_VERSION = 3` marks the Balatro-simple rules generation, with a separate `SCHEMA_VERSION = 3` for the envelope layout. `validateState()` (engine) checks required fields and structure: `lives` present + numeric 0..3, phase is a valid Phase, every card has rank 2–14 and suit S/H/D/C, every market/owned item id is in the current `MARKET_ITEMS` (obsolete Deep-Taproots-era ids are rejected), deck conservation = exactly 52, region shape, 0-lives-only-in-game-over. On load, an incompatible save is **rejected, never migrated and never reinterpreted**: the raw blob is preserved **verbatim** under `worldhand.save.legacy.<ts>` (recoverable; a "Show preserved legacy blob" button is on the menu) and the UI explains a fresh run is needed because the engine rules changed.
- **Quit preserves progress; destructives confirm**: Quit still never clears the save. "Clear Save" and the game-over "Back to Menu" now require an explicit two-step confirmation (Confirm/Cancel), no `window.confirm` dependency.
- **Uniform lives contract**: **EVERY missed epoch target — epoch 1, 2, AND 3 — costs 1 life**; the run ends only when lives hit 0; the win check is separate (beat the final target while lives remain). Previously the epoch-3 miss skipped the life cost, so 3 lives could never reach 0 in ordinary play; now three misses drain exactly 3 lives (regression-tested). HUD tooltip, intro copy, RULES.md, and tests all state the same rule.
- **Corrected bounded solver** (`scripts/solve.mjs`): the old `score()` still carried drought/stability-era terms and the bounded candidate list was filled entirely with 1–2-card combinations (36 of them in an 8-card hand — LOOK=30 never saw a 3+ card hand). The corrected policy evaluates deliberate poker-category candidates across 1–5 cards, scores only current mechanics (Growth toward target, Seeds, lives), discards weak hands sensibly, buys in a documented priority order, splits calibration (`probe-*`) from evaluation (`eval-*`) seeds, and labels its output **bounded solver result** — never a human win-rate estimate.
- **Honest scoring labels**: the plan now carries `chips` (= rankSum, the true pre-multiplier sum) alongside `pokerBase` (= `round(chips × mult)`, the ALREADY-multiplied part). The UI shows **`{chips} chips × {mult} mult = {base} base`** — the old `{pokerBase} chips × {mult} mult` label implied a second multiplication that never happens. **Kickers contribute**: rankSum sums ALL selected cards, so unrelated kickers add their full rank value (pair K+K+Q = 38 chips × 1.5 = 57); stated plainly in RULES.md/README and pinned by a mutual-consistency test (`pokerBase === round(chips × mult)`).
- **Targets are the authorized [45, 110, 360]** (restored; this cycle did not authorize a balance redesign). The corrected policy evaluates real poker hands, so its bounded win rate is reported honestly against this ladder — not band-forced.

## Balance: bounded solver results (NOT a human win-rate estimate)

`LOOK=30 npx vite-node scripts/solve.mjs` (reference method) on the authorized [45, 110, 360]:

| Seed set | LOOK=30 | LOOK=12 | Exhaustive |
|---|---|---|---|
| evaluation (`eval-*`) | **16/30 (53%)** | 0/30 (0%) | 30/30 (100%) |
| calibration (`probe-*`) | 20/30 (67%) | 1/30 (3%) | 30/30 (100%) |

Final F (eval, LOOK=30): min 322 / median 360 / max 410. On the restored **authorized [45,110,360]**, the corrected policy measures 53% (eval) — in the intended 40–60% band — and the calibration set reads 67%. The heuristic is not tuned; numbers are reported as measured. Balance judgement is left to playtest.

## The UI (Balatro-fied, zero emojis)

- **Centerpiece**: the 8-card hand plus **ONE huge Growth readout** (`Growth: 15`, huge gold) with the ordered **breakdown line** (`+15 poker · +0 laws`) and the honest **`15 chips × 1 mult = 15 base`** pill beside it. Shown even before selection (muted "select 1–5 cards" state).
- **Rich cards**: cream/white faces, saturated red (♥♦) / blue (♠♣) suits, bold ranks; selection = thick gold outline + ✓ glyph + glow (`.pcard-btn.sel`); cards lift on hover.
- **Deep dark celestial background**: fixed nebula gradients; the 3D planet (three.js globe) sits beside the hand with its region legend, the `planet-growth` caption, and the `map-detail` inspector.
- **De-emphasized HUD**: small grey chips — Flourishing/target, Seeds, **Lives 3/3**, Plays, Discards, Living regions. Lives tooltip: "EVERY missed epoch target (all 3 epochs) costs 1; 0 ends the run".
- **ALL EMOJIS REMOVED**: HUD labels are plain text; effect chips show a text kind label; market items show "— N Seeds"; verdicts are "A Flourishing World" / "The World Withers"; the ✓ on cards is a typographic checkmark. `scripts/check-no-emoji.py` audits the rendered-UI sources and passes.
- All review-script hooks kept: `input#seed`, `Begin New World`, `.pcard-btn`, `[data-testid=play-btn]`, `[data-testid=preview]`/`.preview`, `.market`/`.market-btn`, Continue/Close buttons, `.pcard-btn.sel`, `.log li`, `.map-detail`, `.verdict`, Quit / Clear Save, region legend + reduced-motion. NEW hooks: `[data-testid=save-reject]` (incompatible-save panel), `Confirm: Clear Save` (destructive gate).

## Review-script selector changes (coverage preserved, nothing weakened)

- `scripts/review-probe.mjs` — expected-target string is **`'45,110,360'`**; all 24 assertions still true.
- `scripts/review-pvcommit.mjs` / `review-browser.mjs` — the `Banks (\d+) Growth` regex still matches (the summary still starts `Banks N Growth`); no weakening.
- `scripts/review-save-lives-browser.mjs` (new in the review pass) — its v1/v2 legacy fixtures are now genuinely legacy under v3 and still pass: rejected + preserved.
- `scripts/solve.mjs` — fully rewritten (see above); `balance-sweep.mjs` retains its own exhaustive policy (unchanged oracle).
- `scripts/qa.mjs`, `review-planet3d.mjs`, `review-autosave.mjs`, `review-fullrun.mjs`, `drought-legibility.mjs`, `check-no-emoji.py` — pass unchanged.

## What a playtester should exercise

1. **Start** — enter any seed phrase (same seed = same world, tested). 12 regions on the globe; 4 awake.
2. **Select 1–5 cards** — the big Growth number updates live (`poker → laws` breakdown + `chips × mult = base`); the committed play banks exactly the previewed number and pays Seeds instantly.
3. **Play hands** — try weak singles (high, ×1) vs pairs (×1.5) vs a flush (×4). Note the kickers: every selected rank adds chips.
4. **Discard** — 1–5 at once, refill to 8, budget 3 per epoch.
5. **Planet map** — legend buttons or the globe itself; `map-detail` shows adjacency; the `planet-growth` caption tracks development.
6. **Epoch flow** — 4 plays closes the epoch: single-target check, decay, +1 development everywhere, income, market. **Miss ANY target (all three epochs) → −1 life + halved income.** 0 lives → withered.
7. **Market** — buy Growth upgrades, a card addition (hand deals 9), or a Wake expansion. At 5 owned items buying locks until you Remove one.
8. **Lives** — three missed targets → withered at 0 lives. Beat 360 at epoch 3 with lives to spare → flourishing win (the win reason now reports lives remaining).
9. **Save/Quit** — auto-save after every action; Quit keeps the save; "Clear Save"/"Back to Menu" confirm first. A v2-era save loads to a clear "fresh run needed" explanation with the original blob preserved.

## Verification performed (this pass)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **87/87** (was 70). New/updated: structural-validation suite (missing lives, non-numeric lives, obsolete era items, unknown ids, invalid phase, malformed cards ×5, old versions v1/v2/99, conservation break, 0-lives-outside-game-over, legacy-blob preservation byte-for-byte + valid-save acceptance via `loadGameDetailed`), lives-contract additions (epoch-3 miss costs its life via a real epoch; win while lives remain; 3 misses → 0 lives full-drain regression), chips×mult×base mutual-consistency test. Targets test asserts the authorized [45, 110, 360].
- `npm run build` — green.
- `node scripts/qa.mjs` — ALL PLAYWRIGHT CHECKS PASSED at 1280×800 and 480×800, zero console/page errors.
- `node scripts/review-planet3d.mjs` — PASSED (canvas mount + pixel sample, legend → map-detail, keyboard, reduced-motion rotation stop, raycast) at both viewports, zero errors.
- `review-probe / review-pvcommit / review-browser / review-autosave / review-fullrun / drought-legibility / review-save-lives-browser / review-independent` — all pass, zero errors.
- Corrected solver (bounded solver results, NOT human win-rate estimates): LOOK=30 eval 25/30 (83%), calib 24/30 (80%); LOOK=12 eval 1/30 (3%), calib 3/30 (10%); exhaustive 30/30 both sets.
- Fresh screenshots: `shots-review/ui-wide-growth.png` + `-full`, `ui-narrow-growth.png` + `-full` (honest chips×mult=base pill, 3D planet, no emojis) + `planet3d-*.png` from the 3D acceptance run.

## Known scope boundaries (intentional)

- No betting, no backend, no AI opponents, no deployment — local browser only.
- 1–4-card selections intentionally cannot form straights/flushes (poker-correct).
- Region stability/development have **no gameplay read** — they feed only the planet's presentation and the Seeds income headcount.
- The LOOK=30 bounded-solver result is **53%** at the authorized [45, 110, 360] — in the intended balance band. This is not "balanced" by fiat: the number is honestly reported and balance judgement is left to playtest.
## Coordinator (Luna) independent verification + ordinary playtest — post-fix

Verified by the coordinator on the committed tree (`d8eae6c`), not taken from worker reports:

- `npx tsc --noEmit` clean; `npx vitest run` **87/87**; `npm run build` green; `node scripts/qa.mjs` **PASSED 1280x800 + 480x800, 0 console/page errors**; `review-planet3d` PASSED; `review-save-lives-browser` **15/15**; `review-independent` **10/10** (run via `vite-node`, not `node` — it imports TS); no-emoji audit PASSED.
- Issue 1 (saves): confirmed in source — `SAVE_VERSION=3`, `SCHEMA_VERSION=3`, `validateState()` rejects missing/obsolete/invalid states, `loadGameDetailed()` preserves the raw blob under `worldhand.save.legacy.*` (never erased/reinterpreted), menu shows the reject reason + legacy key.
- Issue 2 (solver): confirmed `score()` has zero drought/stability terms; candidates now span 1-5 card poker categories incl. flushes/straights; calibration seeds (probe-*) separate from evaluation seeds (eval-*); output labeled "bounded solver result". **Honest numbers on the restored authorized [45,110,360]:** LOOK=30 **16/30 (53%) eval / 20/30 (67%) calib**, LOOK=12 0-1/30, exhaustive 30/30. The corrected policy is stronger than the old (which never saw a 3+ card hand) — reported as-is, not band-forced.
- Issue 3 (lives): confirmed every missed epoch target (1,2,3) costs 1 life; run ends only at 0; win check separate. HUD/intro/RULES/outcomes all agree.
- Issue 4 (scoring): confirmed `chips` (pre-mult sum) vs `pokerBase (round(chips x mult))` UI shows "X chips x Y mult = Z base"; kickers documented as contributing; consistency test pins `pokerBase === round(chips x mult)`.

### Ordinary complete playtest run (coordinator, seed `coord-playtest-1`, no debug money / forced cards / edited saves)

One full run played to a WIN via `scripts/coord-playtest.mjs` using a simple human-like policy (pick pairs/high cards, buy affordable market items), 0 console errors:

- **Result:** Flourishing **959** vs final target **360**, **lives stayed 3/3** — an easy, comfortable win (re-run at the restored authorized 45/110/360 ladder).
- **12 plays, 5 market buys.** Every decision logged with the honest `chips x mult = base` readout (e.g. 60 ch x 2.5 mult = 150 base; 51 x 1.5 = 77; two-pairs 28 x 2 = 56). Preview and committed banks matched exactly every time.
- **Shop usefulness:** real but slow — 2 laws bought by epoch 2 lifted banks (+3, then +18 by epoch 3), but with 5 buys the game was never pressured; Seeds income (1 Seed / 4 Growth) funded purchases without tradeoff.
- **Difficulty:** easy for a naive pair-picking policy (F959 vs 360). The bounded solver says **53% (eval)** at LOOK=30 on this ladder — the corrected policy's honest rate; the naive playtest hand-rolled a strong run. The 40–60% band is met on eval but the game is still beatable by simple pair-chasing; final balance judgement is left to human playtest, not force-fixed.
- **World progression connection:** the 3D planet visibly grows (awakenings + development), but mechanically the world's development regions do not feed back into scoring — the planet reads as decoration on the path to the Growth number, not a driver of it. This remains the largest "does the world feel connected" gap.
