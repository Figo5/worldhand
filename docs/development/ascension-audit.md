# Ascension first-playable audit (rules version 7)

This audit measures the current loop before any more content is added. The loop covers stats, terrain, civilizations, passives, eras, crises and completion.

- **Measurement:** 1,000 seeds × 11 documented bots × 6 rule sets.
- **Samples:** 37,317 sampled decisions, plus a UI review.
- **Raw output:** [experiments/ascension-audit/audit-1000.txt](experiments/ascension-audit/audit-1000.txt).
- **Reproduce with:** `node --import ./scripts/ts-resolve.mjs scripts/ascension-audit.mjs 1000` (about 3.5 minutes on 9 workers; the output is identical on every run).
- **Bots and ablations:** [scripts/lib/ascension-bots.mjs](../../scripts/lib/ascension-bots.mjs).

**Bots are diagnostic.** They show structure, not fun or human skill. No tuning was changed.

## Verdict

**The loop is complete, deterministic, explainable, and fair to a player who reads the forecast. Strategically it is still narrow.** Four structural issues should be decided before content is added:

1. **Score has no consequence.** Poker, the land bonus and passives only move a number.
   - Removing the land bonus or the passives leaves the completion rate unchanged.
   - A random legal policy completes 56% of runs; the best poker bot completes 60%.
2. **Only one strategy family completes: broad, balanced development.**
   - Every focused strategy completes 0–9% of runs.
   - 81% of completed runs end with all six civilizations.
3. **The Harsh Winter is the only real filter, and it bites through terrain at round 3.**
   - It kills 30–35% of naive runs.
   - The Plague is mild. The Invasion is trivial for any broad strategy: median survivor margin +38.
4. **The Winter has a lock-in trap.** Crisis entry is automatic, so once two stats reach 15 the Winter strikes. A cold-world player who spread development early cannot build Vitality past 14 without bringing it on immediately.

## Bots
- **poker-max:** the highest poker score. Ignores the world.
- **score-max:** the highest immediate total (poker + land + passives).
- **balanced:** 5 cards, always raising the lowest stat.
- **terrain:** focuses the stat its land favours most, plus whatever the era checklist asks for.
- **prepared:** balanced, but reads the round-end crisis forecast. It builds what the forecast lacks and holds back the checkpoint until the forecast is safe.
- **civ-synergy:** maximises passive bonuses once civilizations exist.
- **focus-V / P / I / K:** focus one stat, plus whatever the checklist asks for.
- **random:** seeded random legal actions (the weak baseline).

## 1. Strategy comparison (full rules)

| Strategy | Complete | Winter | Plague | Invasion | Rounds p10/med/p90 | V/P/I/K at completion | Main failure |
|---|---|---|---|---|---|---|---|
| prepared | **97.6%** | 98% | 100% | 100% | 10/11/11 | 54/54/54/54 | cold land (1.6%) |
| balanced | 64.9% | 70% | 93% | 100% | 10/11/11 | 54/54/54/54 | cold land (30%) |
| poker-max | 59.9% | 66% | 91% | 100% | 11/11/12 | 56/55/55/55 | cold land (34%) |
| score-max | 56.4% | 65% | 88% | 100% | 11/11/12 | 55/55/56/56 | cold land (35%) |
| random | 55.7% | 65% | 87% | 99% | 17/19/20 | 56/55/54/55 | cold land (35%) |
| civ-synergy | 52.6% | 65% | 83% | 97% | 11/12/14 | 54/57/65/65 | cold land (34%) |
| focus-K | 8.7% | 97% | 100% | 9% | 17/18/19 | 98/82/53/98 | lopsided realm (88%) |
| terrain | 0.4% | 51% | 36% | 2% | 17 | 95/83/55/95 | cleared forests → trade outruns medicine → lopsided realm |
| focus-V | 0% | 98% | 0% | — | — | — | trade outruns medicine (98%) |
| focus-P, focus-I | 0% | 0% | — | — | — | — | cleared forests (98%) |

- **Completers look alike.** Every completing strategy ends with near-equal stats (about 54 each), 6 civilizations, and all six archetypes in 81% of completions.
- **Specialisation dies at the crisis that tests what it neglected.** Industry or Prosperity leads die in the Winter. Vitality leads die in the Plague. Knowledge leads die in the Invasion's lopsided-realm strain.

## 2. Subsystem ablations: completion rate

| Strategy | full | no terrain bonus | no passives | no strain | no civilizations in crises | no crises |
|---|---|---|---|---|---|---|
| poker-max | 59.9 | 59.9 | 59.9 | 69.5 | **13.2** | 100 |
| score-max | 56.4 | 59.4 | 55.7 | 65.6 | **12.8** | 100 |
| balanced | 64.9 | 64.9 | 64.9 | 68.3 | **20.0** | 100 |
| prepared | 97.6 | 97.6 | 97.6 | 98.6 | **21.2** | (bot artifact) |
| civ-synergy | 52.6 | 56.2 | 59.6 | 67.1 | 12.0 | 100 |
| focus-K | 8.7 | 8.7 | 8.7 | **96.8** | 0 | 100 |
| random | 55.7 | 56.2 | 56.9 | 66.8 | 8.9 | 100 |

