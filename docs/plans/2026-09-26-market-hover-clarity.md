# Market Hover Clarity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make market chart hover data immediately readable while preserving the fixed trading-desk layout and adding a tactical-board-style outer frame.

**Architecture:** Keep the existing SVG chart and bottom readout as the stable information surface, but add an anchored tooltip for the active point, visible point/cursor emphasis, corrected hit-target geometry, and keyboard focus support. Use market-scoped CSS to increase hierarchy and reserve a predictable chart/readout height so the order book remains visible without layout jumps.

**Tech Stack:** React, SVG, CSS, Playwright E2E, Vite build.

---

### Task 1: Add failing chart interaction coverage

**Files:**
- Modify: `front-codex/tests/e2e/specs/market.spec.js`

**Step 1: Write the failing test**

Add a market chart test that opens `/market`, waits for the selected item and chart observations, focuses a point target, and asserts:

- point targets are keyboard reachable (`tabIndex` is `0`);
- the active tooltip is visible and contains a full observation time plus both price labels;
- the readout remains present with the same observation status role;
- the market terminal has a visible inset frame rather than touching the viewport edge.

**Step 2: Run the focused test to verify it fails**

Run: `npx playwright test tests/e2e/specs/market.spec.js --grep "hover details" --workers=1`

Expected: FAIL because no tooltip exists, point targets use `tabIndex=-1`, and the current market frame does not expose the new assertion hooks.

### Task 2: Implement chart tooltip and corrected hit targets

**Files:**
- Modify: `front-codex/src/pages/MarketTrendChart.jsx`

**Step 1: Add the minimal implementation**

- Add a short axis-time formatter separate from the full tooltip time.
- Keep the latest point active by default, clear hover state on pointer leave, and restore the latest readout.
- Set point targets to `tabIndex={0}` and use the plot-relative x percentage so the transparent hit areas align with SVG points.
- Render an active point halo for visible series and a high-contrast `.market-trend-tooltip` positioned near the active point, flipping left/right near chart edges.
- Keep the accessible data table and existing bottom readout.

**Step 2: Run the focused test to verify it passes**

Run: `npx playwright test tests/e2e/specs/market.spec.js --grep "hover details" --workers=1`

Expected: PASS.

### Task 3: Tune market layout and typography

**Files:**
- Modify: `front-codex/src/styles/market.css`

**Step 1: Apply the visual changes**

- Add market-only inset spacing, border, and radius matching the tactical-board frame.
- Give the chart frame a bounded height and keep the readout directly below it so the order book is not pushed below the viewport.
- Increase axis, legend, readout, tooltip, and summary supporting text sizes by one hierarchy level.
- Style tooltip with opaque dark background, accent border, shadow, 13px time, and 15–16px price values.
- Add visible focus rings and active point halos without reintroducing animation or page-wide selector changes.
- Preserve the existing tablet/mobile breakpoints and stack tooltip/readout safely on narrow screens.

**Step 2: Run unit/build checks**

Run: `npm --prefix front-codex run test:unit && npm --prefix front-codex run build && npm --prefix front-codex run check:bundle`

Expected: PASS.

### Task 4: Verify regression behavior and package the change

**Files:**
- No additional source files.

**Step 1: Run market E2E regression**

Run: `npx playwright test tests/e2e/specs/market.spec.js --workers=1`

Expected: All market tests pass, including desktop, tablet, keyboard, tooltip, and no-overflow coverage.

**Step 2: Check formatting and diff**

Run: `git diff --check`

Expected: no output and exit code 0.

**Step 3: Commit**

```bash
git add front-codex/src/pages/MarketTrendChart.jsx front-codex/src/styles/market.css front-codex/tests/e2e/specs/market.spec.js docs/plans/2026-09-26-market-hover-clarity.md
git commit -m "fix(market): clarify chart hover details"
```
