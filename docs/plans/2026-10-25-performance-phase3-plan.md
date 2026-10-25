# Performance Phase Three Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bound expensive legacy reads and email blocking while preserving normal results and access controls.

**Architecture:** Small handler-level validation/limits and existing scoped throttles, bounded operation-based fraud pagination and batched actor projection. Retain Django/React, existing database ownership, collector/publisher and all unrelated interfaces.

**Tech Stack:** Django/DRF, isolated SQLite unmanaged fixtures, React Query, Node tests, existing Playwright and CI.

---

## Task 1: SMTP transport and explicit read throttles

Files: `backend/EVE_MDjango/EmailBackend.py`, `backend/EVE_MDjango/settings.py`,
`backend/Authentication/throttle.py`, `backend/Authentication/test_email_backend.py`.

1. Add tests in the existing discovered auth module: effective configured and
   fallback timeout reaches SMTP_SSL; SSL context preserved; connect/login/send
   timeout raises; failed open closes/discards partial transport and retry uses
   a new one; fail_silently remains respected; endpoint timeout is not success.
2. Run `python manage.py test Authentication.test_email_backend --settings=EVE_MDjango.public_auth_test_settings --noinput`;
   observe assertion failures for missing timeout/cleanup before implementing.
3. Set production EMAIL_TIMEOUT10 and minimally fix the existing backend, no
   async/retry platform. Add PlanetaryQueryThrottle30/min and BazaarChartThrottle
   60/hour as small AuthIPThrottle subclasses; test transport identity/XFF and
   independent caches with the real handlers in Task2/3.
4. Run all46 existing auth tests plus new tests using isolated settings.

## Task 2: Planetary/query-directory bounds and numeric ranks

Files: `backend/PlanetaryResource/views.py`, a small local validation helper if
needed, `backend/PlanetaryResource/tests.py`, `backend/StarFieldSearch/views.py`,
`backend/StarFieldSearch/tests.py`, `front-codex/src/services/apiPlanetaryResource.js`,
related Node/browser tests; existing resource catalogs remain unchanged.

1. Add failing real SQLite/zero-query tests for the design's types, raw100/34
   boundaries, dedup, server resources/icons, numeric invalid values and Top3,
   LIMIT5001/10001, explicit overflow, deepest-location and first-match rules.
   Add missing/oversized/invalid/duplicate CSV directory tests and normal
   public/closed-mode/JWT/throttle coverage.
2. Run `python manage.py test PlanetaryResource StarFieldSearch --settings=EVE_MDjango.public_access_test_settings --noinput`;
   verify genuine assertion failures, then minimally implement design bounds.
3. Keep raw array responses and old result shapes; do not silently page/truncate
   or change external unmanaged schema. Use finite numeric keys only for ranks.
4. Add test-first adapter handling for actionable400/429; preserve failed-query
   results and no automatic batching. Run Node/planetary browser regressions.

## Task 3: Bounded Bazaar chart reads

Files: `backend/Bazaar/views.py`, `backend/Bazaar/tests.py` (or local test module).

1. Write real unmanaged-table SQLite regressions: normal5/8 series, raw9 reject,
   strict shape/server/rank, stable dedup, China/china/world grouping, day labels,
   366/367 points, cap+1 SQL and no partial curves. Invalid/empty input does no
   data SQL. Include public permissions/invalid JWT and real429 behavior.
2. Run `python manage.py test Bazaar --settings=EVE_MDjango.public_access_test_settings --noinput`;
   confirm missing bounds fail first, then implement only chart validation,
   one bounded query, normalized grouping and independent throttle. Remove the
   chart's raw-request print. Leave unrelated Bazaar handlers alone.
3. Rerun suite and existing frontend legacy adapter tests; no new UI.

## Task 4: Fraud bounded operation history and frontend paging

Files: `backend/FraudList/views.py`, `backend/FraudList/serializers.py`,
`backend/FraudList/test_history.py`, `front-codex/src/services/apiFraudList.js`,
`front-codex/src/pages/FraudAdmin.jsx`, relevant Node/browser tests.

1. Add failing real SQLite fixtures for authorized20/50 anchors, unchanged
   current ACL, multi-page stable order, pairedB/F at boundaries, cross-groupF
   exclusion, empty IDs, duplicateF bounded, deleted/null actors, no-param arrays
   versus explicit page envelope, invalid/unknown/repeated params. Query count
   remains constant when page grows; no serializer per-row lookup.
