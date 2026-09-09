# Worldhand

A deterministic seeded planet-building card roguelike with a poker-scored engine — played in the browser, no backend. **Maximally Balatro-simple**: play poker hands, earn money, spend money to make the planet smarter. No per-suit actions, no region choices, no drought — just cards, one big Growth number, and a shop.

## The core loop

- **12 regions** on the 3D planet; 4 awake at start, more woken by market expansions (the planet visibly grows).
- Each epoch you get **4 plays** and **3 discards** from an **8-card hand** dealt from a 52-card deck.
- **Play = play a poker hand.** Select 1–5 cards; the exact selection is scored (full 5-card categories; 1–4-card selections score high/pair/two-pair/trips/quads only; **Ace is low** in the wheel). There is **no suit decision, no region choice, no acting suit** — the same cards score the same no matter the suit mix.
- **Every play resolves to ONE hero number, Growth** (see formula below), banked toward the single cumulative epoch target (Flourishing).
- **Every play also auto-earns Seeds** — hand quality is money; there is no separate gather action (formula below).
- **Discard 1–5 cards** at once; the hand refills (or to 9/10 with card additions). Card conservation (hand + deck + discard = 52) is a tested invariant — card additions grow the dealt hand from the same 52-card pool.
- A deterministic **ResolutionPlan** is built by one shared pipeline: the UI *preview* and the engine *commit* both call the same `buildPlan`, so what you see is exactly what happens.

## The Growth formula (the hero number)

Computed in one place (`buildPlan`), in a fixed order:

1. **poker** = `round(chips × CATEGORY_MULT[category])` where **chips = rankSum = the sum of the ranks of ALL selected cards (kickers included — see below)** — high ×1, pair ×1.5, two-pair ×2, trips ×2.5, straight ×3, flush ×4, full-house ×5, quads ×6, straight-flush ×8.
2. **World-Law bonuses only**: × owned `growthMult` (floored at 1, e.g. Open Canals ×1.2), then + owned `growthFlat` (Canopy Choir +3, Stone Masonry +6).

`Growth = max(0, round(pokerBase × lawMult) + lawFlat)` where `pokerBase = round(chips × mult)` is the already-multiplied base. The UI shows the full honest equation — **`{chips} chips × {mult} mult = {base} base`** — so the multiplication is never implied twice. Breakdown displayed as `+15 poker · +2 laws`. No region, stability, or drought modifiers exist anymore. **Flourishing is the cumulative sum of banked Growth** toward the epoch target.

**Kickers contribute**: `rankSum` sums ALL selected cards, not just the scoring combination — an unrelated kicker adds its full rank to the chips (a pair K♠K♥ + Q♦ is `38 chips × 1.5 = 57`, not `26 × 1.5 = 39`). This is deliberate, documented, and pinned by a test (`pokerBase === round(chips × mult)`) so display and formula cannot drift.

## The auto-Seeds formula (money from hand quality)

Every play earns Seeds instantly — no Mine action:

```
seedsGained = ceil(Growth × SEEDS_PER_GROWTH)   with SEEDS_PER_GROWTH = 1/4
```

i.e. **1 Seed per 4 Growth** (a 15-Growth hand pays 4 Seeds), capped by the 30-Seeds cap like every other income source. Epoch end also pays +1 Seed per living healthy region plus law income (`extraSeedsPerEpoch`), halved on a missed epoch target.

## Lives, epochs, winning

- **3 epochs, ONE cumulative-Growth target each: 45 → 110 → 360** (strictly escalating; see Balance).
- **Balatro-style lives: start 3.** Missing ANY epoch target — epoch 1, 2, **or 3** — costs 1 life **and** halves that epoch's market income. **0 lives → game over (withered).** The epoch-3 miss is also terminal for the win (final-target check) but still costs its life; the win check is separate: beat the final target while lives remain.
- **Winning = beat the epoch-3 target.** Flourishing collapsed to 0 also ends the run.
- Stability decays 1 per living region at epoch end (Mycorrhiza softens it) — **cosmetic pressure only**; nothing in scoring reads stability, and there is **no Drought, no challenge, no stability requirement of any kind**.

## The market (spend Seeds to make the civilization smarter)

Up to 3 offers per epoch end from the item pool; **max 5 owned items** with explicit removal (no refund, frees the slot; buying is blocked at the cap):