**What each layer contributes:**
- **Terrain bonus and passives: score only.** Without them the median final score drops 12–18% (poker-max 5046 → 4393 / 4357), but completion is unchanged. Chasing them (score-max, civ-synergy) slightly *lowers* completion.
- **Civilizations in crises carry the crises.** They are the single largest input: removing them drops competent completion from about 60% to 13–21%. "Allied civilizations" (+5 each, usually +30) alone decides most Invasions.
- **Strain is what makes specialisation lethal.** Without it focus-K completes 97% instead of 9%; broad strategies gain only 3–10 points.
- **Terrain still matters through crises and homes, even with no land bonus.** Pooled completion falls from 82% on worlds with 0–2 cold regions to 22% on 9–12. A world with no forest (so no Nature Keepers) completes 42%, against 67% for the rest. A world with no desert or tundra (so no Scholars) completes 41%.
- **Prepared "no crises" is 0% because of the bot:** its forecast margin is always 0, so it holds the checkpoint forever.

## 3. Structural flags
- **One strategy clearly dominates:** yes, broad balanced development. This is structural. Medieval needs all four stats at 50, and the three strains punish every lopsided profile.
- **A stat is consistently mandatory:** Vitality, somewhat. It is Winter's resilience and half of Plague's, and both Winter civilizations are Vitality archetypes. At the Winter, survival is 98% with Nature Keepers present versus 60% without, and 94% versus 55% for Nomads (partly causal at +8 each, partly a Vitality-first confound).
- **A civilization is disproportionately valuable:** not one archetype, but civilization *count* is. At the Invasion, "Allied civilizations" is worth about +30, the largest single factor.
- **Terrain distribution:** cold land (tundra + mountains) is the dominant disadvantage for naive play: balanced completes 89% at 0–2 cold regions but 20% at 7–8. Prepared play stays at 89% even at 7–8, so the danger is visible and answerable.
- **A crisis forces the same build:** the Winter forces "Vitality ≥ Industry" (strain 0 in 77% of survivors). The Plague forces "Knowledge ≥ Prosperity" (72%). The Invasion forces balance.

## 4. Decision value (37,317 sampled play states)

| States from | Poker-best = score-best | Terrain changes the best play | Passives change it (with civs) | Crisis-best ≠ score-best (at risk) | Score cost of crisis-best (median) | Era-progress-best ≠ score-best |
|---|---|---|---|---|---|---|
| balanced | 82.4% | 7.9% | 16.2% | 80.3% | 21 | 47.2% |
| score-max | 82.3% | 7.2% | 15.2% | 79.6% | 25 | 52.7% |
| prepared | 82.9% | 7.7% | 14.6% | 68.0% | 21 | 39.1% |
| random | 81.8% | 8.0% | 16.7% | 79.5% | 26 | 53.5% |

- **World layers rarely change the best-scoring play.** The immediately best play is usually just the best poker hand: land changes it in about 8% of states, passives in about 16%.
- **Immediate score conflicts with the world often:** with crisis preparation in about 70–80% of states, and with era progress in about 40–50%. The crisis-best play costs a median 21–26 points.
- **But the conflict is not a real tradeoff.** Score has no stakes, so the correct choice is always the world-building one.
- **The score-best play always uses 5 cards (100% of states).** Kickers always add chips, so "fewer, stronger cards" is never a choice.

## 5. Crisis fairness
- **Impossible worlds: none found.** 4 of 1,000 seeds (329, 393, 874, 918) defeat every bot. All four are completed by a Vitality-first opening (grow only Vitality until the Winter forecast is safe), with Winter margins of +11 to +16.
- **Near-impossible: the Winter lock-in trap.** In cold worlds without Nature Keepers or Nomads, any non-Vitality stat reaching 15 early means Vitality cannot pass 14 without bringing the Winter on. The forecast warns ("would fail by N") from round 1, but the lock is not explained. It accounts for 16 of prepared's 17 failures (winter, cold land, margins −1 to −12) and its 7 runs stuck at the cap.
- **Trivial crisis:** the Invasion, for any broad strategy. 97–100% survival, and survivors' median margin is +38 (p10 +27). It only punishes specialisation. The Plague is mild (87–93%).
- **Unanticipatable punishment:**
  - The Merchants emerging at the Plague's own round end turned survival into failure in 0.3% of Plagues.
  - The round-end emergence changed the Winter's outcome in 7% (always in the player's favour).
  - Before this audit the UI showed neither.
- **Misleading forecast (fixed):**
  - Before: the forecast shown before the triggering play disagreed with the outcome in **13.0%** of Winters, 4.4% of Plagues and 0.2% of Invasions. It ignored both the play itself and the round-end emergence.
  - After: the forecast now projects the round end, and the play preview shows the crisis after that play. The triggering play's preview disagrees with the outcome in **0.0%**, verified by a test and in the browser.

