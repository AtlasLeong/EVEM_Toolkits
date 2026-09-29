# Manufacturing Terminal Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the manufacturing estimator as a cohesive dark terminal with a compact top bar, focused three-column desktop workspace, and readable mobile flow without changing manufacturing calculations.

**Architecture:** Keep the existing React component/data flow and replace presentation through a small JSX structure adjustment plus a terminal-scoped CSS layer placed last in the stylesheet. Add stable test hooks only where needed for visual/semantic assertions; do not add dependencies or alter API calculations.

**Tech Stack:** React, CSS Grid/Flexbox, Node test runner, Playwright, Vite.

---

### Task 1: Capture the redesign contract in browser tests

**Files:**
- Modify: `front-codex/tests/e2e/specs/manufacturing.spec.js`

**Step 1: Write failing assertions**

Add assertions for the new page contract: a compact terminal header, a visible workspace region, a collapsed skills/architecture disclosure, readable route labels at 520px, and the absence of horizontal overflow.

**Step 2: Run the focused test to verify it fails**

Run: `$env:PW_TEST_PORT='4185'; npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`

Expected: FAIL on the new selectors or layout assertions before the redesign is implemented.

### Task 2: Recompose the page chrome and panel landmarks

**Files:**
- Modify: `front-codex/src/pages/ManufacturingEstimator.jsx`
- Modify: `front-codex/src/styles/manufacturing.css`

**Step 1: Implement the smallest JSX structure change**

Group target, quantity, efficiency, and route status under a terminal header landmark. Add `data-testid`/ARIA landmarks for the configuration rail, manufacturing route, and cost rail. Preserve all existing state handlers and formula text.

**Step 2: Run the focused test**

Run the same Playwright command and confirm only visual/landmark assertions remain if any.

### Task 3: Replace the fragmented palette with one terminal token system

**Files:**
- Modify: `front-codex/src/styles/manufacturing.css`

**Step 1: Apply the palette and component states**

Add the final terminal-scoped rules at the end of the stylesheet. Use graphite/navy surfaces, warm amber action emphasis, cool blue-gray information states, and green only for complete status. Define consistent hover, focus-visible, pressed, disabled, border, and text tokens for inputs, segmented route controls, cards, and callouts.

**Step 2: Verify CSS hygiene**

Run: `git diff --check`

Expected: no whitespace errors.

### Task 4: Tune desktop density and mobile flow

**Files:**
- Modify: `front-codex/src/styles/manufacturing.css`

**Step 1: Set layout constraints**

Use a fixed-height desktop workspace with `minmax(0, 1fr)` for the route column, bounded side rails, and independent overflow. At mobile widths switch to one column, keep route labels textual, and remove horizontal overflow.

**Step 2: Run visual checks**

Use Playwright CLI to capture 1440×960 and 520×900 screenshots. Inspect that the title does not dominate the page, the route column is the visual focus, and the cost rail is populated rather than empty.

### Task 5: Run the full verification set

**Files:**
- No additional source files.

**Step 1: Run focused unit and browser tests**

Run: `node --test tests/unit/manufacturingPlan.test.mjs`

Run: `$env:PW_TEST_PORT='4185'; npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`

Expected: all focused tests pass.

**Step 2: Run repository checks**

Run: `node --test tests/unit/*.test.mjs`

Run: `npm run build`

Run: `git diff --check`

Expected: all tests and production build pass with no diff-check errors.

**Step 3: Review the final diff**

Run: `git diff --stat` and inspect only the manufacturing page/style/test changes. Do not stage or modify unrelated tactical, market, archive, or generated files.
