# Killboard NPC identity recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve anonymous KM participant rows to the NPC labels rendered by the client when their persisted weapon/unit type ID is an exact NPC catalog entry.

**Architecture:** Add a small, cached GameData lookup backed by the verified catalog and its client-image mapping metadata. Keep participant serialization precedence as player identity, exact camouflage identity, then NPC weapon identity; preserve all raw IDs and honest unknown fallbacks.

**Tech Stack:** Django/Python backend, unittest/Django `SimpleTestCase`, immutable JSON game catalog, existing React presentation tests.

---

### Task 1: Add the failing NPC lookup and serializer tests

**Files:**
- Modify: `backend/Killboard/tests/test_serializers.py`
- Test: `backend/Killboard/tests/test_serializers.py`

**Step 1:** Add a test for `weapon_type_id=56000171040` expecting `display_name=科尔`, `identity_kind=npc`, and `npc_source_type_id` equal to the source ID.

**Step 2:** Add a test for a normal player row proving the player name remains preferred.

**Step 3:** Add a test for an ordinary weapon/module ID proving it does not become NPC.

**Step 4:** Run the focused tests and confirm the new NPC test fails because the serializer has no NPC lookup.

### Task 2: Implement the exact client NPC lookup

**Files:**
- Modify: `backend/GameData/registry.py`
- Modify: `backend/Killboard/serializers.py`

**Step 1:** Add `npc_identity(type_id)` in `GameData.registry` that returns a verified NPC record only when the catalog item has the maintained no-icon NPC metadata and a non-empty localized name.

**Step 2:** Keep the lookup exact and catalog-backed; do not infer NPC status from numeric prefixes or missing character IDs.

**Step 3:** Update `participant_payload()` to resolve the NPC after player and camouflage identity, expose `npc_source_type_id`, and leave normal rows unchanged.

**Step 4:** Run the focused backend tests and confirm they pass.

### Task 3: Verify integration and preserve untracked user work

**Files:**
- No unrelated files.

**Step 1:** Run all Killboard backend tests.

**Step 2:** Run the frontend Killboard presentation tests to ensure `identity_kind=npc` renders the existing NPC treatment.

**Step 3:** Inspect the diff and status; do not stage the existing user-modified test or untracked archives/screenshots.

**Step 4:** Commit only the NPC implementation and tests.

**Step 5:** Perform a read-only production API check for reports `20043564` and `20043609` after deployment; verify the saved `weapon_type_id` rows now expose the NPC names.
