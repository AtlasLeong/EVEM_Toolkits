# Market Chart and P1/P2 Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split market buy/sell history into readable synchronized charts with range statistics, while addressing the highest-impact market, tactical-map, accessibility, and polling issues found in the audit.

**Architecture:** Extend the existing market series response with current/range/month statistics and preserve extrema during server-side sampling. Render two reusable price-series panels sharing the selected time range, with responsive stacking and keyboard-accessible tooltips. Improve account-pool failure isolation, tactical drag frame coalescing, and selected P1/P2 feedback without changing the existing API authentication model.

**Tech Stack:** Django REST Framework, Django ORM/MySQL-compatible queries, React 18, TanStack Query, SVG/Canvas, Playwright, Python unittest/Django TestCase.

---

### Task 1: Market series contract and account-pool resilience

**Files:**
- Modify: `backend/Market/views.py`
- Modify: `backend/Market/models.py`
- Modify: `backend/Market/session_bundle.py`
- Modify: `backend/Market/worker.py`
- Test: `backend/Market/tests/test_terminal_api.py`
- Test: `backend/Market/tests/test_worker.py`
- Test: `backend/Market/tests/test_session_export.py` or a focused new Market test module

**Steps:**
1. Add failing tests for current/range/month statistics, null-only series, a single sample, and extrema-preserving sampling.
2. Add a failing test proving a malformed session file is skipped while another valid session remains usable, and an authentication failure does not permanently disable the whole pool when another session can be tried.
3. Run the focused Django tests and confirm the new assertions fail for the expected missing behavior.
4. Implement the response contract, one-month aggregate/statistics calculation, composite snapshot index, and bounded sampling that keeps first/last/min/max representatives.
5. Implement per-session validation/selection and worker fallback with sanitized status handling; preserve the existing no-password/session-file security boundary.
6. Run focused tests, then the full Market test group.

### Task 2: Market terminal split charts and responsive UI

**Files:**
- Modify: `front-codex/src/pages/MarketPrices.jsx`
- Modify: `front-codex/src/pages/MarketTrendChart.jsx` or extract a reusable chart panel
- Modify: `front-codex/src/styles/market.css`
- Test: `front-codex/tests/e2e/specs/market.spec.js`
- Test: `front-codex/tests/e2e/specs/market-chart-release.spec.js`

**Steps:**
1. Add failing browser tests for two distinct buy/sell charts, current/range/month statistics, exact tooltip values, keyboard point navigation, no flash during item switching, and responsive desktop/tablet/mobile layout.
2. Run the focused Playwright tests and confirm they fail against the current single-chart UI.
3. Implement two synchronized chart panels with compact approximate axes, exact readouts, high/low/current markers, and explicit buy/sell labels. Keep the existing order-book section.
4. Add a clock tick for stale labels, hide tooltip until measured, use a stable tooltip id/`aria-describedby`, and support ArrowLeft/ArrowRight navigation across observations.
5. Consolidate the relevant market responsive rules and add a reduced-motion path without changing the established warm/dark terminal frame.
6. Run focused market E2E tests at 1920x1080, 1440x900, 1280x720, 1180x680, 390x844, then the full frontend E2E suite.

### Task 3: Tactical interaction performance and semantics

**Files:**
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/components/tactical/TacticalStarMap.jsx`
- Modify: `front-codex/src/components/tactical/TacticalControls.jsx`
- Modify: `front-codex/src/components/tactical/PirateIntelBoard.jsx`
- Modify: `front-codex/src/App.jsx`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`
- Test: `front-codex/tests/unit/*.test.mjs` as appropriate

**Steps:**
1. Add failing tests for drag update coalescing, non-nested interactive close controls, select/dialog semantics, refresh busy state, and non-smooth route reset.
2. Run the focused tests and verify the failures identify the existing behavior.
3. Implement requestAnimationFrame coalescing for map drag, preserve pointer-up authority, and avoid full React renders for intermediate pointer events.
4. Separate nested SVG action controls into sibling semantics, improve dialog/select accessibility, and preserve keyboard activation.
5. Add refresh busy/last-sync feedback and use instant route reset unless reduced-motion/user preferences require otherwise.
6. Run tactical unit/E2E tests and a dense-map performance smoke test.

### Task 4: Polling, search, and visual-regression hardening

**Files:**
- Modify: `front-codex/src/pages/MarketPrices.jsx`
- Modify: `front-codex/src/pages/MarketAdmin.jsx`
- Modify: `backend/Market/views.py`
- Modify: `front-codex/src/styles/market.css`
- Test: market and tactical Playwright specs

**Steps:**
1. Add failing tests for visible-tab polling/backoff, inline retry, search behavior, and 1180–1300px collision/overflow cases.
2. Reduce duplicate polling, add retry/backoff and explicit fetch status, and keep old data visible without presenting it as fresh.
3. Replace unindexed broad search behavior with an indexed/prefix-compatible path where supported, retaining safe fallback behavior for the existing catalog.
4. Normalize touch target sizes, secondary text contrast, and responsive breakpoints without changing desktop content hierarchy.
5. Run the full frontend build, bundle check, backend Market tests, frontend unit tests, and viewport matrix.

### Task 5: Review and handoff

**Steps:**
1. Inspect the complete diff for unrelated changes and confirm the pre-existing untracked archives/output files remain untouched.
2. Run all relevant verification commands and record exact pass/fail counts.
3. Do not deploy until the user reviews the local result or explicitly asks to push; prepare a concise deployment checklist if requested.
