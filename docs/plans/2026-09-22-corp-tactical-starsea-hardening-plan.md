# 军团、战术板、星海见闻加固实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成阶段 0/1/2 的安全、实时协同、地图联动和移动端修复，并以自动化测试作为验收依据。

**Architecture:** 保留现有 HTTP 命令和版本校验；增加组织单调 `state_version`、提交后事件通知和 Redis/Channels 可选广播。WebSocket 不可用时使用带版本游标的 HTTP fallback。地图普通人数上报使用独立观察标记，移动端使用快速上报 outbox。

**Tech Stack:** Django/DRF、Django Channels、Redis（可选本地 fallback）、React、Vitest/Node tests、Playwright。

---

### Task 1: 阶段 0 权限和回跳回归

**Files:**
- Modify: `backend/TacticalCollaboration/services.py`
- Modify: `front-codex/src/components/tactical/TacticalReportForm.jsx`
- Modify: `front-codex/src/components/tactical/TacticalMembers.jsx`
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx`
- Modify: `front-codex/src/pages/Login.jsx`
- Test: `backend/TacticalCollaboration/tests/test_system_intel.py`
- Test: `front-codex/tests/unit/loginDestination.test.mjs`

**Steps:**
1. Write failing tests proving a scout cannot submit `fleet_intel`, `ships`, or `force_id`, and tactical login preserves the encoded organization URL.
2. Run only those tests and verify the expected failures.
3. Add server-side role checks and the shared safe-next allowlist.
4. Hide disallowed report fields for scouts and update all tactical login links.
5. Run backend and unit tests; commit the focused change.

### Task 2: 阶段 0 生产边界与请求可靠性

**Files:**
- Modify: `backend/EVE_MDjango/settings.py`
- Modify: `front-codex/src/hooks/useTacticalSession.js`
- Modify: `front-codex/src/services/fetchWithAuth.js`
- Modify: `front-codex/src/styles.css`
- Test: `backend/tests_starsea_local.py` or a new settings boundary test
- Test: `front-codex/tests/unit/tacticalSession.test.mjs`

**Steps:**
1. Add failing tests for origin/host configuration, request deadlines, and exponential reconnect backoff.
2. Run them to verify failure.
3. Make production settings environment-driven with a strict allowlist; add request timeout and jittered reconnect while keeping local fallback.
4. Run targeted tests and commit.

### Task 3: 阶段 1 组织版本与非锁快照

**Files:**
- Modify: `backend/TacticalCollaboration/models.py`
- Create: migration for `Organization.state_version`
- Modify: `backend/TacticalCollaboration/services.py`
- Modify: `backend/TacticalCollaboration/realtime.py`
- Modify: `backend/TacticalCollaboration/views.py`
- Test: `backend/TacticalCollaboration/tests/test_backend_audit.py`

**Steps:**
1. Add failing tests for monotonic versions, stale snapshot rejection, and no row lock on read snapshots.
2. Verify failures.
3. Add the version field, increment it in command transactions, and return it in snapshots.
4. Replace wall-clock acceptance with version acceptance; keep permission version checks.
5. Run backend test suite and commit.

### Task 4: 阶段 1 事件广播与 HTTP fallback

**Files:**
- Modify: `backend/TacticalCollaboration/realtime.py`
- Create/modify: `backend/TacticalCollaboration/events.py`
- Modify: `front-codex/src/hooks/useTacticalSession.js`
- Modify: `front-codex/src/utils/tacticalSocket.js`
- Test: `backend/TacticalCollaboration/tests/test_realtime.py`
- Test: `front-codex/tests/unit/tacticalSession.test.mjs`

**Steps:**
1. Write failing tests for event publish after commit, one update per version, and fallback `since_version`.
2. Verify failures.
3. Add Redis/Channels publisher with a no-op/local fallback and stop per-socket 1 Hz database polling.
4. Add version-aware client reconciliation and reconnect-before-expiry.
5. Run targeted and integration tests; commit.

### Task 5: 阶段 2 地图人数上报联动与性能分层

**Files:**
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx`
- Modify: `front-codex/src/utils/tacticalMapInteraction.js`
- Modify: `front-codex/src/utils/tacticalMarkerLayout.js`
- Create/modify: `front-codex/src/utils/tacticalMapPresentation.js`
- Test: `front-codex/tests/unit/tacticalMapPresentation.test.mjs`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Steps:**
1. Add failing tests for report markers, click-to-report focus, and viewport/LOD filtering.
2. Verify failures.
3. Pass reports through the map, render one clear observation marker per system, and connect selection callbacks.
4. Add viewport filtering, stable label priority, and a spatial index for hit testing.
5. Run unit and browser tests; commit.

### Task 6: 阶段 2 移动端快速上报和冲突处理

**Files:**
- Modify: `front-codex/src/pages/TacticalCollaboration.jsx`
- Modify: `front-codex/src/components/tactical/TacticalReportForm.jsx`
- Modify: `front-codex/src/styles/tacticalCollaboration.css`
- Create: `front-codex/src/utils/tacticalOutbox.js`
- Test: `front-codex/tests/unit/tacticalSession.test.mjs`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Steps:**
1. Add failing tests for mobile quick report, queued retry, and conflict choice.
2. Verify failures.
3. Implement bottom-sheet quick report, local outbox, retry status, and field-level conflict UI.
4. Add virtual list/pagination and scroll containment.
5. Run desktop/mobile Playwright and commit.

### Task 7: 全量验证与审查

**Steps:**
1. Run Django, Node, frontend build, and Playwright suites.
2. Run a 100-connection ASGI smoke/locust test and inspect DB lock wait metrics.
3. Run `git diff --check` and review the complete diff.
4. Request a code review before any merge or deployment.
