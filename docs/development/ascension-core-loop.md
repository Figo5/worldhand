# Ascension core-loop correction (rules version 8)

This fixes the four structural issues in the [first-playable audit](ascension-audit.md) with the smallest rule changes that measurably work.

- **Evidence:**
  - the before/after audit ([raw output](experiments/ascension-core-loop/audit-1000.txt)): 1,000 seeds × 18 bots × rules v7 vs v8 × 6 ablations, plus 76,564 sampled decisions;
  - the design comparison ([raw output](experiments/ascension-core-loop/designs-300.txt)): 300 seeds × 9 designs.
- **v7 is reproduced exactly** in the harness: every v7 number matches the published v7 audit.
- **Bots are diagnostic.** They show structure, not fun.

## Rule changes

1. **Score builds Reserves.** Every 150 points scored in an era add 1 resilience to that era's crisis ("Reserves"). Only the current era's score counts.
2. **Crises are faced by choice.**
   - Meeting an era's requirements at a round end makes its crisis **ready**. Play continues, and the player faces it (`resolve`) whenever they choose.
   - Each round end it is kept waiting adds **+4 pressure** ("Time to gather").
   - After **2** round ends it **strikes on its own**: play stops until it is faced.
   - Surviving advances exactly one era. There is no hidden point of no return: the deadline and the cost are shown, and nothing else changes while it waits.
3. **The Invasion tests wealth against walls.**
   - The old universal "highest − lowest stat" strain is gone.
   - Pressure is 40, +2 per open region, **+ development ÷ 4** ("Riches to plunder") and **+ Prosperity above Industry** ("Undefended wealth").
   - Resilience is Industry, +5 per civilization, +3 per mountain and +10 for Empire Builders.
   - Industry always pays: +1 arms against at most +¼ riches.
4. **Medieval asks for development in any shape.** It now needs **200 development**, 3 stats at 40 and 3 civilizations, instead of all 4 stats at 50. A world may pour its development into one peak or spread it.
5. **The Plague base goes from 30 to 35,** so the Plague stays a real test once reserves exist.

Each crisis also has a one-line `watch` text ("tests X; hurt by Y"), shown to the player as "Crises ahead". Rules version goes from 7 to 8.

## Design alternatives tested (same 300 seeds, same bots)

Completion rates below are for balanced / patient / lean-I (Industry-focused), with the lean-I completed-world profile in parentheses.

| Design | Result | Verdict |
|---|---|---|
| v7 (before) | 65 / 65 / 93%; the Invasion is never a threat (margin +38) | the baseline |
| **v8 (chosen)** | **73 / 95 / 97%** (79/42/42/41); Invasion 89% for balanced play | chosen |
| v8 without reserves | 17 / 45 / 85% | score is load-bearing; without it naive play collapses |
| reserves at 1 per 100 | 89 / 97 / 99% | too strong: crises stop mattering |
| reserves from the whole run (1 per 200 or 300) | Winter harder, Invasion easier | rejected: the opposite of the goal (measured during development; that switch has since been removed) |
| automatic trigger (grace 0) | 73 / **73** / 95% | waiting is worth +22 points to a patient player; the ready state stays |
| pressure clock by era age instead of waiting | random play fell to 7%, focused players lost 5–8 points | rejected: it punishes slow focused builds (switch removed) |
| grace 1 / 3 rounds, or waiting cost 8 | within ±2% of the chosen setting | the least-surprising middle kept |
| Medieval: all 4 stats at 50 | 75 / 97 / 100%, but lean worlds end 62–66/51/51/50 | focus stays shallow |
| Medieval: 3 stats at 50 | 74 / 96 / 99%, lean worlds 61/51/50/49 | focus stays shallow |
| v8 with the v7 Invasion | 83 / 100 / 99%; broad Invasion margin +46 | the old Invasion is trivial again |
| Plague base 30 | Plague survival 99% for broad play | too mild |
| a universal "Mastery" factor (half the highest stat) | +25 for everyone; profiles unchanged | rejected: a flat buff |

**Not simulated, and why:**
- **Score as era currency (score needed to leave an era).** With no run clock, score always accumulates, so a score gate only delays.
- **A limited action economy.** That's a new system, which this phase excludes.

## Before/after audit (1,000 seeds)

