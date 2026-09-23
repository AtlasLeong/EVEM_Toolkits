# Tactical Strength Overview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Same-session execution uses subagent-driven development on explicitly disjoint files.

**Goal:** A clear realtime enemy/friendly overview with optional fleet details, count-only reports, reporting history and separate membership controls.

**Architecture:** Keep authoritative role-filtered snapshots; add small scope/member metadata rather than another statistics stream. Pure frontend aggregation consumes current Force IDs and latest system snapshots, never history sums. A compact overlay and map share selection and live data, with no geometry changes or optimistic writes.

**Tech Stack:** Django/DRF/Channels, React/SVG, Node tests, existing Playwright suites, isolated SQLite.

### Task 1 — scope and membership metadata (backend agent)

Files: `backend/TacticalCollaboration/services.py`, `graph.py`, new `tests/test_overview.py`, minimal existing test assertions if required.

1. Add failing tests for active member count excluding removed/disabled/pending; never return it to scout if permission-restricted. Add tests for `in_scope` on forces/reports matching map's drawable selected regions+border hops, scope changes and empty scope; archived/friendly protections stay intact.
2. Implement `member_count` for commanding snapshots and members response; annotate visible current forces/reports with `in_scope`. Reuse cached static scope projection, no full coordinates in snapshots, no per-row queries. Preserve graph authorization and normal navigation.
3. Run isolated TacticalCollaboration/TacticalBoard tests and query-count cases, no local DB migration/restart. Self-review; root obtains spec then quality review. No commit.

### Task 2 — count-only map labels (map agent)

Files: `front-codex/src/components/tactical/CollaborationMap.jsx`, `src/utils/tacticalMapPresentation.js`, `src/utils/tacticalMarkerLayout.js`, map unit tests/styles only if needed. Do not edit root-owned page/form/CSS or shared E2E file.

1. Add failing map presentation/layout tests: latest system count becomes one neutral `人数上报 N人` (unknown/0 distinct), never draggable/never Force, coexistence with fleet names does not sum them, independent content widths and centered rows, bounded stack/overflow still works.
2. Render compact count-only marker tied to actual star and selectable for star details; remove no fleet/history data, no duplicate huge numbers. Preserve fleet dragging, pointer target identity, scopes, wheel handling and density expansion.
3. Run scoped unit tests and self-review, report contract and files; root handles browser and two-stage review. No commit.

### Task 3 — aggregation and frontend integration (root)

Files: new `front-codex/src/utils/tacticalOverview.js`, unit test, new `src/components/tactical/TacticalOverview.jsx` if useful, `src/pages/TacticalCollaboration.jsx`, `TacticalReportForm.jsx`, `TacticalMembers.jsx`, `src/styles/tacticalCollaboration.css`, hook copy, existing browser tests.

1. Resolve counting answer or stated default; write failing aggregation tests for system-first/separate semantics as chosen, unknown/zero, stale, role visibility, duplicate IDs, current-vs-all scope. Implement pure helper with explicit sources and unknown counts.
2. Write failing browser tests for counts-only default/no required name, names optional through named mode, summary/member layout, scope and live updates, current record/fleet distinct displays, focus/highlight and mobile.
3. Implement compact grouped overview rows, enemy/friendly metrics, scope selector, search/grouping; only explicit click causes camera focus. Preserve existing selected force actions and scope/version/lease safeguards. Replace ambiguous UI labels, isolate members card and show active/online counts. Add ticking local observation age. Keep default on existing named dialogs when explicitly selected.
4. Run full tactical tests, ordinary starmap regressions, build/diff check; scoped review then quality review and fix findings.

### Task 4 — local acceptance

1. Restart only verified isolated 8001 backend after code change (no schema changes expected), keep 4194 frontend running. No production requests or writes.
2. Real local browser count-only/overview/membership smoke with preserved demo records and capture screenshots. Run HTTP/WS smoke and full final regression after fixes.
3. Document exact results/limitations and hand off local URL. No git commit/push/merge/deployment.

## Execution

- Tasks 1–4 complete locally. Implementation independently specification/quality reviewed; findings fixed with failing/passing browser regressions. Final full tactical E2E: 64 passed; ordinary starmap E2E: 7 passed; local browser acceptance and HTTP/WS smoke passed. Exact evidence and limitations are in the verification document. Counting uses the documented system-first recommendation because the optional clarification has not received another answer. No commit, push, merge or production deployment was performed.
