# Collaborative Tactical Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a private organization-wide tactical board with reports, movable friendly/enemy deployments, regional loading and a validated 100-account limit; all enemy deployments are visible to scouts, friendly deployments only to the founder and commanders.

**Architecture:** Keep the existing public star map and route planner unchanged. Add one shared board per organization with authoritative transactions, organization membership, server-filtered role views, versioned commands and replayable notifications. No within-organization room isolation or per-enemy publish approval. Runtime selection remains an implementation gate.

**Tech Stack:** Existing React, Canvas, TanStack Query, Django/DRF and MySQL; Node tests, Django tests and Playwright. Long-connection runtime and shared presence backend remain to be verified before adding dependencies.

---

## Status and execution boundary

Implemented locally in `.worktrees/tactical-collaboration`, branch `codex/tactical-collaboration`, based on reviewed corporation feature state `8761dd7`. All paths below are relative to that worktree. No push, production migration, SSH or deployment is authorized by this document. Original task steps below remain the design acceptance reference; actual filenames and measured results are recorded in the runtime/verification documents.

Implementation refinements: role-filtered full-snapshot recovery replaces incremental event replay in V1; Channels/Uvicorn are opt-in, existing WSGI unchanged. Commands/presence use durable database transactions, no Redis. A dedicated scoped SVG map preserves the original public Canvas star map. Founder-only restoration is the safe default pending the optional user policy reply. Real MySQL concurrency and production readiness remain open gates, not completed claims.

Read `2026-09-21-collaborative-tactical-board-design.md` first. The user has settled visibility: all enemy deployments for scouts, friendly deployments only for the founder/commanders, no separate rooms. Commanders may approve members and remove scouts, but never remove commanders/the founder or assign roles. Reinstatement after management removal remains a separate policy to resolve before enabling re-approval; do not silently let join approval bypass a founder's removal.

Each task follows RED → minimal GREEN → review → scoped local commit. Tests listed below are acceptance targets to write, not existing passing tests. Execute server commands from `backend`, Node/browser commands from `front-codex`, unless noted. Never import production `.env` in isolated tests.

## Task 0: Close contracts and runtime spike

**Files:**
- Read: `backend/EVE_MDjango/asgi.py`, `db_routers.py`, `settings.py`, `ci_settings.py`.
- Read: `backend/Authentication/models.py`, `front-codex/src/services/fetchWithAuth.js`.
- Read: `scripts/deploy/README.md`, `evem-backend.override.conf.example`.
- Create: `docs/plans/2026-09-21-collaborative-tactical-board-runtime.md`.

1. Encode the confirmed organization-wide membership and role visibility contract, including commander scout-removal, own-report access and no manual enemy publish switch. Resolve reinstatement separately; it must not reopen the settled room/visibility decisions.
2. Check official runtime/library documentation and current dependency compatibility. Compare incremental polling, SSE and WebSocket against the design, including multi-worker broadcast, JWT expiry, Origin checks, replay and revocation.
3. In an isolated test configuration, prove an authenticated join and bounded message exchange; prove a rejected join emits no private data. No production deployment changes.
4. Record exact dependency pins, local commands and reproducible Redis/MySQL fixtures if selected. Define presence lease timing, replay window and latency/load-test thresholds before implementation.
5. Expand the real transport/connection tests in Tasks 6–7 with the selected runtime's exact commands. Commit only reviewed contracts and isolated spike material.

**Gate:** Do not claim transport or capacity readiness until this evidence exists. Runtime-specific implementation is deliberately not fabricated in this plan.

## Task 1: Organization and membership authorization

**Files:**
- Create: `backend/TacticalCollaboration/{__init__.py,apps.py,models.py,permissions.py,services.py,serializers.py,views.py,urls.py}`.
- Create: `backend/TacticalCollaboration/migrations/__init__.py`, generated additive `0001_initial.py`.
- Create: `backend/TacticalCollaboration/tests/{__init__.py,test_membership.py}`.
- Modify: `backend/EVE_MDjango/{settings.py,ci_settings.py,urls.py,ci_urls.py}`.

1. Write API tests for invite → application → approval, commander approval creating only a scout, forged role fields, rejection, revoked invite, pending users reading intelligence, self-approval, cross-organization IDs, owner-only role changes, commander removal of scouts only, concurrent target promotion/removal and revocation of all removed-user connections.
2. Run `python manage.py test TacticalCollaboration.tests.test_membership --settings=EVE_MDjango.ci_settings --noinput`; confirm failures reflect missing behavior.
3. Add organization, membership, invite and application records, an audit record, uniqueness constraints and transactional review service. Use `settings.AUTH_USER_MODEL`; ordinary platform staff status must not silently grant private tactical access.
4. Use server-resolved roles only; a representative policy unit test is:

