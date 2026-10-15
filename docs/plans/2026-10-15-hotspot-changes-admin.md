# Hotspot Changes and Admin Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This session uses the approved equivalent superpowers:subagent-driven-development with separate specification and quality reviews.

**Goal:** Add a permissioned snapshot-net-increase leaderboard with thirty-day history and a single owner-controlled management center while preserving public totals and KM shutdown.

**Architecture:** Store bounded immutable sanitized history plus an atomic manifest outside the application database; collect no additional RPCs. Keep explicit user grants/audits in a new Django app and protect private read APIs before filesystem reads. Integrate private mode into the existing panel and lazy-load one owner-only management page.

**Tech Stack:** Python 3/Django/DRF, standard-library JSON/filesystem, existing MySQL application DB with isolated SQLite tests, React 18/React Query/Vite, node:test and Playwright.

---

## Baseline and ownership

Worktree: `C:/Users/22351/.codex/worktrees/anomaly-hotspots/EVEM_Toolkits`, branch `codex/hotspot-changes-admin-20261015`, base `a4001b61a6ab4cfc9970c4ec332b320e6d080734`.
Baseline: 47 AnomalyHotspots tests passed (5 platform skips), 710 frontend unit tests passed. Preserve unrelated untracked operational artifacts and the original dirty `43c4` worktree.
No server/game calls, push or deployment are part of local implementation. All new code follows @superpowers:test-driven-development; run the new test red before implementing and record evidence.

## Task 1: Sanitized durable history and ten-minute collector integration

**Files:** Create `backend/AnomalyHotspots/history.py`, `backend/AnomalyHotspots/tests/test_history.py`; modify `backend/AnomalyHotspots/management/commands/anomaly_collect.py`, worker/settings configuration, timer example and focused contract/command tests.

1. Write failing tests for baseline then second sample, signed delta, positive sorting, missing/new IDs, true elapsed across a failure, idempotent duplicate, conflict/out-of-order denial and retention preserving references. Run `python manage.py test AnomalyHotspots.tests.test_history --settings=EVE_MDjango.anomaly_test_settings --noinput` and confirm feature assertions fail.
2. Implement bounded standard-library history, immutable samples plus atomic manifest, strict schemas/no-link/ownership/size checks. Retain thirty days, hard maximum sample count and byte budget. Do not follow or delete unknown artifacts. Do not store raw traffic, session credentials or auth bodies.
3. Export `record_success(directory, rows, *, now_ms=None)`, `read_changes(directory, *, interval=None, before=None, limit=100)`, `record_attempt(directory, status, *, now_ms=None, system_count=0, session_slot=None, pool_size=None, audit=None)` and `read_attempts(directory)`; return sanitized data only. Config `ANOMALY_HISTORY_DIR` is opt-in. Use explicit safe failures, not silent resets of corrupt history.
4. Changes payload contract: `{version:1,status:'ok'|'baseline'|'unavailable',statistics_window:null,interval:{id,start_at_ms,end_at_ms,elapsed_ms}|null,coverage:{comparable,new,missing,negative,unchanged},systems:[{solar_system_id,previous_destroy_num,destroy_num,delta}],intervals:[{id,start_at_ms,end_at_ms,elapsed_ms}],next_before:number|null}`. Interval IDs are end timestamps. Signed comparable rows retained; UI ranks positive ones. At most 100 interval choices/page; read selected interval only after strict validated integer selection. Unavailable/baseline has empty rows, no invented counts.
5. Command writes the same accepted timestamp to history/public success; failure attempts do not advance history. Distinguish history I/O failures from game/source status and keep public last-good publication usable. Keep `read_attempts` bounded (latest 200) and safe operational fields only. History cannot import Django account ORM/session loaders.
6. Test before changing timer; nominal `OnUnitActiveSec=10min`, small scheduling jitter (up to 30s), retain request jitter/global backoff. No extra RPCs/automatic rejection-driven retry. Run focused tests then full AnomalyHotspots suite and worker contracts. Commit only task files after checks.

## Task 2: Explicit grants, private API and owner-only unified backend

**Files:** Create `backend/ControlCenter/{apps,models,access,views,urls}.py`, migrations/tests and isolated test settings/URLs; modify application registration/URLs/settings and `backend/AnomalyHotspots/{views,urls}.py` (not public schema).

1. Write failing API tests using real test accounts: owner, explicit viewer, ordinary account, staff/superuser outsider, inactive, anonymous, reassigned owner email. Owner requires configured `CONTROL_CENTER_OWNER_ID` plus unique active email match. No JWT email authorization. Run tests to see intended denials/missing feature failures.
2. Add `FeatureGrant(user,capability,enabled,version,updated_by,created_at,updated_at)` unique by user/capability, and append-only authorization audit with actor/target/before/after/reason/time/request ID. Fixed capability `hotspot_changes.view`; avoid generic role editing or granting staff. Grant update and audit same transaction; bounded inputs, conflict409 and idempotent no-op handling.
3. API contract: authenticated `GET /api/control-center/access/` -> `{can_manage:bool,can_view_hotspot_changes:bool}`; owner-only `GET users/?q=` exact email/user ID -> `{results:[{id,username,email,grant:{enabled,version}}]}`; `GET grants/` bounded list same account shape; `PUT grants/<int:user_id>/` accepts `{enabled:bool,version:int,reason?:string}` -> updated account; `GET audit/?before_id=` -> bounded `{results,next_before}`; `GET overview/` -> `{collection:{...safe summary...,attempts:[...]},modules:[{key,label,path,allowed}]}`.
4. Add authenticated grant-gated changes endpoint using Task1's `read_changes` and verified `system_metadata`. Accept only valid bounded interval/before parameters; private headers on success and all errors, no public allowlisting. Authenticate/authorize before files or metadata. Default deny when storage/config unavailable. Return history unavailable truthfully; never game calls.
5. Overview includes sanitized latest status/failures/history state and links to existing license, market, corporation/starsea review, fraud, feedback, tactical usage; honor their actual checks. KM absent/disabled remains unchanged; do not use its blank owner config for control center. Existing grants survive unrelated staff/group changes; revoked grants deny with old JWT on next call.
6. Run isolated control-center and private API tests, public auth policy regression, migration drift and affected existing suites. Commit only task files after checks. Document provisioning/settings and rollback, no live mutation.

