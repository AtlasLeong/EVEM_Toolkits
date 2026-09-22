# Corporation and Tactical Board Audit / Repair Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This audit runs independent investigations concurrently with explicit file ownership.

**Goal:** Find and repair reproducible functional, permission and performance faults in the existing corporation and tactical modules, then report the remaining product backlog accurately.

**Architecture:** Preserve current UI, public-review boundaries, authoritative role-filtered tactical snapshots, count-first aggregation and existing database contracts. Reproduce each defect before changing code; add regression coverage and make the smallest correction. No new product features or speculative refactoring.

**Tech Stack:** Django/DRF/Channels, React/Vite/SVG, Python/Node tests, Playwright and isolated local SQLite.

## Scope / safety

- Work only in `.worktrees/tactical-collaboration`; preserve the pre-existing dirty changes.
- No commit, merge, push, deployment or production database operations.
- All backend test writes use isolated CI settings. Browser regression servers use separate local ports; no resetting demo or user records.

## Task 1 — Corporation backend audit

Owner: corporation backend reviewer. Files: `backend/Community/` and its tests.

1. Trace draft/application/review/public serialization and image access, with SQL query shape and pagination.
2. For each confirmed fault, add a focused failing test and record root cause.
3. Apply minimum correction; run relevant tests, then Community regression suite.
4. Send exact findings and diff for independent review.

## Task 2 — Tactical backend audit

Owner: tactical backend reviewer. Files: `backend/TacticalCollaboration/`, `backend/TacticalBoard/` and their tests.

1. Trace admission, leases, WS and HTTP recovery, roles, report/force versioning and aggregation inputs.
2. Reproduce boundary/performance faults with isolated tests and query/serialization evidence.
3. Add failing regression tests, then minimal fixes without relaxing safeguards.
4. Run tactical backend regressions and submit findings/diff for independent review.

## Task 3 — Corporation frontend audit

Owner: corporation frontend reviewer. Files: corporation pages/components/utils and dedicated tests.

1. Inspect async state, draft/upload/save/edit/review/share/poster export and directory filtering.
2. Reproduce real failures with unit or browser tests before fixing.
3. Run corporation unit and browser suites on 4173; report evidence and remaining risks.

## Task 4 — Tactical frontend and backlog (root)

Files: tactical hook/services/pages/components/utils and tests; documentation under `docs/plans/`.

1. Audit request lifetimes, read/write recovery, render cost, map/list interaction and privacy reset.
2. Add failing tests for verified faults; preserve explicit user-intended semantics.
3. Run Node units and tactical browser regressions on 4193; run build and diff checks.
4. Independently review agent patches and rerun affected backend suites.
5. Cross-check original requested modules against source routes, backend apps and existing verification/rollout records; distinguish raw data import, usable feature, local completion and production verification.
6. Deliver a consolidated audit report with exact test results and unresolved rollout/feature gaps.

## Execution log

- Initial worktree status recorded; pre-existing overview/named-fleet/map work retained.
- Independent backend and corporation frontend investigations dispatched. Root auditing tactical session lifecycle and product backlog.
- Completed 14 verified repair groups and independent cross-review; final regressions: backend 311 passed / 1 platform skip, Node 176 passed, corporation browser 68 passed, navigation browser 7 passed, tactical browser 70 passed, corporation HTTP sandbox 4 passed, and real local tactical HTTP/WebSocket smoke passed. Final production build and diff checks passed. Detailed findings and unfinished modules are recorded in `2026-09-22-corporation-tactical-audit-report.md`. No commit, push, deployment or production database access performed.
