# Market Side-view Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the top status badge and make single-side price viewing obvious and full-width.

**Architecture:** Replace independent page booleans with one `viewMode` (`both`, `sell`, `buy`) and derive visible sides. Pass visibility through the chart's tooltip, readout and accessible table; apply a single-column modifier and reset chart interaction on mode change. Keep requests, catalog freshness, sidebar and data formatting unchanged.

**Tech Stack:** React, CSS, Node test runner, Playwright, Vite.

---

### Task 1: Implement exclusive chart modes with TDD

**Files:** `front-codex/src/pages/MarketPrices.jsx`, `front-codex/src/pages/MarketTrendChart.jsx`, `front-codex/src/styles/market.css`; create `front-codex/tests/e2e/specs/market-side-view.spec.js`.

1. Add browser fixtures with two items, real-shaped stats, two dated observations, and both five-level ladders. Write tests for the full approved display contract, including an empty buy series and switching by keyboard.
2. From `front-codex`, run `$env:PW_TEST_PORT='4294'; npx playwright test tests/e2e/specs/market-side-view.spec.js --workers=1 --reporter=list --output=output/market-side-red`. Confirm failures because the new controls/behavior are absent.
3. Implement `const [viewMode, setViewMode] = useState('both')`, deriving `showSell = viewMode !== 'buy'`, `showBuy = viewMode !== 'sell'`. Render three buttons in a named group with `aria-pressed` and a visible active style; remove obsolete badge markup/CSS/state.
4. Make the trend panel grid one column when one side is visible. Filter tooltip/readout/table by the same visibility; clear old point state on mode changes without losing keyboard focus on the control or adding network requests.
5. Rerun new tests, inspect desktop/mobile screenshots. Check spec then code quality independently and address actionable issues.

### Task 2: Preserve and verify regressions

**Files:** `front-codex/tests/e2e/specs/market.spec.js`, `front-codex/tests/e2e/specs/market-chart-release.spec.js`.

1. Replace old hide/show legend selectors with explicit side-view buttons, preserving time-window, segmented missing-data, and keyboard detail coverage.
2. Point freshness clock assertions at the retained catalog status instead of removed top badge. Keep the existing 2-hour expiry contract test.
3. Run all market specs and shared dark-console geometry tests on port 4294; run `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs` and `npm run build`.
4. After spec/quality approval, commit only scoped source/tests/docs. Leave local branch for review without push or deployment. Record test counts and screenshot evidence.

## Verification record

- RED baseline: the new side-view spec failed before the controls and visibility contract were implemented.
- GREEN focused Playwright run: `53 passed` across the new side-view coverage, market regressions, release chart checks and dark-console geometry checks.
- Frontend unit/preview run: `354 passed`, `0 failed`.
- Production build and bundle budget check: passed (`vite build` plus `npm run check:bundle`).
- Visual evidence: desktop dual-side, desktop sell-only and mobile sell-only screenshots are in `front-codex/output/market-side-green-2/`.
