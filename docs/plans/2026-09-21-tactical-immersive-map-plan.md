# Tactical Immersive Map Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the tactical board a map-first experience with floating controls and authenticated real star-system/stargate rendering.

**Architecture:** Keep the existing tactical API, role filtering, WebSocket snapshot protocol and public `/starmap` unchanged. Refactor only the tactical page into a full-bleed map shell with floating panels, and add an explicit map-data provenance/status field so real static-board data is never confused with synthetic local fixtures.

**Tech Stack:** React, existing tactical SVG map, CSS, Django service/graph projection, existing `TacticalBoard` static models, Node test runner, Playwright, Django tests.

---

### Task 1: Establish failing layout and provenance tests

**Files:**
- Modify: `front-codex/tests/unit/tacticalCollaboration.test.mjs`
- Modify: `front-codex/tests/tactical-e2e/tactical.spec.js`
- Modify: `backend/TacticalCollaboration/tests/test_board.py`
- Modify: `backend/TacticalCollaboration/graph.py` only after RED tests exist

**Steps:**

1. Add a unit assertion that the map-first shell exposes a floating overlay state and does not require a persistent two-column side panel.
2. Add a Playwright assertion at desktop size that the map bounds exceed the current fixed map column and the side panel can be collapsed without changing map bounds.
3. Add a backend test that map responses include a provenance/status field and return real static system names/security values when static rows are present.
4. Run the focused tests and confirm they fail for the missing new contract.
5. Commit only the failing tests.

### Task 2: Add explicit map data provenance and safe real-data projection

**Files:**
- Modify: `backend/TacticalCollaboration/graph.py`
- Modify: `backend/TacticalCollaboration/tests/test_board.py`
- Modify: `scripts/tactical/local_seed.py`
- Modify: `scripts/tactical/README.md`

**Steps:**

1. Add a small response field describing `source` (`static-board` or `synthetic-demo`), `is_real`, and counts; derive it from the actual queried rows/settings, not a client flag.
2. Ensure system projection includes display name, English name, security status, region and constellation, and excludes rows with unusable coordinates instead of placing them at `(0,0)`.
3. Keep synthetic fixture generation explicitly marked as demo-only; do not copy production `.env` or touch the online database.
4. Run the focused Django board tests to confirm the new response contract.
5. Commit the backend/data contract.

### Task 3: Implement the map-first floating shell

**Files:**
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/styles/tacticalCollaboration.css`
- Modify: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Steps:**

1. Add the failing desktop interaction test for a collapsible floating right drawer and a floating map toolbar.
2. Replace the grid columns with a positioned map shell: map fills the content region; top status, left controls and right drawer overlay it.
3. Keep existing accessibility labels, keyboard focus, selected-force details and non-optimistic commands. Ensure overlay pointer events do not reach the map.
4. Add responsive rules: desktop full-bleed map, tablet compact drawer, mobile list/no map.
5. Run tactical Playwright tests and inspect a 1440×1050 and 390×844 screenshot.
6. Commit the frontend layout change.

### Task 4: Preserve old star map and complete verification

**Files:**
- Modify: `docs/plans/2026-09-21-collaborative-tactical-board-verification.md`
- Modify: `docs/plans/2026-09-21-collaborative-tactical-board-runtime.md`

**Steps:**

1. Run backend focused tests, migration drift checks, Node unit/preview tests and frontend build.
2. Run serial legacy, tactical and preview browser suites; verify `/starmap` screenshots/behavior remain unchanged.
3. Run the local HTTP/WebSocket smoke test and a short local real-data map request against the isolated fixture.
4. Record screenshots, source status, known synthetic-demo limitations and production MySQL gate.
5. Commit documentation and leave the branch local; do not push, merge, deploy or migrate online data.

