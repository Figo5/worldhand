# Worldhand

A deterministic, seeded **planet-building roguelike** played with an 8-card hand.
Pure engine, React + TypeScript + Vite UI, versioned localStorage saves. No backend,
no external runtime dependency, no gambling/betting mechanics.

## Run

```bash
cd /Users/giofiore/Documents/Codex/worldhand
npm install       # once
npm run dev       # → http://localhost:5177
```

Other commands: `npm run build` (typecheck + production build), `npm test` (vitest).

## How it plays

- Each **epoch** you're dealt an **8-card hand**. Your best 5-card poker hand from
  those 8 cards is your **hand strength** (0 = high card … 8 = straight flush).
- You get **3 World Actions** per epoch to spend on regions:
  - **Prosper** — convert strength into Order (your currency).
  - **Fortify** — raise a region's stability (or **Repair** a fractured region).
  - **Survey** — chance to reveal a new region (law-modifiable).
  - **Trade** — open a 3-card market; buy cards into the world deck for Order.
  - **Wonder** — build a wonder in a stability-6+ region; requires flush-or-better and 12 Order.
- End of epoch: regions **decay 1 stability** (0 ⇒ fractured), you collect Order,
  and you **enact one of two drafted laws** that modify future epochs.
- **Win** by raising **3 wonders** before 3 regions fracture or 15 epochs pass.
- **Same seed ⇒ identical world, cards, law drafts, survey rolls.** Every run with the
  same seed and the same action sequence plays out identically.

## Architecture

```
src/engine/     pure, DOM-free, deterministic (rng.ts, poker.ts, worldhand.ts)
src/ui/         save.ts (versioned localStorage envelope)
src/            React UI (App.tsx, styles.css, main.tsx)
tests/          vitest engine tests (determinism, mechanics, full-run termination)
```

The engine has zero UI or DOM imports; the UI holds no rules. Save files are
versioned envelopes (`{version, savedAt, state}`) with a forward-only migration hook.

## Docs

- `RULES.md` — full rules reference.
- `PLAYTEST_HANDOFF.md` — what to verify when picking this up.