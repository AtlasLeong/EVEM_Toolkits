# Collaborative Tactical Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a private, role-controlled tactical star map with intelligence reports, movable deployments, regional loading and a validated 100-account room limit.

**Architecture:** Keep the existing public star map and route planner unchanged. Add a separate collaboration domain with authoritative transactions, explicit room authorization, versioned commands and replayable notifications. Runtime selection and room-access semantics are gates before implementation, not assumptions to silently fill in.

**Tech Stack:** Existing React, Canvas, TanStack Query, Django/DRF and MySQL; Node tests, Django tests and Playwright. Long-connection runtime and shared presence backend remain to be verified before adding dependencies.

---

## Status and execution boundary

Planning only. All paths below are relative to the feature worktree root. Current design archive is in `.worktrees/community-corp`; implementation should use an isolated `codex/` worktree based on the reviewed feature state, preserving current untracked QA artifacts. No push, production migration, SSH or deployment is authorized by this document.

Read `2026-09-21-collaborative-tactical-board-design.md` first. Before changing code, settle whether approval admits a person to all organization rooms or only assigned rooms, and how a founder-removed member may be reinstated. Default-deny cross-room reads until that rule is confirmed. Do not invent commander room-assignment privileges or let join approval bypass a founder's removal.

Each task follows RED → minimal GREEN → review → scoped local commit. Tests listed below are acceptance targets to write, not existing passing tests. Execute server commands from `backend`, Node/browser commands from `front-codex`, unless noted. Never import production `.env` in isolated tests.

## Task 0: Close contracts and runtime spike

**Files:**
- Read: `backend/EVE_MDjango/asgi.py`, `db_routers.py`, `settings.py`, `ci_settings.py`.
- Read: `backend/Authentication/models.py`, `front-codex/src/services/fetchWithAuth.js`.
- Read: `scripts/deploy/README.md`, `evem-backend.override.conf.example`.
- Create: `docs/plans/2026-09-21-collaborative-tactical-board-runtime.md`.

1. Confirm room-access scope; record what approval grants without changing the three-role matrix.
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

1. Write API tests for invite → application → approval, commander approval creating only a scout, forged role fields, rejection, revoked invite, pending users reading intelligence, self-approval, cross-organization IDs and owner-only role changes.
2. Run `python manage.py test TacticalCollaboration.tests.test_membership --settings=EVE_MDjango.ci_settings --noinput`; confirm failures reflect missing behavior.
3. Add organization, membership, invite and application records, an audit record, uniqueness constraints and transactional review service. Use `settings.AUTH_USER_MODEL`; ordinary platform staff status must not silently grant private tactical access.
4. Use server-resolved roles only; a representative policy unit test is:

```python
def test_commander_may_approve_but_not_assign_roles(self):
    self.assertTrue(can("commander", "approve_join"))
    self.assertFalse(can("commander", "assign_role"))
    self.assertFalse(can("scout", "approve_join"))
```

   The pure helper is insufficient alone: endpoint tests must establish actor membership, target organization and current status. Serialize competing approvals and owner removal/role operations under a documented lock order. Protect the sole founder from accidental demotion/removal; ownership transfer is not part of this release.
5. Rerun the focused suite and `python manage.py makemigrations TacticalCollaboration --check --dry-run --settings=EVE_MDjango.ci_settings`; commit only the scoped app/config/tests.

## Task 2: Rooms, explicit access and local graph

**Files:**
- Modify: `backend/TacticalCollaboration/{models.py,services.py,views.py,urls.py}`.
- Create: `backend/TacticalCollaboration/{map_scope.py,tests/test_rooms.py,tests/test_map_scope.py}` and generated migration.
- Read, preserve: `backend/TacticalBoard/{models.py,routing_data.py,views.py,urls.py}`.

