# Corporation Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This session uses subagent-driven-development with independent file ownership and spec/quality review.

**Goal:** Repair five audited defects and close automated release-gate gaps locally.

**Architecture:** Preserve versioned approval snapshots and fail-closed media authorization. Add session fencing, dirty-editor state, approved-claim identity snapshots and safe Unicode reads/writes. Extend the existing release pipeline rather than introducing a new deployment system.

**Tech Stack:** React, TanStack Query, Django/DRF, Python unittest, Node test, Playwright, existing MySQL rehearsal scripts.

---

## Task 1: Session-fenced authentication (root)

Files: `front-codex/src/services/fetchWithAuth.js`, new `front-codex/tests/unit/auth-session.test.mjs`; authentication context/login only if necessary.

1. Add tests executing the real module for pending refresh across logout/account switch,
   late failure, original 401 after switching, concurrent refresh and normal multipart.
2. Run `node --test tests/unit/auth-session.test.mjs`; witness the old session corruption.
3. Capture session identity/generation at request entry; key refresh single-flight to it;
   check after every await before storage effects or retry. Throw a recoverable session
   change error instead of sending an old request under a different identity.
4. Run unit tests and authentication browser regressions; self-review before integration.

## Task 2: Backend identity and Unicode (backend workstream)

Files: `backend/Community/models.py`, `views.py`, additive migration, new regression tests,
`front-codex/tests/preview/community.mjs` only by root integration.

1. Add failing real API tests: wrong first claim rejected, different short name approved;
   competing identity candidates; legacy missing snapshot; all text fields reject lone
   surrogates with unchanged version/content; historical invalid text remains renderable.
2. Run focused Django suite under `EVE_MDjango.ci_settings` and record RED.
3. Add nullable proposed identity snapshot fields and serialize them privately. Approval
   adopts the approved values under user->corporation->claim locks; leave legacy null
   snapshots on known identity. Reuse Unicode validator for strict writes/tolerant reads.
4. Run Community/full isolated suites and `makemigrations Community --check --dry-run`.
5. Update API contract and migration compatibility notes after reviews.

## Task 3: Editor protection and public-cache consistency (frontend workstream)

Files: `front-codex/src/pages/CorporationManage.jsx`, `CorporationReview.jsx`,
`components/community/CorporationUI.jsx`, scoped helpers/styles and focused browser tests.

1. Add failing browser tests for saved A -> dirty B -> reconnect/refetch, background 503,
   remote version conflict, navigation cancellation, and review/hide public cache behavior.
2. Run only new tests and record RED. Use own local port/output if another browser suite runs.
3. Synchronize successful saves into management cache. Track dirty baseline; never replace
   dirty form from background data. Keep editor mounted on background errors. Explicitly
   offer conflict reload/discard, prevent stale writes and protect navigation. Invalidate
   public queries after decisions/visibility changes. Display proposed identity in review.
4. Run new and existing corporation browser regressions; verify desktop/mobile alignment.

## Task 4: Automated release gates (deployment workstream)

Files: `.github/workflows/ci.yml`, `scripts/deploy/release.py`, release tests/docs;
new isolated Community preflight/readiness modules and tests; `backend/Community/urls.py`.

1. Add failing tests for unsafe/missing/nonpersistent storage config, readiness errors,
   unchanged state after failed preflight, and Community readiness failure rollback.
2. Add `node --test tests/unit/*.test.mjs tests/preview/*.test.mjs`, preview E2E and
   `python -m unittest discover -s scripts/community/tests -v` to CI with failure evidence.
3. Implement non-mutating candidate config validation before switching. Do not assume deploy
   user == service user: generic service readiness performs runtime permissions checks.
   Keep checks cheap, redact details, no public diagnostics/credentials/absolute paths.
   Conditional handling must preserve rollback to pre-Community versions without silently
   skipping readiness for new versions. Preserve existing dependency and migration gates.
4. Run release safety tests and isolated health tests. Document the root-owned publisher
   upgrade prerequisite, manual Linux/MySQL validation and non-destructive boundaries.
5. Correct QA documentation that claims a full MySQL suite when it runs selected scenarios.

## Task 5: Integration, two-stage review, local handoff

1. Mirror changed claim identity contract in local sandbox without weakening real API tests.
2. Independent spec reviewer inspects all implementation and regressions against this scope.
3. Fix spec findings; independent quality reviewer checks security/concurrency/migrations.
4. Fresh full isolated backend, Node, browser, sandbox and deployment checks, plus build.
5. Review diff, update verification record, commit scoped files locally and preserve worktree.
6. No push/merge/deploy. List additive migration and server-tool installation requirements.

## Progress

- [x] Session fencing
- [x] Claim identity and Unicode
- [x] Draft protection and public cache
- [x] Automated release checks
- [x] Integration and independent reviews
- [x] Final verification and local commit

Final evidence is recorded in `2026-09-21-community-stability-verification.md`.
The implementation and evidence are retained on the local feature branch only.
