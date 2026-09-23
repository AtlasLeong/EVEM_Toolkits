# Corporation Activities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the approved corporation activity overview, custom tags and form spacing locally.

**Architecture:** Extend versioned JSON content without migrations. Keep explicit legacy event/pvp compatibility, reuse pure client helpers for display/validation, synchronize the loopback sandbox. Continue in the existing isolated `codex/community-corp` worktree.

**Tech Stack:** Django/DRF, React, CSS, Canvas, Node test runner, existing Playwright regression harness.

---

## Task 1: Backend content contract (delegated; independent from frontend styling)

Files: `backend/Community/views.py`, optional focused `backend/Community/activity.py`, `backend/Community/tests.py`; contract documentation `docs/plans/2026-09-20-corporation-api-contract.md`.

1. Add failing tests: PATCH accepts `{activity_description:'主权战与反收割', custom_activity_tags:['反收割'], activities:['sovereignty_production','pirate_combat']}`; limits, normalization duplicates, disabled pvp addition, safe legacy read, explicit empty overview and publication isolation.
2. Run `python manage.py test Community --settings=EVE_MDjango.ci_settings --noinput` using the repository's isolated in-memory SQLite settings; observe expected missing-field rejection.
3. Implement JSON fields and computed kind; strict validation plus safe read normalization. Keep pvp only when already in the locked revision. No change to moderation/publication rules or production data.
4. Run the full Community suite and migration drift check; independently review specification and code quality before committing.

## Task 2: Frontend editing, read surfaces and poster (main thread)

Files: `front-codex/src/utils/corporationActivity.js` (new), `src/services/apiCommunity.js`, `src/pages/{CorporationManage,Corporations,CorporationReview}.jsx`, `src/components/community/CorporationUI.jsx`, `src/styles/corporations.css`, `src/utils/corporationPoster.js`.

1. Add unit tests for current/legacy activity labels, custom-tag validation, bounded summary and explicit legacy-vs-empty overview. Add regression checks to existing browser harness for 140/180px textareas, custom tags and renamed activity form; run RED before implementation.
2. Add a pure activity module, use current enums in choices and read-compatible enums in display. Keep old pvp removable without silent data loss; payload excludes computed properties.
3. Implement scoped textarea height/padding, common field spacing, accessible custom-tag input (Enter/IME-safe, labelled removal, no accidental save), third-tab overview and read-only old event reference.
4. Update public cards/detail, complete moderation view and event poster with explicit legacy mode; retain all artwork and watermarks.
5. Run `node --test tests/unit/corporationActivity.test.mjs tests/unit/corporationPoster.test.mjs` and targeted existing browser suite. Do not loosen assertions to mask regressions.

## Task 3: Preview integration and regression

Files: `front-codex/tests/preview/community.mjs`, `tests/preview/sandbox.test.mjs`, relevant HTTP test and `tests/e2e/helpers/community.js`, existing corporation browser specs, `tests/preview-e2e` if needed.

1. Add failing sandbox contract tests for the same new/legacy cases.
2. Update preview defaults, validation, serialization, seed data and filtering to match the real API. Reuse pure JS tag helpers when appropriate; no backend bypass in production.
3. Run Node preview tests and all Community backend tests. Run browser processes serially; never restart the same server under a running suite.
4. Build with `npm run build`; run corporation regression including actual preview service. Inspect desktop/mobile screenshots via the browser/Playwright workflow.

## Task 4: Review and handoff

1. Independent specification review, then independent quality review; fix actionable issues and rerun relevant tests.
2. Run final `git diff --check`, build, unit/backend and browser regression. Record exact evidence in a verification note.
3. Local commit only. Keep branch/worktree. Do not push, merge, deploy or modify online MySQL.
4. Deliver local preview and screenshots. Warn before restarting an existing in-memory preview because its test data resets; prefer a new loopback port to preserve prior testing.

## Progress

- [x] Approved design and existing isolated worktree verified; initial 16 cover/poster unit tests pass.
- [x] Backend contract, tests, review
- [x] Frontend form/tag/overview surfaces, tests
- [x] Sandbox integration and browser regression
- [x] Independent reviews and final verification; local-only handoff

Verification evidence: `2026-09-20-corporation-activities-verification.md`.
