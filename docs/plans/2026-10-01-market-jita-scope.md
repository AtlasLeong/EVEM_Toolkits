# 吉他海四市场范围标识 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在市场价格页面明确显示当前报价来自吉他海四（Jita IV - Moon 4），并让后端与前端共享稳定的范围元数据，同时保持现有 `scope=global` 客户端兼容。

**Architecture:** 后端集中定义固定的市场范围元数据，在物品列表、物品行和历史序列响应中返回；前端优先使用 API 返回的 `market_scope.label`，缺少元数据时将旧的 `global` 映射为“吉他海四”。页面在标题、当前物品信息和盘口摘要处显示范围，不改变采集协议或快照表结构。

**Tech Stack:** Django REST Framework、React、Vitest、Playwright、现有市场 CSS。

---

### Task 1: Add failing backend contract tests

**Files:**
- Modify: `backend/Market/tests/test_terminal_api.py`

**Steps:**
1. Add an items API assertion that the top-level response and each item include `market_scope` with key `jita_h4`, protocol scope `8`, and label `吉他海四`.
2. Extend the series API exact-body assertion to require the same metadata.
3. Run the targeted Django tests and confirm they fail because the response has no `market_scope` yet.

### Task 2: Implement backend market scope metadata

**Files:**
- Create: `backend/Market/scope.py`
- Modify: `backend/Market/serializers.py`
- Modify: `backend/Market/views.py`

**Steps:**
1. Define one immutable-source dictionary and a function returning a fresh payload for the fixed protocol scope 8.
2. Add the metadata to `item_payload` and the public items response without changing the existing `scope` compatibility field.
3. Add the metadata to the public series response.
4. Re-run the targeted tests and then the full Market API test module.

### Task 3: Add failing frontend display coverage

**Files:**
- Modify: `front-codex/tests/e2e/specs/market-focus-terminal.spec.js`
- Modify: `front-codex/tests/e2e/specs/market.spec.js` (only if the shared fixture needs the contract)

**Steps:**
1. Add `market_scope` to the mocked items/series payload used by the market terminal test.
2. Assert that the page exposes the explicit text `价格范围：吉他海四` in the market header and summary.
3. Run the focused Playwright test and confirm it fails before the UI change.

### Task 4: Implement frontend label resolution and layout

**Files:**
- Modify: `front-codex/src/pages/MarketPrices.jsx`
- Modify: `front-codex/src/styles/market-focus.css` (or the existing market stylesheet containing the header styles)

**Steps:**
1. Update `marketScopeLabel` to prefer metadata labels and map legacy `global` to `吉他海四`.
2. Resolve scope metadata from list, series, or selected item data, preserving old fixtures.
3. Render a visible scope chip in the page header, current instrument block, and quote summary.
4. Add responsive, non-intrusive chip styling consistent with the current terminal UI.
5. Re-run the focused Playwright test and frontend unit tests.

### Task 5: Document and verify the change

**Files:**
- Modify: `docs/market-prices.md`

**Steps:**
1. Document that protocol scope 8 is currently presented as the confirmed 吉他海四 market range while retaining the internal compatibility value `global`.
2. Run backend Market tests, frontend unit tests, and the focused market e2e test.
3. Review the diff for accidental changes and commit the implementation separately from the plan.