```python
def test_commander_may_approve_but_not_assign_roles(self):
    self.assertTrue(can("commander", "approve_join"))
    self.assertTrue(can("commander", "remove_scout"))
    self.assertFalse(can("commander", "remove_commander"))
    self.assertFalse(can("commander", "assign_role"))
    self.assertFalse(can("scout", "approve_join"))
```

   The pure helper is insufficient alone: endpoint tests must establish actor membership, target organization and current actor/target roles under lock. Serialize competing approvals, removals, role changes and protected writes under a documented lock order. A commander cannot remove a concurrently promoted commander using a stale scout list. Previously committed reports survive removal; an in-flight write must not commit after access revocation. Protect the sole founder from accidental demotion/removal; ownership transfer is not part of this release.
5. Rerun the focused suite and `python manage.py makemigrations TacticalCollaboration --check --dry-run --settings=EVE_MDjango.ci_settings`; commit only the scoped app/config/tests.

## Task 2: Shared organization board, visibility and local graph

**Files:**
- Modify: `backend/TacticalCollaboration/{models.py,services.py,views.py,urls.py}`.
- Create: `backend/TacticalCollaboration/{map_scope.py,visibility.py,tests/test_boards.py,tests/test_visibility.py,tests/test_map_scope.py}` and generated migration.
- Read, preserve: `backend/TacticalBoard/{models.py,routing_data.py,views.py,urls.py}`.

1. Add failing tests for cross-organization denial, all enemy deployments visible to scouts without publication flags, friendly list/detail/history/aggregate denial, unauthorized scope change, valid region IDs, 0/1/2-hop closure, missing coordinates, duplicated gates, boundary exits and outside-scope forces surviving scope edits.
2. Run `python manage.py test TacticalCollaboration.tests.test_boards TacticalCollaboration.tests.test_visibility TacticalCollaboration.tests.test_map_scope --settings=EVE_MDjango.ci_settings --noinput` and verify RED.
3. Enforce one shared board per organization and reuse approved active membership without another room application. Add a central visibility projection used by all reads/notifications and a dedicated map endpoint returning only included systems, necessary labels, internal gates and boundary exits. Cache static graph by canonical scope/data version; enemy deployments outside the loaded scope remain searchable and listable by scouts. Scope is not an authorization boundary.
4. Never mutate unmanaged static graph tables. Keep full route graph independent of the view, and verify gate moves against the authoritative graph.
5. Rerun focused tests and existing `TacticalBoard` suite, check migration drift, then commit.

## Task 3: Reports, canonical forces and concurrency

**Files:**
- Modify: `backend/TacticalCollaboration/{models.py,services.py,serializers.py,views.py,urls.py}`.
- Create: `backend/TacticalCollaboration/{commands.py,tests/test_reports.py,tests/test_forces.py,tests/test_concurrency.py}` and migration.

1. Add failing tests for unknown vs zero counts, allowed ship classes, own-report corrections, adopted-report correction, duplicate sightings, stable force IDs, adjacent moves, non-adjacent correction, immutable observation time and stale versions. Cover commander-only friendly creation/side changes, scout payloads forging a friendly force ID/side, enemy-to-friendly removal from scout views, and friendly-to-enemy publication of current data without private friendly history/source leakage.
2. Run `python manage.py test TacticalCollaboration.tests.test_reports TacticalCollaboration.tests.test_forces --settings=EVE_MDjango.ci_settings --noinput`.
3. Add versioned reports, report revisions, forces with explicit friendly/enemy side and force-source links pinned to report revisions; source is optional for directly created friendly deployments. Add command receipts keyed by actor/organization-board/request ID and payload digest. All confirmed enemy forces are automatically readable by scouts, with no publish toggle. A move contract example:

```json
{
  "request_id": "bc2f19c0-d7d2-4fb7-ac28-46b3b846598c",
  "expected_version": 7,
  "destination_system_id": 30000002,
  "kind": "gate_move"
}
```

   Authenticate and authorize, validate resource organization/board and visibility, acquire the documented locks, check idempotency/version/adjacency, update force location, increment version and write audit/event in one transaction. Re-authorize stored idempotent responses before returning them after a role change. Return 409 for a stale version or reused request ID with different content, without disclosing inaccessible friendly records. The example system ID is illustrative, not a claim about a real gate.
