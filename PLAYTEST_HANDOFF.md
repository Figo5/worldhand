# Playtest Handoff — Worldhand

**Status**: vertical slice complete and verified in a real browser (Playwright/Chromium).
Engine contracts: 12 regions, 8 epochs × 4 hands, 8-card hands, 3 discards, explicit
Play/Discard/Advance, suit-specific actions, Flourishing target 12, Seeds, stability base
3, market, laws, challenges, versioned saves.

## Start

```bash
cd /Users/giofiore/Documents/Codex/worldhand
npm install          # if needed
npm run dev          # http://localhost:5177 (strict port)
```

## Verified evidence (this build)

Commands run and results:

- `npx tsc --noEmit` → clean.
- `npx vitest run` → **21/21 passed** (determinism, suit actions, epoch/law/market flow,
  withering, challenge evaluation, full-run termination in < 1s).
- `npm run build` → production bundle emitted (dist/).
- `node scripts/verify.mjs` (dev server on 127.0.0.1:5177, headless Chromium):
  - COUNTS: 12 regions, 8 cards, HUD `Flourishing 3/12 | Seeds 8 | Discards 3/3 | Living 4/12`.
  - Play verified: hand shrank 8 → 7 after card select + Play; Seeds 8 → 9 via ♦ Sow.
  - Discard verified: counter 3 → 2.
  - Reload verified: HUD identical after `page.reload()`; `localStorage['worldhand.save']` = 2513 bytes.
  - Full Advance-only run to epoch 8 → verdict screen rendered
    ("🍂 The World Withers — Final Flourishing −5 fell short of 12").
  - Zero page errors (`pageerror`/console.error = []).
  - Screenshots in `shots/`: menu, first hand, after-play, region-selected, mid-hand,
    after-reload, game-over.

## What to playtest (20 min)

1. **Determinism**: run seed `auralia-the-first`, note hand; quit, Clear Save, restart
   same seed → identical hand and world.
2. **Region targeting**: select a ♠ card → regions become enabled buttons ("Click to
   target…"); click one, Play; stability rises. Non-♠ plays need no target (hint shown).
3. **Discard budget**: 3 per hand, resets each hand.
4. **Epoch flow**: Advance through 4 hands → Challenge resolution, decay, market refresh,
   law draft (pay Seeds or Skip Law).
5. **Bloom wake**: play a ♥ Q/K/A → a dormant region wakes (Living count rises).
6. **Save/Load**: Save → reload page → Load; state identical. Auto-save also runs every action.
7. **Responsive**: narrow the window — regions drop to 2 columns, cards shrink.

## Tuning notes

- Flourishing target 12 vs ♥ income `round(rank/5)` is tight — Canopy Choir matters.
- Decay 1/epoch from base 3 gives ~3 idle epochs before regions start dying; the epoch
  Challenge adds pressure to fortify.
- Slow Ruin (+5 Seeds, +1 decay) is intentionally the aggressive open.

## Files

- Engine: `src/engine/worldhand.ts` (rules), `poker.ts` (5-of-8 evaluation), `rng.ts`.
- UI: `src/App.tsx`, `src/styles.css`; saves: `src/ui/save.ts`.
- Tests: `tests/engine.test.ts`; browser check: `scripts/verify.mjs`.
- Extend: add laws to `LAWS`, actions to the `Action` union + `applyAction` + UI buttons;
  bump `SAVE_VERSION`/`CURRENT_VERSION` and add a `migrate()` step for save changes.