# Performance phase4 implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove measured repeated public hotspot geography work without changing file integrity, authorization or collection.

**Architecture:** One process-local, single-entry validated public projection with60-second monotonic freshness. Each request first calls the unchanged hardened snapshot reader; private-history and auth remain uncached.

**Tech Stack:** Python/Django/DRF, SQLite isolated tests; existing MySQL runtime and protected GitHub release workflow.

## Task1: Test-first bounded projection reuse

Files: modify `backend/AnomalyHotspots/views.py` and existing
`backend/AnomalyHotspots/tests/test_api.py`; optionally existing
`backend/AnomalyHotspots/tests/test_core.py` for shared file-safety fixtures.

1. Add a regression using real snapshot and real geography models:
   `with self.assertNumQueries(2): first = client.get(...)` followed by
   `with self.assertNumQueries(0): second = client.get(...)`; compare full bodies.
   Run the exact test with existing isolated settings; verify genuine query-count
   failure before implementation.
2. Add boundary tests: all snapshot changes and distinct paths invalidate; mock
   monotonic time only to assert hit at59.999 and refresh at60 or negative age;
   actual DB name changes become visible on expiry. A failed DBlookup returns
   unknown names once, next request recovers, not a negativecache. Mutating
   response dictionaries must not contaminate subsequent responses.
3. Add warm-cache safety/guard tests: replace bytes with malformed/duplicatekeys/
   oversized file or delete/link/chmod it, expect unavailable immediately;
   settings public switch and throttles continue denying before data access.
   Preserve private metadata wrapper compatibility. Include deterministic
   concurrent publication/no-I/O-under-lock check. Watch missing behaviors fail.
4. Implement the minimum helper in views: retain `read_snapshot`; split raising
   loader and existing catch-to-empty wrapper; one entry with full snapshot+path,
   monotonic timestamp and public projection; short lock around lookup/publish,
   defensive copies, no unavailable/error cache. Never change query membership
   validation or expose DBexception content.
5. Run `python manage.py test AnomalyHotspots --settings=EVE_MDjango.anomaly_test_settings --noinput`
   from backend; all pass (POSIX skips only on Windows). Self-review and report
   red/green evidence, changed files and tradeoffs; commit exact scoped files.

## Task2: Independent review and integration

1. Requirements reviewer inspects actual code/diff against design, not implementer
   report. Resolve missing/extra scope and rerun tests until approved.
2. Fresh quality reviewer checks safety, concurrency, test realism and simplicity;
   independently runs relevant tests. Resolve and re-review any findings.
3. Root runs AnomalyHotspots, ControlCenter, public-access/auth suites, deployment
   safety, unchanged frontend unit/build budget as appropriate. Compare measured
   work counts/candidate timing using sanitized stored data; don't claim broad
   latency gains from synthetic fixtures. Record results here before release.

## Task3: Protected publication and real readback

1. Push branch and create/attach PR; wait for complete exact-head PR CI including
   Linux file safety, full browser and MySQL gates. Never skip/reduce existing CI.
2. Normal merge at exact tested head; complete master CI then automatic Production.
   No manual root publish or policy update. Existing opaque-CI fallback remains.
3. Read exact running component versions/state and healthy services/timers/KM
   disabled. Run bounded read-only public smoke, warmed timing samples (record
   cold/multiple-process caveat) and public/private guards. No collection, mail,
   owner credentials or production fixture writes. Report live version, tests,
   actual scope, limits and explicit metric-led deferrals.
