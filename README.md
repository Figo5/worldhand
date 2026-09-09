# Worldhand

A deterministic, seeded **planet-building card roguelike**. Pure engine, React +
TypeScript + Vite UI, versioned localStorage saves. No backend, no gambling/betting.

## Run

```bash
cd /Users/giofiore/Documents/Codex/worldhand
npm install       # once
npm run dev       # → http://localhost:5177 (strict port)
```

Other commands: `npm run build`, `npm test`, `node scripts/verify.mjs` (Playwright smoke
test against a running dev server; writes screenshots to `shots/`).

## The game

- A world of **12 regions** (4 awake at start) over **8 epochs × 4 hands** (32 hands).
- Each hand deals **8 cards**. Suits are your verbs:
  - ♠ **Roots** — +stability to a chosen region (click the region to target it).
  - ♥ **Bloom** — +Flourishing (the win resource); Q+ also wakes a dormant region.
  - ♦ **Sow** — +Seeds (currency for market and laws).
  - ♣ **Tend** — +1 stability to every living region and +1 Flourishing.
- Per hand: up to **3 Discards**, then explicit **Play** (select card → optional region →
  Play) and **Advance** to move to the next hand / close the epoch.
- At epoch end: regions **decay 1 stability** (base 3, max 10), an epoch **Challenge** is
  resolved (+2 Flourishing if met, −1 if not), the **Market** refreshes (3 cards for
  Seeds), and a **Law draft** of two is offered (paid with Seeds, or Skip Law).
- **Win**: Flourishing ≥ **12** when epoch 8 ends. **Lose**: short of the target, or
  Flourishing ≤ 0, or 5 living regions at 0 stability (Withering).

## Determinism & saves

Same seed phrase ⇒ identical world, hands, market, challenges, and law drafts. Saves are
versioned `{version, savedAt, state}` envelopes in `localStorage` (`worldhand.save`),
with a forward-only migration hook. The app auto-saves after every action.

## Architecture

```
src/engine/     pure, DOM-free, deterministic (rng.ts, poker.ts, worldhand.ts)
src/ui/save.ts  versioned localStorage envelope
src/App.tsx     React UI (explicit Play / Discard / Advance controls, ARIA-labelled regions)
tests/          vitest engine tests (21: determinism, suits, epochs, market, laws, outcomes)
scripts/        verify.mjs — Playwright end-to-end smoke test + screenshots
```

## Docs

- `RULES.md` — full rules reference.
- `PLAYTEST_HANDOFF.md` — verification checklist and evidence.