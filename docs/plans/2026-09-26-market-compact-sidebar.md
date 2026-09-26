# Market Compact Sidebar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make large chart prices readable and use the right sidebar for the existing order book.

**Architecture:** A pure string/BigInt formatter changes only chart statistic display. Move the existing order-book JSX into the summary sidebar, retain exact prices and responsive framed layout, and test browser geometry independently of formatting.

**Tech Stack:** React 18, CSS Grid/Flexbox, Node test runner, Playwright, Vite.

---

### Task 1: Compact statistic formatter

**Files:** Create `front-codex/src/utils/marketPrice.js`, `front-codex/tests/unit/marketPrice.test.mjs`.

1. Write tests for `21897981.37 -> 2189.8万`, `123456789 -> 1.23亿`, values below 万, zero, null, invalid input, unit promotion and values beyond Number precision. Expected missing output: 样本不足.
2. Run `node --test tests/unit/marketPrice.test.mjs` from front-codex and confirm expected failing assertion before implementation.
3. Implement `formatCompactMarketPrice(value)` using validated decimal strings and BigInt quotient/remainder rounding. Maximum two fractional digits, no trailing zeroes, no repeated currency suffix.
4. Rerun formatter tests. Review spec and quality independently.

### Task 2: Sidebar and responsive statistics

**Files:** Modify `front-codex/src/pages/MarketTrendChart.jsx`, `front-codex/src/pages/MarketPrices.jsx`, `front-codex/src/styles/market.css`; create `front-codex/tests/e2e/specs/market-compact-layout.spec.js`.

1. Add regression fixtures with real-shaped large prices, five levels per side and zero/missing values. Assert compact text, full title/accessibility text, no overflowing visible statistic values, sidebar-only depth, both empty-side messages, and all levels contained on desktop.
2. Run `PW_TEST_PORT=4294 npx playwright test tests/e2e/specs/market-compact-layout.spec.js --workers=2` (PowerShell env syntax) and record failures proving old behavior.
3. Wire the formatter into TrendStats; keep original full formatter for exact title and visually hidden text. Add ISK group label. Use content-aware wrapping without ellipsis.
4. Move the depth section into the sidebar; show empty sides explicitly; adjust sidebar cards/spacing and central rows so chart fills freed height. Preserve mobile/tablet access, dark styling and frame.
5. Run focused new and existing market suites, inspect screenshots at 1920x1080, 1440x900, 1366x768, 1200x768, tablet and mobile. Check short desktop scroll access.

### Task 3: Review and handoff

1. Run `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs` and `npm run build`.
2. Run `PW_TEST_PORT=4294 npx playwright test --workers=2` to detect unrelated frontend regressions.
3. Independent spec then code-quality review; fix any actionable findings with tests.
4. Commit only scoped files after fresh verification. Leave local branch ready for review; do not push/deploy without a new user request.

## Verification record — 2026-09-26

- Followed test-driven development: seven formatter test groups and the initial browser layout assertions failed against the old behavior before implementation.
- Final unit/preview suite: **354 passed**. Production build and bundle-budget check: **passed**.
- Final compact-layout browser suite: **21 passed**. Coverage includes exact hover/accessibility text, zero/missing values, empty order-book sides, desktop/tablet/mobile layout, short-screen access, and extreme-price width sweeps (320, 390, 420, 520, 1180, 1200, 1280, 1366 and 1440 px).
- Full browser regression on the final source: **293 passed, 4 timed out** out of 297. The failures occurred while loading the initial page/chart or while the focus test navigated through five pages; no layout assertion had failed. The unrelated focus test had already passed its 16 composite-input CSS assertions before the final login-page load exhausted its 30-second budget.
- Repeated all four failed cases **three times each with one worker and unchanged timeouts: 12 passed (29.5 seconds)**. No timeout increases or unrelated application/test changes were made. This supports a transient local loading issue, but the initial full-run failures remain recorded rather than being reported as a clean full run.
- Independent formatter specification/quality and sidebar specification/quality reviews completed. Fixed findings include extreme-price wrapping, consistent trimming for exact text, full-width mobile ladders, and the market-only 1180 px shell boundary.
- Visually checked desktop and mobile screenshots using test data. Stable previews: `output/playwright/market-compact-sidebar-desktop-20260926.png` and `output/playwright/market-compact-sidebar-mobile-20260926.png`.
- Scope remains frontend-only and local. No API, database, collection schedule, production deployment or push changes.
