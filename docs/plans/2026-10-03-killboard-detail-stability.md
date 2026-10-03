# Killboard detail stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make KM detail switching visually stable while clarifying report IDs, system-ID fallbacks, and participant avatar frames.

**Architecture:** Keep the existing API and summary/detail selection contract. Derive a stable AppShell transition key for all `/killboard/:killId` paths so changing the selected report does not remount the page transition. Add a small presentation helper for the system label and dedicated CSS classes for the report ID and participant image fallback.

**Tech Stack:** React 18, React Router 6, Framer Motion, CSS, Node `node:test`, Vite.

---

### Task 1: Lock the behavior with failing tests

**Files:**
- Modify: `front-codex/tests/unit/killboardPresentation.test.mjs`
- Modify: `front-codex/tests/unit/killboardPage.test.mjs`
- Create/modify: `front-codex/tests/unit/appShell.test.mjs` if the existing test harness can load AppShell safely.

Add assertions for `killboardSystemLabel` (name first, then `星系 #<id>`, then `未知星系`), the hero report-ID class, and a stable transition key for two different killboard detail paths. Run the focused tests and observe the expected failures before implementation.

### Task 2: Implement presentation and layout fixes

**Files:**
- Modify: `front-codex/src/utils/killboardPresentation.js`
- Modify: `front-codex/src/pages/Killboard.jsx`
- Modify: `front-codex/src/components/killboard/KillParticipantRow.jsx`
- Modify: `front-codex/src/styles/killboard.css`

Implement the system-ID fallback helper and use it for hero/list location text where applicable. Add a dedicated `kb-report-id` class. Add an explicit full-size `.kb-ship-placeholder` rule so missing artwork uses the same frame geometry as loaded participant hulls.

### Task 3: Remove the route-transition flicker

**Files:**
- Modify: `front-codex/src/components/layout/AppShell.jsx`

Derive `pageTransitionKey` from the pathname, collapsing `/killboard/<id>` to `/killboard` while leaving all other routes unchanged. Keep the existing animation for module-to-module navigation. Do not add arbitrary timeouts or disable accessibility motion preferences.

### Task 4: Verify and review

Run focused unit tests, the complete `npm run test:unit`, and `npm run build`. Start the isolated preview server and use the existing Playwright harness to switch between two reports, checking that the page wrapper does not remount/animate and that the report ID, system fallback, and placeholder frame remain stable. Review the diff for unrelated changes before deployment.