1. Add failing tests for room-bound authorization, unauthorized scope change, valid region IDs, 0/1/2-hop closure, missing coordinates, duplicated gates, boundary exits and outside-scope forces surviving scope edits.
2. Run `python manage.py test TacticalCollaboration.tests.test_rooms TacticalCollaboration.tests.test_map_scope --settings=EVE_MDjango.ci_settings --noinput` and verify RED.
3. Implement room access using Task 0's confirmed policy. Add a dedicated map endpoint accepting validated scope and returning only included systems, necessary region/constellation labels, internal gates and boundary exits; cache by canonical scope and static data version.
4. Never mutate unmanaged static graph tables. Keep full route graph independent of the view, and verify gate moves against the authoritative graph.
5. Rerun focused tests and existing `TacticalBoard` suite, check migration drift, then commit.

## Task 3: Reports, canonical forces and concurrency

**Files:**
- Modify: `backend/TacticalCollaboration/{models.py,services.py,serializers.py,views.py,urls.py}`.
- Create: `backend/TacticalCollaboration/{commands.py,tests/test_reports.py,tests/test_forces.py,tests/test_concurrency.py}` and migration.

1. Add failing tests for unknown vs zero counts, allowed ship classes, own-report corrections, adopted-report correction, duplicate sightings, stable force IDs, adjacent moves, non-adjacent correction, immutable observation time and stale versions.
2. Run `python manage.py test TacticalCollaboration.tests.test_reports TacticalCollaboration.tests.test_forces --settings=EVE_MDjango.ci_settings --noinput`.
3. Add versioned reports, report revisions, forces and force-source links; add command receipts keyed by actor/room/request ID and payload digest. A move contract example:

```json
{
  "request_id": "bc2f19c0-d7d2-4fb7-ac28-46b3b846598c",
  "expected_version": 7,
  "destination_system_id": 30000002,
  "kind": "gate_move"
}
```

   Authenticate and authorize, validate resource room, acquire the documented locks, check idempotency/version/adjacency, update force location, increment version and write audit/event in one transaction. Return 409 for a stale version or reused request ID with different content. The example system ID is illustrative, not a claim about a real gate.
4. Prove one accepted result for duplicate commands, one winner for concurrent versions and no implicit report sum. Mirror the tests on isolated MySQL, since SQLite does not prove production row locking.
5. Rerun focused and full app tests, migration drift, then commit.

## Task 4: Authenticated UI shell and organization flow

**Files:**
- Create: `front-codex/src/pages/TacticalOrganizations.jsx`, `TacticalRoom.jsx`.
- Create: `front-codex/src/services/apiTacticalCollaboration.js`.
- Create: `front-codex/src/components/tactical/collaboration/{RoomHeader.jsx,JoinRequests.jsx,MemberPanel.jsx}`.
- Modify: `front-codex/src/App.jsx`, `src/components/layout/AppShell.jsx`; choose the existing scoped CSS location after inspecting current styles.
- Create: `front-codex/tests/e2e/specs/tactical-membership.spec.js`.

1. Write failing UI tests for login, join pending state, commander review and rejected role escalation. Test denied deep links rather than only hidden buttons.
2. Run `npm run test:e2e -- tests/e2e/specs/tactical-membership.spec.js --workers=1` and observe RED.
3. Add lazy routes separate from `/starmap`, authenticated service calls and accessible role-specific views. Use session-bound query keys, clear private caches on account changes and discard delayed old-account results.
4. Rerun focused tests plus auth-session unit tests; keep mock UI evidence separate from real backend security tests. Commit.

## Task 5: Local map, quick reporting and deployment interaction

**Files:**
- Create: `front-codex/src/components/tactical/collaboration/{ReportComposer.jsx,IntelligenceList.jsx,ForceDetails.jsx,ScopePicker.jsx,DeploymentLayer.jsx}`.
- Modify: `front-codex/src/pages/TacticalRoom.jsx`.
- Modify only with regression tests: `front-codex/src/components/tactical/TacticalStarMap.jsx`.
- Create: `front-codex/src/utils/tacticalCommands.js`, `tests/unit/tacticalCommands.test.mjs`, `tests/e2e/specs/tactical-room.spec.js`.