- **Poker-hand upgrades**: Canopy Choir (+3 Growth every play), Stone Masonry (+6 Growth every play), Open Canals (Growth ×1.2 every play).
- **Card additions**: Fourth Counsel (hand 9), Fifth Counsel (hand 10) — new unique item ids; the dealt hand grows from the same 52-card deck, so conservation still holds exactly 52.
- **Region expansion**: Wake Laguna / Wake Brumal — awaken a specific dormant region; the planet visibly grows.
- **Laws**: Mycorrhiza Network (decay −1), Seed Vaults (+3 Seeds/epoch), Barter Routes (market −2).

Old per-suit upgrades (Deep Taproots, Rich Soil, Communal Tending) are removed along with the actions they buffed. Owned items never reappear; Seeds never go negative; purchases apply exactly once.

## The 3D planet

three.js globe (untouched mechanics): terrain patches, evolution icons that appear/grow with each region's **development**, dormant regions dim. **The globe itself now visibly grows** — its scale blends living-region awakenings (50%) and total development (50%), so waking regions and accumulating civilization growth both make the planet larger. Every living region gains +1 development at each epoch end (presentation only). Under `prefers-reduced-motion` rotation and icon animation stop.

## The UI (Balatro-fied, zero emojis)

- Rich cream/white cards, saturated red (♥♦) / blue (♠♣) suits, bold ranks; selection = thick gold outline + glow (`.pcard-btn.sel`).
- **ONE huge `Growth: N` hero number** per hand with the small ordered breakdown (`+15 poker · 0 laws`) and the honest **`15 chips × 1 mult = 15 base`** equation readout (chips = full rank sum, base = the already-multiplied poker part).
- Deep dark celestial background; greyed/minimal secondary HUD (Flourishing/target, Seeds, Lives, Plays, Discards, Living regions).
- **No emojis anywhere in the rendered UI** (labels are plain text; suit symbols are typographic glyphs).
- Full keyboard support and reduced-motion/accessibility preserved.

## Review-script hooks (unchanged)

`input#seed`, `Begin New World`, `.pcard-btn`, `[data-testid=play-btn]`, `[data-testid=preview]`/`.preview`, `.tie-btn` (kept in CSS for compat), `.market`/`.market-btn`, `button:has-text(Continue)`, `button:has-text(Close)`, `.pcard-btn.sel`, `.log li`, `.map-detail`, `.verdict`, Quit / Clear Save, region legend, reduced-motion.

## Saves

Versioned localStorage envelope (`schema: 3` + state `version: 3` — v3 is the Balatro-simple rules generation) with **auto-save** after every committed action. On load, a save whose version or structure is incompatible with the current engine (old version, missing/non-numeric `lives`, obsolete era market items, invalid phase, malformed cards, broken 52-card conservation) is **rejected — never migrated, never reinterpreted, never erased**: the raw blob is preserved verbatim under a `worldhand.save.legacy.<ts>` key and the menu explains that a fresh run is needed because the engine rules changed. Quit never clears the save; "Clear Save" (and the game-over "Back to Menu") are destructive and both require an explicit confirmation. Rewards are applied once inside the engine commit, so auto-saving cannot double-apply them.

## Development

```bash
npm install
npm run dev        # vite on port 5177
npm test           # vitest — engine + poker contracts
node scripts/qa.mjs  # Playwright browser checks at 1280x800 and 480x800
node scripts/review-planet3d.mjs  # 3D planet acceptance + screenshots (shots-review/)
node scripts/capture-ui-shots.mjs # card-first UI + big-Growth screenshots (shots-review/)
npx vite-node scripts/solve.mjs --set=eval --look=30  # bounded solver result over the eval-* seed set
npx vite-node scripts/solve.mjs --set=calib --look=30 # calibration set (target sweeps only)
python3 scripts/check-no-emoji.py # emoji audit of rendered-UI sources
npm run build
```

Determinism: the same seed phrase produces the identical world, deal, and chronicle (tested).

No betting, no backend, no network calls. Pure TypeScript engine (`src/engine/`), React UI (`src/App.tsx` + `src/components/Planet3D.tsx`). The 3D world is **simulated presentationally only** — region state (stability, development, dormancy, adjacency) comes exclusively from the pure engine; the globe adds no mechanics.