4. Prove one accepted result for duplicate commands, one winner for concurrent versions and no implicit report sum. Mirror the tests on isolated MySQL, since SQLite does not prove production row locking.
5. Rerun focused and full app tests, migration drift, then commit.

## Task 4: Authenticated UI shell and organization flow

**Files:**
- Create: `front-codex/src/pages/TacticalOrganizations.jsx`, `TacticalOperations.jsx`.
- Create: `front-codex/src/services/apiTacticalCollaboration.js`.
- Create: `front-codex/src/components/tactical/collaboration/{BoardHeader.jsx,JoinRequests.jsx,MemberPanel.jsx}`.
- Modify: `front-codex/src/App.jsx`, `src/components/layout/AppShell.jsx`; choose the existing scoped CSS location after inspecting current styles.
- Create: `front-codex/tests/e2e/specs/tactical-membership.spec.js`.

1. Write failing UI tests for login, join pending state, commander review, commander removal of scouts only and rejected role escalation. Test denied deep links rather than only hidden buttons; approved users should see the single organization board without a room picker or another application.
2. Run `npm run test:e2e -- tests/e2e/specs/tactical-membership.spec.js --workers=1` and observe RED.
3. Add lazy routes separate from `/starmap`, authenticated service calls and accessible role-specific views. Use account/organization/permission-generation query keys, clear private caches on account or role changes and discard delayed old-account/old-role results. Do not put friendly data in the scout's browser cache.
4. Rerun focused tests plus auth-session unit tests; keep mock UI evidence separate from real backend security tests. Commit.

## Task 5: Local map, quick reporting and deployment interaction

**Files:**
- Create: `front-codex/src/components/tactical/collaboration/{ReportComposer.jsx,IntelligenceList.jsx,ForceDetails.jsx,ScopePicker.jsx,DeploymentLayer.jsx}`.
- Modify: `front-codex/src/pages/TacticalOperations.jsx`.
- Modify only with regression tests: `front-codex/src/components/tactical/TacticalStarMap.jsx`.
- Create: `front-codex/src/utils/tacticalCommands.js`, `tests/unit/tacticalCommands.test.mjs`, `tests/e2e/specs/tactical-collaboration.spec.js`.

1. Add RED tests for prefilling selected system, keyboard count entry, unknown count, own pending reports, confirmation/link, drag adjacency, explicit non-adjacent correction, stale conflict and duplicate submissions. Test every enemy deployment visible to scouts, no publish buttons, commander friendly/enemy/all layers, and no friendly details or counts in scout responses.
2. Run `node --test tests/unit/tacticalCommands.test.mjs` and `npm run test:e2e -- tests/e2e/specs/tactical-collaboration.spec.js --workers=1`.
3. Separate camera drag from force drag using a movement threshold and captured hit target; cancel on Escape/permission loss. Only confirmed response changes shared state; retain editable local draft on failure.
4. Add desktop collapsible panel and mobile list/search/reporting with no full graph download. Preserve mobile route planning and existing `/starmap` behavior.
5. Run focused tests, starmap regression specs and `npm run build`; inspect desktop/mobile screenshots and commit.

## Task 6: Replayable synchronization and live authorization

**Files:**
- Create: `backend/TacticalCollaboration/{events.py,realtime.py,tests/test_events.py,tests/test_realtime.py}`.
- Modify: selected isolated ASGI/runtime configuration from Task 0; do not replace the live WSGI publisher yet.
- Create: `front-codex/src/hooks/useTacticalCollaboration.js`, `src/utils/tacticalEvents.js`, `tests/unit/tacticalEvents.test.mjs`.
- Create: `front-codex/tests/e2e/specs/tactical-reconnect.spec.js`.

