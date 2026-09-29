# Client Icon Verification Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-only icon candidate verification workflow and safely consume confirmed client icon mappings in the manufacturing/market UI.

**Architecture:** A small pure-data mapping module validates confirmed records and resolves an item ID to a production asset. A Vite dev-only route loads a generated candidate manifest, keeps draft bindings in local storage, and exports reviewed JSON; it never ships the raw extraction directory. `MarketItemIcon` consumes confirmed mappings first, then the existing allowlist and fallback.

**Tech Stack:** React, React Router, Vite, Vitest/Node unit tests, Playwright, Node `sharp`, JSON manifests, lucide-react.

---

### Task 1: Add mapping schema and resolver tests

**Files:**
- Create: `front-codex/src/utils/clientIconMapping.js`
- Create: `front-codex/src/data/confirmed-client-icon-mapping.json`
- Test: `front-codex/tests/unit/clientIconMapping.test.mjs`

**Step 1: Write the failing test**

Cover valid records, duplicate item/path rejection, path traversal rejection, revoked/conflict exclusion, and resolver fallback for unknown IDs.

**Step 2: Run test to verify it fails**

Run: `npm --prefix front-codex run test:unit -- clientIconMapping.test.mjs`

Expected: FAIL because the mapping module and fixture do not exist.

**Step 3: Write minimal implementation**

Implement `normalizeClientIconMapping`, `getConfirmedClientIcon`, and `getClientIconMappingStatus`. Require positive numeric item IDs, `confirmed` status, a local `/images/client-items/` path, SHA-256 metadata, and unique item/path values. Ship an empty schema-versioned mapping fixture.

**Step 4: Run test to verify it passes**

Run: `npm --prefix front-codex run test:unit -- clientIconMapping.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/utils/clientIconMapping.js front-codex/src/data/confirmed-client-icon-mapping.json front-codex/tests/unit/clientIconMapping.test.mjs
git commit -m "feat: add validated client icon mapping resolver"
```

### Task 2: Add offline candidate manifest preparation

**Files:**
- Create: `front-codex/scripts/prepare-client-icon-candidates.mjs`
- Modify: `front-codex/package.json`
- Create: `front-codex/tests/unit/clientIconCandidates.test.mjs`

**Step 1: Write the failing test**

Test manifest filtering and normalization from `decoded-images-manifest.json`: accept decoded PNGs, preserve source hash/dimensions, reject missing files and unsupported dimensions, and produce stable relative URLs without `..` segments.

**Step 2: Run test to verify it fails**

Run: `npm --prefix front-codex run test:unit -- clientIconCandidates.test.mjs`

Expected: FAIL because the preparation module does not exist.

**Step 3: Write minimal implementation**

Implement a CLI that accepts `--manifest`, `--images`, and `--out`; writes a compact `manifest.json` plus generated 96px WebP thumbnails under a local ignored directory. Do not copy the original extraction tree. Add `icons:prepare` to `package.json` with no default external path.

**Step 4: Run test to verify it passes**

Run: `npm --prefix front-codex run test:unit -- clientIconCandidates.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/scripts/prepare-client-icon-candidates.mjs front-codex/package.json front-codex/tests/unit/clientIconCandidates.test.mjs
git commit -m "feat: prepare local client icon candidate manifest"
```

### Task 3: Build the dev-only verification page

**Files:**
- Create: `front-codex/src/pages/IconVerification.jsx`
- Create: `front-codex/src/styles/iconVerification.css`
- Modify: `front-codex/src/App.jsx`
- Modify: `front-codex/src/styles.css`
- Test: `front-codex/tests/unit/IconVerification.test.mjs`

**Step 1: Write the failing test**

Cover item search, candidate filtering, selecting a candidate, binding, conflict warning, revoke, and export payload. Include an empty-manifest state that tells the developer to run `icons:prepare`.

**Step 2: Run test to verify it fails**

Run: `npm --prefix front-codex run test:unit -- IconVerification.test.mjs`

Expected: FAIL because the page and route do not exist.

