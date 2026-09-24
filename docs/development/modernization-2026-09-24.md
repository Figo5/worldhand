# Repository analysis and modernization (2026-09-24)

A review of `main` at `6b3713a` (rules v8, Ascension rules v8) and the
tooling changes made on `claude/zen-cannon-tu3i4x`. No engine rule,
balance number or save format changed; the 40 Classic replay fixtures
replay unchanged.

## What the repository is

| Area | State |
|---|---|
| Engine (`src/engine/`, ~2.3k lines) | Pure TypeScript, seeded (mulberry32 + FNV-1a), no clock/DOM. Classic (`worldhand.ts`) and the dev-only Ascension ruleset (`ascension/`) share only `rng.ts`, `poker.ts` and `core/streams.ts`; `tests/engine-boundaries.test.ts` enforces this. Preview and commit share one scoring function (`buildPlan`). |
| UI (`src/App.tsx`, `ui/`, `components/`) | React 19 + three.js. `App.tsx` holds the title screen, table, shop and planet panel (~900 lines). The globe only renders engine state. |
| Saves (`src/ui/save.ts`) | Versioned envelope (schema 4 / rules 8), strict validator, incompatible saves preserved as legacy keys, file export/import. |
| Tests | 368 Vitest tests in 13 files, including 40 recorded Classic replays with per-epoch state hashes. |
| Browser QA | `qa-portable.mjs` (file:// artifact) and `qa-ascension-dev.mjs` run in CI with Playwright. |
| Toolchain | Already current: Vite 8 (Rolldown), TypeScript 7, Vitest 5, React 19, three r186, Node 24. |
| Scripts | 37 `.mjs` scripts. CI runs 3 (`build-portable`, `qa-portable`, `qa-ascension-dev`); `docs/development/README.md` lists the current ones; the rest are dated evidence for earlier rulesets. |

The engineering baseline is strong: determinism is tested rather than
assumed, rule changes are versioned, and experiments are recorded. The
modernization work was therefore about configuration debt and blind spots,
not dependency upgrades.

## Changes on this branch

| Change | Why | Evidence |
|---|---|---|
| `npm run typecheck` type-checks `tests/` too (`tests/tsconfig.json`), and CI runs it | Tests were never type-checked. Turning it on found `tests/regional-bonus.test.ts` importing `Card`/`Suit` from `../engine/poker` (a path that does not exist, so those types were silently `any`), assertions reading seeds-effect fields that v8 removed, and fixture literals typed as `string` | 23 errors before, 0 after; 368 tests pass |
| `replay-codec.mjs` JSDoc types | Decoded replay actions are now typed as `Action` in the replay test | Type-check |
| `tsconfig`: target/lib ES2022, `erasableSyntaxOnly` | ES2020 predated Vite 8's default browser target. `erasableSyntaxOnly` keeps `src/` runnable through Node's type stripping, which the `ts-resolve.mjs` probe scripts rely on | Type-check, builds |
| Globe (`Planet3D`, three.js) loads as its own chunk via `React.lazy` | The web build was one 801 kB script (215 kB gzip), most of it three.js. The entry chunk is now 256 kB (78 kB gzip) and the globe chunk 547 kB (137 kB gzip), fetched on mount. The title screen and hand no longer wait for three.js. If the chunk fails to load, a note replaces the globe and the region legend stays usable, instead of the app unmounting | CI build output; both QA scripts now wait for the globe canvas (production preview and file:// artifact) |
| Portable build: `rolldownOptions` and `codeSplitting: false` | Vite 8 ignored the old `inlineDynamicImports` with a warning. The artifact stays a single file (805 kB) with the globe inlined. Vite's preload helper then warned `EMPTY_IMPORT_META` (IIFE has no `import.meta`); with no other chunks it never resolves a URL, so only that code is filtered | CI portable build and `qa-portable.mjs` |
| `chunkSizeWarningLimit`: 600 (web), 1000 (portable) | The 500 kB warning fired on every build, so a real regression would not stand out. three.js cannot usefully be split further, and the portable file is one chunk by design | CI build output has no warnings |
| `.nvmrc` (24), `engines.node >=24`, `private: true`, dropped `main` | One Node version for CI, nvm/fnm and Netlify. `private` stops an accidental `npm publish` of an app whose license is undecided. `main: index.html` meant nothing | CI uses `node-version-file` |
| CI: `permissions: contents: read`, checkout/setup-node v6 | Least-privilege token; current action majors | CI run on this branch |
| UI: World Chronicle menu item, Lives tooltip, development line | The menu item only closed the menu. The tooltip said "(all 3 epochs)", but epochs are unlimited. The development line divided by `living x 10`, but development is uncapped, so it could read "44/40" | `qa-portable.mjs` now opens the chronicle from the menu; the copy changes are not covered by QA |

## Findings not changed

Ordered by value. None is urgent.

1. **No linter or formatter.** There is no ESLint/Prettier config. The
   React hooks rules would flag `latest.current = state` (a ref written
   during render, `App.tsx`). Adding `eslint`, `typescript-eslint` and
   `eslint-plugin-react-hooks` needs new devDependencies and a regenerated
   lockfile, which this session could not do (see *Blocked*).
2. **Save import trusts owned-item contents.** `validateState` checks that
   `jokers`, `vouchers`, `consumables`, `projects` and `planetLevels` are
   arrays or objects, but not their ids or numbers. A hand-edited import
   such as a joker with `mult: "x"` is accepted and previews `NaN` Growth
   (reproduced with `importSave` on this branch).
   It is single-player, so this is a robustness issue, not a security one.
   Checking ids against `JOKERS`/`VOUCHERS`/... (as is already done for
   `MARKET_ITEMS`) would close it without a rules change.
3. **`clone()` must track `GameState` by hand.** Any new nested field
   that is not added to `clone()` in `worldhand.ts` would be shared between
   states. The replay fixtures would catch a behavior change, but not a
   latent alias. A test that deep-freezes a state and applies every action
   type would guard it.
4. **Stability shows "x/10" but can only fall.** Regions start at
   stability 3 and only decay; `STABILITY_MAX` (10) is never reachable, so
   "stability 3/10" in the legend and map detail suggests a mechanic that
   does not exist.
5. **Unreachable branches and unused exports.** `flourishing <= 0` (it
   starts at 3 and Growth is never negative) and `outcome === 'flourishing'`
   (there is no win) are still handled in the engine and UI. `TOTAL_EPOCHS`
   and `SURVIVAL_MAX` are unused by the game, and `hasSave` and
   `legacyNotice` in `save.ts` are unused. Recent work deliberately leaves
   Classic untouched, so these are best removed with its next deliberate
   change.
6. **ARIA patterns.** The hand is a `listbox` whose `option`s are all
   tab stops (a listbox expects one tab stop plus arrow keys, which the
   hand already has), and the run menu is `role="menu"` without arrow-key
   or Escape handling. Plain buttons with `aria-pressed`, or completing
   the patterns, would be more accurate.
7. **Script sprawl.** 34 of 37 scripts do not run in CI, and many
   browser scripts are unverified against v8 (as the development README
   says). Moving the dated ones under `scripts/archive/` or next to their
   reports would make the current tooling obvious.
8. **Deploy hardening.** `netlify.toml` sets no security headers. A CSP
   such as `default-src 'self'` should work with the built site (no inline
   scripts), but it needs checking on a deploy preview before it ships.
9. **CI minutes.** Pull-request branches run CI twice (the `push` and
   `pull_request` triggers), and Chromium plus its system packages are
   downloaded on every run (~25 s). Restricting `push` to `main`, and
   caching `~/.cache/ms-playwright` by Playwright version, would halve the
   CI minutes a pull request uses. Restricting `push` also stops CI for
   branches without a pull request, so it is a workflow choice.
10. **License.** `package.json` still says MIT while the README records
    the license as undecided. That is the owner's decision; `private: true`
    at least prevents publishing under it by accident.

## Blocked in this session

The session's network policy returned 403 for every package registry
(npm, Yarn and CDN mirrors), so `npm ci` could not run. Local verification
used Bun's Vitest-compatible runner (all 368 tests) and the machine's
TypeScript 6 with a Vitest type stub. TypeScript 7, both Vite builds and
the Playwright QA were verified by GitHub Actions on this branch. Anything
that changes dependencies (linting, `@types/node` so that
`engine-boundaries.test.ts` can be type-checked too) needs registry access.
