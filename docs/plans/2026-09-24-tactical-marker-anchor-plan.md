# Tactical Marker Anchor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every tactical map card prefer a centered position directly above or below its owning star system, falling back to side placement only when necessary.

**Architecture:** Keep the existing deterministic `layoutForceMarkers` solver and preferred-slot persistence. Add explicit vertical candidate tiers and a soft star-name reservation so real obstacles still win while vertical centering wins over cosmetic text spacing. The SVG rendering and backend contracts remain unchanged.

**Tech Stack:** React, SVG, plain JavaScript layout utilities, Node test runner, Playwright.

---

### Task 1: Add regression coverage for centered vertical anchors

**Files:**
- Modify: `front-codex/tests/unit/tacticalMarkerLayout.test.mjs`
- Test: `front-codex/tests/unit/tacticalMarkerLayout.test.mjs`

**Step 1: Write the failing tests**

Add tests that assert a clear single-card layout has its horizontal center equal to the system point and uses the centered-above slot; add a second test that places a soft name-area reservation over the above candidate and still expects the centered-below candidate before any side candidate.

**Step 2: Run tests to verify they fail**

Run:

```bash
cd front-codex
node --test tests/unit/tacticalMarkerLayout.test.mjs
```

Expected: the new centered-anchor assertions fail against the current slot order/obstacle scoring.

**Step 3: Commit the red tests**

```bash
git add front-codex/tests/unit/tacticalMarkerLayout.test.mjs
git commit -m "test: define centered tactical marker anchors"
```

### Task 2: Implement vertical-first marker placement

**Files:**
- Modify: `front-codex/src/utils/tacticalMarkerLayout.js`
- Test: `front-codex/tests/unit/tacticalMarkerLayout.test.mjs`

**Step 1: Implement the minimal layout change**

Refactor the candidate list into explicit groups: centered-above, centered-below, bounded horizontal nudges of those vertical candidates, then left/right candidates. Keep toolbars, reserved UI rectangles, already placed cards, and nearby star centers as hard conflicts. Exclude only the star-name reservation from hard blocking (or give it a lower score) so the card can remain vertically centered when the text is the only conflict. Preserve `slot`, `preferredSlots`, viewport clamping, row centering, and leader endpoints.

**Step 2: Run the focused unit tests**

Run:

```bash
cd front-codex
node --test tests/unit/tacticalMarkerLayout.test.mjs tests/unit/tacticalMapPresentation.test.mjs
```

Expected: all focused layout tests pass, including the new centered-anchor tests and existing non-overlap/stable-slot tests.

**Step 3: Commit the implementation**

```bash
git add front-codex/src/utils/tacticalMarkerLayout.js front-codex/tests/unit/tacticalMarkerLayout.test.mjs
git commit -m "fix(tactical): anchor map cards above or below systems"
```

### Task 3: Verify tactical rendering and responsive behavior

**Files:**
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`
- Test: `front-codex/tests/tactical-e2e/map-scope.spec.js`

**Step 1: Run the tactical E2E suite**

Run:

```bash
cd front-codex
npx playwright test tests/tactical-e2e --workers=1
```

Expected: all tactical tests pass; existing drag, close, leader-line, dense-map, and wheel-zoom coverage remains green.

**Step 2: Run the production build**

Run:

```bash
cd front-codex
npm run build
```

Expected: Vite build and bundle budget complete successfully.

**Step 3: Inspect the local preview**

Open the local tactical preview and check a single star, a dense cluster, a viewport edge, and a wheel zoom. Confirm cards are centered above/below when clear and use a leader line plus side fallback only when required.

### Task 4: Final verification and handoff

**Files:**
- Modify: none

**Step 1: Run the focused regression command**

```bash
cd front-codex
node --test tests/unit/tacticalMarkerLayout.test.mjs tests/unit/tacticalMapPresentation.test.mjs
npx playwright test tests/tactical-e2e --workers=1
```

Expected: zero failures.

**Step 2: Check repository state**

```bash
git status --short
git log -4 --oneline
```

Expected: only intended commits and no generated test artifacts.

**Step 3: Report the result**

Include the changed files, test counts, local preview URL, and whether deployment is requested separately.