**Step 3: Write minimal implementation**

Add a dev-only route guarded by `import.meta.env.DEV`. Use a three-pane layout: catalog items, paginated candidate grid, and binding inspector. Keep drafts in `localStorage`; export a schema-validated JSON file. Never render internal item IDs as the primary label; show them only in the inspector metadata.

**Step 4: Run test to verify it passes**

Run: `npm --prefix front-codex run test:unit -- IconVerification.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/pages/IconVerification.jsx front-codex/src/styles/iconVerification.css front-codex/src/App.jsx front-codex/src/styles.css front-codex/tests/unit/IconVerification.test.mjs
git commit -m "feat: add local client icon verification page"
```

### Task 4: Connect confirmed mappings to the shared icon component

**Files:**
- Modify: `front-codex/src/utils/marketItemIcons.js`
- Modify: `front-codex/src/components/MarketItemIcon.jsx`
- Modify: `front-codex/tests/unit/marketItemIcons.test.mjs`
- Create: `front-codex/public/images/client-items/.gitkeep`

**Step 1: Write the failing test**

Add a confirmed mapping fixture and assert it wins over the legacy allowlist; assert revoked, unknown, and failed image loads still render the existing package fallback.

**Step 2: Run test to verify it fails**

Run: `npm --prefix front-codex run test:unit -- marketItemIcons.test.mjs`

Expected: FAIL because the resolver is not consulted.

**Step 3: Write minimal implementation**

Resolve in this order: confirmed client mapping, legacy approved WebP, null. Keep the component’s lazy loading, error recovery, sizing, and accessibility behavior unchanged.

**Step 4: Run test to verify it passes**

Run: `npm --prefix front-codex run test:unit -- marketItemIcons.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/utils/marketItemIcons.js front-codex/src/components/MarketItemIcon.jsx front-codex/tests/unit/marketItemIcons.test.mjs front-codex/public/images/client-items/.gitkeep
git commit -m "feat: consume confirmed client item icons"
```

### Task 5: Add end-to-end verification and build checks

**Files:**
- Create: `front-codex/tests/e2e/specs/icon-verification.spec.js`
- Modify: `front-codex/playwright.config.js` (only if the dev route needs a fixture)
- Modify: `front-codex/README.md`

**Step 1: Write the failing test**

Exercise the dev route with a small fixture manifest: search an item, bind a candidate, export JSON, reload, and verify the mapping remains visible. Verify the production route does not expose the dev page when `DEV` is false.

**Step 2: Run test to verify it fails**

Run: `npm --prefix front-codex run test:e2e -- icon-verification.spec.js`

Expected: FAIL because the route and fixture wiring are incomplete.

**Step 3: Write minimal implementation**

Add fixture loading only for the test environment, document `icons:prepare`, and keep generated candidates ignored. Do not add the route to ordinary navigation.

**Step 4: Run the full verification suite**

Run:

```bash
npm --prefix front-codex run test:unit
npm --prefix front-codex run build
npm --prefix front-codex run check-bundle
npm --prefix front-codex run test:e2e -- icon-verification.spec.js manufacturing.spec.js
git diff --check
```

Expected: all tests pass; build and bundle checks pass; no whitespace errors.

**Step 5: Commit**

```bash
git add front-codex/tests/e2e/specs/icon-verification.spec.js front-codex/playwright.config.js front-codex/README.md
git commit -m "test: verify client icon workflow and production fallback"
```

### Task 6: Review and release the mapping workflow

**Files:**
- Review: `docs/plans/2026-09-29-client-icon-verification-tool.md`
- Review: `front-codex/src/utils/clientIconMapping.js`
- Review: `front-codex/src/pages/IconVerification.jsx`

**Step 1:** Run `git status --short` and confirm unrelated user changes remain unstaged.

**Step 2:** Inspect the final diff for path safety, bundle size, accidental raw-resource copies, and dev-only route guards.

**Step 3:** If checks pass, create the scoped release commit/PR according to the user’s requested deployment workflow; do not stage unrelated files.
