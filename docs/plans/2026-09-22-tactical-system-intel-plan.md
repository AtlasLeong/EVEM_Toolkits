# Real-map system intelligence implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execute within the existing isolated worktree; user approved local implementation and autonomous design.

**Goal:** Deliver a usable local tactical board with readable real-system intelligence and safe interaction in dense star clusters. No push, deployment, or production data changes.

**Architecture:** Keep actual x/z coordinates and real gates. System enemy-count snapshots are distinct from independently tracked fleets. Preserve legacy fleet reports, permissions, revisions, audit, session and version guards. Introduce explicit `report_kind=system_count` for new scout reports, with `fleet` as the backward-compatible default. Latest observed snapshot per system wins deterministically; unknown remains unknown. The map is a quiet dark canvas with subdued gates, warm enemy counts, green friendly fleets and compact floating controls.

**Tech Stack:** React, SVG, Vite, Django, local SQLite, Node test runner, Playwright.

## Task 1 — Real map, density and direct drag

Files: `front-codex/src/components/tactical/CollaborationMap.jsx`, new `src/utils/tacticalSystemIntel.js` and `src/utils/tacticalMapInteraction.js`, associated unit tests; map-scoped styles in a separate tactical map stylesheet if necessary.

1. Write failing unit tests for deterministic latest snapshot (same-system reports do not sum; unknown vs zero), density candidates, focus and return view, safe drop selection and boundary conditions.
2. Remove rendered overview and constellation modes. Never alter real node positions. Render only real projected systems and gates.
3. Display system snapshots as compact enemy counts attached to labels; put author/time/ships in selection details rather than many map cards. Keep fleets distinct and draggable. Labels avoid one another and ordinary nodes, with selected/reported priority and short leader lines.
4. Clicking crowded nodes focuses the same map; true overlap exposes named candidates. A view-history control returns to previous framing. Allow more zoom where needed; do not zoom during a drag.
5. Drag only by existing permission; resolve destination at pointer-up. A unique loaded real star is valid regardless of adjacency; ambiguous drop opens a picker and never submits prematurely. Blank/outside/same-system drop does nothing. Show target name. Keep fleet fixed until server snapshot.
6. Use a scoped native non-passive wheel listener; clean it up. No global navigation changes.
7. Run scoped unit tests and build; spec review followed by quality review.

## Task 2 — Snapshot semantics and local data

Files: `backend/TacticalCollaboration/models.py`, `services.py`, migration `0004_report_report_kind.py`, `tests/test_board.py`; `front-codex/src/utils/tacticalCollaboration.js`, unit tests.

1. Add failing API tests: new system-count creation/projection; immediate scout visibility; own-report update only; immutable kind; confirmation-to-force rejected; existing legacy report behavior retained.
2. Add validated optional report kind on create; expose in entity/revision data. Reject kind changes and confirm of system totals. No automatic fleet creation or aggregation.
3. Add frontend payload support without passing report-only fields to force commands.
4. Run Django tactical tests with isolated CI settings and unit tests. Migrate only verified `tactical_local_settings` SQLite. Add sample system snapshots to the real local organization without resetting existing user edits.

## Task 3 — Integrated UI and verification

Files: `front-codex/src/pages/TacticalCollaboration.jsx`, `components/tactical/TacticalReportForm.jsx`, `styles/tacticalCollaboration.css`, tactical E2E specs, `scripts/tactical/README.md`.

1. Add/adjust failing E2E tests for initial real map, collapsible details, quick system-count reporting and direct correction drag; preserve regression tests for session, roles and nav.
2. Make the map dominant, default right panel closed. Keep compact search/top controls and bottom-right selected-system intelligence with author/time/history and quick update. Remove obsolete sightings/approval language for system counts.
3. New report form defaults to enemy count snapshot, ship breakdown optional. Editing a report preserves its kind; scouts only edit own. System-count reports cannot be adopted as fleets.
4. Drag submits correction with reason `指挥通过星图拖拽调整部署位置`; explicit gate-move actions retain real-gate validation. Counts and observed timestamp remain unchanged on move.
5. Run unit, backend and tactical E2E suites plus ordinary starmap regressions, production build and local safety checks. Review spec then quality, fix findings and rerun.
6. Verify actual local login, real star map, dense interaction, scout sync and screenshot. Leave backend/frontend running and provide URL/accounts. Document exact verified results and limitations; do not claim production capacity or deployment.

## Execution record

- Existing dirty work is retained in `codex/tactical-collaboration`.
- Tasks 1–3 implemented in the existing worktree. The local SQLite migration and idempotent real-map demo snapshot seed were applied; no production access, push, merge or deployment.
- New system snapshots use `report_kind=system_count`, default new reports to enemy counts, preserve seconds in observation timestamps, and cannot be adopted as independent forces. Legacy fleet observations remain list-only and retain their explicit adoption flow.
- Real map only; density-aware labels, focus/return, named ambiguous hit/drop selection, native wheel isolation and arbitrary loaded-system correction drag are implemented. Ordinary navigation code was not changed.
- Spec and quality review completed. Corrected map/form selector collision, pointer-capture click handling, boundary portal interception, toolbar wrapping, top-right spacing, diagonal label placement and scope-version camera/gesture reset. Actual pre-fix regression failures were reproduced for the interaction fixes.
- Final checks passed: 79 tactical unit tests, 57 backend tests, 13 local safety/data tests, 6 ordinary-navigation regressions, all 48 tactical browser tests, production build and real local HTTP/WebSocket smoke. Exact scope, warnings and limits are recorded in `2026-09-22-tactical-system-intel-verification.md`.
