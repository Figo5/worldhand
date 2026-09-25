# Development and research evidence

- [Independent review and dated addenda](independent-review.md)
- [Historical playtest handoff](playtest-handoff.md)
- [Interface design brief](design-brief.md)
- [Rejected non-match-penalty experiment](experiments/non-match-penalty-d02b14c/)
- [Ascension first-playable audit (rules v7)](ascension-audit.md) and its [raw output](experiments/ascension-audit/audit-1000.txt)
- [Ascension core-loop correction (rules v8)](ascension-core-loop.md): before/after [audit](experiments/ascension-core-loop/audit-1000.txt) and [design comparison](experiments/ascension-core-loop/designs-300.txt)
- Ascension scarcity studies on the v8/v9 loop: [budget candidates](experiments/ascension-scarcity/) and [graded outcomes](experiments/ascension-graded/designs-1000.txt)
- **[Ascension release (rules v10): design and balance evidence](ascension-release.md)**, with its [1,000-seed audit, Omen ladder, ablations, legendary lift and origins](experiments/ascension-release/)
- [Repository analysis and modernization (2026-09-24)](modernization-2026-09-24.md): tooling changes and open findings

These documents span earlier rulesets. Their measurements, counts, paths and
verdicts describe the revision named in each report, not necessarily current main.
The rejected experiment is preserved as evidence, not as runnable current code.

Dozens of obsolete QA captures were removed from the current tree after visual
review. The current [gameplay image](../media/gameplay.png) is the intentional
presentation visual. All original images remain available without rewriting history:

- [shots](https://github.com/Figo5/worldhand/tree/51b7de534f792193577c56881ec4bbd1a44b136c/shots)
- [shots-review](https://github.com/Figo5/worldhand/tree/51b7de534f792193577c56881ec4bbd1a44b136c/shots-review)
- [qa-current.png](https://github.com/Figo5/worldhand/tree/51b7de534f792193577c56881ec4bbd1a44b136c/qa-current.png)
- [qa-home.png](https://github.com/Figo5/worldhand/tree/51b7de534f792193577c56881ec4bbd1a44b136c/qa-home.png)
- [qa-play.png](https://github.com/Figo5/worldhand/tree/51b7de534f792193577c56881ec4bbd1a44b136c/qa-play.png)
- [qa-run.png](https://github.com/Figo5/worldhand/tree/51b7de534f792193577c56881ec4bbd1a44b136c/qa-run.png)

## Verification scripts

Run from the repository root. Browser checks use Playwright (a dev dependency);
install its Chromium runtime with `npx playwright install chromium` if needed.
Generated QA folders are ignored.

Current (CI runs the typecheck, the tests, both builds and both browser QA scripts on every push):

```sh
npm run typecheck           # app and tests
npm test                    # unit/contract tests + Classic replay fixtures + Ascension engine/saves
npm run build
npm run build:portable
node scripts/qa-portable.mjs                                        # the file:// artifact: Classic in full, Ascension offline
node --import ./scripts/ts-resolve.mjs scripts/qa-ascension.mjs     # Ascension: whole runs through the UI, screens checked against the engine
node --import ./scripts/ts-resolve.mjs scripts/ascension-sim.mjs 500 all '{"omen":0}'   # Ascension bots: completion, crises, pacing, content
./scripts/ascension-audit.sh                                        # long-running release audit; keeps completed studies on rerun
npx vite --port 5177 --host 127.0.0.1 & node scripts/qa.mjs         # Classic dev-server layout check
node --import ./scripts/ts-resolve.mjs scripts/difficulty-measure.mjs   # Classic balance harness
```

`qa-ascension.mjs` takes a base URL (for example a Netlify deploy preview) and
a comma-separated list of bot personas; `QA_MOBILE_FULL=1` also plays a whole
run on a phone viewport, and `QA_ONLY_MOBILE=1` limits a rerun to the mobile
checks. `ascension-sim.mjs` options: `omen`, `pool`
(`full`/`starter`), `origin`, `ablation`, `patch` (set any engine table value
by path, harness-only), `seedTexts` (an explicit seed list) and `json`.

The Ascension prototype harness (`ascension-audit.mjs`, `ascension-designs.mjs`,
`lib/ascension-bots.mjs`) and `qa-ascension-dev.mjs` measured rules v7–v9 and
were retired with the v10 engine; they remain in history at
[`c150890`](https://github.com/Figo5/worldhand/tree/c150890/scripts).

**Classic replay fixtures.** `tests/fixtures/classic-replays.json` holds 40
recorded runs (4 frozen policies x 10 seeds) and `tests/classic-replays.test.ts`
replays them, requiring the same state hash at every epoch boundary. Re-record
with `node --import ./scripts/ts-resolve.mjs scripts/record-classic-replays.mjs`
**only** for a deliberate rules change (with a `SAVE_VERSION` bump), never to
make a failing replay pass.

**Retired scripts.** These failed on the current rules and were removed. The
last versions remain in history at
[`bb68a8f`](https://github.com/Figo5/worldhand/tree/bb68a8f5e9faf256605c3d2ef9a001c7abbfa4b7/scripts),
and the dated reports that cite them describe the rulesets they were written for.

| Script | Why it failed | Replaced by |
|---|---|---|
| `verify.mjs` | Drove the pre-v3 suit-action UI (`.pcard-btn` title selectors no longer exist) | `qa.mjs`, `qa-portable.mjs` |
| `balance-sweep.mjs` | Imported `EPOCH_TARGETS`, removed with the fixed three-epoch targets | `difficulty-measure.mjs`, `target-sweep.mjs` |
| `review-independent.mjs` | v3/v4 review probe; asserts state version 4 | Save/lives/growth tests in `tests/` |
| `review-independent-v5.mjs` | v5 review probe; asserts uncapped Seeds, which v8 caps | `tests/economy-bounds.test.ts`, `tests/fix-regressions.test.ts` |

Other retained `review-*`, `*-shots`, `*-reg` and playtest scripts are dated
evidence for earlier reports. The engine-only ones (`solve.mjs`,
`bankrate-probe.mjs`, `flip-rate.mjs`, `review-probe.mjs`) still run. The
browser ones need a dev server on `127.0.0.1:5177` and have not been re-verified
against v8. Consult their source and the dated reports before interpreting
their results.
