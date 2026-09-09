# Worldhand — Rules

A single-player, deterministic planet-building card roguelike. No betting, no opponents:
cards are verbs that act on a living world.

## World

- **12 regions**, each with a terrain and **stability** (base **3**, max **10**). Four
  start awake; the rest are **dormant** until woken by a ♥ Queen-or-higher Bloom play.
- **Flourishing** 🌱 — the win resource. Starts at 3. Target: **12**.
- **Seeds** 🌰 — currency. Start with 8. Income each epoch end: +1 per living region,
  plus law bonuses.
- **8 epochs × 4 hands = 32 hands.** Each hand deals **8 cards** from a 52-card deck
  (reshuffled from discards when empty).

## Card suits = actions

Select a card in your hand, optionally click a target region (for ♠), then press **Play**:

| Suit | Action | Effect |
|------|--------|--------|
| ♠ | **Roots** | +`round(rank/4)` (min 1) stability to the targeted region. Requires a region target; +1 more with *Deep Taproots*. |
| ♥ | **Bloom** | +`round(rank/5)` (min 1) Flourishing; +1 more with *Canopy Choir*. Q, K, A also wake the first dormant region. |
| ♦ | **Sow** | +`round(rank/3)` (min 1) Seeds. |
| ♣ | **Tend** | +1 stability to every living region and +1 Flourishing. |

Each hand allows up to **3 Discards** (throw cards back to reshape the hand), and
**Advance** ends the hand — unplayed cards return to the discard pile and the next hand
is dealt (or the epoch closes after hand 4).

## Epoch end

1. **Challenge** (rolled for the coming epoch, shown in the HUD): e.g. "3+ regions at
   stability 5+", "7+ regions awakened", or "total stability of 18+". Met: **+2
   Flourishing**; missed: **−1**.
2. **Decay**: every living region loses `1 + law modifiers` stability. Reaching 0 does
   not kill instantly, but 5 dead regions = instant **Withering** loss.
3. **Market refresh**: 3 random cards at 4–8 Seeds each (−2 with *Barter Routes*).
   Bought cards join the world deck and reappear in later hands.
4. **Law draft**: enact one of two laws by paying Seeds, or Skip.

| Law | Cost | Effect |
|-----|------|--------|
| Mycorrhiza | 6 | decay −1 |
| Seed Vaults | 8 | +3 Seeds each epoch end |
| Barter Routes | 5 | market −2 Seeds |
| Canopy Choir | 10 | ♥ plays +1 Flourishing |
| Deep Taproots | 10 | ♠ plays +1 stability |
| Slow Ruin | 4 | decay +1, +5 Seeds each epoch end |

## Win / Loss

- **Flourishing World (win)**: Flourishing ≥ **12** at the end of epoch 8.
- **Withered (loss)**: short of 12 at epoch 8, Flourishing ≤ 0 at an epoch boundary,
  or 5 living regions at 0 stability.

## Determinism & saves

- All randomness from a seeded mulberry32 RNG (seed phrase → FNV-1a → per-epoch/hand salts).
- Same seed ⇒ same world, hands, market, challenges, law drafts — forever.
- Saves: `{version: 1, savedAt, state}` under `localStorage['worldhand.save']`,
  auto-saved after each action; newer/older versions are safely ignored/migratable.