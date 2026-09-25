# Ascension release evidence (2026-09-24)

This report describes the six-era Ascension release branch. Earlier [first-playable](ascension-audit.md), [core-loop](ascension-core-loop.md), [scarcity](experiments/ascension-scarcity/) and [graded-crisis](experiments/ascension-graded/designs-1000.txt) experiments used different rules and are historical comparisons. The current engine and tests are the authority for this release.

## The chosen loop

Each era grants 7–10 hands and four discards. A play uses one hand, whether it contains one card or five. The player can face the fully forecast crisis early. Surviving with unused hands earns Influence and carries at most two hands into the next era. Waiting gives more score, stat growth and civilization development, while facing early buys more Council choices. Running out of hands forces the crisis. This bounds repair without hiding information or introducing random punishment.

The scarcity study compared fixed plays, action budgets, an era clock and score upkeep, plus card-spend budgets. Fixed hands and separate limited discards were the simplest rule that kept poker and focused builds viable. The later two-hand carry limit preserves a reason to face early without giving up most of the next era's development. Scoring cards alone grow their suits. Score becomes this era's Reserves, so a strong poker hand can survive a crisis even when its suits are imperfect; the suits, land, civilizations and strain still change the forecast.

The six eras each add a play rule and end in a seeded, visible crisis. A failure costs Resolve and leaves a specific scar, allowing a comeback; the final crisis must be endured. Between eras the Council uses earned Influence for cards, decrees, deck thinning and legendaries. The Chronicle records engine events. The run summary presents the final world, every crisis, people, legendaries, major events and replay actions. Ascension saves and profile history are separate from Classic.

## Content and formats

| System | Release set |
|---|---:|
| World cards | 36 |
| Decrees | 14 |
| Legendaries | 17 |
| Civilization archetypes | 8 |
| Era stages | 6 |
| Crisis variants | 13 |
| Stacking Omens | 8 |

Content has stable IDs, deterministic catalog order, a closed typed effect vocabulary and validation tests. World-card effects cover land, stats, civilizations, relations, Reserves, Influence, score, held cards and discards. Ascension's run save stores its setup and actions, validates by replay, and keeps incompatible blobs under legacy keys. The profile has its own schema, normalization and migration table. Classic saves use separate keys and their replay fixtures are unchanged.

A new profile begins with 26 world cards, 11 decrees, 11 legendaries and six peoples eligible for offers or emergence. Achievements unlock the rest horizontally; they do not increase base stats between runs.

## Baseline simulation

[Full output](experiments/ascension-release/audit-1000-full.txt): 1,000 fixed seeds (`audit-0` through `audit-999`) × 23 deterministic policies, 23,000 runs, under the full content pool. Policies include random, mediocre, poker-max, poker with discards, balanced, forecast-aware, terrain-aware, civilization-aware, four focused suits, paired-stat specializations, and early/late facing. The harness samples legal plays, applies the same pure engine as the UI and guards against nonterminating runs.

| Policy | Won | Median plays | What it tests |
|---|---:|---:|---|
| Random | 0% | 23 | Weak floor; cannot coast through crises |
| Mediocre | 56% | 51 | Balance heuristic, little Council use |
| Poker-max | 55% | 51 | Best immediate score, no discards |
| Poker-dig | 78% | 53 | Poker plus purposeful discards |
| Balanced | 74% | 51 | Raises trailing world stats, ignores forecast |
| Forecast planner | 83% | 49 | Reads crisis and next-era outlook |
| Planner, all hands | 87% | 51 | Full development instead of early facing |
| Terrain-aware | 85% | 49 | Specializes where land gives chips |
| Civilization-aware | 75% | 49 | Values people and their gifts |
| Focused Vitality / Prosperity / Industry / Knowledge | 89% / 55% / 63% / 86% | 49 each | Focus, with forecast repair |
| Naive Industry focus | 28% | 46 | Focus without accounting for strain |

No seed was lost by every tested policy (0/1,000). This is evidence against a common impossible seed, not a proof that every seed is always winnable. No tested policy won every seed, including the forecast readers. The strongest policies still lost 11–17% of runs, and losses occur in multiple eras. All 13 crisis variants appeared; Revolution had the highest pooled failure share (31% of times faced), while Invasion and Market Crash were 12% and 13%.

The size mix across all plays was **25% one card, 25% two, 3% three, 22% four and 25% five**. Five-card play does not dominate. The poker-only bot won 55%, and its discard-aware version 78%; score matters. Balanced, focused, terrain-aware and civilization-aware policies have different success rates and final stat spreads; world development matters too. An early-facing policy won 64% versus 87% for a planner that used all hands, so taking Influence early has a real development cost.

The legendary ownership comparison in the raw output is observational and confounded by policy and survival; it is not a causal lift estimate. The separate sampler study below is intended to compare random offers and choices more fairly.

### Starter collection and the difficult seed

[Starter-pool output](experiments/ascension-release/audit-1000-starter.txt) repeats the same 1,000 seeds and 23 policies with only the content available to a new profile. The starter pool is somewhat harder: planner-late won 86% instead of 87%, poker-dig 74% instead of 78%, balanced 71% instead of 74%, and mediocre 53% instead of 56%. Vitality focus won 90%, so it did not become mandatory after unlocks were removed; other focused and poker approaches still won many runs. Five-card hands were 24% of plays.

