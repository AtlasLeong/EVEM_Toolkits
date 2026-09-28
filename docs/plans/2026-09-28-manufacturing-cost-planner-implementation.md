# Manufacturing Cost Planner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a local-only manufacturing estimator that expands the approved ship/material/building recipe scope, defaults to self-manufacturing, supports per-node purchase overrides, and never reports missing prices as zero or as a complete total.

**Architecture:** Keep recipe data and computation in small frontend modules. Fetch a normalized, scope-limited fixture from `public/industry/` instead of bundling the full research JSON. Use the existing public Market API only for best-sell reference quotes, with explicit stale/uncollected handling. Render the estimator as a new route and scoped stylesheet; no backend schema, market snapshot, account session, or deployment changes in this phase.

**Tech Stack:** React 18, React Router, existing Vite app, native `node:test` unit tests, Playwright E2E.

---

### Task 1: Add normalized local recipe/catalog fixture

**Files:**
- Create: `front-codex/public/industry/manufacturing-scope.json`
- Create: `front-codex/src/utils/manufacturingCatalog.js`
- Test: `front-codex/tests/unit/manufacturingCatalog.test.mjs`

**Step 1: Write the failing test**

Cover the approved scope only (ships, industrial materials, buildings; no ammunition), stable product IDs, normalized product names, `outputNum`, `materials`, `money`, `time`, and `maxInstallQuantity`. Assert that malformed recipes and duplicate IDs are rejected.

**Step 2: Run it to verify it fails**

Run: `node --test tests/unit/manufacturingCatalog.test.mjs`
Expected: FAIL because the catalog loader does not exist.

**Step 3: Write minimal implementation**

Generate a committed, normalized fixture from the already reviewed research data and the verified local name mappings. The loader validates schema, filters the three allowed categories, and exposes maps by product ID and name. Do not use the research file's garbled `name` values in UI.

**Step 4: Run it to verify it passes**

Run: `node --test tests/unit/manufacturingCatalog.test.mjs`
Expected: PASS, including a no-ammunition assertion.

**Step 5: Commit**

```bash
git add front-codex/public/industry/manufacturing-scope.json front-codex/src/utils/manufacturingCatalog.js front-codex/tests/unit/manufacturingCatalog.test.mjs
git commit -m "feat: add normalized manufacturing recipe fixture"
```

### Task 2: Implement pure plan expansion and cost state

**Files:**
- Create: `front-codex/src/utils/manufacturingPlan.js`
- Test: `front-codex/tests/unit/manufacturingPlan.test.mjs`

**Step 1: Write the failing test**

Test output batch ceiling, recursive self-manufacturing, same-material aggregation, a purchased intermediate pruning its subtree, per-plan manual price precedence, and missing/stale/empty quote states. Assert that incomplete totals return `complete: false` with missing item IDs and never coerce missing prices to zero.

**Step 2: Run it to verify it fails**

Run: `node --test tests/unit/manufacturingPlan.test.mjs`
Expected: FAIL because plan calculation functions do not exist.

**Step 3: Write minimal implementation**

Implement deterministic functions (`createPlan`, `expandPlan`, `summarizePlan`) using integer/decimal-safe arithmetic. Preserve route choices and manual prices in plan state; treat quotes as read-only snapshots. Apply no unverified skill/building formula: expose raw recipe fee/time and a `formulaStatus: "unverified"` marker.

**Step 4: Run it to verify it passes**

Run: `node --test tests/unit/manufacturingPlan.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/utils/manufacturingPlan.js front-codex/tests/unit/manufacturingPlan.test.mjs
git commit -m "feat: calculate manufacturing plan routes and gaps"
```

### Task 3: Add market quote adapter and estimator page

**Files:**
- Create: `front-codex/src/services/apiManufacturing.js`
- Create: `front-codex/src/pages/ManufacturingEstimator.jsx`
- Create: `front-codex/src/styles/manufacturing.css`
- Modify: `front-codex/src/App.jsx` (narrow lazy import/route patch)
- Modify: `front-codex/src/components/layout/AppShell.jsx` (narrow nav item patch)
- Test: `front-codex/tests/unit/manufacturingQuoteAdapter.test.mjs`

**Step 1: Write the failing test**

Test quote normalization from Market `/items/` responses, chunking IDs within the existing page-size limit, and classification of `fresh`, `stale`, `empty`, `uncollected`, and absent items.

**Step 2: Run it to verify it fails**

Run: `node --test tests/unit/manufacturingQuoteAdapter.test.mjs`
Expected: FAIL because the adapter does not exist.

**Step 3: Write minimal implementation**

Use the existing public market service conventions. The page loads the local fixture, lets the user select a target and quantity, renders the tree, toggles make/buy, edits a plan-only purchase price, and shows a complete total only when every required purchase price and formula input is available. Include existing `MarketItemIcon` where the allowlist has an asset and a neutral package fallback otherwise. Add no real save endpoint in this phase; local browser state may be used only for the active draft.

**Step 4: Run it to verify it passes**

Run: `node --test tests/unit/manufacturingQuoteAdapter.test.mjs` and `npm run build`
Expected: PASS and a successful Vite build.

**Step 5: Commit**

```bash
git add front-codex/src/services/apiManufacturing.js front-codex/src/pages/ManufacturingEstimator.jsx front-codex/src/styles/manufacturing.css front-codex/src/App.jsx front-codex/src/components/layout/AppShell.jsx front-codex/tests/unit/manufacturingQuoteAdapter.test.mjs
git commit -m "feat: add manufacturing estimator workspace"
```

### Task 4: Add focused E2E regression coverage

**Files:**
- Create: `front-codex/tests/e2e/specs/manufacturing.spec.js`

**Step 1: Write the failing test**

Mock the public Market response and verify the route loads, switching a middle node to purchase collapses its children, editing the plan price updates the subtotal, and an unquoted required item produces a missing-price warning rather than a complete total.

**Step 2: Run it to verify it fails**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js`
Expected: FAIL before route/page implementation is present.

**Step 3: Adjust only the minimal selectors/behavior needed**

Use accessible labels and stable `data-testid` values for the estimator; do not rely on pixel coordinates or illustrative text.

**Step 4: Run it to verify it passes**

Run: `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/tests/e2e/specs/manufacturing.spec.js
git commit -m "test: cover manufacturing estimator interactions"
```

### Task 5: Verify the untouched areas and document boundaries

**Files:**
- Modify: `docs/plans/2026-09-28-manufacturing-cost-planner-design.md` (status and local-only implementation note)

**Step 1: Run focused and existing checks**

Run: `node --test tests/unit/manufacturing*.test.mjs tests/unit/market*.test.mjs`, `npm run build`, and `npm run test:e2e -- tests/e2e/specs/manufacturing.spec.js` from `front-codex`.

**Step 2: Inspect the diff**

Confirm no backend, market database, collector credentials, session files, or deployment manifests changed. Confirm existing user modifications in `App.jsx` and `AppShell.jsx` remain intact outside the narrow route/nav additions.

**Step 3: Report**

Present the local URL and test evidence. Clearly state that authenticated plan persistence, verified industry modifiers, and production deployment remain follow-up work.

