# Board Security Colors Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Color system dots on both tactical boards by security status using the navigation map's five bands.

**Architecture:** Move the existing navigation palette into a shared pure utility. The shared board SVG glyph reads the same palette for its dot while keeping selection/report emphasis on a separate ring. No map data or backend contract changes.

**Tech Stack:** React SVG, JavaScript, Node test runner, Playwright, Vite.

---

### Task 1: Shared palette

**Files:**
- Modify: `front-codex/src/utils/securityColor.js`
- Modify: `front-codex/src/components/tactical/TacticalStarMap.jsx`
- Create: `front-codex/tests/unit/securityMapColor.test.mjs`

**Step 1:** Write a unit test importing the utility. Assert the navigation palette at `-0.1`, `0`, `0.1`, `0.2`, `0.49`, `0.5`, `0.79`, `0.8`, and `1`, plus gray for `null`, `undefined`, `NaN`, and infinity.

**Step 2:** Run `node --test tests/unit/securityMapColor.test.mjs` in `front-codex`; confirm RED because the named function does not exist.

**Step 3:** Export `getSecurityMapColor` from `securityColor.js` with the existing navigation hex values and explicit finite-number handling. Replace the private `getSecurityColor` in `TacticalStarMap.jsx` with the shared import.

**Step 4:** Rerun the focused test; expect all cases to pass.

### Task 2: Board glyph

**Files:**
- Modify: `front-codex/tests/unit/boardMapPrimitives.test.mjs`
- Modify: `front-codex/src/components/tactical/BoardMapPrimitives.jsx`

**Step 1:** Update tests for the shared `BoardStarGlyph` to assert red for the existing negative-security fixture in ordinary, selected, reported, related and pirate-class cases. Assert ring colors and fixed-size geometry remain unchanged. Add a green and unknown-security dot case.

**Step 2:** Run `node --test tests/unit/boardMapPrimitives.test.mjs`; confirm RED on the old neutral/status dot fill.

**Step 3:** Use `getSecurityMapColor(node.security_status)` for the dot fill. Keep current ring color/status priority, radius and transparent hit target. If related state needs emphasis, keep it separate from dot fill.

**Step 4:** Rerun focused tests; expect PASS.

### Task 3: Regression and real-map check

**Files:**
- Verify only; no production edits expected.

**Step 1:** Run `node --test tests/unit/*.test.mjs` and `npm run build` in `front-codex`.

**Step 2:** Run `npx playwright test -c tests/tactical-e2e/playwright.config.js pirate-density.spec.js tactical.spec.js`.

**Step 3:** Check the actual local board with `EVEM 公开静态星图快照` and both board tabs. Inspect colored nodes, selected/report outlines, label contrast and zoom. Do not present the synthetic density fixture as a real map preview.

**Step 4:** Review `git diff --check`, changed files and status. Commit scoped source/tests locally; do not push or deploy without a separate request.
