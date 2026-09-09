# Worldhand

A deterministic seeded planet-building card roguelike with a poker-scored engine — played in the browser, no backend.

## The living world (3D planet)

The world view is a **real 3D globe** rendered with three.js (`src/components/Planet3D.tsx`) — a planet in space, not a chart:

- **Terrain patches**: all 12 regions are distinct spherical terrain caps on the ocean sphere, coloured by terrain (meadow/coast/highland/forest/steppe/wetland), with a starfield and atmosphere around them.
- **Evolution icons**: each region's surface visibly develops — forest groves (trees), food (farms/fields), industry (workshops), settlements (buildings), knowledge (observatories) — scattered across the patch. Icons appear and grow with the region's **development** and its awake state; **dormant regions render dim, desaturated and unlit**. Presentation only: every icon state is derived from engine region data (`development`, `dormant`, terrain), no new mechanics.
- **Alive**: the globe auto-rotates slowly. Under `prefers-reduced-motion` the rotation and icon animation stop (state changes apply instantly) and a global CSS motion kill switches transitions off.
- **Selection**: hover highlights a region and changes the cursor; click (raycast) selects it. The selected region gets a gold emissive highlight + outline ring, and its adjacency neighbours light up as bright link lines. The globe canvas itself is keyboard-operable (arrow keys walk the regions, Enter selects).
- **Region legend**: a compact button list under the globe makes **every region reachable without rotating the globe** — Tab through, Enter/Space to select; the selected button shows a ✓. The region inspector (`map-detail`) shows exact name, terrain, stability, development, and adjacency.

## The core loop (v2 three-epoch slice)

- **12 regions** on the 3D planet; 4 awake at start, the rest woken by Bloom plays (Q+ hearts), expansions, and decay pressure.
- Each epoch you get **4 plays** and **3 discards** from an **8-card hand** dealt from a 52-card deck.
- **Play = select 1–5 cards.** The exact selection is scored as a poker hand (full 5-card categories; 1–4-card selections score high/pair/two-pair/trips/quads only).
- The **majority suit** of the selection decides which action fires; on a tie you choose the suit in the preview, and the committed play carries that exact choice (`suitChoice`) so preview and commit always agree. The **Ace is low** (A-2-3-4-5 wheel).
- **Discard 1–5 cards** at once; the hand refills to 8 from the deck. Card conservation (hand + deck + discard = 52) is a tested invariant.
- A deterministic **ResolutionPlan** is built by one shared pipeline: the UI *preview* and the engine *commit* both call the same `buildPlan`, so what you see is exactly what happens.

## Suits

| Suit | Action |
|---|---|
| ♠ Roots | Stability to a living region (magnitude scales with rank sum; weakest region by default). **Adjacency**: living neighbors of the target gain half the amount ("roots spread"). **Development**: +1 development to the target; every 3 development grants +1 stability on future Roots plays there. |
| ♥ Bloom | +Flourishing; any Q+ card in a Bloom play wakes a dormant region |
| ♦ Sow | +Seeds |
| ♣ Tend | +1 stability to *every* living region |

## Epochs, targets, Survival, challenge

- **3 epochs**, escalating targets: (Flourishing 20 / stability 20) → (36 / 30) → (52 / 40).
- **Survival pool** — start with 3. Missing an epoch-1 or epoch-2 target costs 1 Survival **and halves that epoch's Seed income**; at 0 Survival the run ends withered. (An epoch-3 target miss is already terminal, so it costs nothing extra.)
- Targets are calibrated against measured competent play (`scripts/solve.mjs` greedy all-subsets policy over 30 seeds): ~21/30 wins (70%) on the shipped targets, final Flourishing min 46 / median 55 / max 68. The old [5, 8, 12] targets were trivially banked (30/30 wins, F 41–68).
- Stability decays by 1 per living region at epoch end; **Seeds** income comes from living healthy regions plus laws.
- **Epoch 3 carries an explicit, previewed Drought challenge**: every living region must hold stability 3+ at epoch end. It's announced in the log and the HUD the moment epoch 3 begins, and failing it withers the world.

## Market

At each epoch end you may spend **Seeds** on up to 3 offers: **laws** (persistent rule changes like Mycorrhiza decay relief), **upgrades** (suit bonuses like Deep Taproots), and **expansions** (wake a specific dormant region). World stats are capped: stability 10 per region, 30 Seeds.

## Saves

Versioned (`version: 2`) localStorage envelope with **auto-save**: every committed state-changing action persists immediately (the Save button remains as an explicit checkpoint). Loading a forward-only version or an incompatible v1 save is rejected, not guessed. **Quit never clears your save** — Quit returns to the menu with the save intact; "Clear Save" is the only destructive action. Rewards are applied once inside the engine commit, so auto-saving cannot duplicate them.

## Development

```bash
npm install
npm run dev        # vite on port 5177
npm test           # vitest — engine + poker contracts
node scripts/qa.mjs  # Playwright browser checks at 1280x800 and 480px
node scripts/review-planet3d.mjs  # 3D planet acceptance + screenshots (shots-review/)
npm run build
```

Determinism: the same seed phrase produces the identical world, deal, and chronicle (tested).

No betting, no backend, no network calls. Pure TypeScript engine (`src/engine/`), React UI (`src/App.tsx` + `src/components/Planet3D.tsx`). The 3D world is **simulated presentationally only** — region state (stability, development, dormancy, adjacency) comes exclusively from the pure engine; the globe adds no mechanics.