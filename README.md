# Worldhand

A deterministic seeded planet-building card roguelike with a poker-scored engine — played in the browser, no backend.

## The core loop (v2 three-epoch slice)

- **12 regions** on an SVG planet disc; 4 awake at start, the rest woken by Bloom plays (Q+ hearts), expansions, and decay pressure.
- Each epoch you get **4 plays** and **3 discards** from an **8-card hand** dealt from a 52-card deck.
- **Play = select 1–5 cards.** The exact selection is scored as a poker hand (full 5-card categories; 1–4-card selections score high/pair/two-pair/trips/quads only).
- The **majority suit** of the selection decides which action fires; on a tie you choose the suit in the preview. The **Ace is low** (A-2-3-4-5 wheel).
- **Discard 1–5 cards** at once; the hand refills to 8 from the deck. Card conservation (hand + deck + discard = 52) is a tested invariant.
- A deterministic **ResolutionPlan** is built by one shared pipeline: the UI *preview* and the engine *commit* both call the same `buildPlan`, so what you see is exactly what happens.

## Suits

| Suit | Action |
|---|---|
| ♠ Roots | Stability to a living region (magnitude scales with rank sum; weakest region by default). **Adjacency**: living neighbors of the target gain half the amount ("roots spread"). **Development**: +1 development to the target; every 3 development grants +1 stability on future Roots plays there. |
| ♥ Bloom | +Flourishing; any Q+ card in a Bloom play wakes a dormant region |
| ♦ Sow | +Seeds |
| ♣ Tend | +1 stability to *every* living region |

## Epochs, targets, challenge

- **3 epochs**, escalating targets: (Flourishing 5 / stability 14) → (8 / 22) → (12 / 30).
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
node scripts/qa.mjs  # Playwright browser checks at 1280x800 and 420px
npm run build
```

Determinism: the same seed phrase produces the identical world, deal, and chronicle (tested).

No betting, no backend, no network calls. Pure TypeScript engine (`src/engine/`), React UI (`src/App.tsx`).