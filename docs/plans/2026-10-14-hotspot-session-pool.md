# Hotspot Session Pool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. For this approved same-session run, use superpowers:subagent-driven-development with independent spec then quality review.

**Goal:** Dedicate the seven existing KM accounts to one sequentially rotating anomaly-hotspot collector while retaining KM suspension and conservative rate limits.

**Architecture:** Separate strict derived hotspot bundles and an explicit owner-only pool cursor select one account per pass. The selected slot binds to existing coordinator aliases; global cooling, request budgets and the public saved-snapshot API remain unchanged.

**Tech Stack:** Python/Django management commands, MessagePack, existing POSIX private file helpers, SQLite coordination, systemd and existing GitHub CI/publisher.

---

### Task 1: Strict conversion and explicit private hotspot pool

**Files:** Modify `backend/AnomalyHotspots/session_bundle.py`; create `backend/AnomalyHotspots/tests/test_session_pool.py`; use existing `GameSessions/rotation.py` and KM safe file primitives without widening KM capabilities.

1. Write tests that derive a strict bundle from synthetic KM input and preserve its own endpoint/hello/auth/route/flag without mutating source, strip profile capabilities, reject a target other than -1 and all malformed/private inputs. Run tests to observe missing conversion behavior.
2. Implement `derive_from_killboard(bundle)` by validating KM input, deep-copying only required authentication plus its `get_kill_info` envelope, replacing that Ext10 business call and validating the result with the existing hotspot validator. No socket or persistence in conversion.
3. Write failing tests for full seven-slot cycle, process restart continuation, singular fallback, conflicting config, bounds, duplicate paths/inodes/materials, unsafe file/cursor/link/permission, explicit cursor versus KM source/cursor collision. Use actual temporary files; POSIX-only security cases skip on Windows and execute in Linux CI.
4. Implement explicit pool loading and one atomic private cursor selection. Suggested return contract: `(bundle, slot, index, pool_size)`. Pool config must be full validated before cursor advancement; absent cursor starts zero, corrupt bounded regular cursor may restart zero but insecure cursor must fail closed. Multi-session pools require explicit private anomaly cursor. No default secret discovery or home scanning.
5. Run `python manage.py test AnomalyHotspots.tests.test_session_pool --settings=EVE_MDjango.anomaly_test_settings --noinput` from `backend`, then all existing anomaly tests. Record red/green evidence; commit only owned source/tests after self-review.

### Task 2: Bind selected slot to one bounded collector pass

**Files:** Modify `backend/AnomalyHotspots/collector.py`, `backend/AnomalyHotspots/management/commands/anomaly_collect.py`, `backend/AnomalyHotspots/tests/test_collector.py`, `backend/AnomalyHotspots/tests/test_command.py`; modify or add `scripts/deploy/tests/test_anomaly_worker_contract.py` only if documentation contract needs coverage.

1. Write failing tests proving selected index/size reach `account_lease('ANOMALY', index, size)`, bad mapping fails before socket, command selects one bundle only, no new session on rate/auth/network rejection, and shared global cooldown prevents game connections across slots/restarts.
2. Add index/pool_size parameters with compatible defaults to session/collection entry point; command calls the new selector once and forwards fixed selection. Normalize optional diagnostic fields from the actual session; add only safe A–G-style slot, pool count, RPC count, stage and allowlisted error reason to journal. Preserve existing status/count fields and snapshot schema.
3. Test seven sequential command runs using real saved bundles/cursor and only mocked network boundary; source files unchanged; failures preserve last-good time/rows; logs omit private fields/paths/raw exceptions. Validate account mapping size/unique IDs even before any network call.
4. Run `python manage.py test AnomalyHotspots --settings=EVE_MDjango.anomaly_test_settings --noinput`; run KM transport/session and GameSessions regression with isolated settings; `python -m unittest discover -s scripts/anomaly_hotspots/tests -v` and deploy worker contracts.
5. Commit owned changes, independent spec review against approved design, then independent production quality review. Fix important findings with failing regressions and re-review. No unrelated frontend density/timeout/UI changes or query flag needed: existing owner blank already closes KM.

### Task 3: Verification, release and private pool provisioning

**Files:** Update deployment/operator docs with private pool keys and rollback instructions, without actual files, account aliases or credentials. Root may keep local operational artifacts under ignored/untracked `output/`, not in product or Git. No CI/dependency/migration edits.

1. Fresh scoped tests and diff/policy checks. Verify backend-only source scope, no raw material and no dependency/schema changes. Retain original worktree dirt.
2. Fetch current master; integrate fast-forward only if unchanged, push backup feature branch and master normally (no force). Wait all required CI jobs and automatic Production publishing. On failure inspect exact logs and fix scoped causes without weakening gates.
3. Confirm both public deployment version endpoints match published SHA. Root alone stops hotspot timer and waits its in-flight service to finish, backs up protected anomaly config, then runs a reviewed server-local conversion/provisioning helper with deployed code as the existing collector user.
4. Validate seven derived private bundles offline, new independent cursor, original aliases and files unchanged. Atomic collector.env switch from single file to explicit pool, leaving coordinator file and cooldown unchanged. Keep snapshots/web access and KM suspension intact. If staging fails, keep old hotspot configuration rather than clearing coordinator state.
5. Re-enable original randomized timer. Observe normal scheduled pass logs for safe slot/index advancement and actual success or honest blocked status; do not repeatedly launch manual game requests. Verify API last-success time, source versions, permissions and KM disabled/inactive/denied. Report what is live versus only offline validated; all seven online authorization checks are not claimed from one successful account.
