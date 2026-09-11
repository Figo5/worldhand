# Worldhand

A deterministic seeded planet-building card roguelike with a poker-scored engine — played in the browser, no backend. **Balatro-hard**: play poker hands, earn money, spend money to build a scaling engine (Jokers, Planet cards, Consumables, Vouchers, World Level) and outrun escalating blinds. No per-suit actions, no region choices, no drought — just cards, one big Growth number, and a shop.

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

1. **poker** = `round(chips × mult)` where **chips = rankSum = the sum of the ranks of ALL selected cards (kickers included — see below)** and `mult = CATEGORY_MULT[category] + planetBoosts` — high ×1, pair ×1.5, two-pair ×2, trips ×2.5, straight ×3, flush ×4, full-house ×5, quads ×6, straight-flush ×8. **Planet cards permanently raise a hand type's `mult`.**
2. **World-Law bonuses**: × owned `growthMult` (floored at 1, e.g. Open Canals ×1.2), then + owned `growthFlat` (Canopy Choir +3, Stone Masonry +6).
3. **World Level**: +2 Growth/play per level above 1 (the simplified worldbuilding number).
4. **Regions**: the sum of the regional bonuses of every awake region whose fixed `specialization` equals the hand's exact category (dormant → 0).
5. **Jokers**: × the product of `(1 + mult)` over every joker whose condition the hand meets (stack multiplicatively; Vouchers add to all joker mult).
6. **Consumables**: × the product of the queued one-shot boosts (applied to the next hand, then consumed).

`Growth = max(0, round((pokerBase × lawMult + lawFlat + worldBonus + totalRegionBonus) × jokerMult × consumableMult))` where `pokerBase = round(chips × mult)` is the already-multiplied base. The UI shows the full honest equation — **`{chips} chips × {mult} mult = {base} base`** — so the multiplication is never implied twice. Breakdown displayed as `+15 poker · +2 laws · +4 world · +7 regions ×1.5 joker`. **Flourishing is the lifetime sum of banked Growth**; the per-epoch target is measured against Growth banked THIS epoch.

**Kickers contribute**: `rankSum` sums ALL selected cards, not just the scoring combination — an unrelated kicker adds its full rank to the chips (a pair K♠K♥ + Q♦ is `38 chips × 1.5 = 57`, not `26 × 1.5 = 39`). This is deliberate, documented, and pinned by a test (`pokerBase === round(chips × mult)`) so display and formula cannot drift.

## The auto-Seeds formula (money from hand quality)

Every play earns Seeds instantly — no Mine action:

```
seedsGained = ceil(Growth × SEEDS_PER_GROWTH)   with SEEDS_PER_GROWTH = 1/4
```

i.e. **1 Seed per 4 Growth** (a 15-Growth hand nominally pays 4 Seeds). Seeds **accumulate without ceiling** — every play banks the full nominal earn, so the preview, the committed summary, and the chronicle all read the same single `amount` (no credited/overflow split). Epoch end also pays +1 Seed per living healthy region (stability > 0) plus law income (`extraSeedsPerEpoch`), halved on a missed epoch target, and is banked in full.

## Lives, epochs, winning

- **Unlimited epochs, ONE per-epoch Growth target each**: `100 + 40·(n−1) + 5·(n−1)²`, escalating fast. **Early advance**: the moment Growth banked THIS epoch reaches the target, the epoch closes immediately (unused plays and discards are forfeited, exactly as in Balatro). Growth banked resets at each boundary; a separate **lifetime Flourishing** total keeps growing for score/display. Every epoch opens the market → next-epoch loop; the run ends only when lives run out or Flourishing collapses. **The goal is the World Score** — make the world as good as you can before your 3 lives run out. **The blinds escalate fast, so you must build a scaling engine (Jokers, Planet cards, World Level) to survive.** Reload cannot duplicate rewards or life deductions (rewards apply once inside the engine commit; a finished run is inert).
- **Balatro-style lives: start 3.** Missing ANY epoch target costs 1 life **and** halves that epoch's market income. **0 lives → game over (withered).** With unlimited epochs, missing targets is the pressure that eventually ends the run — lives are the exhaustible resource, and "how far did I get" is the score.
- **Winning = keep advancing.** The run ends only when lives run out or Flourishing collapses to 0.
- **Stability is a real (small) economy dial, not pure cosmetics**: every living region decays 1 stability at epoch end (**Mycorrhiza Network reduces that decay by 1 — 1 → 0, living regions stop decaying**; floored at 0, never a gain, never a double loss; regions at 0 stay at 0). Stability is never part of the Growth score, but **epoch income counts only living regions with stability > 0**, so decayed-out regions stop paying Seeds and Mycorrhiza protects that income base. There is **no Drought, no challenge, no stability requirement of any kind** in scoring.

## The market (spend Seeds to make the civilization smarter)

The shop is **Balatro-style** — four rotating card types plus the World Level boost, offered each epoch end:

