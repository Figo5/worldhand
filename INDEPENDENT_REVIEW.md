# Worldhand — Independent Review (v3, post-playtest-fix round)

**Reviewer:** Independent subagent (Hermes), delegated-child session. Routing metadata per required delegation override: **provider `ollama-cloud`, model `glm-5.3-flash`** (session-configured route; not the coordinator model `deepseek-v4-flash:0731`, no recursive delegation). All claims below cite tool outputs produced in this session.
**Date:** 2026-09-09 (13:00–13:40 EDT) · **Repo:** `/Users/giofiore/Documents/Codex/worldhand` · **HEAD at review start and end: `43c803f`** ("qa: refresh screenshots after target calibration"). Working tree had no source changes at review start (only screenshot PNG churn); the implementation worker's edits are already committed in the tree at `6f49ca8`, `8c1d73e`, `43c803f`. File mtimes show the last source edits landed ~34–49 min before my review began — the implementation worker had stabilized.
**Scope:** full test/build/QA battery, engine/UI/save/solver inspection, new independent Playwright probes for the save-rejection and lives-reach-zero paths. No engine/test/docs files modified by me; no tests weakened; no requirements rewritten. Two new review scripts added (§ 7). One long-standing pre-existing dev server was briefly killed and restarted unchanged (same `npm run dev` command, port 5177) — no state modified.

---

## 0. Verdict up front

**The engine lives/scoring/solver-targets contract is solid and verified. Two of the four assigned issues are fixed in the engine but their SAVE-side and SOLVER-side counterparts are NOT fully fixed in the current tree**, and the implementation worker's most recent commits (calibration) postdate the save-policy files by many commits, so I judged the worker done with save.ts/solve.mjs and documented precisely (no fixes applied — see § 5 for the decision).

| # | Issue | Status | One-line summary |
|---|---|---|---|
| 1 | Save/LOAD versioning + structural validation | **PARTIAL** | SAVE_VERSION=2 exists and legacy v1 is preserved-and-rejected, but there is **no structural validation** (missing lives / obsolete item ids / invalid phase / malformed cards load as a broken playable game), no UI message about a fresh run, and **Clear Save has no confirmation**. |
| 2 | solve.mjs policy | **FAIL (stale)** | score() **still contains drought/stability-era logic**; the documented policy text no longer matches the shipped targets (12-era comments); purchase policy is undocumented. |
| 3 | Lives contract | **PASS** | 3 lives, miss→−1, 0→withered, consistent across HUD/RULES/tests/engine. |
| 4 | Scoring communication | **PASS (with one doc gap)** | chips × mult is honest single-application; kickers-in-sum true but **undocumented**; base=sum×mult asserted in tests + independently re-verified. |

Corrected bounded-solver win rate (measured this session): **LOOK=30 → 16/30 (53%)** on shipped [45,110,360].

---

## 1. Verification battery (all run by me on this tree, this session)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **clean, exit 0** |
| Unit tests | `npx vitest run` | **70/70 passed** (2 files: poker + worldhand) |
| Build | `npm run build` | **green** (dist/assets/index-BXni0gEu.js 762 kB / gzip 205 kB; >500 kB chunk warning only) |
| Playwright QA | `node scripts/qa.mjs` | **ALL PLAYWRIGHT CHECKS PASSED at 1280×800 and 480×800**, zero console/page errors (script fails on any error; `errors.length` gate confirmed by reading qa.mjs:74) |
| 3D planet | `node scripts/review-planet3d.mjs` | **PLANET3D CHECKS PASSED**, 0 pageerror/console-error lines at both viewports |
| Engine probes | `npx vite-node scripts/review-probe.mjs` | all assertions true; conservation 52 cards, 0 violations across 12 plays + 9 discards + 4 buys; `lives-zero-ends-withered: true`; `autoseeds-formula-10-growth: true` |
| Full-run UI | `node scripts/review-fullrun.mjs` | 3 epochs traversed to verdict, `errors: []` (known benign probe quirk: `data-testid="epoch-end"` phase shows "unknown" in the probe; Close/Continue fallback handles it, documented in PLAYTEST_HANDOFF) |
| Preview==commit | `node scripts/review-pvcommit.mjs` | `MATCH: true`, `category-match: true` |
| Two-viewport | `node scripts/review-browser.mjs` | both viewports pass, `errors: []`, quit-preserves-save `3421→3421 bytes` |
| Autosave | `node scripts/review-autosave.mjs` | PASSED (post-start/post-play/post-discard saves; quit preserves) |
| No-Drought | `node scripts/drought-legibility.mjs` | `NO-DROUGHT ASSERTION: PASSED` (3 seeds) |
| No-emoji | `python3 scripts/check-no-emoji.py` | PASSED |
| Dev server | `npm run dev` (port 5177) | HTTP 200 throughout browser checks |

