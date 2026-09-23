# Named Fleets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execution is in this session via subagents for disjoint files, using the already-approved local-only scope.

**Goal:** Named, immediately shared fleet observations with centered consistent map labels, safe identity/history and a simple reporting form.

**Architecture:** Introduce `fleet_intel` reports linked to stable Force IDs. Force holds current source attribution; old observations do not double-count or reverse manual moves. Existing total snapshots remain separate. The actual-map geometry and permissions stay intact.

**Tech Stack:** Django, isolated SQLite, React, SVG, Vite, Node tests, Playwright.

### Task 1 — backend identity and projection

Files: `backend/TacticalCollaboration/models.py`, `services.py`, migration `0005_*`, new `tests/test_named_fleets.py`, existing assertions as needed.

1. Write failing tests for scout named creation → immediately visible enemy Force; distinct names and identical names produce distinct IDs; explicit existing ID updates with CAS.
2. Add tests for chronology, own-report edits, duplicate requests, immutable links/types, cross-org/friendly/archive rejection, no re-confirmation, manual edit/source fencing and moved-force revision preserving position/time semantics.
3. Add nullable Report↔Force source/link fields and fleet_name, migrations; implement only the approved command contract. Keep legacy projection fields compatible where feasible.
4. Run `.venv/Scripts/python.exe backend/manage.py test TacticalCollaboration --settings=EVE_MDjango.ci_settings --noinput`; expect all pass. No local migration/restart by subagent; root handles it.
5. Spec review, then quality review; no commit.

### Task 2 — named centered map labels

Files: `front-codex/src/components/tactical/CollaborationMap.jsx`, `src/utils/tacticalMapPresentation.js`, `src/utils/tacticalMarkerLayout.js`, `src/utils/tacticalMapInteraction.js`, `src/styles/tacticalMapIntel.css`, their unit tests.

1. Failing tests: force names retained in labels; width follows name/count; three rows and overflow; row centering within a group; consistent label layout with no large system count duplicate.
2. Render name + count in compact badges, neutralize conditional star-name weight. Center text in each row with textAnchor and dominantBaseline. Keep security under star names; leave snapshot ring/details and accessible source information.
3. Prefer placement above actual star, collision fallback and leader lines. Long names truncate without losing readable count; no synthetic repositioning or premature drag submission.
4. Run tactical unit suites and build, then spec/quality review. Root owns `groupMapForces` in tacticalCollaboration.js, changing visible limit to 3.

### Task 3 — form, details, integration and local trial

Files: `TacticalReportForm.jsx`, `TacticalCollaboration.jsx`, `tacticalCollaboration.js`, tactical CSS, unit/browser tests, guarded local scripts/docs.

1. Add failing payload tests and browser scenarios before implementation. Quick report offers new fleet / existing fleet / system count; new fleet presets + custom name, existing choice pins reviewed force version. Edit preserves report type and linked fleet.
2. Integrate immediate report flow, current source author/time, current/historical statuses, no legacy adoption for fleet_intel. Lists and focused details allow scoped existing-fleet update by all allowed reporters. Keep own-record edit boundaries and force admin controls unchanged.
3. Migrate verified local SQLite and restart only the exact local backend; preserve demo edits. Add named demo reports idempotently, without deleting old records.
4. Real local smoke; full tactical browser suite plus ordinary star-map regressions; unit/backend/build. Review, fix and repeat verification. Capture actual screenshot and leave 4194/8001 running.
5. Update verification doc with exact results/limits; return local URL/credentials. Do not merge, push or deploy.

## Execution

- Tasks 1–3 complete locally. Independent backend/map/frontend spec reviews and subsequent quality reviews passed; the frontend long-name overflow finding was reproduced, fixed, and regression tested.
- Existing dirty work is preserved. No commit, push, merge, production DB access or deployment.
- Local backup/migration, actual scout UI demo, HTTP/WS transport verification, 263 test cases and build completed; exact commands and limits are recorded in `2026-09-22-tactical-named-fleets-verification.md`.
