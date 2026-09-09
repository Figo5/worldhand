# Worldhand — Playtest Handoff (v2 core, three-epoch vertical slice)

## Status: READY FOR PLAYTEST (v2.1 balance + tie-commit fix)

Commit replaces the v1 (8-epoch, one-card-per-play) contract with the corrected v2 core. The old contract was deliberately incompatible and has been removed.

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
- Hidden challenge → **explicit previewed Drought** in epoch 3 (log + HUD + previewed every epoch long).
- Fixed target → **three escalating targets** (20/20 → 36/30 → 52/40) on **capped** stats (stability 10, Seeds 30), calibrated by `scripts/balance-sweep.mjs` so a competent greedy policy wins ~70% of seeds (was 100% at 5/14 → 8/22 → 12/30). A **Survival pool** (3, −1 per missed epoch-1/2 target, halved market income on a miss, withered at 0) makes every epoch target live.
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
- **Concrete fix direction (not yet implemented):** the Bloom preview should state the wake's drought implication at the point of decision (e.g. append `— Laguna will need stability 3+ during Drought`, or show a projected `regions needing stability 3+ : X` while a wake is pending). This is the single highest-value readability change for the one mechanic that "works."

## Known scope boundaries (intentional)

- No betting, no backend, no AI opponents, no deployment — local browser only.
- Development is now mechanical on Roots plays: each Roots play adds +1 development to its target, and every 3 development grants +1 stability on future Roots plays there; living neighbors receive half the Roots amount (adjacency spread). Other suits' development economy remains post-slice.
- 1–4-card selections intentionally cannot form straights/flushes (poker-correct).
- Drought legibility gap documented above; proposed preview change deferred.