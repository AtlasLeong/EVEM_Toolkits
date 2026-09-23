# Tactical Map Performance and Motion Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the tactical star map smooth during wheel zoom and pan while keeping system labels stable, legible, and visibly attached to their owning system.

**Architecture:** Keep real system coordinates and tactical data unchanged. Split the map into a static topology layer, a camera-transformed world layer, and a screen-space interaction layer. During a wheel gesture, update one camera transform through `requestAnimationFrame`; commit the final camera to React state after the gesture settles. Recompute collision layouts only when the scope, data, viewport, or settled zoom changes. Use hysteresis for label visibility and a short opacity transition after the layout settles.

**Tech Stack:** React, SVG, requestAnimationFrame, Node test runner, Playwright.

---

### Task 1: Add camera and label behavior tests

**Files:**
- Modify: `front-codex/tests/unit/tacticalMapInteraction.test.mjs`
- Modify: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Steps:**

1. Add unit cases for wheel frame coalescing, label visibility hysteresis, and preserving a settled label layout while a camera is moving.
2. Run the focused unit tests and confirm the new cases fail because the helpers do not exist yet.
3. Add an end-to-end assertion that a wheel burst keeps the same label set during movement and that labels settle with a transition class after the gesture.
4. Run the focused Playwright tests and confirm the new assertion fails for the current implementation.

### Task 2: Extract stable camera and label helpers

**Files:**
- Modify: `front-codex/src/utils/tacticalMapInteraction.js`
- Modify: `front-codex/src/utils/tacticalMapLayout.js`

**Steps:**

1. Add a small wheel-camera reducer that consumes an accumulated delta once per animation frame and returns the next camera without touching label layout.
2. Add a label visibility state helper with separate enter and exit zoom thresholds so labels do not flicker at one boundary.
3. Add a stable label transition helper that returns the settled positions plus a phase (`moving`, `settling`, or `idle`).
4. Run focused unit tests and verify they pass.

### Task 3: Split map rendering into static, world, and interaction layers

**Files:**
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/styles/tacticalMapIntel.css`

**Steps:**

1. Give the SVG topology and tactical overlays stable refs and group boundaries.
2. Apply wheel camera changes to the world transform in the animation frame, while keeping React state for settled camera state and pointer calculations.
3. Freeze marker and label layouts during movement; recompute only after the idle timer completes.
4. Keep selected system, active drag target, and close controls in the interaction layer so they remain responsive.
5. Add motion classes and reduced-motion behavior for the label fade and settled-layout phase.
6. Run the focused unit and end-to-end tests.

### Task 4: Cache layout inputs and cull expensive work

**Files:**
- Modify: `front-codex/src/utils/tacticalMarkerLayout.js`
- Modify: `front-codex/src/utils/tacticalMapInteraction.js`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`

**Steps:**

1. Build a cached nearby-node index per projected map and viewport instead of filtering every system for every marker group.
2. Reuse the preferred marker slots and settled label positions until the relevant inputs change.
3. Skip gate indexing, collision scoring, and secondary labels during an active wheel frame.
4. Add a dense-map unit case proving repeated frames reuse the same layout result.
5. Run focused tests and inspect the diff for accidental data or permission changes.

### Task 5: Validate and prepare release

**Files:**
- Create: `docs/plans/2026-09-23-tactical-map-performance-verification.md`

**Steps:**

1. Run frontend unit tests, build, bundle budget, preview E2E, tactical E2E, and the full frontend E2E suite.
2. Run `git diff --check` and verify the worktree is clean apart from committed changes.
3. Record the test counts, observed behavior, and any browser-specific caveat in the verification document.
4. Commit the completed implementation and verification notes.

