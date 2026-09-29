# Manufacturing Control Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the redundant formula card, modernize search/quantity controls, and prevent quantity changes from re-running stable market quote work or visibly shaking the page.

**Architecture:** Keep the manufacturing calculation pure and synchronous. Add stable derived quote keys in the page component, keep all existing API/cache behavior, and append a scoped terminal CSS layer for quiet borders, pressed states, and tabular numbers. No new UI dependency is installed.

**Tech Stack:** React, CSS, Node test runner, Playwright, Vite.

---

### Task 1: Add failing interaction regressions

**Files:**
- Modify: `front-codex/tests/e2e/specs/manufacturing.spec.js`

**Step 1: Write failing assertions**

Assert the formula card is absent, the quantity control exposes a stable value surface, and clicking the plus button twice preserves the same quote request set after the initial quote load.

**Step 2: Run focused browser test**

Run: `$env:PW_TEST_PORT='4185'; npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`

Expected: FAIL because the formula card is still rendered and the new test hooks do not yet exist.

### Task 2: Remove duplicate formula content and expose stable control hooks

**Files:**
- Modify: `front-codex/src/pages/ManufacturingEstimator.jsx`

**Step 1: Make the smallest JSX change**

Remove the left-column formula callout. Add a stable test id to the quantity value surface. Preserve labels, ARIA names, and the existing formula explanation near the efficiency field and summary.

**Step 2: Run focused browser test**

Confirm the formula-card assertion passes while the request-stability assertion remains red.

### Task 3: Stabilize quote effect dependencies

**Files:**
- Modify: `front-codex/src/pages/ManufacturingEstimator.jsx`

**Step 1: Implement a stable purchase ID key**

Derive a sorted/deduplicated key from `purchaseIds`, use it for the quote refresh callback/effect dependencies, and retain the original IDs for requests. Quantity changes with the same purchase set must not start another missing-quote check.

**Step 2: Run focused browser test**

Confirm the quote request count remains unchanged after quantity changes and all existing route/price assertions pass.

### Task 4: Apply modern control styling

**Files:**
- Modify: `front-codex/src/styles/manufacturing.css`

**Step 1: Replace visual treatment**

Use a single 1px terminal border, low-contrast surfaces, local hover/pressed backgrounds, `:focus-visible` rings, `font-variant-numeric: tabular-nums`, and layout containment on the quantity control. Remove any thick nested outline behavior while preserving keyboard visibility.

**Step 2: Capture visual proof**

Capture 1440×960 and 520×900 screenshots with Playwright CLI. Confirm the bottom card is gone, the search field has one border, and plus/minus interactions do not move neighboring content.

### Task 5: Run full verification

**Files:**
- No additional source files.

**Step 1: Run focused and unit tests**

Run: `node --test tests/unit/*.test.mjs`

Run: `$env:PW_TEST_PORT='4185'; npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`

**Step 2: Run production checks**

Run: `npm run build`

Run: `git diff --check`

Expected: all checks pass with no whitespace errors and no changes to unrelated workspace files.