## Task 3: Private changes mode and unified admin UI

**Files:** Create private API service/hook, changes utilities/tests, lazy management page/CSS; modify leaderboard, map integration and App/AppShell; add e2e coverage.

1. Write failing unit/browser tests before UI: ordinary/guest sees only totals; grant viewer sees positive signed delta ranking and real interval; owner sees management route; revoked403 clears rows; switch account drops previous private data; mobile no overlap. Run each relevant test red.
2. Use Task2 contract exactly; default deny, identity-scoped query keys, abort signals, no arbitrary server-error display. Poll capability/private read with bounded visible-only interval (30s) for revocation, no game RPC from UI. Hide private rows immediately on identity mismatch, logout or denial; do not retain private last-good after denied access. Scope caches to session identity and clear them appropriately.
3. Add authorized-only 总量/变化 switch inside existing panel; existing total experience/search/region grouping/heat behavior unchanged. Private view ranks only delta>0 descending then ID, shows `+N` and previous→current, actual Shanghai24h interval, coverage/gap/baseline messages, interval history pagination/selection and search. Avoid a third overlapping panel or hidden private data in public props/DOM. Location uses system ID and existing helpers.
4. Lazy `/admin-console` route gated by owner capability; single nav entry visible only to owner. Unified page: exact-account search + grant/revoke and conflict handling, audit list, sanitized collection/failure state, existing module cards respecting server returned allowed. Accessible controls and responsive sizing. Clear sensitive state on denial.
5. Run full node unit suite, Vite build/bundle budget, and focused Playwright tests at mobile390/tablet800/desktop1440 including total-panel spacing regressions, camera retention, owner/viewer/ordinary/revoke/account switch/history selection. Commit only task files after checks.

## Task 4: Integration, independent reviews and handoff

1. Separate specification review then quality review after each implementation task, fixes with regression tests, re-review until approved. Final combined review after frontend/backend integration.
2. Run fresh complete affected suites, application migration/system checks with isolated settings, worker boundary contracts, unit/build/budget and focused browser suite. Inspect git diff for credentials/unrelated files.
3. Document exact operator steps: provision private directory/group modes, owner stable ID resolution, migration, opt-in history configuration and timer reload. Preserve original shared game coordinator and KM-disabled flags; no extra probe requests.
4. Report implemented behavior/test evidence and that production activation needs deployment plus two successful new samples. Do not claim live data/backfilled history or push/deploy without a subsequent release instruction.

## Completion record — 2026-10-15

Local implementation completed on `codex/hotspot-changes-admin-20261015`; the verified product commit is `b5915b3b09592a91dc65e1fd738e8646c8bded3e`. History, backend, CI/operations documentation and frontend each passed independent specification and quality review. Review regressions fixed read-time expiry/staging bounds, audit bulk-upsert protection, private cache revocation, history pagination retry and mobile admin flex-width overflow.

Fresh final product checks:

- Frontend unit suite: 726 passed, no skips/failures.
- Production Vite build and bundle-budget check: passed.
- Root browser integration selection: 75 passed on isolated port 4197, including authentication/cache isolation, guest access, navigation/accessibility, management, private changes, and original map spacing/camera cases.
- ControlCenter: 41 passed; migration drift and Django system checks passed.
- AnomalyHotspots: 75 discovered, successful run with 6 platform-specific skips; existing authentication/public-read selections: 59 passed.
- Release-tool baseline regression: 343 discovered, successful run with 16 platform skips. Updated CI/source-plan/worker selection: 71 passed.
- Manual Playwright CLI checks used synthetic API responses only: desktop and 390px private ranking, owner search/grant/audit, mobile management, retained 16px row spacing and no horizontal page overflow. Corrected mobile management measured viewport/scroll width 390/390, root width 358, table client/scroll width 328/480. The task's CLI browser and root preview service were stopped afterward.

No production server/game requests, database migrations, configuration changes, pushes or deployment were performed for this feature. Public totals and KM shutdown remain unchanged in production. Linux ownership/group permissions, filesystem durability, actual MySQL concurrency, protected-policy installation, default-database migration and owner/history configuration remain deployment gates described in `docs/hotspot-changes-admin-operations.md`. Previously unrecorded samples cannot be backfilled; the private leaderboard needs two normal successful recorded collections after activation.

The isolated worktree and committed feature branch are retained; unrelated pre-existing untracked operational artifacts and the original dirty worktree were not included or modified.
