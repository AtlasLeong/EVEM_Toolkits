# Killboard session rotation and status UI implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rotate the configured Killboard sessions once per collector round while preserving per-request pacing/backoff, and make the owner-facing page use explicit 24-hour timestamps, NPC fallbacks, and a distinct dropped-equipment treatment without exposing the internal cooldown badge.

**Architecture:** The collector will select exactly one session for a five-minute run, using a small atomic cursor file to advance round-robin across the configured pool. The selected client remains unchanged for every RPC in that run; `CollectorPacer` and the persisted exponential cooldown remain the safety controls for `RequestTooOften`. The React presentation layer will normalize timestamps in Asia/Shanghai with `hour12: false`, map unresolved NPC participants to an honest NPC label, and style dropped rows independently while leaving backend rate-limit state intact.

**Tech Stack:** Django/Python collector, JSON/msgpack transport tests, React/Vite frontend, Vitest-style unit tests, existing systemd timer and release publisher.

---

### Task 1: Add a deterministic round-robin session selector

**Files:**
- Modify: `backend/Killboard/session_bundle.py`
- Modify: `backend/Killboard/collector_transport.py`
- Modify: `backend/Killboard/management/commands/killboard_probe.py`
- Test: `backend/Killboard/tests/test_session_bundle.py`
- Test: `backend/Killboard/tests/test_collector_transport.py`
- Test: `backend/Killboard/tests/test_killboard_probe.py` (create if absent)

**Steps:**
1. Write failing tests for selecting index 0, then index 1, then wrapping to index 0 from an explicit three-session pool; assert a single `KillboardClient` keeps the selected bundle for all RPCs in one run.
2. Run the focused tests and verify they fail because production currently calls `random.choice`.
3. Add an owner-readable, configurable cursor path (defaulting to the private collector state directory), read it defensively, and atomically write the next index with a restrictive file mode on POSIX.
4. Expose `load_round_robin_session(paths=None, cursor_path=None)` and make the management-command factory use it once when constructing the client; do not rotate inside `before_rpc`.
5. Preserve fail-closed duplicate/invalid-session validation and fall back to index 0 only when the cursor is missing or malformed.
6. Run the focused backend tests and then the existing session/transport suite.
7. Commit the backend rotation change.

### Task 2: Lock down rate-limit classification and cooldown regression tests

**Files:**
- Modify: `backend/Killboard/collector_transport.py` only if the tests expose a gap.
- Modify: `backend/Killboard/discovery.py` only if the tests expose a gap.
- Test: `backend/Killboard/tests/test_collector_transport.py`
- Test: `backend/Killboard/tests/test_discovery.py`

**Steps:**
1. Add a failing regression test proving only the structured `Ext10 -> Ext16 -> ['UserError', 'RequestTooOften', None]` envelope maps to `rate_limited`.
2. Add a failing cooldown test proving the first rate-limited run pauses the shared cursor for 15 minutes, then increases to 30 and 60 minutes, without trying another session in the same run.
3. Run these tests red, then implement only the minimal fixes if needed.
4. Run the full focused Killboard backend test group and commit.

### Task 3: Make frontend status, NPC, dropped rows, and time formatting explicit

**Files:**
- Modify: `front-codex/src/pages/Killboard.jsx`
- Modify: `front-codex/src/utils/killboardPresentation.js`
- Modify: `front-codex/src/components/killboard/KillParticipantRow.jsx`
- Modify: `front-codex/src/styles/killboard.css`
- Test: `front-codex/tests/unit/killboardPresentation.test.mjs`
- Test: `front-codex/tests/unit/killboardPage.test.mjs`
- Test: `front-codex/tests/unit/killboardParticipantRow.test.mjs`

**Steps:**
1. Write failing tests for a timestamp rendered as `2026/9/30 11:35:37` in the configured Asia/Shanghai timezone, with no AM/PM; add tests for NPC marker/name fallback and for the collection-label helper returning no rate-limit badge while preserving authorization/configuration errors.
2. Write a failing DOM/class assertion for a dropped equipment row to receive the dropped modifier and a distinct status label.
3. Run the focused frontend tests and verify they fail for the intended missing behavior.
4. Implement explicit `hour12: false`, `timeZone: 'Asia/Shanghai'`, and two-digit time fields; keep raw fallback behavior for invalid dates.
5. Update participant presentation to prefer verified NPC/source labels over numeric IDs or “未知角色”, without inventing a character identity.
6. Conditionally omit only the rate-limit/cooldown live pill; retain forbidden and configuration warnings.
7. Add a teal/green dropped background and border treatment that remains legible in dark mode, with reduced-motion-safe transitions.
8. Run focused tests, then the frontend lint/build suite, and commit.

### Task 4: Verify, release, and observe

**Files:**
- Modify: `docs/plans/2026-09-30-killboard-session-rotation-ui.md` only for verification notes.

**Steps:**
1. Run the complete backend Killboard tests, frontend unit tests, and production build.
2. Inspect the diff for credential/session leakage, accidental changes to unrelated untracked artifacts, and any per-RPC session rotation.
3. Build the release using the existing publisher, deploy through the verified release process, and run migration/health checks if the release contains migrations.
4. Confirm the collector timer remains active, the state cursor advances between rounds, and a synthetic `RequestTooOften` fixture still causes cooldown rather than a credential switch within a run.
5. Check the owner page for 24-hour time, NPC labels, dropped styling, and no visible “限流冷却中” badge while preserving backend logs.
6. Record the exact test and deployment evidence before claiming completion.
