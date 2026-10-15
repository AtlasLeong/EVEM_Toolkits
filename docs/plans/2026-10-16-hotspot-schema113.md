# Observed Hotspot Schema 113 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore strict hotspot decoding for the observed schema 113 without weakening validation or increasing game traffic.

**Architecture:** Keep the current transport and validated row model. Permit only record schema IDs 112 and 113 at the existing Ext19 boundary; all other bounds and validation remain unchanged. Market session activation waits for complete market captures.

**Tech Stack:** Python, MessagePack, unittest/Django tests, existing GitHub CI and protected production publisher.

---

### Task 1: Reproduce the observed compatibility failure

**Files:** Modify `backend/AnomalyHotspots/tests/test_core.py`.

1. Allow the synthetic `wire` helper to select a record schema, defaulting to 112.
2. Add a test that schema 113 decodes wrapped and transport-unwrapped responses
   into the same sorted exact rows as 112, including zero values.
3. Change the former unknown-schema negative fixture from 113 to 114.
4. Add schema-113 negative cases for extra/missing fields, duplicate IDs,
   boolean/negative/unsafe counts, and malformed record boundaries. Unknown IDs
   and invalid schema types must remain rejected.
5. Run `python -B -m unittest AnomalyHotspots.tests.test_core.ProtocolTests`
   from `backend` with `PYTHONPATH` including `backend`. Expect the new
   schema-113 positive regression to fail before changing production code.

### Task 2: Add the smallest strict compatibility change

**Files:** Modify `backend/AnomalyHotspots/protocol.py`.

1. Declare an explicit immutable observed-schema allowlist `{112, 113}`.
2. Retain the exact integer type check and change only the schema membership
   condition. Leave record structure, unpack bounds and `validate_rows` intact.
3. Re-run the protocol tests and then
   `python manage.py test AnomalyHotspots GameSessions.tests --settings=EVE_MDjango.anomaly_test_settings --noinput`.
4. Decode the authorized capture offline with the candidate. Log only flow
   counts, row counts and validation outcome; never copy private capture data
   into tests, Git, logs or release archives.
5. Review the exact diff and commit only the two source/test files and these
   design/plan documents. Operational helpers and private material stay out.

### Task 3: Review and controlled release

1. Obtain independent review of the strict allowlist and regression coverage.
2. Push the branch, create/attach a PR, wait for complete CI, then merge via the
   established process. Preserve all untracked operational files.
3. Wait for master CI and production success; verify deployed backend SHA.
4. Read sanitized normal-timer audit and public snapshot timestamp/count.
   Do not manually run the collector, clear protection flags, reset cursors or
   send consecutive verification calls to all four sessions.
5. Report actual live success or the remaining blocker. Market remains awaiting
   a capture containing all four complete market sessions.
