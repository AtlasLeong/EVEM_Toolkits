# Market Terminal Fixed Viewport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the plan task-by-task.

**Goal:** Rebuild the public market page as a fixed one-screen trading terminal that fills the application viewport and keeps the chart, order book, catalog, and quote summary visible together on desktop.

**Architecture:** Keep the existing React data/query/API contracts and semantic DOM. Add an immersive market-page shell style, replace the vertical flex sizing with explicit CSS grid rows, and add browser-level layout assertions before changing production styles. Responsive breakpoints retain a stacked, scrollable mobile layout.

**Tech Stack:** React, Vite, CSS, Playwright E2E, existing market query hooks and SVG chart.

---

### Task 1: Lock the layout contract with failing browser tests

**Files:**
- Modify: `front-codex/tests/e2e/specs/market.spec.js`

**Step 1: Write the failing tests**

Add desktop assertions that the market terminal is immersive, the layout grid has three columns, the center chart frame has a bounded height, and the order-book panel is visible without page scrolling. Add a viewport screenshot assertion hook or stable bounding-box checks; keep existing route/data tests unchanged.

**Step 2: Run tests to verify they fail**

Run: `npm --prefix front-codex run test:e2e -- --workers=1 front-codex/tests/e2e/specs/market.spec.js`

Expected: the new bounding-box assertions fail against the current tall layout.

**Step 3: Commit the failing test**

```bash
git add front-codex/tests/e2e/specs/market.spec.js
git commit -m "test(market): specify fixed viewport terminal layout"
```

### Task 2: Implement the immersive shell and bounded grid

**Files:**
- Modify: `front-codex/src/pages/MarketPrices.jsx`
- Modify: `front-codex/src/styles/market.css`
- Modify: `front-codex/src/styles.css`

**Step 1: Add semantic shell hooks**

Add `market-page--immersive` to the page root and a `market-terminal-toolbar` hook if needed without changing existing labels or API behavior.

**Step 2: Run the focused test to verify it still fails**

Run: `npm --prefix front-codex run test:e2e -- --workers=1 front-codex/tests/e2e/specs/market.spec.js`

Expected: the new layout assertions remain red because CSS has not changed.

**Step 3: Replace content-height flex sizing with viewport-safe grid sizing**

In `styles.css`, let `shell-main`, `page-stage`, and `page-wrapper` expose `min-height: 0` for the immersive market page and remove page-stage max-width/padding only under `.shell-main:has(.market-page--immersive)`.

In `market.css`, make the terminal fill its parent (`height: 100%; min-height: 0`), set a compact header row, set the three-column layout to `height: minmax(0, 1fr)`, and make the center column a three-row grid (`auto minmax(0, 1fr) 206px`). Reset the chart SVG wrapper to `min-height: 0` inside the bounded stage. Keep left and right panes independently scrollable.

**Step 4: Run the focused test to verify it passes**

Run: `npm --prefix front-codex run test:e2e -- --workers=1 front-codex/tests/e2e/specs/market.spec.js`

Expected: PASS, including the fixed viewport assertions.

**Step 5: Commit the implementation**

```bash
git add front-codex/src/pages/MarketPrices.jsx front-codex/src/styles/market.css front-codex/src/styles.css front-codex/tests/e2e/specs/market.spec.js
git commit -m "feat(market): fit terminal to one desktop viewport"
```

### Task 3: Preserve responsive behavior and interaction stability

**Files:**
- Modify: `front-codex/src/styles/market.css`
- Modify: `front-codex/tests/e2e/specs/market.spec.js`

**Step 1: Add responsive assertions**

Add tablet/mobile checks that the terminal does not overflow horizontally, the summary moves below the center pane, and the mobile page can scroll naturally.

**Step 2: Run the responsive tests to verify the new checks fail if needed**

Run: `npm --prefix front-codex run test:e2e -- --workers=1 front-codex/tests/e2e/specs/market.spec.js`

Expected: any missing breakpoint behavior is reported before the CSS adjustment.

**Step 3: Implement responsive overrides**

Use existing `1100px` and `767px` breakpoints. Restore `height: auto` and normal overflow on mobile while preserving compact chart/ladder dimensions and keyboard-visible controls.

**Step 4: Run the responsive tests**

Run: `npm --prefix front-codex run test:e2e -- --workers=1 front-codex/tests/e2e/specs/market.spec.js`

Expected: PASS at desktop, tablet, and mobile viewports.

**Step 5: Commit the responsive changes**

```bash
git add front-codex/src/styles/market.css front-codex/tests/e2e/specs/market.spec.js
git commit -m "test(market): cover responsive terminal layout"
```

### Task 4: Full verification and visual review

**Files:**
- No source changes expected; only test artifacts if a regression is found.

**Step 1: Run the full frontend E2E suite**

Run: `npm --prefix front-codex run test:e2e -- --workers=1`

Expected: all existing tests pass.

**Step 2: Run the production build and repository checks**

Run: `npm --prefix front-codex run build` and `git diff --check`.

Expected: build succeeds and `git diff --check` prints no errors.

**Step 3: Capture a browser screenshot for visual QA**

Use the repository Playwright setup against the local app at desktop and mobile sizes. Verify there is no outer white margin inside the content area, the chart occupies the center, and the depth panel is visible within the same viewport.

**Step 4: Commit any only-if-needed visual fixes**

```bash
git add <verified files>
git commit -m "fix(market): polish terminal viewport spacing"
```

### Task 5: Publish through the existing deployment pipeline

**Files:**
- No deployment configuration changes unless CI reports a required asset or test update.

**Step 1: Push the feature branch and open a pull request**

```bash
git push -u origin codex/market-terminal-v2
```

Create a PR targeting `master`, attach it to the task, and wait for CI.

**Step 2: Merge only after CI and visual checks pass**

Merge the PR, wait for the production workflow, then verify `/deploy-version.json`, `/market`, and the market JavaScript chunk return successfully.

