# Tactical Count Marker Interactions Implementation Plan

**Goal:** Allow authorized members to relocate a count-only enemy observation and withdraw its current map card without losing audit history.

**Architecture:** Keep count-only reports separate from fleet deployments. Add versioned `report.move` and `report.withdraw` commands; retain withdrawn reports in snapshots for history but exclude them from active map and overview projections. Use the existing pointer target resolver for dragging, and a compact confirmation dialog for withdrawal.

**Stack:** Django REST command service, React SVG map, Playwright and Django tests.

## Task 1: Command behavior

1. Add failing backend tests for reporter/commander moves, unauthorized scout moves, version conflicts, withdrawal and retained revisions.
2. Add the two commands to validation and service logic, with `system_count` restriction and author or commander permission.
3. Run targeted backend tests and migrations check.

## Task 2: Projection behavior

1. Add failing unit tests that withdrawn reports do not appear as the latest count or historical map badge.
2. Update count reducers and report marker projection, plus a visible withdrawn status in the history.
3. Run targeted frontend units.

## Task 3: Map interaction and UI

1. Replace the existing "count cannot drag" browser test with a failing drag-to-system test, and add a failing withdrawal confirmation test.
2. Reuse map drag targeting for count reports; keep the old system until the server command succeeds. Add the inline close control and accessible confirmation dialog.
3. Run tactical browser tests, frontend build and relevant backend suites.

## Task 4: Release

1. Recheck branch diff and CI; commit and push.
2. Merge to repository default branch after green checks and monitor automatic deployment/readiness.
