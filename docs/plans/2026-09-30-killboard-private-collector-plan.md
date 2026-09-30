# Private Killboard Collector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restrict Killboard to the owner account, collect all ship classes whose total loss value is strictly above 20,000,000,000 ISK every five minutes, enrich reports with system security, and ship a controlled sci-fi black UI.

**Architecture:** Keep the existing parser and bounded discovery domain, adding a concrete authenticated TCP transport around the captured MessagePack kill-info protocol, a private captured-session pool, and a lease-protected five-minute management worker. Workbook rows 200–400 provide candidate accounts only; password login and conversion into valid sessions are not yet verified. Add server-side owner permission and batched system-security enrichment; the React page consumes the same authenticated API and uses page-level dark tokens. PCAPdroid HTTP is the capture-download channel, not the game's KM transport.

**Tech Stack:** Django/DRF, existing JWT auth, SQLite/MySQL deployment database, systemd timer, React/Vite, Lucide icons, Python standard library plus the existing protocol dependencies.

---

### Task 1: Import the private candidate account pool safely

**Files:**
- Create outside the repository: private session/config directory supplied by deployment environment.
- Create: `scripts/killboard/import_account_pool.py`
- Test: `scripts/killboard/tests/test_import_account_pool.py`

**Steps:**
1. Read the workbook without printing cell values; assert rows 200–400 have the expected email/password columns and exactly 201 usable records.
2. Write only an owner-readable candidate manifest with opaque account IDs and encrypted/locally protected credential material; never commit or log plaintext passwords.
3. Add duplicate-email rejection, row-range validation, and a redacted summary command.
4. Test malformed workbook, missing rows, duplicate emails, and redaction.

### Task 2: Implement private owner access and API cache isolation

**Files:**
- Create: `backend/Killboard/access.py`
- Modify: `backend/Killboard/views.py`, `backend/Killboard/urls.py`
- Modify: `front-codex/src/services/apiKillboard.js`, `front-codex/src/App.jsx`, `front-codex/src/components/layout/AppShell.jsx`
- Test: `backend/Killboard/tests/test_access.py`, `front-codex/tests/unit/killboardAccess.test.mjs`

**Steps:**
1. Add a server-side permission that checks one active, unique account email against `KILLBOARD_OWNER_EMAIL` (defaulted only in deployment configuration).
2. Require JWT authentication for reports, detail, filters, status and access capability; return `401/403` as appropriate and `Cache-Control: private, no-store` plus `Vary: Authorization`.
3. Add a minimal access capability endpoint returning only `can_view_killboard`.
4. Gate navigation and direct routes with the capability result; use the existing authenticated fetch/refresh helper.
5. Replace public-access regression tests with anonymous, ordinary-user, duplicate/disabled-owner and owner cases.

### Task 3: Add value and system-security semantics

**Files:**
- Modify: `backend/Killboard/models.py`, migration, `backend/Killboard/services.py`, `backend/Killboard/parser.py`, serializers/views.
- Create/modify: shared security enrichment helper and tests.

**Steps:**
1. Add `CollectionPolicy.min_isk_lost` and configure the built-in policy as `20000000000.00`, with no ship-class allowlist.
2. Reject missing/non-numeric values and enforce the threshold in persistence and API query paths.
3. Batch-enrich system security, constellation and region from existing board system tables; return null/unknown when unavailable, never guess.
4. Apply the existing security bands and colors, with text labels in addition to color.
5. Add boundary and no-N+1 tests for `null`, `0`, `0.49`, `0.5`, `0.79`, `0.8` and values just above/below threshold.

### Task 4: Add authenticated transport, latest-ID bootstrap and five-minute worker

**Files:**
- Create: `backend/Killboard/collector_transport.py`, account/session pool adapter and management command.
- Modify: discovery cursor/run models and migration as needed.
- Create: `scripts/deploy/evem-killboard-collector.service.example`, `.timer.example`.
- Test: transport, bootstrap, lease recovery, retry/backoff and worker tests.

**Steps:**
1. Implement the captured TCP kill-info request/response adapter without bypassing authentication or inventing endpoints. Extract only one complete connection's handshake, four authentication/character-entry calls and read-only KM template, offline; validate before replay.
2. Bootstrap from a verified existing report and configured empty upper bound with an explicitly acknowledged contiguous-ID assumption, bounded bisection and neighbor reprobes. Return a candidate only, never claim sparse probes verify global coverage or advance over uncollected IDs. Normal collection uses a persisted bounded forward cursor.
3. Select one private session per run, redact session/account identifiers, and classify auth/rate/network/protocol failures.
4. Add a lease/heartbeat and stale-running recovery so a crashed run cannot block future collection.
5. Run every five minutes via a single systemd timer, with one-worker locking, bounded requests and backoff.
6. Add a real authorized latest-ID smoke command; synthetic fixtures remain labelled local-preview only.

### Task 5: Apply the sci-fi black Killboard UI

**Files:**
- Modify: `front-codex/src/pages/Killboard.jsx`, `front-codex/src/styles/killboard.css` and security presentation utilities.
- Test: frontend unit tests, production build, desktop/mobile rendered checks.

**Steps:**
1. Use fixed dark tokens: `#080D12`, `#101B24`, `#142732`, `#28424D`, `#E9F2F2`, `#77E6E0`, `#F5B95D`, `#FF7D72`.
2. Keep the two-column intelligence desk, remove empty secondary profile space, and show ship/system/value/security in the hero and report list.
3. Add security text badges/legend, exact value tooltips, loading/empty/error/forbidden states and reduced-motion handling.
4. Verify no horizontal overflow, visible keyboard focus and at least WCAG AA contrast.

### Task 6: Verification and controlled release

**Steps:**
1. Run focused backend, migration, collector, frontend and build suites.
2. Run one authorized latest-KM smoke test and inspect the stored report without exposing account credentials.
3. Verify ordinary users receive `403`, owner receives data, and hidden navigation cannot bypass the API gate.
4. Deploy only through the existing release process after confirming the production host and service account; enable the timer last.
5. Verify timer health, cursor advancement, report threshold, security fields and rollback instructions.