- **Jokers** (max 5) — conditional multipliers that define your build: "×1.5 Growth when you play a Pair," "×2 on a Flush," "×1.5 if no face cards," "×1.25 on every hand." They stack multiplicatively.
- **Planet cards** — permanently raise a hand type's base mult (build toward one hand).
- **Consumables** — one-shot boosts queued before a hand ("next hand ×2"), consumed on play.
- **Vouchers** — permanent globals (+1 hand size, all jokers +0.5 mult, +2 Seeds/epoch).
- **World Level boost** — spend Seeds to raise the world level (+2 Growth/play, +1 Seed/epoch, +5 World Score per level above 1).
- **World Projects** — an infinite repeatable Seed-sink (Cultivate a region, World Monument, Fertile Soil, Seed Granary); cost rises each purchase, so the shop never drains.

Plus the classic items: **poker-hand upgrades** (Canopy Choir +3, Stone Masonry +6, Open Canals ×1.2), **card additions** (Fourth/Fifth Counsel — hand 9/10), **region expansions** (Wake Laguna/Brumal/Pellucid/Vantage/Ozurn/Harrow/Sequana/Kestrel), and **laws** (Mycorrhiza Network, Seed Vaults, Barter Routes). **Max 5 owned law/upgrade items** with explicit removal (no refund, frees the slot; buying is blocked at the cap); **max 5 owned Jokers**. Owned items never reappear; Seeds never go negative; purchases apply exactly once.

## The 3D planet

three.js globe (untouched mechanics): terrain patches, evolution icons that appear/grow with each region's **development**, dormant regions dim. **The globe itself now visibly grows** — its scale blends living-region awakenings (50%) and total development (50%), so waking regions and accumulating civilization growth both make the planet larger. Every living region gains +1 development at each epoch end (presentation only). Under `prefers-reduced-motion` rotation and icon animation stop.

## The UI (Balatro-fied, zero emojis)

- Rich cream/white cards, saturated red (♥♦) / blue (♠♣) suits, bold ranks; selection = thick gold outline + glow (`.pcard-btn.sel`).
- **ONE huge `Growth: N` hero number** per hand with the small ordered breakdown (`+15 poker · +2 laws · +4 world · +7 regions ×1.5 joker`) and the honest **`15 chips × 1 mult = 15 base`** equation readout (chips = full rank sum, base = the already-multiplied poker part).
- Deep dark celestial background; greyed/minimal secondary HUD (Flourishing/target, Seeds, Lives, Plays, Discards, Living regions).
- **No emojis anywhere in the rendered UI** (labels are plain text; suit symbols are typographic glyphs).
- Full keyboard support and reduced-motion/accessibility preserved.

## Review-script hooks (unchanged)

`input#seed`, `Begin New World`, `.pcard-btn`, `[data-testid=play-btn]`, `[data-testid=preview]`/`.preview`, `.tie-btn` (kept in CSS for compat), `.market`/`.market-btn`, `button:has-text(Continue)`, `button:has-text(Close)`, `.pcard-btn.sel`, `.log li`, `.map-detail`, `.verdict`, Quit / Clear Save, region legend, reduced-motion.

## Saves

Versioned localStorage envelope (`schema: 3` + state `version: 7` — v7 is the Balatro-hard rules generation) with **auto-save** after every committed action. On load, a save whose version or structure is incompatible with the current engine (old version, missing/non-numeric `lives`, obsolete era market items, invalid phase, malformed cards, broken 52-card conservation, invalid region specialization) is **rejected — never migrated, never reinterpreted, never erased**: the raw blob is preserved verbatim under a `worldhand.save.legacy.<ts>` key and the menu explains that a fresh run is needed because the engine rules changed. Quit never clears the save; "Clear Save" (and the game-over "Back to Menu") are destructive and both require an explicit confirmation. Rewards are applied once inside the engine commit, so auto-saving cannot double-apply them.

## Portable / offline release (play anywhere, no server)

```bash
npm run build:portable
```

Produces **one file**: `dist-portable/worldhand.html` (~0.8 MB) with the JS, CSS and
three.js all inlined — no assets directory, no network requests, no backend, no accounts,
no tracking. Copy it to a USB stick or any machine and **double-click it**; it runs from
`file://` in any modern browser. (The normal `npm run build` output is an ES-module bundle
that a browser refuses to load over `file://`, which is why the portable build emits a
single classic script instead.)

Saves work exactly as below — `localStorage` on the `file://` origin — so a run persists
across reloads on the same machine and browser.

**Moving a run between machines**: on the title screen, **Export Save to File** downloads
`worldhand-save-<date>.json`; **Import Save from File** loads it on the other machine and
resumes the run. The file never leaves the device on its own. An imported file goes through
the *same* version + structure gate as a normal load, and a file that fails the gate is
refused **without touching the save already on that device**.

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
npm run build:portable          # one self-contained offline HTML file (dist-portable/worldhand.html)
node scripts/qa-portable.mjs    # Playwright QA of that artifact over file://
```

Determinism: the same seed phrase produces the identical world, deal, and chronicle (tested).

No betting, no backend, no network calls. Pure TypeScript engine (`src/engine/`), React UI (`src/App.tsx` + `src/components/Planet3D.tsx`). The 3D world is **simulated presentationally only** — region state (stability, development, dormancy, adjacency) comes exclusively from the pure engine; the globe adds no mechanics.