## 2. Issue 1 — SAVE/LOAD versioning + structural validation: **PARTIAL**

**What IS fixed (verified in code + browser):**

- **SAVE_VERSION distinguishes the new engine.** `src/engine/worldhand.ts:31` → `SAVE_VERSION = 2`; fresh states are stamped `version: 2` (setupWorld). Envelope `{version, savedAt, state}` in `src/ui/save.ts`; `CURRENT_VERSION` re-exported. A same-version envelope round-trips (test `v2 state round-trips through JSON`).
- **Old-version saves are rejected AND preserved as recoverable legacy data.** `loadGame()` returns null for `env.version > CURRENT_VERSION` (forward-only) and for version < 2 via `migrate()` → `null` (save.ts:36–41: "v1 (old 8-epoch contract) is incompatible… discard stale v1 saves rather than guess a migration" — the *load* discards, not the storage). My browser probe wrote a v1 envelope (lives:2, Roots-era shape), reloaded: the intro menu stayed (no silent resurrection), and the raw localStorage envelope was **byte-preserved** (`env.version===1 && env.state.lives===2` still readable afterwards). "Load Saved World" on a legacy save returns the menu with error "No saved world found." — non-destructive.
- **Quit preserves progress.** `Quit` button (`src/App.tsx:135–141`) only `setState(null)`, never touches localStorage — my probe confirmed the save string is byte-identical before/after Quit; reload auto-loads via the mount `loadGame()` effect and the auto-save `useEffect` (App.tsx:61–63) persists every committed action.
- **Tests:** 70/70 green; lives serialization + envelope shape covered (`lives are serialized in the save envelope`, `v2 state round-trips through JSON`).

**What is NOT fixed (browser-verified, with the probe script kept at `scripts/review-save-lives-browser.mjs`):**

1. **No structural validation of the v2 state.** `loadGame()` checks only the envelope version; a version-2 envelope containing *any* garbage state loads verbatim (`return env.state`). Probe outcomes at 1280×800:
   - **missing lives** → game loads; HUD renders a literal empty value: `Lives /3` (broken UI, no error).
   - **invalid phase** (`phase:'epoch-99'`) → loads; the App falls to the select-branch rendering an empty game.
   - **obsolete market/law item id** (`laws:[{id:'deep-taproots'}]`, Roots/Tend/Sow/Grow/Study-era) → loads as a playable game; the chip renders with an empty label; a later plan would treat it as a law contributing 0 (silent reinterpretation).
   - **malformed card** (`hand:[{r:1,s:'Z'}]`) → `loadGame()` itself returns the state (no card validation), and **a pageerror `TypeError: Cannot read properties of undefined (reading 'split')` is thrown during render** (cardName reads `.split` on an undefined rank name); the game then renders as playable. The engine also accepts such cards at play time: `buildPlan([{r:1,s:'Z'}],[0],[])` → `valid:true, growth:1`; rank 1 → Growth 1; suit 'X' → Growth 5. There is no rank∈[2,14]/suit∈{S,H,D,C} guard anywhere in the load or scoring path.
   - **forward version** (`state.version:99` in a v2 envelope) → loads as playable (the envelope version is checked, the inner state version never is).
2. **No UI explanation that a fresh run is needed.** On a legacy/corrupt save the menu shows only the standard copy; nothing says the save was stale/incompatible or that a fresh run is needed (grep for fresh/stale/incompatible in src: only code comments in save.ts). The data being preserved does mitigate this (user can hand-recover), but the assigned UX requirement is unmet.
3. **Destructive reset has NO confirmation.** `Clear Save` calls `clearSave()` directly (App.tsx:109): my probe listened for a dialog — `clear-save guard observed: none`, and the save is destroyed immediately. Similarly, the game-over screen's **"Back to Menu" clears the save with no confirmation** (verified: localStorage emptied, no dialog). The assigned requirement "destructive reset requires confirmation" is unmet.

## 3. Issue 2 — solve.mjs policy: **FAIL (stale drought-era code + undocumented policy)**