1. Add failing tests for snapshot/cursor boundary races, dropped/duplicate/out-of-order events, replay window expiry, logout during reconnect, role change and cross-organization event delivery. Include friendly events excluded from scout live/replay/history/aggregate payloads, opaque authorized-view cursors, enemy-to-friendly withdrawal without new private details, and friendly-to-enemy visibility without past friendly history.
2. Run `python manage.py test TacticalCollaboration.tests.test_events TacticalCollaboration.tests.test_realtime --settings=EVE_MDjango.ci_settings --noinput` and `node --test tests/unit/tacticalEvents.test.mjs` under the isolated runtime fixtures specified in Task 0.
3. Persist per-organization-board ordered events with commands; only notify after commit. Recover committed-but-not-broadcast events through authorized-view replay. Filtered private events must neither leak global event counts nor cause infinite client gap recovery. Never assume an in-memory broadcast is durable delivery.
4. Authenticate the connection without putting long-lived tokens in URLs, validate Origin and re-check current access for subscriptions, replay and sensitive outgoing data. Apply the same server-side role projection to deployments, reports, rosters and statistics. On downgrade, invalidate prior permission cursors/subscriptions, clear friendly client state and refetch a filtered snapshot; an old-role request/command receipt must not restore private content.
5. Test multiple independent browser contexts against the real test server, not only intercepted HTTP; record reconnection and revocation evidence. Commit.

## Task 7: Atomic 100-account presence and bounded load

**Files:**
- Create: `backend/TacticalCollaboration/{presence.py,tests/test_presence.py}`.
- Modify: `backend/TacticalCollaboration/realtime.py`, frontend member panel/hook.
- Create: `scripts/tactical/load_board.py`, `scripts/tactical/README.md`.

1. Write RED tests for simultaneous admissions at 99 members, same-account tabs, closing one of two tabs, reconnect grace, expiry, revoked membership and shared-state restarts. Include simultaneous commander entry when full: no unapproved extra slot.
2. Run `python manage.py test TacticalCollaboration.tests.test_presence --settings=EVE_MDjango.ci_settings --noinput` using shared-state integration fixtures, not only an in-memory fake.
3. Implement atomic account leases, bounded per-account connections and role-filtered count/roster snapshots. Require successful admission before serving tactical live state so REST reads do not bypass board capacity. Authorized approval/personnel management must remain available outside a full board, without granting an extra map-subscription slot. Lease cleanup must match the connection generation and cannot remove a newer reconnection.
4. The load tool must refuse non-loopback targets by default, require an explicit isolated-test opt-in for remote staging, create no production accounts and accept no command-line plaintext passwords. Simulate 100 unique accounts, multi-tab duplication, bursts, slow clients and reconnect waves under Task 0's agreed thresholds.
5. Run `python scripts/tactical/load_board.py --base-url http://127.0.0.1:8001 --accounts 100 --duration-seconds 600` from repo root, once the safe fixture-based tool exists. Record metrics and failures; do not equate opening 100 sockets with passing this test. Commit code and a non-sensitive results summary.

## Task 8: Independent review and local delivery

**Files:**
- Create: `docs/plans/2026-09-21-collaborative-tactical-board-verification.md`.
- Modify later, only after runtime is settled: `.github/workflows/ci.yml` and relevant additive deployment tests/docs.

1. Independent specification review checks every design acceptance item; independent security/concurrency review checks authorization, idempotency, events, leases and actual MySQL evidence.
2. Resolve findings, then fresh backend app/regression tests, Node tests, serial browser suite, build, isolated MySQL tests and the real 100-account exercise.
3. Check migrations are additive, static tables unchanged, rollback effects understood and private data excluded from logs/artifacts. Record skips and blocked tests honestly.
4. Deliver a locally running version with synthetic accounts and clear role-switching instructions; no bypass code in production authentication.
5. Outline runtime/proxy/readiness/backup/rollback changes for later review. Do not push, merge or deploy without separate user authorization.

## Progress

- [x] Confirmed product permissions archived.
- [x] Existing code integration points inspected.
- [x] Single organization board, all enemy deployments visible to scouts, friendly visibility restricted, commander scout-removal confirmed.
- [x] Runtime choice and bounded local connection proof; founder-only restoration default documented.
- [x] Tasks 1–5 core domain/UI implementation, additive migrations and focused regression tests.
- [x] Task 6 snapshot recovery/permission invalidation and live HTTP/WS smoke checks (not historical replay).
- [x] Task 7 durable 100-account limit and guarded load tool implemented.
- [ ] Real MySQL multi-worker concurrency, maximum-record/slow-client/reconnect-wave capacity validation.
- [x] Task 8 local-only cross-review, final serial regression and isolated 100-account/600-second exercise; evidence and local handoff recorded. This does not close the separate real-MySQL/production gates above.

Executed with bounded backend/frontend implementation agents, independent cross-reviews and main-agent transport/integration/visual verification. User data in other worktrees and production is unchanged. Invite revocation UI and long-term report retention remain explicitly deferred, not silently counted as complete.
