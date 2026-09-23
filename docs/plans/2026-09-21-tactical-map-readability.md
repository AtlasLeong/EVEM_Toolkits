# Tactical Map Readability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the tactical map readable on dense real star data by defaulting to a constellation overview with a focused local system view, while retaining a real-space view for navigation and preserving tactical permissions.

**Architecture:** Keep the static universe layout independent from force reports. Build deterministic constellation-level nodes and gate edges for the overview, then switch to the existing system-level geometry for one constellation or the real-space scope. Use a camera model with safe-area fitting, pointer-anchored zoom, screen-space labels/force markers, nearest-target hit testing, and explicit boundary portals. The backend contract remains unchanged; all permissions continue to be enforced by the existing filtered snapshot.

**Tech Stack:** React 18, SVG/canvas-style map primitives already used by `CollaborationMap`, plain JavaScript utilities, Node `node:test`, Playwright.

---

### Task 1: Add deterministic map geometry helpers and regression tests

**Files:**
- Create: `front-codex/src/utils/tacticalMapLayout.js`
- Modify: `front-codex/tests/unit/tacticalCollaboration.test.mjs`
- Create: `front-codex/tests/unit/tacticalMapLayout.test.mjs`

**Step 1: Write the failing tests**

Cover one behavior per test:

- project a dense system set with a supplied `fitIds` so boundary outliers do not shrink the core;
- produce deterministic constellation overview nodes and inter-constellation edges regardless of input order;
- compute an overview force summary without changing node coordinates when reports change;
- return the nearest valid system in screen space, never the first array item;
- fit a camera into asymmetric map safe padding and keep zoom anchored at a pointer;
- expose boundary exits separately from loaded system nodes.

**Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/unit/tacticalMapLayout.test.mjs`

Expected: FAIL because the new module and helpers do not exist.

**Step 3: Implement the minimal helpers**

Implement stable, pure functions:

- `validSystems(systems)` and `projectSystemsScoped(systems, { fitIds, width, height, padding })`;
- `buildConstellationOverview(systems, stargates, constellations)` using sorted IDs and centroids, with edge source/destination IDs retained;
- `summarizeOverviewForces(forces, systems)` returning counts keyed by constellation without modifying geometry;
- `nearestSystemAt(nodes, point, maxDistance)`;
- `fitCamera(bounds, viewport, padding, zoom)` and `zoomAroundPoint(view, point, multiplier, limits)`;
- `boundaryPortals(boundaryExits)` preserving source and destination IDs/names.

**Step 4: Run tests and verify they pass**

Run: `node --test tests/unit/tacticalMapLayout.test.mjs tests/unit/tacticalCollaboration.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/utils/tacticalMapLayout.js front-codex/tests/unit/tacticalMapLayout.test.mjs front-codex/tests/unit/tacticalCollaboration.test.mjs
git commit -m "feat(tactical): add deterministic dense-map layout helpers"
```

### Task 2: Refactor the collaboration map camera and interaction model

**Files:**
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/utils/tacticalMarkerLayout.js`
- Modify: `front-codex/tests/unit/tacticalMarkerLayout.test.mjs`

**Step 1: Write the failing tests**

Add tests for the desired interaction contract:

- fit excludes boundary nodes from the core when a focus set is supplied;
- zoom changes node spacing while label/badge sizes stay in screen pixels;
- nearest drag target wins when two systems are inside the old 35px radius;
- marker layout respects the full safe area and includes text-width obstacles;
- resetting the view returns to the fitted core camera rather than `{ x: 0, y: 0, scale: 1 }`.

**Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/unit/tacticalMapLayout.test.mjs tests/unit/tacticalMarkerLayout.test.mjs`

Expected: FAIL against the current all-in-one SVG transform and first-match drag target.

**Step 3: Implement the minimal map changes**

- Keep a deterministic static world coordinate layer and derive `view` from `fitCamera`.
- Use `zoomAroundPoint` for toolbar and pointer wheel/gesture zoom.
- Replace `nodes.find` drag targeting with `nearestSystemAt` and only accept actual loaded adjacent systems.
- Keep force markers and labels in a screen-sized overlay; hide low-priority labels until zoom or explicit selection, while always retaining selected/search/adjacent labels.
- Give markers the current safe padding and measured label width when choosing placement.
- Draw boundary portals in a separate layer with destination name and “范围外” state; do not include them in core fit bounds.
- Add accessible mode text and retain keyboard selection behavior.

**Step 4: Run tests and verify they pass**

Run: `node --test tests/unit/tacticalMapLayout.test.mjs tests/unit/tacticalMarkerLayout.test.mjs tests/unit/tacticalCollaboration.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/components/tactical/CollaborationMap.jsx front-codex/src/utils/tacticalMarkerLayout.js front-codex/tests/unit/tacticalMapLayout.test.mjs front-codex/tests/unit/tacticalMarkerLayout.test.mjs
git commit -m "fix(tactical): keep labels and targets readable while zooming"
```

### Task 3: Add constellation overview and local tactical drill-down

**Files:**
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx`
- Modify: `front-codex/src/styles/tacticalCollaboration.css`
- Modify: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Step 1: Write the failing browser test**

Using the seeded real snapshot, assert:

- the default map announces “星座总览” and shows constellation blocks rather than 128 overlapping system labels;
- clicking a constellation opens “局部星系战术图” with a visible back control;
- searching a system enters its constellation and focuses the actual system;
- switching to “真实空间” keeps the real-space view available;
- force updates do not change the static node positions;
- a boundary portal is visible without shrinking the core map;
- mobile continues to hide the desktop map and exposes the existing path-planning/summary flow.

**Step 2: Run the browser test and verify it fails**

Run: `npx playwright test tests/tactical-e2e/tactical.spec.js --grep "星座总览|真实空间|边界出口"`

Expected: FAIL because the current map has only one system-level view.

**Step 3: Implement the minimal UI**

- Pass `constellations` and `onFocusSystem` into `CollaborationMap`.
- Add map modes: `overview`, `constellation`, and `spatial`, with a breadcrumb/back control.
- Render deterministic constellation blocks and aggregated enemy/friendly counts in overview; clicking a block enters its local system view.
- On search selection, locate the matching system, switch to its constellation, and animate the camera to the system. Do not move the camera for ordinary force report updates.
- Add concise mode/help text explaining that topology edges are real gate connections, not distance.
- Style the map controls, overview cards, badges, boundary portals, and responsive states without changing the existing panel hierarchy.

**Step 4: Run the browser test and verify it passes**

Run: `npx playwright test tests/tactical-e2e/tactical.spec.js --grep "星座总览|真实空间|边界出口"`

Expected: PASS.

**Step 5: Commit**

```bash
git add front-codex/src/components/tactical/CollaborationMap.jsx front-codex/src/pages/TacticalCollaboration.jsx front-codex/src/styles/tacticalCollaboration.css front-codex/tests/tactical-e2e/tactical.spec.js
git commit -m "feat(tactical): add constellation overview and local map drilldown"
```

### Task 4: Full regression, visual QA, and security checks

**Files:**
- Modify only if required by failing checks: `front-codex/tests/**`, `front-codex/src/**`

**Step 1: Run unit and frontend checks**

```bash
node --test tests/unit/*.test.mjs
npm run build
```

Expected: all unit tests pass and the production build exits 0.

**Step 2: Run the complete tactical and legacy browser suites**

```bash
npx playwright test tests/tactical-e2e/tactical.spec.js
npx playwright test
```

Expected: tactical and existing frontend suites pass without new console errors.

**Step 3: Capture dense real-data screenshots**

Capture desktop 1440×1050, laptop 1366×768, and mobile 390px views. Verify no label/marker overlap in overview, selected-system readability in local view, and unchanged mobile behavior.

**Step 4: Run backend regression**

```bash
python manage.py test TacticalCollaboration --keepdb
```

Expected: all tactical backend tests pass; scout visibility and organization permissions remain unchanged.

**Step 5: Review the diff and commit the verified result**

Confirm no backend permission code or online deployment files changed. Commit only after all commands above have fresh passing output.

