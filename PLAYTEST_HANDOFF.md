# Playtest Handoff — Worldhand

**Status**: vertical slice complete. Engine + UI + tests verified. No known blockers.

## How to start

```bash
cd /Users/giofiore/Documents/Codex/worldhand
npm install   # if node_modules missing
npm run dev   # http://localhost:5177 (strict port)
```

Verify first:

```bash
npx tsc --noEmit   # → clean
npx vitest run     # → 19/19 passed
npx vite build     # → dist/ emitted
```

## What to playtest (30 min)

1. **Determinism**: start a run with seed `auralia-the-first`. Note your 8-card hand.
   Quit, clear save, restart with the same seed — the hand and 3 starting regions must
   be identical.
2. **Action economy**: Prosper on a region → Order rises by `3 + strength×2`; actions
   tick 3 → 0; epoch advances automatically after the third action.
3. **Law phase**: after each epoch end you must pick one of two laws; the enacted chip
   appears in the HUD bar and persists next epoch.
4. **Decay & fracture**: leave regions unfortified; they lose 1 stability per epoch and
   fracture at 0. Repair (Fortify on fractured) restores to 3.
5. **Market**: Trade opens 3 offers; buy one (−6 Order, −2 with Open Markets); bought
   cards should surface in a later hand (deck reshuffle at epoch start).
6. **Wonder path**: get a region to stability 6+, hold a flush-or-better hand, pay 12
   Order → Wonder. Build 3 → win screen.
7. **Loss path**: ignore everything; after 3 fractures (or epoch 15) you get the loss
   screen with a reason string.
8. **Saves**: mid-run, hit Save → reload the page → Load. State (hand, regions, Order,
   laws, log) must be intact. Save envelope is `{version:1, savedAt, state}`.
9. **Responsive**: narrow window to phone width — regions grid drops to 2 columns,
   cards shrink, topbar stacks.

## Known balances to watch

- Starting 3 actions/epoch may feel tight for a 6-region, 3-wonder goal — Great Works
  (+1 action) is intended as a strong pick.
- Stone Covenant (+3 Order / +1 decay) is deliberately swingy.
- Survey base chance 45% + 5%×strength; feel free to tune in `worldhand.ts`.

## Where things live

- Rules: `RULES.md` · Overview: `README.md`
- Engine: `src/engine/worldhand.ts` (all rules), `src/engine/poker.ts` (evaluation),
  `src/engine/rng.ts` (mulberry32 + FNV-1a seed hash)
- Saves: `src/ui/save.ts` (versioned localStorage, forward-only migration hook)
- UI: `src/App.tsx`, `src/styles.css`
- Tests: `tests/engine.test.ts`

## Extending

- New laws: add to `LAWS` in `src/engine/worldhand.ts` and wire their effect where
  `s.laws.reduce(...)` appears.
- New actions: extend the `Action` union, the `applyAction` switch, and `legalActions`.
- Save version bump: increment `SAVE_VERSION` + `CURRENT_VERSION` and add a migration
  step in `migrate()`.