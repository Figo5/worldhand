# Worldhand — Playtest Handoff (v2 core, three-epoch vertical slice)

## Status: READY FOR PLAYTEST

Commit replaces the v1 (8-epoch, one-card-per-play) contract with the corrected v2 core. The old contract was deliberately incompatible and has been removed.

## What a playtester should exercise

1. **Start** — enter any seed phrase (same seed = same world, tested). 12 regions on the planet disc; 4 awake.
2. **Play** — click 1–5 cards in the hand; the **Resolution preview** panel shows category, category points, acting suit, how the suit was decided (majority / tie / your tie choice), and the exact world effects. Press Play — the commit matches the preview exactly.
3. **Tie-break** — select a tie (e.g. 2♥ + 2♦); the preview offers suit-choice buttons; your choice is what fires.
4. **Discard** — select up to 5 cards, press Discard: the hand refills to 8 immediately; budget is 3 per epoch.
5. **Planet map** — click any region node (mouse or keyboard): terrain color, stability pips, development ring, and adjacency lines/detail appear. Dormant regions render dimmed with "z".
6. **Epoch flow** — 4 plays closes the epoch: target check, challenge, decay, income, market. Buy laws/upgrades/expansions with Seeds or continue.
7. **Epoch 3 Drought** — explicitly announced at epoch start in the log and HUD; keep every living region at stability 3+ through epoch end or the world withers.
8. **Save/Quit** — Save persists a versioned envelope; **Quit keeps the save** (menu → Load Saved World restores). Only "Clear Save" deletes.

## What changed vs the previous slice (v1 → v2)

- One-card suit action → **1–5 card poker selection** with exact scoring (cards + precedence + Ace-low wheel).
- Text-panel regions → **SVG planet map** with terrain/development/adjacency and accessible (tabbable, labeled) controls.
- Discard didn't refill → **discard 1–5 with refill** and a tested card-conservation invariant.
- Hidden challenge → **explicit previewed Drought** in epoch 3 (log + HUD + previewed every epoch long).
- Fixed target → **three escalating targets** (5/14 → 8/22 → 12/30) on **capped** stats (stability 10, Seeds 30).
- No preview/commit chain → one **deterministic ResolutionPlan** shared by preview and commit.
- Quit cleared save → **quit preserves the save**; version 2 envelope; v1 saves rejected, not mis-migrated.
- 8 epochs/4 hands → **3 epochs × (4 plays + 3 discards)** vertical slice.
- Market: **laws + upgrades + expansions** with Seed costs, Barter Routes discount, meaningful two-action depth per suit.

## Verification performed

- `npx vitest run` — **59 tests, all passing** (poker categories, precedence, wheel; selection scoring; majority/tie; plan determinism preview==commit; discard/refill/conservation; 4 plays + 3 discards; targets; drought; market; caps; withering; save version).
- `node scripts/qa.mjs` — real Playwright runs at **1280×800 and 420×820**: new world → select 2 → preview → play (3/4) → discard (refill to 8, 2/3) → map click (adjacency detail) → save → quit → load; no console errors; no horizontal overflow.
- Screenshots in `shots/`: `before-*.png` (menu), `after-*-selected.png`, `after-*-map.png`.

## Known scope boundaries (intentional)

- No betting, no backend, no AI opponents, no deployment — local browser only.
- Development rings currently render but only Bloom/expansion paths move region state; deeper development economy is post-slice.
- 1–4-card selections intentionally cannot form straights/flushes (poker-correct).