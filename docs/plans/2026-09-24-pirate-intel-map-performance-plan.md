# Pirate Intel Map Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep crowded pirate-intel maps readable and camera updates within a frame budget.

**Architecture:** The existing SVG marker layer remains complete. A bounded, stable card sampler and collision-free placement layer control only HTML callouts. A frame scheduler coalesces rapid camera events without changing the pure camera math.

**Tech Stack:** React 18, Vite 7, Node `node:test`, esbuild for JSX unit tests.

---

### Task 1: Reproduce dense-card behavior

**Files:**
- Test: `front-codex/tests/unit/pirateIntelMap.test.mjs`

**Steps:**
1. Add assertions that 100 spread markers yield a bounded, non-overlapping card set and that selecting a marker outside the sampled set brings it into the cards.
2. Add a small-camera-change assertion that an unchanged visible marker set retains the same card keys.
3. Run `node --test tests/unit/pirateIntelMap.test.mjs`; expect the new assertions to fail on the current layout.

### Task 2: Bound and place cards

**Files:**
- Modify: `front-codex/src/components/tactical/PirateIntelMap.jsx:35-75`
- Modify: `front-codex/src/components/tactical/PirateIntelMap.jsx:205-220,325-349`
- Modify: `front-codex/src/styles/pirateIntelMap.css`

**Steps:**
1. Compute capacity from safe viewport dimensions and card dimensions, capped at 24.
2. Select visible markers by deterministic farthest-point sampling in world coordinates, putting the selected marker first.
3. Place cards in clear nearby candidates or clear fallback slots; skip only if no clear slot exists.
4. Show the number of cardless locations and point users to the complete marker/list views.
5. Re-run the test file and confirm the new assertions pass without regressions.

### Task 3: Coalesce camera updates

**Files:**
- Test: `front-codex/tests/unit/pirateIntelMap.test.mjs`
- Modify: `front-codex/src/components/tactical/PirateIntelMap.jsx:205-305`

**Steps:**
1. Add a failing scheduler test using a fake animation-frame queue: several deferred updates yield one commit with the latest camera; an immediate update cancels the frame.
2. Implement a small scheduler and route wheel/drag through deferred updates, while resets, buttons, and focus use immediate updates.
3. Run `node --test tests/unit/pirateIntelMap.test.mjs`; expect all tests to pass.

### Task 4: Final verification

**Files:** no source changes expected.

**Steps:**
1. Run the map and polling unit tests.
2. Build to an isolated temporary output directory and run `scripts/check-bundle.mjs` on it.
3. Re-run the 400/800-marker layout benchmark, compare to the recorded 16/74 ms baseline, and inspect `git diff` and `git status` for unintended edits.
