# Worldhand

A deterministic planet-building poker roguelike with a 3D world and a portable offline build.

**[Play Worldhand](https://worldhand.netlify.app/)** · [Rules and scoring](docs/rules.md) · [Development evidence](docs/development/README.md)

![A poker-hand preview beside Worldhand's evolving 3D planet](docs/media/gameplay.png)

## Play hands. Grow a world. Keep it alive.

Select one to five cards from an eight-card hand, preview their Growth, then commit
or discard. Each epoch gives you four plays and three discards to reach its target.
Beating the target advances immediately; missing it costs one of three lives.
There is no fixed final epoch: build for a higher World Score before the run ends.

Spend Seeds between epochs on Jokers, Planet cards, consumables, vouchers and
world upgrades. The twelve-region globe develops as you play. Specializations
contribute regional bonuses, while the shop provides most of the scaling decisions.
The current economy caps **per-play Seed income** and uses escalating geometric
targets; the detailed contracts and measured limitations live in the [rules](docs/rules.md).

## Run locally

Use a current Node.js release supported by Vite 8 (Node.js 24 is a suitable choice):

```sh
git clone https://github.com/Figo5/worldhand.git
cd worldhand
npm ci
npm run dev             # http://localhost:5177
npm run build           # production site in dist/
npm run preview         # serve the production site
```

## Take it offline

```sh
npm run build:portable
```

Open **`dist-portable/worldhand.html`** directly in a modern browser. The single
HTML file bundles JavaScript, CSS and Three.js; it needs no server or network.
Export/import saves from the title screen to move a run between devices. Browser
storage behavior for `file://` varies, so keep an exported backup of a valued run.

## Architecture

- **Pure TypeScript engine:** seeded random state, poker evaluation and all state
  transitions live in `src/engine/`. The same seed and actions reproduce the run.
- **One scoring pipeline:** preview and commit share `buildPlan`, keeping the
  displayed result tied to the actual transaction.
- **React + Three.js:** React presents the hand, market and chronicle. The globe
  renders engine-owned region state; animation does not decide game outcomes.
- **Versioned local saves:** schema 4 / engine rules 8. Incompatible saves are
  preserved as legacy data and rejected with an explanation. Imports are validated
  before replacing an existing run.

## Testing

```sh
npm test
npm run build
npm run build:portable
# Optional browser checks of the file:// artifact:
npx playwright install chromium
node scripts/qa-portable.mjs
```

Verified on 2026-09-22: **211 tests passed**, plus production and portable builds
(Node.js 26.8.1). Coverage includes poker, deterministic transitions, preview/commit,
bounded economy, save validation and death boundaries. Builds report bundle-size
and portable-bundling warnings; they complete successfully. The portable browser checks
also passed: offline loading, keyboard play, shop purchases, a full run, reload
persistence, mobile layout, and save export/import.

## Status and limitations

A playable single-player game with no backend, accounts or real-money betting.
Balance evidence comes from bounded scripted policies, not human win-rate studies.
Regional bonuses have a measured low impact on many choices; the rules document
preserves that limitation and the rejected experiments. Keyboard controls and
reduced-motion support are included.

## License

`package.json` declares MIT, but this repository does not yet include a license
file. The license notice and copyright attribution still need to be confirmed.