1. Add RED tests for prefilling selected system, keyboard count entry, unknown count, pending state, confirmation/link, drag adjacency, explicit non-adjacent correction, stale conflict and duplicate submissions.
2. Run `node --test tests/unit/tacticalCommands.test.mjs` and `npm run test:e2e -- tests/e2e/specs/tactical-room.spec.js --workers=1`.
3. Separate camera drag from force drag using a movement threshold and captured hit target; cancel on Escape/permission loss. Only confirmed response changes shared state; retain editable local draft on failure.
4. Add desktop collapsible panel and mobile list/search/reporting with no full graph download. Preserve mobile route planning and existing `/starmap` behavior.
5. Run focused tests, starmap regression specs and `npm run build`; inspect desktop/mobile screenshots and commit.

## Task 6: Replayable synchronization and live authorization

**Files:**
- Create: `backend/TacticalCollaboration/{events.py,realtime.py,tests/test_events.py,tests/test_realtime.py}`.
- Modify: selected isolated ASGI/runtime configuration from Task 0; do not replace the live WSGI publisher yet.
- Create: `front-codex/src/hooks/useTacticalRoom.js`, `src/utils/tacticalEvents.js`, `tests/unit/tacticalEvents.test.mjs`.
- Create: `front-codex/tests/e2e/specs/tactical-reconnect.spec.js`.

1. Add failing tests for snapshot/cursor boundary races, dropped/duplicate/out-of-order events, replay window expiry, logout during reconnect, role change and cross-room event delivery.
2. Run `python manage.py test TacticalCollaboration.tests.test_events TacticalCollaboration.tests.test_realtime --settings=EVE_MDjango.ci_settings --noinput` and `node --test tests/unit/tacticalEvents.test.mjs` under the isolated runtime fixtures specified in Task 0.
3. Persist per-room ordered events with commands; only notify after commit. Recover committed-but-not-broadcast events through replay. Never assume an in-memory broadcast is durable delivery.
4. Authenticate the connection without putting long-lived tokens in URLs, validate Origin and re-check current access for subscriptions, replay and sensitive outgoing data. Filter roster fields on the server by current role.
5. Test multiple independent browser contexts against the real test server, not only intercepted HTTP; record reconnection and revocation evidence. Commit.

## Task 7: Atomic 100-account presence and bounded load

**Files:**
- Create: `backend/TacticalCollaboration/{presence.py,tests/test_presence.py}`.
- Modify: `backend/TacticalCollaboration/realtime.py`, frontend member panel/hook.
- Create: `scripts/tactical/load_rooms.py`, `scripts/tactical/README.md`.

1. Write RED tests for simultaneous admissions at 99 members, same-account tabs, closing one of two tabs, reconnect grace, expiry, revoked membership and shared-state restarts. Include simultaneous commander entry when full: no unapproved extra slot.
2. Run `python manage.py test TacticalCollaboration.tests.test_presence --settings=EVE_MDjango.ci_settings --noinput` using shared-state integration fixtures, not only an in-memory fake.
3. Implement atomic account leases, bounded per-account connections and role-filtered count/roster snapshots. Require successful admission before serving tactical live state so REST reads do not bypass the room policy. Authorized approval/personnel management must remain available outside a full room, without granting an extra map-subscription slot. Lease cleanup must match the connection generation and cannot remove a newer reconnection.
4. The load tool must refuse non-loopback targets by default, require an explicit isolated-test opt-in for remote staging, create no production accounts and accept no command-line plaintext passwords. Simulate 100 unique accounts, multi-tab duplication, bursts, slow clients and reconnect waves under Task 0's agreed thresholds.
5. Run `python scripts/tactical/load_rooms.py --base-url http://127.0.0.1:8001 --accounts 100 --duration-seconds 600` from repo root, once the safe fixture-based tool exists. Record metrics and failures; do not equate opening 100 sockets with passing this test. Commit code and a non-sensitive results summary.

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
- [ ] Room-access policy and runtime gate.
- [ ] Tasks 1–7 implementation and focused verification.
- [ ] Task 8 independent review and local delivery.

Execution choices: subagent-driven development within the current task, or a separately requested implementation session using executing-plans. Neither has started.
