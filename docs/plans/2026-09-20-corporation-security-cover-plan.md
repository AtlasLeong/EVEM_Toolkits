# Corporation Security and Default Cover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show each location level's security and preview the actual default cover in the local corporation editor.

**Architecture:** Add immutable per-level security snapshots without migrations; retain legacy deepest security. Reuse existing disclosure valueContent and deterministic cover assets. Keep the local preview contract aligned.

**Tech Stack:** Django, React, Node test runner, existing browser regression harness and Playwright CLI visual QA.

## Task 1 — Location snapshot contract (delegated)

Files: `backend/Community/location.py`, `backend/Community/tests_location.py`, `docs/plans/2026-09-20-corporation-api-contract.md`.

1. Add tests requiring `region_security:0.5`, `constellation_security:0.3`, `solarsystem_security:-0.22` for a three-level catalogue fixture; verify partial selections, null values, forged read-only properties and old raw snapshots.
2. Run `python manage.py test Community.tests_location --settings=EVE_MDjango.ci_settings --noinput`; observe missing-field failures.
3. Generate each value from its own catalogue record; retain deepest `security`. Normalize optional invalid per-level fields to null without losing valid names/IDs; legacy deepest fallback only when the corresponding new key is absent, not explicitly null. No lookup on read or mutation of snapshots.
4. Run Community suite, migration drift check and self-review. Independent spec and quality reviews follow integration.

## Task 2 — UI and cover preview (main)

Files: `front-codex/src/components/community/{CorporationSelect,CorporationLocation}.jsx`, `src/pages/CorporationManage.jsx`, `src/styles/corporations.css`; small pure helper if needed; existing corporation browser tests.

1. Add failing coverage for selected-value security, all-level summary, legacy/null values and default-cover initial/upload/remove states.
2. Reuse `FilterDisclosure.valueContent` for name + badge while preserving string accessible name; add optional selectedSecurity fallback. Render name/badge pairs at each level. Preserve keyboard and dismissal behavior.
3. Retain per-level values on location changes and clear stale descendants. Save payload remains ID-only.
4. For the cover field only, show deterministic existing default artwork and exact helper text when no upload; upload/remove transitions preserve existing controls and moderation behavior.
5. Run targeted browser tests and inspect desktop/mobile layout via CLI.

## Task 3 — Preview contract and integration

Files: `front-codex/tests/preview/community.mjs`, `tests/preview/sandbox.test.mjs`, `tests/preview-e2e/sandbox.spec.js` if needed.

1. Add failing contract test for per-level values, then update demo snapshot generation to match the backend.
2. Run `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs`.
3. Run corporation browser regression and actual preview service tests serially; `npm run build`.
4. Preserve existing in-memory preview data: do not restart ports 4190/4192. Use a new loopback port if new server code needs loading.

## Task 4 — Review and local handoff

1. Independent spec review then quality review; fix and re-test all actionable findings.
2. Run final backend/browser/unit/build verification and `git diff --check`; write verification evidence.
3. Local commit only, leave output/screenshots untracked, retain branch/worktree and give preview link.

## Progress

- [x] Approved design and isolated worktree verified
- [x] Backend snapshot contract
- [x] UI/security/default-cover preview
- [x] Preview contract and integration regression
- [x] Independent reviews, verification and local-only handoff

Evidence: `2026-09-20-corporation-security-cover-verification.md`.