The 23 paired policies all lost `audit-553` with the starter collection. This was a policy-coverage warning, not evidence that the seed was impossible. The reproducible [single-seed probe](experiments/ascension-release/seed-probe-553.txt) crosses 15 legal play policies with 15 legal Council policies on that exact setup. **73 of 225 combinations won**, including poker-dig plays with the balanced Council and balanced plays with the poker Council. No rule or content change was needed. These audits do not mathematically prove every possible seed is winnable.

### Challenge ladder

The [Omen ladder study](experiments/ascension-release/omens-250.txt) repeats 250 matched seeds with five policies at each of the nine levels, using the full pool. Win rates fall with added constraints without reducing every style to zero:

| Omen | Planner, all hands | Vitality arc | Poker with discards | Balanced | Mediocre |
|---:|---:|---:|---:|---:|---:|
| 0 | 86% | 90% | 82% | 76% | 59% |
| 2 | 84% | 89% | 74% | 69% | 52% |
| 4 | 78% | 84% | 70% | 69% | 45% |
| 6 | 56% | 66% | 44% | 48% | 26% |
| 8 | 47% | 55% | 32% | 34% | 15% |

Some adjacent Omen levels have a small sampling reversal; the overall progression is strong. The highest levels are challenges rather than a 100%-solved path.

### System ablations

The [ablation study](experiments/ascension-release/ablations-200.txt) uses 200 matched seeds, six policies and the full content pool for each condition. It removes one system at a time; these are diagnostic engine changes, not player-facing rules. Selected win rates:

| Condition | Planner, all hands | Vitality arc | Poker with discards | Balanced | Mediocre |
|---|---:|---:|---:|---:|---:|
| Full game | 91% | 88% | 76% | 73% | 53% |
| No score-derived Reserves | 49% | 50% | 34% | 31% | 22% |
| No strain pressure | 99% | 99% | 93% | 84% | 70% |
| No land chip affinity | 87% | 84% | 81% | 62% | 46% |
| No civilization help in crises | 69% | 74% | 62% | 51% | 29% |
| No civilization passives | 88% | 82% | 71% | 66% | 47% |
| No era rules | 76% | 80% | 69% | 50% | 37% |
| No legendaries | 75% | 61% | 68% | 45% | 34% |
| No Council actions | 60% | 63% | 72% | 34% | 34% |

Reserves give poker score a direct survival role; without them, every tested style loses substantially more. Strain keeps forecast-aware repair from becoming nearly automatic. Land chips, civilization contributions, era rules, legendaries and the Council also affect outcomes. Removing world cards and decrees had a smaller aggregate effect (planner 91% → 88%, balanced 73% → 66%); those purchases add build choices but are less central than the underlying world systems. Removing terrain factors from crises alone had little aggregate effect because land still changes chips and development. Ablations change the policies' opportunity set, so these differences are directional evidence rather than isolated causal estimates for a single player's choice.

### Legendaries and origins

In a separate [1,000-seed comparison](experiments/ascension-release/legendary-lift-1000.txt), two policies chose randomly among offered legendaries. Both won 85% of runs. Among runs where each legendary was offered, taking a specific one versus taking another offered item ranged from about 9 percentage points worse to 4 points better; no item showed a large universal advantage. This comparison keeps the offer visible but still substitutes one item for another, and it is not a controlled estimate of owning versus owning nothing. The 38 seeds both sampler policies lost are not evidence of impossible seeds: the broad 23-policy audit had a win on every full-pool seed, and the samplers used a different seed set.

The [origin study](experiments/ascension-release/origins-200.txt) repeats 200 matched seeds with four policies. The planner won 90% on Pangaea, 82% on Archipelago, 85% on Highlands, 89% on Verdant and 84% on Frontier. The balanced policy ranged from 54% on Archipelago to 72% on Verdant. Land choice therefore changes the run's difficulty and the value of a strategy; Archipelago's weak early margins are visible in the raw output rather than concealed from the player.

## Browser and regression checks

The production build was played through the rendered UI with a forecast planner, a mediocre policy and a random policy. The scripts checked every displayed transition against a headless run with the same setup and actions. The planner won after 97 UI actions with zero state mismatches; the mediocre policy won after 65 with zero mismatches; the random policy lost to Revolution in the Industrial age after 53 actions with zero mismatches. The loss summary named the failed crisis, the shortfall, the strain factors and the people who fell. The scripts also checked mid-run reload, Council, Chronicle, history, encyclopedia, achievements, a refused bad backup, successful backup transfer, Classic mode entry and console/network errors.

At 390 × 844, a whole 89-action Ascension run reached the summary with no horizontal page overflow and no console errors. The mobile audit captured the Council and summary; the crisis table has an explicit sideways-scroll cue for margins and scars. The 480 × 800 portable-artifact browser test completed a Classic run, transferred its save to a second context, and started and resumed Ascension from the offline single-file build. The [desktop](../media/ascension-desktop.png) and [mobile](../media/ascension-mobile.png) gameplay captures are checked in. Further screenshots in `shots/ascension/` and `shots/portable-*.png` are local QA output.

Local checks at this revision: typecheck, 325 tests, production build and portable build passed. The test suite includes 40 frozen Classic replays and Ascension determinism, preview/commit, card conservation, content, crises, saves and profile checks. Browser QA uses Chromium; a manual Safari/Firefox pass has not been recorded.

## Release status

The public Netlify site was still serving an older Classic-only commit on 2026-09-24. Netlify's project dashboard reports that production deploys are paused because the team has exhausted billing-cycle credits; pull request previews have continued to build. The release branch can be reviewed and played from a deploy preview while that service limit remains. Production availability must be verified after Netlify resumes production deploys.
