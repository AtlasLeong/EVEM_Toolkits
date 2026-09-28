# Manufacturing Terminal Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将制造估价页重做为与市场页同源的深色终端，并让路线选中态和大额 ISK 金额清晰可读。

**Architecture:** 保留制造计划与行情服务，只改 `ManufacturingEstimator.jsx` 的展示层和 `manufacturing.css` 的 scoped 样式。金额紧凑格式化作为页面内纯函数导出，单元测试直接验证边界；E2E 验证用户可见的路线控件和摘要文案。

**Tech Stack:** React, Vite, CSS, Playwright, Node test runner.

---

### Task 1: Add compact ISK formatter tests

**Files:**
- Modify: `front-codex/src/pages/ManufacturingEstimator.jsx`
- Create: `front-codex/tests/unit/manufacturingDisplay.test.mjs`

**Step 1: Write the failing test**

Add tests for exact values below 10,000, the `万` range, the `亿` range, and null values. Import the named `formatCompactIsk` export from the page module.

**Step 2: Run test to verify it fails**

Run: `node --test tests/unit/manufacturingDisplay.test.mjs`
Expected: FAIL because `formatCompactIsk` is not exported.

**Step 3: Write minimal implementation**

Add a pure formatter that returns `待补价格` for absent values, keeps two decimal places at most, and returns `约 N.NN 万 ISK` or `约 N.NN 亿 ISK` for larger values.

**Step 4: Run test to verify it passes**

Run: `node --test tests/unit/manufacturingDisplay.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/pages/ManufacturingEstimator.jsx front-codex/tests/unit/manufacturingDisplay.test.mjs
git commit -m "test: cover compact manufacturing isk display"
```

### Task 2: Rebuild manufacturing summary and route markup

**Files:**
- Modify: `front-codex/src/pages/ManufacturingEstimator.jsx`
- Modify: `front-codex/tests/e2e/specs/manufacturing.spec.js`

**Step 1: Write the failing E2E assertions**

Assert the summary shows both the exact total and a compact `万/亿 ISK` label, the route group exposes buttons with visible “自造” and “购买” labels, the active button has `aria-pressed=true`, and the selected node exposes an explicit selected state.

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`
Expected: FAIL on compact amount or selected-state assertions.

**Step 3: Implement minimal markup changes**

Add compact amount beneath the exact total, add stable `data-testid`/ARIA hooks for selected tree rows and route buttons, and keep node text and route controls separate so selecting a row never changes its production mode.

**Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`
Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/pages/ManufacturingEstimator.jsx front-codex/tests/e2e/specs/manufacturing.spec.js
git commit -m "feat: clarify manufacturing route and cost states"
```

### Task 3: Apply market terminal visual system

**Files:**
- Modify: `front-codex/src/styles/manufacturing.css`

**Step 1: Write the failing visual contract check**

Extend the E2E checks to assert the manufacturing root uses the terminal modifier and that the selected route has a non-transparent active background and visible text. This protects the reported invisible selected state.

**Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`
Expected: FAIL until the new terminal modifier and contrast styles exist.

**Step 3: Implement the terminal layout**

Scope market-inspired tokens to `.manufacturing-page--terminal`; use a dark slate canvas, thin separators, compact three-column grid, chart-terminal-like header, explicit cyan/amber semantics, visible active state, focus rings, readable form controls, and responsive stacking below 900px. Remove reliance on the old warm-neutral override by making the new modifier the final stylesheet layer.

**Step 4: Run test and build**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`
Run: `npm run build`
Expected: both exit 0.

**Step 5: Commit**

```bash
git add front-codex/src/styles/manufacturing.css
git commit -m "feat: restyle manufacturing page as market terminal"
```

### Task 4: Regression verification and local preview

**Files:**
- No source changes expected.

**Step 1: Run focused unit tests**

Run: `node --test tests/unit/manufacturingDisplay.test.mjs tests/unit/manufacturingCatalog.test.mjs tests/unit/manufacturingPlan.test.mjs tests/unit/manufacturingQuoteAdapter.test.mjs`
Expected: all tests pass.

**Step 2: Run focused E2E**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js --project=chromium`
Expected: 1 passed.

**Step 3: Run production build and whitespace check**

Run: `npm run build` and `git diff --check`
Expected: build exit 0 and no diff errors.

**Step 4: Refresh local preview**

Open `http://127.0.0.1:4173/manufacturing`, verify desktop and narrow viewport layouts, then mark the tab deliverable for the user.

