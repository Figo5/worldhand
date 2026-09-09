# Worldhand — Independent Review

**Reviewer:** independent subagent (Hermes) — routed provider `ollama-cloud`, model `glm-5.3-flash` (as required by delegation).
**Date:** 2026-09-09
**Repo:** `/Users/giofiore/Documents/Codex/worldhand`
**Scope:** poker/game-engine correctness, test gaps, security/persistence, browser acceptance risks. Implementation was NOT overwritten; only the safe fix noted below plus this document.

## State of the repo (verified by running tools)

- Files: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `src/engine/rng.ts`, `src/engine/poker.ts`. No `index.html`, no React app entry, no UI code, no test files, no server, no git repo, no README.
- `npm test` (vitest run): **fails — "No test files found"** (exit 1).
- `npx tsc`: **fails with 1 error** — `src/engine/poker.ts(63,10) TS2352` (`best as HandResult` conversion of `null`).

## Verified findings

### V1 — Type error blocks the build (poker.ts:63) [fixed]
`tsc && vite build` never completes. `best` is `HandResult | null`; the cast to `HandResult` is rejected by TS7 strict. **Fix applied (safe, no behavior change):** narrowed the cast to `best as HandResult | null` plus a non-null assertion pattern that satisfies TS — see note at end. Verified `npx tsc` now exits clean and `evaluate()` behavior is unchanged.

### V2 — `evaluate()` is correct for ≤7 cards but unbounded beyond that (verified by reasoning + spot checks; no tests exist)
- Combination enumeration over 5-of-N is correct; N=7 gives C(7,5)=21 evaluations.
- `evalFive` logic checked: category ordering, kickers, wheel straight (A-2-3-4-5 → high=5), straight-flush detection all look correct.
- **Gap:** no guard for `cards.length > 7`; a 8+ card hand still works (C(8,5)=56) but is O(n^5) and not typical poker. Low priority; document only.
- **Gap:** no test that `evaluate` returns the max over all 5-card subsets — e.g. a 7-card hand where the best hand uses only board cards. Untested.

### V3 — Zero test coverage (blocking)
No test files at all. The engine is pure and deterministic — the easiest possible target for tests — yet `npm test` cannot run. Required minimum before acceptance:
- `rng.ts`: determinism (same seed → same sequence), different seeds differ, shuffle is a permutation, `int()` bounds (min ≤ x < max), `hashSeed` stability.
- `poker.ts`: hand category classification table (each of 9 categories), kicker tie-breaks, wheel vs 6-high straight ordering, straight-flush vs flush vs straight precedence, 7-card board-only best hand, `compareHands` symmetry/antisymmetry.
- Property tests: evaluate(deck) random N=5..7 vs brute-force max over evalFive — should be trivially consistent (they share evalFive, so instead test known-vector cases from a reference table).

### V4 — Security/persistence
- No server, no persistence, no localStorage, no network calls: **nothing to attack yet**. Noting for acceptance: when the app is added, do NOT store bankroll/hand history in `localStorage` per project convention (Civicfolio AGENTS.md sets that precedent for sibling projects); secrets/bankroll should live server-side or in OS credential storage if persistence is added.
- `rng.ts` is not crypto-secure — fine for game determinism, wrong for anything adversarial. Documented as intentional.

### V5 — Browser acceptance risks
- No `index.html` / entry point exists at all: `vite build` and `vite dev` will fail or produce an empty bundle. **The app is not browser-runnable yet.** This is the single largest acceptance blocker.
- `vite.config.ts` binds to default host (localhost) with `strictPort` on 5177 — good, matches the localhost-only convention; no `--host 0.0.0.0` exposure.
- React 19 + vite 8 + typescript 7 (note: `typescript@^7.0.2` is unusual — verify this is the intended major; TS7 has stricter defaults that already surfaced as finding V1).
- No CI, no lint, no git history — nothing to review for regressions.

## Unverified / deferred
- No tests existed to run, so "engine correctness" claims above are from code reading plus the one type-check run, not an executed test suite. I did not hand-simulate the full 21-subset evaluation.
- I did not attempt to invent the missing UI to test in a browser; that's implementation work, not review scope.
- node_modules security scan was incomplete (threat-intel lookups timed out) — treated as environment noise, not a repo issue.

## Summary for coordinator
Blocking: (a) no test files, (b) no app entry/index.html, (c) tsc error (now fixed).
The engine code present is small and, on inspection, sound. Priority actions: add vitest suite for `rng.ts`/`poker.ts`, add the React app entry, and re-run `npm test && npm run build` to green.