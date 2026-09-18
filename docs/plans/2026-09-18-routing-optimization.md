# Routing Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make route planning exact under the approved weighted-cost/least-hop objective and remove repeated full-map work, without deployment.

**Architecture:** Pure immutable route graph with exact state Dijkstra and cKDTree neighbors; per-worker single-flight TTL snapshot for the Django endpoint. Preserve route rules/API and verify against independent small-graph oracles.

**Tech Stack:** Python 3.10+, Django 4.2, DRF, NumPy 1.24.3, SciPy 1.10.1, unittest, existing frontend regression suite.

---

## Task 1: Exact graph search and spatial neighbors

Files: modify `backend/TacticalBoard/A_Star.py`; create `backend/TacticalBoard/test_routing.py`.

1. Add regressions for symmetric priorities, S=0/A=-1/T=4 free gate shortcut, 5 ly range vs 20 ly invalid induction, distinct passed states, equal cost/fewer hops and existing movement matrix. Run `python -B -m unittest TacticalBoard.test_routing -v` from backend; verify expected original failures before implementation.
2. Implement `RouteGraph(galaxies, stargate_connections)` with `.galaxies`, `.by_id`, `.find_route(start, goal, max_distance, allow_dirt, allowed_ids=None)`. Preserve `Galaxy`, `distance`, `a_star` and legacy helpers where used. Exact labels `(cost,hops)` and stable heap sequence, full-state predecessor. Strict range at the shared edge classifier.
3. Add failing spatial tests, implement cKDTree exact candidate lookup with strict final distance filtering and request-local neighbor reuse. Graph must not retain per-request labels.
4. Add independent seeded oracle/differential tests, verify existing tests and new tests pass, self-review. Commit only owned files after root verification.

## Task 2: Snapshot and API integration

Files: create `backend/TacticalBoard/routing_data.py`, `backend/TacticalBoard/test_routing_api.py`; modify `backend/TacticalBoard/views.py`, `backend/EVE_MDjango/ci_settings.py`, `.github/workflows/ci.yml`, `scripts/deploy/requirements-ci.txt`.

1. Add isolated API/loader/cache tests and run to confirm missing feature/failure. Use real in-memory unmanaged tables for ORM behavior; mock only clocks/load failures/concurrency boundaries.
2. Build snapshot via ORM with SQL Round eligibility preserved, full endpoint metadata and graph. Implement 300-second TTL, lock, atomic replacement, failure backoff and clear 503. No route result caching or production dependency changes.
3. Wire endpoint to a single snapshot. Validate names/finite positive radius first; preserve boolean coercion, new8 endpoint policy, response types and display rounding. Never conceal graph failures as no-path.
4. Add TacticalBoard and pinned numerical dependencies to isolated CI. Run `python -B manage.py test TacticalBoard License ActivationCode Feedback EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput` and migration checks.

## Task 3: Reproducible benchmark and operational notes

Files: create `scripts/benchmark_routing.py`, `docs/plans/2026-09-18-routing-optimization-results.md`.

1. Build deterministic synthetic workloads and optionally user-public real map data without private credentials. Compare indexed exact routes with equivalent full-scan exact search and legacy search separately.
2. Measure cold graph build and warm complete routes, sparse/dense/unreachable cases, distance-work count and query count; record runtime/dependency versions. Do not assert wall-clock thresholds in CI.
3. Document cache lifetime, worker-local nature, refresh failure behavior, restart after bulk imports, limits and measured—not promised—results.

## Task 4: Deep review and final verification

1. Independent spec review of graph and integration; fix gaps with new failing tests.
2. Independent quality/correctness review after spec approval; rerun discovered counterexamples and full backend suite.
3. Run deployment safety tests and frontend build/regressions where relevant. Check git diff, no unrelated files/secrets/schema changes.
4. Commit local changes and verified results; leave `codex/routing-optimization` unmerged and unpushed. Report tests, benchmark scope, residual limits and review outcome.

## Progress

- Baseline: original 2 route tests pass in isolated SQLite configuration.
- Design approved by user; isolated worktree created at `.worktrees/routing-optimization`.