2. Run `python manage.py test FraudList --settings=EVE_MDjango.fraud_access_test_settings --noinput`;
   observe failures before implementation. Add bounded anchor queries, grouped
   firstF IDs and actor map; no fallback N+1 or schema migrations.
3. Test-first frontend old-array/new-envelope adaptation, explicit page query
   key, next/previous/disabled/loading/error, preserved paired detail and current
   authorization. Keep existing prefix invalidations, no fetch-all behavior.
4. Rerun admin history/detail/login/validation/reject browser suites and units.

## Task 5: Integrate, review, publish

Files: `.github/workflows/ci.yml` only add new isolated tests to existing command;
appropriate `docs/` operations contracts; no publisher change.

1. Include PlanetaryResource/StarFieldSearch/Bazaar suites under existing isolated
   public settings; retain all previous auth/MySQL/browser/package gates. Reuse
   the already pinned runtime certifi version in CI-only dependencies for the
   real SMTP-backend import; do not change production requirements.
2. Independent requirements review, then code-quality review for each batch;
   fix/retest/re-review issues. Controller inspects actual diff/test evidence.
3. Run all auth/fraud/public/legacy suites, relevant frontend browsers, all unit
   and preview tests, production build/budget, deployment safety tests and
   schema dry-checks. Record reproducible bounded-query and correctness results.
4. Commit only explicit scoped code/tests/docs on the feature branch; push,
   create/attach PR. Full PR CI then normal merge at exact tested head; full
   master CI and automatic protected Production. Do not skip safety gates.
5. Read exact running component SHAs/state/units and unchanged config/timers/KM;
   safe public reads, prior compression/batch/catalog checks, actual anonymous
   desktop/mobile relevant-page screenshots. No real mail/private writes/game
   collection. Preserve private outputs and user changes. Report live outcome
   and limits honestly, not invented general speedup percentages.

## Execution evidence before remote release

- Existing attached worktree reused; base master bba09771, original dirty 43c4
  and private outputs preserved. Baseline46 auth/6 fraud/781 unit-preview passed.
- Test-first genuine failures confirmed for missing SMTP timeout/failed transport
  cleanup, unbounded chart rows/inputs/throttle, lexicographic planetary Top3,
  absent CSV limit, missing operation pagination/actor batching, actionable
  frontend errors and legacy blank-ID mispairing; setup/encoding/interaction
  mistakes were corrected separately rather than counted as product failures.
- A 10000-row real SQLite tie fixture exposed old correlated MAX amplification;
  approved narrow fix reads the same pretable once with LIMIT10001, keeps finite
  maxima/ties and original resource order. No new schema/cache.
- Controller verification:59 auth/SMTP,53 public/legacy,16 fraud backend tests;
  784 frontend unit/preview tests, production build/bundle budget and136 related
  browser regressions passed. Complete deployment safety suite370 passed with17
  existing Windows platform skips; Linux CI must still run its full gates.
- Independent spec then code-quality reviews passed for all four tasks. The
  blank legacy operation-ID issue found in review was fixed test-first; numeric
  legacy IDs and exact nonblank string keys remain compatible. Reviewer separately
  passed13 SMTP,14 Bazaar,25 planetary/directory,16 fraud,19 adapter/unit tests,
  plus five targeted CI safety checks.
- New SMTP tests require the already existing certifi runtime dependency; its
  same pinned version was added to CI-only requirements, not runtime requirements.
- Adding isolated CI labels intentionally triggers the frozen policy's opaque
  build-context fallback. Historical exact-control proofs use an explicitly
  reconstructed old fixture; a new negative proves actual new CI must rebuild
  frontend while backend fingerprint is unchanged in that isolated fixture.
  No source_plan/publisher/Production-policy changes or server policy installation.
- Read-only production aggregate preflight confirmed one-region planet max1667,
  pretable5708 rows, max Bazaar series20 points; SMTP timeout was unset. No
  writes/mail/game calls. Current baseline frontendbba09771/backend0fb8ba166,
  services/timers healthy and KM disabled; Nginx hashes unchanged.
- Remote PR/master CI, deployment and actual production page checks remain
  pending until the version-bound release receipt records them.
