# First-stage Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. In this active session the controller uses subagent-driven development with independent file ownership, spec review followed by quality review, and a final integrated review.

**Goal:** Reduce public transfer and manufacturing quote request amplification without changing collection or private access behavior, then verify and deploy.

**Architecture:** Additive bounded batch reads reuse existing Market projections and access checks. React Query reuses public static catalog data; deterministic small brand derivatives and narrowly scoped Nginx gzip reduce transfer. Existing GitHub production gates remain intact.

**Tech Stack:** React 18, TanStack Query 5, Vite, existing Sharp, Django 4.2/DRF, MySQL, Nginx/systemd, Node unit tests, Django isolated settings, Playwright, GitHub Actions.

---

## Checklist

- [x] Inspect production-equivalent source, approve design, preserve dirty original workspace.
- [x] Reuse attached isolated worktree on `codex/performance-phase1-20261023`, based on production master `7ecc4f90`.
- [x] Baseline frontend: 729 passed, zero failures/skips.
- [x] Task 1: bounded batch API/adapter with red-green tests.
- [x] Task 2: catalog React Query reuse/revalidation and small logo derivatives with red-green tests.
- [x] Task 3: public-only gzip preparation, safety tests and operator procedure.
- [ ] Task 4: spec review, quality review, full verification and real local browser.
- [ ] Task 5: push PR, attach artifact, complete PR/master CI, merge and deploy, activate verified Nginx configuration, verify actual production.

### Task 1: Bounded batch quotes

**Files:** `backend/Market/views.py`, `urls.py`, `tests/test_api.py` (or a dedicated new discovered test), `backend/Authentication/viewer_access.py` and public boundary tests; `front-codex/src/services/apiManufacturing.js`, `tests/unit/manufacturingQuoteAdapter.test.mjs`, relevant existing preview/e2e fixtures.

1. Write failing tests for 48 exact-ID quotes in one request; <=50 submitted IDs; deduplication; empty/invalid/overflow/repeated/unknown inputs; enabled-only projection; constant query work; status, timestamp, decimal/top-five metadata; public switch/JWT/private-write boundaries.
2. Run isolated API and Node adapter tests and record meaningful failures before implementation.
3. Add a narrow public-read endpoint with the existing permission and throttle classes; validate input before queryset evaluation and return existing projection plus scope. Change adapter scheduling from individual IDs to <=50-ID batches, retaining cancellation and missing rows.
4. Update actual consumer fixtures to the additive route, without broadening unrelated mocks or weakening assertions. Run adapter, Market, public-read and manufacturing browser regressions.

### Task 2: Catalog reuse and small logo

**Files:** `front-codex/src/pages/ManufacturingEstimator.jsx`, new `src/services/manufacturingCatalogResource.js` if warranted, Node unit and manufacturing e2e tests; `front-codex/index.html`, `src/components/layout/AppShell.jsx`, `scripts/prepare-site-icons.mjs`, generated `public/brand/*`, brand contract tests and package build lifecycle.

1. Write red tests for a catalog fetch using `cache:'no-cache'`, the supplied abort signal, parse/schema errors, and route re-entry reuse; no stale post-unmount commits.
2. Add the public stable-key Query with one-hour stale/gc and explicit retry UI, preserving selection and manufacturing calculations. Keep the legacy URL.
3. Write red tests for HTML/navigation referencing small assets, expected 32/96/180 dimensions, transparent aspect-preserving derivation and strict byte budget; generate only those known assets using existing Sharp. Keep the original source/URL.
4. Run Node unit tests, production build/budget, and desktop/mobile navigation/manufacturing browser tests; inspect logo screenshots and actual network behavior.

### Task 3: Public gzip

**Files:** `scripts/deploy/nginx-locations.conf.example`, a narrowly scoped Nginx gzip helper/test if necessary, `scripts/deploy/README.md` operator instructions. Do not change publisher, CI gates, settings or service configuration.

1. Read-only inspect real Nginx include/location layout and gzip support; do not expose credentials or certificate material.
2. Write red offline tests for exact-target preparation, ambiguity refusal, private/API/TLS preservation, digest mismatch, config validation failure and restoration.
3. Implement only public asset/catalog-location gzip configuration, moderate level/minimum length and Vary negotiation. Design application as guarded, backed-up, graceful reload with exact rollback; do not execute on production until integrated tests/reviews pass.
4. Test offline and on the target's real Nginx parser with a non-active candidate. Actual activation and public gzip/identity/private-boundary verification are controller-only deployment steps.

### Task 4: Integrated verification/review

1. Review actual diffs against the four approved changes and exclude scope creep; independent spec review first, code-quality review second. Fix/re-review important issues.
2. Run all frontend unit/preview tests, build/budget, relevant full E2E, full Market/GameSessions/public-auth regressions, deploy safety tests, migration dry checks using isolated settings. Never use production database for tests.
3. Verify real local built frontend: 48 IDs/one request; catalog route reuse/failure recovery; small logo desktop/mobile; retain old pricing on failed requests.
4. Confirm no dependency/schema/collector changes and preserve original dirty/untracked files.

### Task 5: Publish and read back

1. Commit explicit reviewed files, push `codex/performance-phase1-20261023`, create/attach PR. Keep private materials and generated test artifacts outside Git.
2. Require full successful PR and merged-master CI (including independent MySQL/package gates), then normal existing Production publisher; no root publishing or bypasses.
3. Activate only the reviewed public gzip configuration using existing root operator access, exact backup, `nginx -t`, graceful reload and rollback on failure. Do not stop/restart collectors or clear budgets.
4. Verify exact frontend/backend SHAs, actual served imports/assets, public endpoint identity/gzip equivalence, 48-ID batch behavior, catalog reuse and private boundaries. Verify market/hotspot timers remain active and KM remains disabled.
5. Report measured transfer/request reductions, tests and live URL. Do not claim general speedup percentages from byte savings alone.

## Pre-push verification evidence

- Frontend unit + preview: 769 passed, no failures/skips. Build and bundle budget passed.
- Market + shared-session/worker regressions: 271 passed; production middleware public-read integration: 14 passed; auth policy independently passed.
- Three existing manufacturing E2E suites: 37 passed. Catalog refresh/reuse, logo and responsive navigation: 12 passed independently and by the controller.
- New reconnect regression initially reproduced a removed target crashing render. A minimal membership guard closes it; preserved-target and removed-target browser cases both pass.
- Logo derivatives: favicon 1666 bytes, navigation 6947 bytes, touch 16388 bytes; source retained, dimensions/alpha/pixel derivation validated.
- Deploy safety suite: 364 tests, no failures, 17 Windows-specific platform skips. Public-gzip subset: 18 tests, no failures, 1 real-flock Windows skip; Linux CI must exercise the non-skipped branch.
- Target Nginx parser rehearsed against a private temporary candidate using real `nginx -t -c`: passed. Actual site/main hashes remained unchanged, zero reloads. Candidate site digest `71e97668efb0c8b93c17eecf549dea60829278446c2898148ece82b322b8783f`.
- Independent catalog/logo spec and quality reviews and batch/gzip quality reviews approved; no critical/important issues remain. Runtime gzip activation, complete CI and exact-version online acceptance are still pending, not claimed complete.