| Strategy | v7 complete | v8 complete | v8 Winter/Plague/Invasion survival | v8 main failure |
|---|---|---|---|---|
| poker-max | 60% | 73% | 92/96/83 | Invasion: riches |
| score-max | 56% | 67% | 88/93/81 | Invasion: riches |
| balanced | 65% | 77% | 89/96/90 | Winter: cold land |
| civ-synergy | 53% | 62% | 85/91/80 | Invasion: riches |
| random | 56% | 48% | 80/90/67 | Invasion: riches |
| patient (waits when unsafe) | 65% | **95%** | 100/100/95 | Invasion |
| prepared | 98% | 96% | 100/100/97 | Invasion |
| resolute (steers one suit by the forecast) | 100% | 100% | 100/100/100 | — |
| planner (score + forecast) | 99% | 97% | 100/100/97 | Invasion |
| lean-V / P / I / K (forecast-aware, focused) | 97 / 95 / 95 / 95% | 95 / 96 / 97 / 96% | ≈100/100/96 | Invasion |
| naive focus bots, terrain | 0–9% | 0% | — | the crisis that tests what they neglect |

- **Focused vs balanced.** Completed focused worlds are now genuinely focused: the median spread (highest − lowest stat) is 28 / 12 / 38 / 28 for lean-V/P/I/K, against 9–12 in v7. Balanced worlds are at 2–7.
- **Score contribution** (full → no reserves):
  - poker-max 73 → 18%;
  - balanced 77 → 20%;
  - patient 95 → 48%;
  - prepared 96 → 74%;
  - lean-I 97 → 87%.

  In v7 the same comparison was flat (60 → 60%).
- **Best poker play vs best long-term play** (the crisis outlook after the play, reserves included): the poker-best play is also long-term-best in 23–31% of states (v7: 21–25%). The long-term play gives up a median 12–15 poker points. The tradeoff is now real, because those points buy resilience.
- **Crisis failure distribution** (share of all runs):

  | | Harsh Winter | Plague | Invasion |
  |---|---|---|---|
  | v7 | 26% | 10% | 6% |
  | v8 | 18% | 9% | 12% |

- **Waiting.** Of the crises that forecast-reading bots found *losing* when they became ready, v8 survives 57% (v7: 0%).
- **Impossible seeds: 0 of 1,000** in both v7 and v8.
  - An earlier v8 run showed 27 seeds that no bot completed. All had **no mountains**, so no passes and no Empire Builders, and all were lost at the Invasion.
  - All 27 are won by a readable strategy: in Medieval, while the Invasion forecast is short, play only clubs.
  - That strategy is now the documented `resolute` bot. These are worlds whose land demands an Industry-focused Medieval, not impossible worlds.
- **Rounds per era (median, completed runs):**
  - Tribal 3, Ancient 3–4, Medieval 3–6; 40–52 plays per run (v7: 3 / 3–4 / 4–5, 44 plays).
  - Random play: 5 / 6 / 6.
  - Focused Industry play: 3 / 3 / 6.

## Acceptance targets

| Target | Status |
|---|---|
| Score materially changes run outcomes | **Met.** Without reserves, completion falls 10–57 points (poker-max 73 → 18%, balanced 77 → 20%). |
| Several distinct strategy families complete runs | **Met:** balanced, score-driven and focused (V/P/I/K) all reach 95–97% with forecast reading. Naive play: 62–77%. |
| Focused strategies not near-0% | **Met for forecast-reading focused play (95–97%, spreads 28–38).** Naive single-suit bots stay 0%: they ignore the forecast and the checklist, and die at the crisis that tests what they neglect. |
| No single strategy dominates almost every seed | **Not met.** `resolute` completes 100% in v8, and did in v7 too. See remaining problems. |
| Winter is no longer the only serious crisis | **Met.** Invasion deaths are now 12% of runs vs Winter's 18% (v7: 6% vs 26%). |
| Invasion is not trivial for broad builds | **Met.** Balanced 90%, poker-max 83%, median margin +7 (v7: 100%, +38). |
| Crisis timing is readable and not a hidden trap | **Met:** ready state, stated cost and deadline, "faced now" and "faced after this play" previews. |
| No seed effectively impossible under reasonable play | **Met** (0 of 1,000). |

## Remaining structural problems

1. **Informed play is close to solved.** A player who reads the forecast and steers one suit at a time wins every seed (`resolute` 100%). The forecast is exact, and nothing limits time within an era except the 2 grace rounds. Difficulty for informed players will need scarcity, such as a per-era round budget or an action economy. That is a system decision for the next phase.
2. **Naive specialisation still dies.** This is by design: strain and the tested stats punish ignoring a crisis. But the naive and forecast-reading outcomes are very far apart (0% vs 96%), so the game is only as forgiving as its explanations are.
3. **Mountainless worlds (about 3%) demand one specific plan** (an Industry-focused Medieval). Forecast-reading completion is 77% on worlds with 0–2 cold regions against 97–100% elsewhere. Terrain matters, maybe too sharply.
4. **Poker, land and passives still rarely change the *immediate* best play.** The poker-best play is the score-best in 82% of states. Their stake is now through reserves, not play-by-play texture.
5. **Waiting is rarely needed by informed bots** (1% of crises), because they hold back before the checkpoint instead. It matters most for the patient style (65 → 95%).
