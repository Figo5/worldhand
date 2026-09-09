# Worldhand

A deterministic seeded planet-building card roguelike with a poker-scored engine — played in the browser, no backend. **Balatro-inspired presentation**: rich cards first, one big Growth number, a living 3D planet.

## The living world (3D planet)

The world view is a **real 3D globe** rendered with three.js (`src/components/Planet3D.tsx`) — a planet in space, not a chart:

- **Terrain patches**: all 12 regions are distinct spherical terrain caps on the ocean sphere, coloured by terrain (meadow/coast/highland/forest/steppe/wetland), with a starfield and atmosphere around them.
- **Evolution icons**: each region's surface visibly develops — forest groves (trees), food (farms/fields), industry (workshops), settlements (buildings), knowledge (observatories) — scattered across the patch. Icons appear and grow with the region's **development** and its awake state; **dormant regions render dim, desaturated and unlit**. Presentation only: every icon state is derived from engine region data (`development`, `dormant`, terrain), no new mechanics.
- **Alive**: the globe auto-rotates slowly. Under `prefers-reduced-motion` the rotation and icon animation stop (state changes apply instantly) and a global CSS motion kill switches transitions off.
- **Selection**: hover highlights a region and changes the cursor; click (raycast) selects it. The selected region gets a gold emissive highlight + outline ring, and its adjacency neighbours light up as bright link lines. The globe canvas itself is keyboard-operable (arrow keys walk the regions, Enter selects).
- **Region legend**: a compact button list under the globe makes **every region reachable without rotating the globe** — Tab through, Enter/Space to select; the selected button shows a ✓. The region inspector (`map-detail`) shows exact name, terrain, stability, development, and adjacency.

## The core loop (simplified single-target slice)

- **12 regions** on the 3D planet; 4 awake at start, the rest woken by Grow plays (Q+ hearts), expansions, and decay pressure.
- Each epoch you get **4 plays** and **3 discards** from an **8-card hand** dealt from a 52-card deck.
- **Play = select 1–5 cards.** The exact selection is scored as a poker hand (full 5-card categories; 1–4-card selections score high/pair/two-pair/trips/quads only).
- The **majority suit** of the selection decides which action fires; on a tie you choose the suit in the preview, and the committed play carries that exact choice (`suitChoice`) so preview and commit always agree. The **Ace is low** (A-2-3-4-5 wheel).
- **Every play banks ONE Growth score** — the hero number, shown huge above the hand with its ordered breakdown (poker → region → laws → drought). Flourishing (the epoch target) is the cumulative sum of banked Growth.
- **Discard 1–5 cards** at once; the hand refills to 8 from the deck. Card conservation (hand + deck + discard = 52) is a tested invariant.
- A deterministic **ResolutionPlan** is built by one shared pipeline: the UI *preview* and the engine *commit* both call the same `buildPlan`, so what you see is exactly what happens — same category, same effects, same Growth number.

## Suits — one action each

| Suit | Action | What it does | How it feeds Growth |
|---|---|---|---|
| ♠ Study | Develop | +1 development to the weakest living region (a `regionChoice` targets a specific living region instead; Deep Taproots upgrade makes it +2). | The acting region's development feeds the Growth **region** part: `+floor(development / 3)`. |
| ♥ Grow | Bank Growth | The Growth suit. Q+ cards in the selection wake the first dormant region (a wake is a Drought liability — the preview says so). | Its poker base *is* the Growth; Canopy Choir adds `+growBonus` to the **laws** part of every Grow play. |
| ♦ Mine | Seeds | `max(1, round(rankSum / 3))` Seeds (Rich Soil adds +2), capped at 30. | No direct Growth — it funds the market, whose upgrades amplify the other suits. |
| ♣ Settle | Stability | +1 stability to **every** living region (Communal Tending makes it +2). | Keeps regions at stability 3+, which zeroes the Growth **drought** part and defends the epoch-3 Drought. |

## The Growth score (one number per play)

Every play resolves to a single **Growth** value, computed in one place (`buildPlan`) in a fixed order:

