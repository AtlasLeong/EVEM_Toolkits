# Killboard display and copy implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean client localization wrappers, redesign the KM hero/value presentation, add a one-click in-game KM touch-tag copy action, and reject reports proven to contain only NPC attackers before persistence.

**Architecture:** Keep display normalization in the shared killboard presentation utility, expose a deterministic copy string from the report ID, and keep the hero layout responsive with CSS grid/containment. Apply NPC-only filtering in the backend persistence boundary using the exact catalog-backed NPC identity resolver; uncertain or mixed reports remain stored.

**Tech Stack:** React/Vite, CSS, Django ORM/services, Node unit tests, isolated Django tests.

---

### Task 1: Display normalization, hero redesign, and copy action

**Files:**
- Modify: `front-codex/src/utils/killboardPresentation.js`
- Modify: `front-codex/src/pages/Killboard.jsx`
- Modify: `front-codex/src/styles/killboard.css`
- Test: `front-codex/tests/unit/killboardPresentation.test.mjs`
- Test: `front-codex/tests/unit/killboardPage.test.mjs`

**Steps:**
1. Add failing tests for all known wrapper tokens, exact in-game touch-tag output, and always-visible compact/full ISK values.
2. Run the focused Node tests and confirm the new assertions fail for the missing behavior.
3. Implement a whitelist wrapper cleaner, export a deterministic `killboardTouchTag(killId)`, add a copy button with Clipboard API fallback, and update the hero CSS to use a three-column grid with an unframed contained ship image and readable exact ISK subline.
4. Run focused tests, then the full frontend unit suite and production build.
5. Commit the display changes.

### Task 2: Reject proven NPC-only reports before persistence

**Files:**
- Modify: `backend/Killboard/services.py`
- Test: `backend/Killboard/tests/test_services.py` (or the existing collector service test module)

**Steps:**
1. Add a failing service test for a report whose every participant is an exact catalog NPC with no player/camouflage evidence; add a mixed/uncertain case that must still persist.
2. Run the focused Django tests and confirm the expected failure.
3. Add the minimal persistence-boundary predicate and stop before creating `KillReport` rows only for the proven NPC-only case.
4. Run the focused service tests and the complete backend Killboard/GameData suite.
5. Commit the collector filter.

### Task 3: Review and release

**Steps:**
1. Run `git diff --check`, frontend tests/build, and backend tests.
2. Review the final diff for scope, preserving unrelated user files.
3. Push `master` and wait for the production workflow to verify and publish.
4. Check `/deploy-version.json` and `/api/deploy-version/` for the published SHA.
