# Market Stat Strip Implementation Plan

> Required workflow: test-driven development, independent specification review, then quality review and fresh verification.

**Goal:** Align all five chart statistics in one row and give the reclaimed space to the line charts.

**Architecture:** Replace wrapping flex statistics and their 480/260px column-count overrides with one content-aware horizontal strip. Keep exact values and existing graph geometry; add a focusable named scroll container where needed. Remove per-panel observation counters and narrow central horizontal padding without modifying API state.

**Tech Stack:** React, CSS Grid/Flex, Playwright, Node test runner, Vite.

## Task 1: Implement the approved layout with regression coverage

Files: `front-codex/src/pages/MarketTrendChart.jsx`, `front-codex/src/styles/market.css`, new `front-codex/tests/e2e/specs/market-stat-strip.spec.js`.

1. Add API-boundary fixtures for regular prices, 万/亿 prices, missing values and maximum supported compact values. Assert real DOM geometry, not CSS source strings.
2. Add tests requiring five equal-y metrics in both and single-side modes at 1920, 1440, 1366, 1180 and phone widths; matching dt/dd baseline positions; no clipping or overlap.
3. Assert local-only scrolling and keyboard access to 月低 for an overflowing strip. Assert observation count appears only in the top toolbar, with sidebar values unchanged.
4. Record baseline plot width/height at representative desktop sizes. Add a regression that compact layout leaves more plot height and less horizontal padding; retain >=180px plotting height and label legibility.
5. Run RED: `$env:PW_TEST_PORT='4296'; npx playwright test tests/e2e/specs/market-stat-strip.spec.js --workers=1 --reporter=list --output=output/playwright/stat-strip-red`. Confirm expected layout failures before editing production.
6. Implement a nonwrapping strip with five content-minimum columns and a locally scrollable, keyboard-reachable viewport. Preserve the semantic definition list. Delete obsolete wrapping queries and count styles. Reduce central padding only within the market immersive layout. Do not alter chart computation, requests or other pages.
7. Run the new tests GREEN, inspect screenshots, self-review, then commit scoped source/tests only. Preserve all unrelated and generated files.

## Task 2: Review and verify

1. Independently review implementation against the display contract; fix any gaps, then request quality review.
2. Run the five market E2E specs plus `dark-console.spec.js`, with a distinct port and bounded worker count.
3. Run `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs`, `npm run build` and `git diff --check`.
4. Inspect desktop both/single and mobile screenshots. Record fresh results and hand off locally without pushing or deploying.

## Verification record — 2026-09-27

- Before production edits, existing compact/side-view suites passed: 34 tests. New regression RED reproduced three expected failures at 1440px: metric groups wrapped with a 48.5px y offset.
- New single-row coverage passed all 26 initial tests. Independent specification review identified a missing plot-height guard; the added 27th test now checks the recorded baseline, reclaimed plot dimensions, and absence of a blank gap.
- Same local fixture at 1920x1080: each plot grew from 472x556px to 496x605px; statistics height fell from 89px to 41px; central horizontal padding fell from 40px to 16px. Sizes are rounded CSS pixels.
- Final regression command: `PW_TEST_PORT=4294 npx playwright test tests/e2e/specs/market.spec.js tests/e2e/specs/market-chart-release.spec.js tests/e2e/specs/market-compact-layout.spec.js tests/e2e/specs/market-side-view.spec.js tests/e2e/specs/market-stat-strip.spec.js tests/e2e/specs/dark-console.spec.js --workers=2 --reporter=list --output=../output/playwright/stat-strip-final` — **101 passed**.
- `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs` — **354 passed**; no failures/skips.
- `npm run build` — passed, including bundle-budget checks. `git diff --check` — passed; Git reported only working-copy CRLF normalization warnings. Playwright also emitted the existing `NO_COLOR`/`FORCE_COLOR` environment warning.
- Independently reviewed against the approved spec, then reviewed for code quality: no remaining findings.
- Visually inspected desktop 1920x1080 dual/single, 1440x900 dual, and 390px mobile screenshots. The local screenshots use synthetic API fixtures, not live market quotes. Artifacts are under `output/playwright/stat-before-1920.png`, `stat-after-1920.png`, `stat-after-1920-single.png`, `stat-after-1440.png`, and `stat-strip-final/` (not committed).
- Scope remains frontend layout/tests only. No API/collector/database changes, push, merge, or deployment in this iteration. Keep `codex/market-stats-single-row` and the existing worktree for follow-up.
