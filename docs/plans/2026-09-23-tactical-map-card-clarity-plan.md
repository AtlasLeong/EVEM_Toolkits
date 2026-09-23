# Tactical Map Card Clarity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show one current badge per named fleet, keep historical reports off the live map, improve star/leader spacing, and add a permission-safe quick archive control.

**Architecture:** Change only frontend presentation and event wiring. Preserve backend Force/Report history, real system coordinates, stargate topology, command authorization and compare-and-swap archive. Pure marker/label utilities carry deterministic layout decisions; the map component renders them and forwards archive clicks to the existing dialog.

**Tech Stack:** React 18, SVG, plain JavaScript, Node `node:test`, Playwright, Vite.

**Scope:** Local branch and local preview only. Do not push, merge, deploy, or mutate production data.

---

### Task 1: De-duplicate live map reports without discarding history

**Files:**
- Modify: `front-codex/tests/unit/tacticalMapPresentation.test.mjs`
- Modify: `front-codex/src/utils/tacticalMapPresentation.js`

**Step 1: Write failing tests.** Use one `force` with `source_report_id: 51` at system 2 and a `fleet_intel` report `id: 51` at system 1. Assert `buildMarkerGroups([force], [report])` has exactly one force group, no generic report group, even when `markerGroupsForViewport(..., {selectedSystemId:1, showReports:true})` is used. Repeat with no force (archived) and assert no orphan map card. Assert `system_count` has only the dedicated `buildSystemCountMarkerGroups` marker. Assert a legacy `report_kind:'fleet'` pending report remains in the generic layer. Update older tests to set `report_kind:'fleet'` explicitly where they intentionally test legacy reports.

**Step 2: Run RED.** `node --test tests/unit/tacticalMapPresentation.test.mjs` from `front-codex`; expect linked/current and system-count exclusivity assertions to fail because the generic loop still includes those kinds.

**Step 3: Implement only the filter.** In `buildMarkerGroups`, before grouping reports, skip `report.report_kind === 'fleet_intel' || report.report_kind === 'system_count'`. Do not alter `latestSystemIntel`, `snapshot`, `Force`, `Report`, or server migrations.

**Step 4: Run GREEN.** Repeat the focused command. Check every assertion including legacy report visibility, hidden count and source history.

**Step 5: Commit.** Stage only the two files and commit `fix(tactical): avoid duplicate fleet observation cards`.

### Task 2: Keep star labels close and prevent redundant/crossing leaders

**Files:**
- Modify: `front-codex/tests/unit/tacticalMapInteraction.test.mjs`
- Modify: `front-codex/src/utils/tacticalMapInteraction.js`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify if required: `front-codex/src/styles/tacticalCollaboration.css`

**Step 1: Write failing geometry tests.** For a node at `{px:400,py:300}` and a vertical real gate from that node downward, assert `layoutIntelLabels(..., {gateSegments:[{x1:400,y1:300,x2:400,y2:500}]})` chooses a nearby candidate not crossed by that segment when available. For multiple marker groups at one selected system, assert a new pure `leaderSegmentsForFocus(groups, labels, {selectedSystemId})` returns no more than one leader for that system; no leader when the endpoint gap is already short. Assert off-screen and unrelated systems produce no leaders. Keep node/gate inputs unchanged.

**Step 2: Run RED.** `node --test tests/unit/tacticalMapInteraction.test.mjs`; expect the new assertions to fail for missing gate avoidance/leader helper.

**Step 3: Implement deterministic candidate scoring.** Add a segment/rectangle intersection helper (finite horizontal/vertical/diagonal gates), then let `layoutIntelLabels` prefer a non-intersecting candidate among its existing near positions, while retaining existing collision and safe-area checks. Build `gateSegments` from `stargates` and screen-space node coordinates in `CollaborationMap` and pass them to label layout. Draw at most one short focus leader via the pure helper rather than per group plus per label. Preserve the actual `stargates.map` edge rendering. If every legal label candidate intersects a gate, render a small map-coloured background behind just that label so text stays legible; do not use a large card or cover stars.

**Step 4: Run GREEN.** Focused interaction/layout tests must pass; also run `node --test tests/unit/tacticalMapPresentation.test.mjs tests/unit/tacticalMarkerLayout.test.mjs` to catch interactions with badge placement.

**Step 5: Commit.** Stage only the layout/render/test files and commit `fix(tactical): declutter map label leaders`.

### Task 3: Quick archive on current fleet badges

**Files:**
- Modify: `front-codex/tests/tactical-e2e/tactical.spec.js`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx`
- Modify: `front-codex/src/utils/tacticalMapPresentation.js`
- Modify: `front-codex/src/styles/tacticalCollaboration.css`

**Step 1: Write failing browser tests.** With the existing commander fixture, locate the current `.tac-map-force`, click the accessible `归档远炮战列队` control, assert the existing `归档部署` dialog opens and no command is sent before confirmation; after `确认归档`, assert the emitted command is `force.archive` with `force_id` and `expected_version` of the selected current force. Assert clicking the control does not emit `force.move` or select a different star. With the scout fixture, assert no archive control is present. For a source report whose force is archived, assert the historical `fleet_intel` report remains in the 上报记录 tab but no map report badge returns.

**Step 2: Run RED.** `npx playwright test --config tests/tactical-e2e/playwright.config.js -g "quick archive|history stays"` from `front-codex`; expect missing control assertions to fail.

**Step 3: Implement minimal UI wiring.** Pass `canArchiveForce={can.manageForces && status==='live'}` and `onArchiveForce={force=>setDialog({kind:'archive',initial:force})}` to `CollaborationMap`. Render an SVG `×` as a separate sibling hit target for each visible force badge, with `role='button'`, `tabIndex=0`, an explicit accessible name, pointer/click propagation stopped, and Enter/Space handling. Use `force.id` rather than name. Reserve about 20px in commander-visible badge width and reduce only the name's available width, never the person count; keep the full title/ARIA name. Reuse `ArchiveForce`'s existing versioned confirmation; do not call the backend directly from the badge. Hide control when permission/session is absent.

**Step 4: Run GREEN.** Run the focused E2E test, then all `tests/tactical-e2e/tactical.spec.js`. Check the `force.archive` and scout permission tests.

**Step 5: Commit.** Stage only the touched UI/test files and commit `feat(tactical): add permission-safe quick archive`.

### Task 4: Full local verification and visual acceptance

**Files:**
- Modify only if a verified defect is found in `front-codex/src/**` or `front-codex/tests/**`
- Record results in `docs/plans/2026-09-23-tactical-map-card-clarity-verification.md`

**Step 1: Run all tactical unit tests.** `node --test tests/unit/tactical*.test.mjs` from `front-codex`; expect zero failures.

**Step 2: Run browser regressions.** `npx playwright test --config tests/tactical-e2e/playwright.config.js` and the starmap navigation specs; expect zero failures. Use the project's Playwright setup; do not connect tests to production.

**Step 3: Build.** `npm run build`; expect exit code 0 and bundle budget pass.

**Step 4: Inspect real local map at 1440×900 and 1366×768.** Capture browser screenshots with the approved Playwright workflow. Verify one live badge for a named fleet, no detached card after move/archive, star name/edge legibility, no drag on archive ×, count-only marker still visible, and no console errors. Record what could not be exercised.

**Step 5: Review and report.** Run `git diff --check`, inspect staged diff for unrelated changes, record exact test counts and screenshot paths, and keep the branch local. Do not claim production readiness from mock E2E alone.
