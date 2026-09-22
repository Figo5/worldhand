# Development and research evidence

- [Independent review and dated addenda](independent-review.md)
- [Historical playtest handoff](playtest-handoff.md)
- [Interface design brief](design-brief.md)
- [Rejected non-match-penalty experiment](experiments/non-match-penalty-d02b14c/)

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

Current verification commands:

```sh
npm test
npm run build
npm run build:portable
node scripts/qa-portable.mjs
```

Run from the repository root. Browser checks use Playwright (a dev dependency);
install its Chromium runtime with `npx playwright install chromium` if needed.
Generated QA folders are ignored. Other retained review scripts may target older
rulesets; consult their source and the dated reports before interpreting results.

Known presentation issue: the title screen still says “across three epochs”; the
current engine has unlimited epochs and escalating targets. The current README
and rules describe the engine accurately. This text-only UI issue is recorded for
a later application pass.
