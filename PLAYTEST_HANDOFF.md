# Worldhand — Playtest Handoff (Balatro-hard edition)

## Status: BALATRO-HARD PASS (World Level + Jokers/Planets/Consumables/Vouchers, steeper blinds)

This pass makes the game genuinely Balatro-like: **simpler worldbuilding** (a single World Level replaces the 12-region/development/specialization map), **harder gameplay** (escalating per-epoch blinds that outpace raw hands), and a **Balatro-style shop** (Jokers, Planet cards, Consumables, Vouchers, World Level boost). SAVE_VERSION is now **7** (Balatro-hard engine; SCHEMA_VERSION stays 3). A v6 save is rejected cleanly and preserved as legacy — never reinterpreted.

## What changed (exactly)

- **World Level** (the simplified worldbuilding number): auto-grows +1 each epoch; boostable with Seeds (`boostWorld`, cost `10 + (level−1)·5`). Each level above 1 = **+2 Growth/play, +1 Seed/epoch, +5 World Score**. Level 1 = +0 (early play unchanged).
- **Escalating blinds**: the per-epoch target is now `100 + 40·(n−1) + 5·(n−1)²` (was `100 + (n−1) + 0.1·(n−1)²`). Steep enough that raw hands alone can't keep up past ~epoch 5 — you must build a scaling engine to survive, but the blinds keep outrunning it.
- **Balatro-style shop** (four rotating card types + World Level boost, offered each epoch end):
  - **Jokers** (max 5, `JOKER_SLOTS`): conditional multipliers that define your build — "×1.5 Growth when you play a Pair," "×2 on a Flush," "×1.5 if no face cards," "×1.25 on every hand." They stack multiplicatively. Vouchers add to all joker mult.
  - **Planet cards**: permanently raise a hand type's base mult (`planetLevels[category] += boost`).
  - **Consumables**: one-shot ×N on the next hand, consumed on play (`s.consumables = []` after the boosted hand).
  - **Vouchers**: permanent globals (+1 hand size, all jokers +0.5 mult, +2 Seeds/epoch).
  - **World Level boost**: spend Seeds to raise the world level.