`scripts/solve.mjs` (last touched in `6f49ca8`'s era; commit for it: `6f49ca8`, earlier than the calibration commits) still contains, verbatim (lines 77–91):

```js
// Only two things decide the ending: final Flourishing >= 12, and the epoch-3
// drought (every living region at stability 3+). Score for exactly those.
const droughtRisk = after.epoch === 3 ? living(after).filter((r) => r.stability < 4).length : 0
const wakePenalty = after.epoch === 3 ? -60 * woke : 0.5 * woke
if (after.epoch === 3) {
  // Flourishing 12 is already banked long before here; epoch 3 is the drought.
  const shortfall = living(after).reduce((n, r) => n + Math.max(0, 3 - r.stability), 0)
  return -shortfall * 100 + wakePenalty - droughtRisk * 5 + df * 2 + stab * 1.5
}
return df * 10 + stab * 1.2 + ds * 0.4 + wakePenalty - droughtRisk * 2
```

- **Stale drought/stability-era logic: CONFIRMED.** The Drought and stability-driven loss were removed in `6f49ca8`; the current loss rule is lives-only (worldhand.ts:534–545, 578–595). The solver still (a) penalizes stability <4 at epoch 3 (`droughtRisk`), (b) penalizes a stability shortfall ×100 (`shortfall`), (c) treats waking a region in epoch 3 as a liability (−60/region) — none of which decides any outcome in the current engine, and (d) comments a target of 12 (the ladder is 45/110/360). The engine-level parts (`df`, `ds` on Growth/Seeds) are current-mechanics, so the probe still functions, but the score() is not "only the current mechanics" as assigned: it is a mix, and its stale terms distort the policy (e.g. it avoids expansions in epoch 3 for a drought reason that no longer exists).
- **candidateSubsets spans 1–5-card candidates: PASS.** `subsets(n)` enumerates every 1..5-card selection (mask loop, `s.length <= 5`), so with LOOK unset/exhaustive the search spans all poker-category candidates (pairs, flushes, straights, 3/4/5-card). Under a LOOK cap the space is truncated deterministically (shorts first + seeded sample) — bounded by design, not limited to 1–2 card combos by policy (LOOK=30 found flushes/straights in runs; exhaustive LOOK≥218 covers everything).
- **Discard policy: present and sensible** (playSeed lines 118–125): spends a discard when the best candidate's value is weak (`b.v < 6`) and dumps the cards the best play didn't want (up to 5). It works, though `v < 6` is a magic number with no doc comment.
- **Purchase policy: present but UNDOCUMENTED** (lines 127–139): fixed priority order canopy-choir → seed-vaults → barter-routes → mycorrhiza → open-canals → stone-masonry, greedy until funds/slots run out, `endMarket` after. No comment states the rationale (cheapest flat Growth per Seed first), no handling of card-additions/expansions (never bought), and LAW_SLOTS/removal is never exercised (buys just fail via throw-catch at the 5-slot cap).
- **Calibration seeds separate from evaluation seeds: NOT IMPLEMENTED.** The script has a single seed list (`probe-0..29`) used both as the calibration target sweep and the evaluation run; there is no seed split (e.g. calib-* vs eval-*), no separate flag, nothing in the code or docs.
- **"Human win-rate estimate" labeling: ABSENT in solve.mjs (PASS), but a variant exists in docs.** grep for "human win-rate"/"human win" across src/scripts/tests/docs: only `RULES.md:70` "**LOOK=30 is the bounded-human reference**". That is a policy-strength label ("bounded human-like reference"), not a win-rate estimate claim, and README:81 + PLAYTEST_HANDOFF:82 correctly say "bounded balance probe (win rate over 30 seeds)" / "bounded win rate". Strictly: nothing is labeled a "human win-rate estimate"; the label asked for ("bounded solver result") appears nowhere verbatim, though "bounded balance probe" and "bounded-human reference" carry the same meaning. I flag RULES.md's "bounded-human reference" as the one borderline phrase; a doc tweak to "bounded-solver reference" would fully align it.

**Corrected bounded-solver win rate (measured by me this session, current tree):**

| Policy | Wins /30 | Notes |
|---|---|---|
| `LOOK=30 npx vite-node scripts/solve.mjs` | **16/30 (53%)** | final F min 294 / median 372 / max 446 |
| LOOK=12 | 3/30 (10%) | final F min 246 / median 304 / max 390 |
| `--look=200` (near-exhaustive) | 30/30 (100%) | min 1018 / median 1269 / max 1761 |

The shipped [45,110,360] sits at 53% under the bounded reference — inside the intended 40–60% band, achieved without forcing (I did not retune anything; this is the reference method's own output). Because score() still carries stale terms, I also spot-checked that the number is stable in shape: the policy's epoch-3 drought/wake terms are inert for outcome purposes (stability never gates the win; waking adds Seed income only), so the 53% is a *bounded solver result* on the live mechanics, though the score needs cleaning to be an honest probe (see § 5 recommendation).

## 4. Issue 3 — Lives contract: **PASS (all four surfaces consistent)**

- **Engine:** `SURVIVAL_START = 3`/`LIVES_CAP = 3` (worldhand.ts:40,46); `state.lives` init 3 (setupWorld); miss on epoch 1/2 → `lives -= 1` + halved epoch income (endEpoch:536–545 + `marketIncome` line 565); `advanceToNextEpoch` → lives ≤ 0 ⇒ `game-over`/`withered`, reason "Out of lives… the world withers" (578–595). Epoch-3 miss costs no life (already terminal) — smallest coherent change (a pure rename of the old Survival pool; grep confirms `Survival` survives only in two comments).
- **HUD:** `Lives {state.lives}/{SURVIVAL_START}` with title "Lives — a missed epoch target costs 1; 0 ends the run" (App.tsx:154–157); intro copy "lose a life; three misses and the world withers".
- **RULES.md §Lives:** exactly the engine rule (3 lives, miss e1/e2 → −1 + halved income, 0 → withered, e3 miss terminal).
- **Tests:** dedicated `Balatro-style lives` describe block (worldhand.test.ts:252–360): starts 3; e1 miss → exactly 1 lost + halved log line; met → no loss; e2 miss → 2 left; 1+miss → 0 lives then boundary → withered, reason contains "lives"; 0-at-boundary → withered; e3 miss → no life cost; win = beat 360. All green in my run.
- **Actual outcome:** engine probe `lives-zero-ends-withered: true`; my independent probe (scripts/review-independent.mjs) drove 1 life + 2 missed targets → `lives===0` → market still opens → closeEpoch → `game-over`/`withered`, reason mentions lives. **The rule is the smallest coherent change** (no new mechanics — the former Survival pool with the same semantics, renamed and surfaced as Lives).

## 5. Issue 4 — Scoring communication: **PASS (display honest, one doc gap)**

- **Display is honest (no re-multiplication):** `buildPlan` computes `pokerBase = Math.round(sum × CATEGORY_MULT[category])` **once** (worldhand.ts:241–242); laws then apply on top: `growth = max(0, round(pokerBase × lawMult) + lawFlat)` (244–248). The UI pill shows `{plan.pokerBase} chips × {plan.mult} mult` (App.tsx:271–273, also in the preview `{plan.pokerBase} chips × {plan.mult} mult`) — pokerBase is the already-multiplied base, mult the category multiplier; nothing multiplies twice. The summary line matches (`Banks ${growth} Growth (${pokerBase} chips x ${mult} mult${laws})`). Verified live in review-pvcommit: `16 chips × 1 mult` for J♣5♠ (rankSum 16, high ×1) — exact.
- **Test asserts base = sum × mult consistency: PASS.** worldhand.test.ts:199–207 (`poker base = round(rankSum × CATEGORY_MULT[category])` for high and flush), and :220–224 (`growth == max(0, poker + laws)`). I re-verified independently across a 1–5-card × law-variant sweep: `growth == max(0, poker + laws)` and `pokerBase == round(rankSum × mult)` hold for every case, including straight-flush ×8.
- **Kickers contributing to the sum: TRUE but undocumented.** The full selection's rankSum feeds pokerBase (e.g. pair K+K with Q kicker: rankSum 38 → base 57; with T kicker: 36 → 54). poker.ts comments `kicker values` in the comparison key only; **neither RULES.md nor README says that non-scoring kickers still add chips to the Growth sum.** Minor doc gap — the math is visible on screen (rankSum × mult), but the rule text should say "kickers add their ranks to the sum".

## 6. Remaining problems (ranked)

1. **save.ts: no structural validation, no UI explanation, no confirm on destructive reset** (details § 2). Highest-impact: a corrupt-but-version-2 save renders a broken game with a pageerror (the `r:1,s:'Z'` hand crashes `cardName`). This is the only path where I could produce a real page error.
2. **solve.mjs score() stale drought/stability logic + undocumented purchase/discard rationale + no calibration/evaluation seed split** (§ 3). The 53% number remains trustworthy as a bounded solver result, but the script's scoring text/behavior contradicts the shipped contract and its doc.
3. **Kickers-in-sum not documented** in RULES.md (§ 5). One sentence.
4. Minor: `Back to Menu` on game-over clears the save without confirmation (same family as #1); `hasSave()` is dead code in the load path; `evaluate()` header comment in poker.ts still says "up to 7 cards" (cosmetic; unchanged since v2).

## 7. Bugs found and fix policy decision

Two real defects documented above (save structural validation; solve.mjs staleness). **I made no code/test/docs changes.** Reason: the last commits touching `src/ui/save.ts` (`810b392`) and `scripts/solve.mjs` (`6f49ca8`) are several commits older than the worker's latest calibration commits (`8c1d73e`, `43c803f`), which suggests the worker's attention has moved past those files — but the assignment says to make only a minimal safe fix *if the worker is clearly done*, and the concurrent-fix brief for this same tree makes "clearly done" unverifiable from the tree alone. The safe call per instructions: document precisely, fix nothing. Suggested minimal fixes when the worker signs off (not applied):

- **save.ts** (~20 lines): after `env.version === CURRENT_VERSION`, validate `state` before returning: `phase ∈ {select, market, epoch-end, game-over}`; `Number.isInteger(lives) && lives ≥ 0 && ≤ 3`; every `hand` card has `r ∈ 2..14` and `s ∈ {S,H,D,C}`; every owned/market law id ∈ `MARKET_ITEMS` ids; return null otherwise (leaving storage untouched preserves the recoverable legacy data). Add a one-line menu note when `hasSave()` is false but a legacy envelope exists, and a `confirm()` (or two-step button) on Clear Save / Back-to-Menu.
- **solve.mjs** (~30 lines): replace score() with current-mechanics scoring (`df × 10 + ds × 0.4 + seeds-cap-aware bonus`; drop droughtRisk/shortfall/wakePenalty/stab, update the "Flourishing >= 12" comment to 360); document the purchase order in a comment; add `CALIB_SEEDS`/`EVAL_SEEDS` lists (or `--calib`/`--eval` flags) so the calibration sweep and the reported win rate use disjoint seed sets; rename the RULES.md "bounded-human reference" phrase to "bounded-solver reference".

## 8. Honest assessment of the ruleset's coherence

**Coherent, for the first time in this repo's review history.** The current contract closes cleanly:

- One hero number (Growth = round(rankSum × category mult), + law mult/flat) drives the target, the Seeds economy, and the solver — one quantity, one pipeline, preview == commit both in engine tests and in the browser (`MATCH: true`).
- Loss and win are single-rule: 3 lives drain only on missed epoch-1/2 targets; the run ends at the epoch-3 boundary either way; no drought, no stability gate, no region choices. RULES.md, HUD, intro copy, tests, and engine agree on every number I checked ([45,110,360], lives 3, seeds cap 30, 4 plays/3 discards/epoch).
- The one thing I would not call fully coherent is the *tooling fringe*: the balance probe still reasons about a removed drought, and the save layer trusts its input. Neither changes what a player faces in a normal run; both should be cleaned before the next calibration pass so the 53% figure is computed by a script that matches the game it calibrates.

The 53% bounded win rate is in the intended band and brackets correctly (10% very-bounded / 100% near-exhaustive). I did not force the band; the shipped targets produce it under the reference method as-is.

## 9. Evidence artifacts (this session)

- `scripts/review-independent.mjs` — engine probes: lives-reach-zero outcome, growth/base consistency sweep, malformed-card behavior, save-shape.
- `scripts/review-save-lives-browser.mjs` — Playwright: legacy v1 save preserved+rejected, obsolete law id, missing lives/invalid phase/malformed card/forward-version loads, Quit byte-preserving save, reload auto-load, Clear Save guard, Back-to-Menu destructiveness. (Both scripts are review-only; they touch no game code.)
- Reruns: `npx vite-node scripts/review-independent.mjs`, `node scripts/review-save-lives-browser.mjs` (dev server on 5177 required).
- All pre-existing review scripts re-run and green (list in § 1).

— End of independent review v3.