# Market Terminal Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将公开市场页改造成铺满应用工作区的稳定三栏交易终端，并把根路由默认入口切换到市场。

**Architecture:** 保留现有 React Query 数据服务和走势图组件，只调整市场页的布局骨架、数据保持策略与可见文案。左栏负责分类和物品切换，中栏承载走势图与盘口深度，右栏承载报价摘要；查询使用 `placeholderData` 保留上一份结果，图表不再通过 React `key` 强制卸载。响应式断点下三栏改为纵向/抽屉式布局，继续满足手机端不横向溢出。

**Tech Stack:** React 18, React Router, TanStack Query, CSS Grid/Flexbox, Playwright E2E, Vite.

---

### Task 1: Lock the requested UI and route behavior with failing tests

**Files:**
- Modify: `front-codex/tests/e2e/specs/market.spec.js`
- Modify: `front-codex/tests/e2e/specs/shell-nav.spec.js`

**Step 1: Write the failing tests**

- Assert the public terminal does not expose an item ID in the catalog or selected instrument heading.
- Assert the old chart footnote and change-calculation summary are absent.
- Assert changing an item keeps the terminal main region mounted/visible while the new series request is pending.
- Assert `/` redirects to `/market` and the shell highlights market navigation.

**Step 2: Run the focused tests to verify they fail**

Run: `npm --prefix front-codex run test:e2e -- tests/e2e/specs/market.spec.js tests/e2e/specs/shell-nav.spec.js`

Expected: FAIL because the current JSX renders IDs/notes, remounts the chart, and the root route points to `/fraudlist`.

### Task 2: Implement stable three-pane terminal data flow

**Files:**
- Modify: `front-codex/src/pages/MarketPrices.jsx`
- Modify: `front-codex/src/pages/MarketTrendChart.jsx` only if the existing chart needs a stable wrapper/test hook

**Step 1: Preserve previous query data while switching**

- Add TanStack Query `placeholderData: previousData => previousData` and a nonzero `staleTime` to categories, item list, and series queries.
- Render loading/error messages as compact status indicators when previous data exists instead of replacing the full pane.
- Remove the chart `key` so item/range changes update props without forced unmount/remount.

**Step 2: Remove nonessential identifiers and notes**

- Keep the category label in the item list, but remove the visible `ID ...` text.
- Replace the selected instrument eyebrow with a neutral market context label.
- Remove the chart footnote and the right-column calculation explanation.

**Step 3: Move depth into the main workspace**

- Render the existing sell/buy `PriceLadder` pair below the chart in a `market-depth-panel`.
- Keep the right column focused on the two quote cards and latest sample metadata.

### Task 3: Implement full-bleed terminal styling and responsive behavior

**Files:**
- Modify: `front-codex/src/styles/market.css`

**Step 1: Fill the available application height**

- Remove the desktop max-width constraint from the public terminal.
- Use a viewport-aware grid height with `min-height: calc(100dvh - var(--app-shell-offset))` and `minmax(0, 1fr)` tracks.
- Make the center pane a flex column; give the chart and depth panel flexible heights so the lower workspace is not empty.

**Step 2: Preserve stable visual structure**

- Add a compact fetching indicator that does not change pane dimensions.
- Style the depth panel as a two-column order-book block.
- Keep scroll ownership in the catalog and center content rather than the document body.

**Step 3: Verify responsive layouts**

- At medium widths collapse the summary below the center pane.
- At phone widths use a vertical stack and preserve existing no-overflow behavior.

### Task 4: Change default routing and update regression tests

**Files:**
- Modify: `front-codex/src/App.jsx`
- Modify: `front-codex/tests/e2e/specs/shell-nav.spec.js`

**Step 1: Change redirects**

- Point the index route and wildcard fallback to `/market`.
- Leave explicit `/fraudlist` and fraud admin routes unchanged.

**Step 2: Run focused tests**

Run: `npm --prefix front-codex run test:e2e -- tests/e2e/specs/market.spec.js tests/e2e/specs/shell-nav.spec.js`

Expected: PASS, including the existing mobile overflow checks.

### Task 5: Build, review, and publish

**Files:**
- No additional source files unless verification reveals a scoped defect.

**Step 1: Run unit/build checks**

Run: `npm --prefix front-codex test`

Run: `npm --prefix front-codex run build`

Run: `git diff --check`

**Step 2: Review the diff**

- Confirm only market UI, routing, tests, and this plan changed.
- Confirm no market credentials, session files, or production configuration are committed.

**Step 3: Commit and push**

```bash
git add docs/plans/2026-09-25-market-terminal-layout.md front-codex/src/App.jsx front-codex/src/pages/MarketPrices.jsx front-codex/src/styles/market.css front-codex/tests/e2e/specs/market.spec.js front-codex/tests/e2e/specs/shell-nav.spec.js
git commit -m "feat(market): redesign public terminal layout"
git push -u origin codex/market-terminal-layout
```

**Step 4: Open, attach, and merge the PR**

- Create a PR targeting `master`.
- Attach the PR to this task.
- Wait for required checks, merge it, and verify the automatic deployment version and public `/market` route.