- **World Score** (the run's goal, shown in HUD): `5×WorldLevel + 15×laws + 10×jokers + 5×planetBoosts + 8×vouchers + floor(Flourishing/10)`.
- **Growth formula** (one shared `buildPlan` pipeline, stable order): poker (chips × mult, mult includes planet boosts) → laws (×growthMult, +growthFlat) → world (+2/level above 1) → regions (awake matching specialization) → jokers (× product of (1+mult)) → consumables (× product of xNext). `Growth = max(0, round((pokerBase×lawMult + lawFlat + worldBonus + regionsBonus) × jokerMult × consumableMult))`.
- **Honest breakdown**: the plan carries `growthParts { poker, laws, world, regions }` plus `jokerMult`/`consumableMult`. The additive parts reconcile to growth **only when no joker fires and no consumable is queued** (jokers/consumables MULTIPLY the total). The UI shows `+15 poker · +2 laws · +4 world · +7 regions ×1.5 joker` and discloses that jokers/consumables multiply.

## The five-Joker limit (reconciled with the purchase button)

- **Engine**: `buyJoker` throws `all 5 joker slots are full` when `s.jokers.length >= JOKER_SLOTS` (guard ordered before the Seeds check).
- **UI**: the joker buy button is `disabled={state.seeds < j.cost || state.jokers.length >= JOKER_SLOTS}` — it disables at the cap instead of throwing on click, matching the law-slot behavior. A "Joker slots N/5" note sits above the section.

## Verification performed (this acceptance pass)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **160/160** (was 156; +4 red-first: growthParts world reconciliation, firing-joker jokerMult/jokerContribs, queued-consumable consumableMult, joker-shelf cap at 5).
- `npm run build` — green.
- `node scripts/qa.mjs` — **ALL PLAYWRIGHT CHECKS PASSED** at 1280×800 and 480×800, zero console/page errors.
- `npx vite-node scripts/flip-rate.mjs` — runs (3.6% as-shipped / 1.9% all-awake).
- **Independent reviewer** (verified `glm-5.3-flash` via `ollama-cloud`): all 6 verification points PASS — (1) five-Joker limit enforced in engine + UI, (2) preview==commit after purchases (shared buildPlan with full ctx), (3) consumables apply once (cleared after play), (4) reload preserves new state (validateState + save round-trip), (5) docs drift flagged (now fixed), (6) honest breakdown with world part + joker/consumable multipliers.
- **Ordinary browser playtest** (isolated storage, seed `acceptance-playtest`, real UI actions): all 5 shop sections present; bought a Joker + a Planet card; reload preserved the state (World Level 2, World Score 27.5, zero page errors). Consumable/Voucher/World-boost buttons correctly disabled when Seeds were insufficient.

## Balance (bounded solver result — NOT a human win-rate estimate)

`scripts/solve.mjs` plays a greedy automated policy (bounded candidate set, LOOK=30). The Balatro-hard target `100 + 40·(n−1) + 5·(n−1)²` is steep enough that even a scaling engine dies naturally. Run-depth distribution on the eval-* set:

```
epoch:  8  9 10 11 12 13 14 15 16 17 18
count:  2  2  3  3  4  6  2  1  4  2  1
```

Runs end around **epoch 8–18**; modal outcome epoch 13 (6/30 = 20%), no empty gap after the spike. This is the intended Balatro-hard shape — you must build a scaling engine to survive, but the blinds keep outrunning it. Reported as measured, not band-forced.

## What a playtester should exercise

1. **Start** — enter any seed phrase; the HUD shows World Level 1, World Score, Flourishing/target, Seeds, Lives, Plays, Discards.
2. **Play hands** — select 1–5 cards; the big Growth number updates live with the honest breakdown (`poker · laws · world · regions`, plus `×N joker`/`×N consumable` when they fire). Preview == commit.
3. **Reach the market** — beat the epoch target (early advance) or spend all 4 plays. The shop offers Jokers, Planet cards, Consumables, Vouchers, World Level boost, and World Projects.
4. **Buy a Joker** — pick one whose condition matches the hand you're building toward (e.g. Pair Joker if you play pairs). Buy up to 5; the button disables at the cap.
5. **Buy a Planet card** — raises a hand type's base mult permanently.
6. **Buy a Consumable** — queue a ×2/×3; it boosts exactly the next hand, then is consumed.
7. **Buy a Voucher** — permanent global (+1 hand size, all jokers +0.5 mult, +2 Seeds/epoch).
8. **Boost World Level** — spend Seeds for +2 Growth/play, +1 Seed/epoch, +5 World Score.
9. **Save/Quit** — auto-save after every action; reload preserves the new state (jokers/planets/consumables/vouchers/world level). A v6-era save loads to a clear "fresh run needed" explanation with the original blob preserved.

## Known scope boundaries (intentional)

- No betting, no backend, no AI opponents, no deployment — local browser only.
- The regional-bonus mechanic (v4) still anti-scales (flip rate 3.6% as-shipped / 1.9% all-awake) — it reads as decoration with a number attached, not a strategic driver. This is a known, recorded limitation, not fixed in this pass.
- The bounded solver reaches epoch 8–18; a skilled human building a strong joker/planet engine may go further. Balance judgement is left to human playtest, not force-fixed.

## UI overhaul verification — Celestial Card Table (2026-09-10)

The presentation-only UI pass is committed in `bd1a1a3`, with the selected-card clearance fix in `475a99c` and current shop/menu evidence in `3df8e95`. No changes were made under `src/engine/` or `src/ui/save.ts`; scoring, targets, economy, randomness, progression, and save compatibility remain on the v7 rules path.

- **Play screen:** compact run rail; owned-Joker shelf; hand-first card table; one prominent Resolution preview; Play/Discard/Clear controls beside the hand; Three.js planet as a secondary contextual panel; World Chronicle collapsed by default.
- **Shop:** dedicated tabbed board for Laws & World, Jokers, Planets, Consumables, and Vouchers; World Projects and World Level remain available; prices, Seeds, Joker slots, queued consumables, disabled affordability/cap states, and Continue are visible in context.
- **Visual evidence:** `shots/before-1280.png` vs `shots/after-1280-selected.png`, `shots/before-narrow.png` vs `shots/after-narrow-selected.png`; shop/menu captures in `shots-review/shop-1280.png`, `shop-narrow.png`, `menu-1280.png`, and `menu-narrow.png`.
- **Browser verification:** isolated Playwright run exercised selection → play → score feedback → epoch transition → shop purchases → reload. `scripts/qa.mjs` passed at 1280×800 and 480×800 with no horizontal overflow and no console/page errors. `scripts/acceptance-playtest.mjs` passed with Joker + Planet purchase and reload persistence; preview-equals-commit and autosave/quit checks passed.
- **Accessibility/feel:** keyboard card navigation/toggle remains available; selected cards have a visible lift/check state; focus states and reduced-motion rules are retained; animation is bounded and hidden-tab animation is paused.
- **Gates:** `npx tsc --noEmit`, `npx vitest run` (169/169), and `npm run build` pass. The Vite chunk-size warning remains non-blocking. `scripts/review-independent-v5.mjs` is a pre-existing direct-Node/ESM-extension harness limitation and is not part of the UI path.

### UI limitations

The current screenshot capture records play/map and shop/menu states rather than a standalone video file. The browser walkthrough is reproducible with `scripts/acceptance-playtest.mjs` and `scripts/shop-shots.mjs`; audio remains intentionally absent. The regional-bonus scaling limitation documented above is unchanged.

The separate final-review worker was explicitly routed to `glm-5.3-flash` via `ollama-cloud`. It completed live wide/narrow visual and behavioral probes (including `PREVIEW==COMMIT true`, no overflow, keyboard selection, reduced-motion, hidden-tab resume, shop/menu/epoch inspection, and empty console-error arrays), but Ollama Cloud exhausted the account's monthly credits before returning its declared structured verdict. No files were modified by that reviewer; this is reported as a provider limitation, not a pass claim.

## Playtest verdict — local completion of the blocked review (2026-09-10)

The final review recorded above stopped without a verdict when Ollama Cloud exhausted the
account's credits. This section closes it **locally, with no cloud provider**: every probe below
was re-run against the same tree (`fc35b24` + the script-selector fixes in this commit), and the
verdict is drawn only from output that is reproducible on this machine.

**Result: PASS on the shipped scope.** No page errors in any probe; no product defect found.

| Probe | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | clean |
| Unit suite | `npx vitest run` | 169/169 |
| Build | `npm run build` | green (chunk-size warning is pre-existing, non-blocking) |
| Wide + narrow QA | `node scripts/qa.mjs` | ALL PLAYWRIGHT CHECKS PASSED at 1280x800 and 480x800 |
| Acceptance playtest | `node scripts/acceptance-playtest.mjs` | all 5 shop sections present; Joker + Planet bought; reload preserved World Lv 2 / World Score 15; page errors NONE |
| Preview == commit | `node scripts/review-pvcommit.mjs` | MATCH true, category-match true |
| Autosave / quit | `node scripts/review-autosave.mjs` | post-start, post-play, post-discard saves + quit/reload all preserved; errors [] |
| Wide + narrow behavior | `node scripts/review-browser.mjs` | selection, discard, map detail, quit-preserves-save (4054 B both widths), market, epoch-end, verdict; overflowX false; errors [] |
| 3D / reduced-motion | `node scripts/review-planet3d.mjs` | PLANET3D CHECKS PASSED — reduced-motion pixel-stable, keyboard + canvas raycast selection both resolve |
| Early advance + run end | `node scripts/review-early-advance.mjs` | epoch 1 closed after 2 plays (early advance fires); run died at epoch 7, out of lives; errors NONE |
| Per-epoch recovery | `node scripts/review-per-epoch-recover.mjs` | miss -> life lost, market income halved, next epoch recovers; errors NONE |

### Two stale harness scripts fixed (not product bugs)

The UI overhaul (`bd1a1a3`) moved the market's Continue button into `<footer class="shop-foot">`
as `[data-testid="end-market-btn"]`, renamed the status bar `.hud` -> `.run-rail`, dropped `.seed`,
and moved the log into a collapsed `<details class="chronicle">`. Two review scripts still probed
the old selectors and had been **silently degraded since that commit**:

- `scripts/review-early-advance.mjs` — its market check never matched, so it tried to play a hand
  while the shop was open and died on a `play-btn` timeout. Its `.seed` epoch read also never
  matched, so the "reach epoch 8+" half of the script had been dead: it broke out after one epoch.
  Fixed the selectors, added a run-over guard (`.panel.verdict` has no play button, no market and
  no epoch-end), and switched the collapsed-`<details>` log read to `textContent`.
- `scripts/review-per-epoch-recover.mjs` — same market selector, plus empty `.hud`/`.log` reads.

Both now report real state. Nothing under `src/engine/` or `src/ui/save.ts` was touched.

### What the run-depth probe shows

`review-early-advance.mjs` plays a naive policy (select the first up-to-5 cards, always play).
It reached **epoch 7** before running out of lives, having climbed to World Lv 8 / World Score 219.
That sits just below the bounded solver's epoch 8-18 band, which is the expected ordering: a naive
policy should die earlier than a greedy engine-building one. No balance change is made on this
evidence.

### Still open (unchanged by this pass)

- The regional-bonus mechanic still anti-scales (3.6% as-shipped / 1.9% all-awake).
- Human balance judgement past the solver band is still unmeasured; both automated policies die
  by epoch 18, but neither is a skilled player.
- `scripts/review-independent-v5.mjs` remains a pre-existing direct-Node/ESM-extension harness
  limitation, not part of the UI path.