1. **poker** = rankSum ("chips") × `CATEGORY_MULT[category]` — mult scales with hand strength: high ×1, pair ×1.5, two-pair ×2, trips ×2.5, straight ×3, flush ×4, full-house ×5, quads ×6, straight-flush ×8.
2. **region** = `+floor(acting region's development / 3)` (Study loop).
3. **laws** = `+growBonus` from owned upgrades (Grow plays only).
4. **drought** = `−5` per living region below stability 3 (`DROUGHT_PENALTY_PER_REGION`).

`Growth = max(0, poker + region + laws + drought)` — floored at 0. The plan carries the number (`growth`) and the ordered parts (`growthParts`), displayed as `+15 poker · 0 region · 0 laws · 0 drought` under the big Growth readout.

## Epochs, targets, Survival, challenge

- **3 epochs**, ONE target each — cumulative Growth (Flourishing): **50 → 120 → 200** (strictly escalating).
- **Survival pool** — start with 3. Missing an epoch-1 or epoch-2 target costs 1 Survival **and halves that epoch's Seed income**; at 0 Survival the run ends withered. (An epoch-3 target miss is already terminal, so it costs nothing extra.)
- Targets are calibrated with `LOOK=30 npx vite-node scripts/solve.mjs` (the bounded reference policy: every 1–2-card selection plus a seeded sample of longer ones, 30 `probe-*` seeds). The shipped [50, 120, 200] measures **18/30 wins (60%) at LOOK=30**, 13/30 (43%) at LOOK=12, and 30/30 (100%) exhaustive — in the intended 40–60% band at the bounded reference. Nearby rungs measured on the same ladder: e3 190 → 20/30 (67%), e3 205 → 15/30 (50%).
- Stability decays by 1 per living region at epoch end; **Seeds** income comes from living healthy regions plus laws.
- **Epoch 3 carries an explicit, previewed Drought challenge**: every living region must hold stability 3+ at epoch end. It's announced in the log and the HUD the moment epoch 3 begins, and failing it withers the world.

## The card-first UI (Balatro-inspired)

- The play panel's hero is the **big Growth number** (`Growth: 15`, huge gold, glow) for the current selection, with the small ordered **breakdown line** underneath (poker → region → laws → drought) and the acting suit's name beside it.
- **Rich cards**: cream/white faces, saturated red (♥♦) and blue (♠♣) suits, bold ranks; selected cards get a thick gold outline, a ✓ glyph, and a glow (`.pcard-btn.sel`).
- Clean rounded panels on a **deep dark celestial background** (fixed nebula gradients + the 3D planet with its starfield).
- The status **HUD is deliberately de-emphasized** — small, grey, quiet chips — so the cards, the Growth readout, and the planet are the clear heroes.
- Full keyboard support: arrows move between cards, Enter/Space toggles; the preview, tie-choice buttons, and region legend remain screen-reader-labelled.

## Market

At each epoch end you may spend **Seeds** on up to 3 offers: **laws** (persistent rule changes like Mycorrhiza decay relief), **upgrades** (suit bonuses like Deep Taproots), and **expansions** (wake a specific dormant region). World stats are capped: stability 10 per region, 30 Seeds.

## Saves

Versioned (`version: 2`) localStorage envelope with **auto-save**: every committed state-changing action persists immediately (the Save button remains as an explicit checkpoint). Loading a forward-only version or an incompatible v1 save is rejected, not guessed. **Quit never clears your save** — Quit returns to the menu with the save intact; "Clear Save" is the only destructive action. Rewards are applied once inside the engine commit, so auto-saving cannot duplicate them.

## Development

```bash
npm install
npm run dev        # vite on port 5177
npm test           # vitest — engine + poker contracts
node scripts/qa.mjs  # Playwright browser checks at 1280x800 and 480x800
node scripts/review-planet3d.mjs  # 3D planet acceptance + screenshots (shots-review/)
node scripts/capture-ui-shots.mjs # card-first UI + big-Growth screenshots (shots-review/)
LOOK=30 npx vite-node scripts/solve.mjs  # bounded balance probe (win rate over 30 seeds)
npm run build
```

Determinism: the same seed phrase produces the identical world, deal, and chronicle (tested).

No betting, no backend, no network calls. Pure TypeScript engine (`src/engine/`), React UI (`src/App.tsx` + `src/components/Planet3D.tsx`). The 3D world is **simulated presentationally only** — region state (stability, development, dormancy, adjacency) comes exclusively from the pure engine; the globe adds no mechanics.