## 6. Pacing (completed runs)
- **Rounds per era:**
  - Broad strategies: Tribal 3, Ancient 3–4, Medieval 4–5; about 11 rounds and 44 plays per run.
  - Focused strategies that survive: 2 / 5 / 10 rounds.
  - Random: 5 / 6 / 8 rounds.
- **Civilizations at the Winter / Plague / Invasion:** 2 / 5 / 6. The sixth usually emerges early in Medieval, and after that nothing new appears.
- **Dead time:** little. The longest stretch without an emergence or crisis is a median 1–2 rounds (p90 3).
- **Repetition and spikes:**
  - Early game: the first spike is at round 3 (the Winter), which ends a third of naive runs.
  - Late game: Medieval is 4–5 rounds of topping up four stats to 50, with at most one new civilization. This is the most repetitive stretch.
- **Eras are short but not empty.** Tribal (3 rounds, about 12 plays) is the shortest and the most decisive.

## 7. Explainability
Reviewed as a player in the dev prototype.

**Fixed in this audit** (the engine knew the reason; the UI hid it):
- **Forecast after the play:** the preview did not say what the selected play does to the coming crisis. It now shows "If the round ended after this play: [civilization] would emerge; [era]'s requirements are met, so the [crisis] strikes — resilience R vs pressure P, would survive or fail by N".
- **Round-end emergence:** the forecast ignored the civilization that would emerge at the round end. It now projects it, and the civilization panel says which one would emerge, where, and why.
- **Land bonus:** it was a lump sum. It is now itemised as "2 Vitality × 1 + 1 Prosperity × 2 + …".

**Open (usability, not fixed):**
- **The lock-in trap is not stated.** Nothing says "once these requirements are met the crisis strikes at the round end — you cannot delay it".
- **The score is shown most prominently,** although it does not affect the outcome. Players will chase it.
- **Page length:** the forecast table sits a screen above the hand, so comparing plays against it needs scrolling.
- **"Nature Keepers 0 (no Nature Keepers)"** does not say whether they are impossible on this land (no forest) or just not yet emerged.

**Already clear:**
- the play score (chips × mult, per-suit stat gains, each passive with its numbers);
- why a civilization emerged (stat ≥ threshold, region fit);
- why an era did or did not advance (have / need per requirement, and the named missing stats);
- why a crisis survived or failed (every factor, including those that do not apply, and the history).

## 8. Balance changes
**None.** No tuning finding met the bar:
- The dominant issues (1–4 in the verdict) are structural. Tuning a number would hide them rather than fix them.
- Raising the Invasion's base would make it non-trivial, but the previous PR measured that a base of 60 makes about 0.9% of worlds impossible.

The one change is to explainability: the round-end projection, measured above (13.0% → 0.0% preview mismatch at the Winter).

## 9. Human playtest script
**Setup:**
- Dev build: `npm run dev` → "Try the Ascension prototype".
- Three runs per tester: seed `crisis-0`, seed `crisis-11`, and one random seed.
- Think aloud. Note the round whenever something surprises you.

**Per run:**
1. **Before your first play:** read the world. Which stats does your land favour? What will the Harsh Winter test? What would you do first?
2. **After three plays:** what did your last play change (score, stats, civilization bonus)? Could you have predicted it?
3. **When a civilization emerges:** why this one, here? Did it change what you play?
4. **Before each round end:** will this round end bring the crisis? Will you survive it? Write your guess, then compare.
5. **At each crisis:** before pressing "Face the crisis", say what will decide it. Afterwards: did the result match?
6. **If the run ended:** what would you do differently from round 1?

**After three runs, answer 1–5 (1 = no, 5 = clearly yes) and say why:**
- Did I understand what my cards changed?
- Did terrain affect my strategy?
- Did civilizations change my strategy?
- Did I understand what I needed to advance?
- Could I prepare for crises?
- Did losses feel explainable?
- Did different runs feel meaningfully different?
- Did I discover any interesting combinations?
- Did the score matter to me? Did I chase it?
- Did any stretch feel repetitive? Which era?

**Observer notes:**
- Did the tester scroll to the forecast before round-ending plays?
- Did they fall into the Winter lock-in on `crisis-11`, or on a cold world?
- Did they notice the "if the round ended after this play" line?

## 10. Blockers before adding content
1. **Give score (poker, land, passives) a stake in the outcome, or remove its prominence.** Today card strength is irrelevant to winning.
2. **Decide whether specialised strategies should be viable.** If yes, the Medieval all-four requirement and the three strains need rethinking together; the ablation shows strain alone flips focus-K from 9% to 97%.
3. **Resolve the Winter lock-in:** make it explicit in the UI, or make crisis entry the player's choice once the requirements are met.
4. **Make the Invasion test something a broad world can fail,** without reintroducing impossible worlds.
5. **Give the Medieval era content or shorten it.** Its last civilization emerges early, and the rest is topping up stats.
6. **Run the human playtest above.** None of this measures fun.
