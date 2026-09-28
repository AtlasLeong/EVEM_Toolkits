# Private tactical usage overview implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. In this thread use the equivalent subagent-driven workflow with independent spec and quality review.

**Goal:** Provide an owner-only, read-only tactical usage dashboard using existing records, without visitor tracking.

**Architecture:** Two JWT-protected Django read endpoints in TacticalCollaboration expose capability and private aggregate data. A lazy React route and capability-gated navigation render those aggregates with isolated component state. No schema or deployment changes.

**Tech Stack:** Existing Django ORM/DRF, React, Lucide, CSS, Python Django tests, Node test runner and browser verification.

## Task 1: Protected aggregation API

Files: create `backend/TacticalCollaboration/usage.py`, `backend/TacticalCollaboration/tests/test_usage.py`; modify `backend/TacticalCollaboration/urls.py`.

1. Write API tests against the exact contract in the approved design. Cover owner-only access (including other superusers denied), account deactivation, ambiguous email fail-closed, all aggregate definitions, no private data, Shanghai time bounds for USE_TZ True/False, no writes and safe methods only.
2. Run `python manage.py test TacticalCollaboration.tests.test_usage --settings=EVE_MDjango.ci_settings --noinput` from backend. Confirm expected missing-endpoint failures.
3. Implement a fresh owner lookup using the server-only owner email and the authenticated account PK; expose capability but independently authorize overview. Avoid business service methods that can create default boards.
4. Aggregate counts with Django Count(distinct=True)/filtered aggregates, bounded query count, explicit operation action allowlist and no metadata inspection. Return timezone-aware wire timestamps even under naive production settings.
5. Run the focused tests and `python manage.py test TacticalCollaboration --settings=EVE_MDjango.ci_settings --noinput`; verify no migrations. Review spec, then quality; commit only task files after root integration.

## Task 2: Private read-only UI

Files: create `front-codex/src/services/apiTacticalUsage.js`, `front-codex/src/hooks/useTacticalUsageAccess.js`, `front-codex/src/pages/TacticalUsage.jsx`, `front-codex/src/styles/tacticalUsage.css`, and `front-codex/tests/unit/tacticalUsage.test.mjs`; modify App.jsx and AppShell.jsx.

1. Write failing Node tests using the existing esbuild/VM pattern for the API contract, GET-only/no-store authenticated reads, abort propagation, errors, no supplied identities; session-safe state helper tests if factored.
2. Run `node --test tests/unit/tacticalUsage.test.mjs`, confirm expected feature absence.
3. Implement the API wrapper and account-keyed capability hook. Hide navigation unless current session is allowed; do not trust JWT email claims. Do not share or persist the aggregate response.
4. Build the lazy `/tactical/usage` page with gated component state, number cards and a period table. Key private component by current authenticated account identity; cancel on account/logout and fence stale responses. Hide old data on failure/denial. Reuse theme tokens and accessible controls.
5. Show clear deduplication/time-range/coverage explanations, empty state, last update, refresh and retry. No editing, export, new tracking, visitor metrics or live polling.
6. Run Node tests and production build; inspect desktop/mobile, owner/denied/error states using local synthetic data. Existing automated browser regression runner can be invoked without adding new specs unless needed by verification instructions.

## Task 3: Integration and review

1. Verify backend and frontend contract together. Run isolated tactical backend regressions, frontend unit/preview tests, targeted existing auth/navigation/tactical browser regressions, and `npm run build`.
2. Run spec review against the approved design, then code/security review focusing on fail-closed permission and stale account data isolation. Fix actionable findings with reproducing tests.
3. Confirm `git diff --check`, no production credentials/output artifacts staged, no analytics models/migrations/tracking writes, no mutation UI and no broad admin grants.
4. Commit verified changes on `codex/tactical-readonly-overview`. Keep the worktree. Report actual verification and explicitly distinguish local implementation from deployment; do not push/merge/deploy without a new request.
