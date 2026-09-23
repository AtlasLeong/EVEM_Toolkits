# Tactical Zoom and Card Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep real tactical map callouts visually stable during wheel zoom and unify the live-card close controls and confirmation styling.

**Architecture:** The real projected systems/gates stay as-is. A pure marker layout function exposes a chosen slot and accepts stable preferred slots; the map computes those slots from the unzoomed projection, then applies them to screen-space card placement during pan/zoom. Wheel events are coalesced to animation frames, and changing name layouts fade out during the wheel gesture. A shared SVG close control and a compact variant of the existing dialog standardize the two removal flows without changing commands or permissions.

**Tech Stack:** React 18, SVG, CSS, Node `node:test`, Playwright E2E, Vite.

---

### Task 1: Stable marker slots across wheel frames

**Files:**
- Modify: `front-codex/src/utils/tacticalMarkerLayout.js`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Test: `front-codex/tests/unit/tacticalMarkerLayout.test.mjs`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Step 1: Write failing tests.** Add a unit fixture with three neighboring systems at scale 1.3456 and 1.56; the same group must keep the same `slot` and stay on the same side of its star when passed `preferredSlots`. Add a browser test capturing one visible badge and its own system dot before and after a wheel step; their relative horizontal/vertical direction must not flip. Preserve existing collision and UI-reservation assertions.

**Step 2: Run RED.** `node --test tests/unit/tacticalMarkerLayout.test.mjs`; run the single new Playwright test with `npx playwright test tests/tactical-e2e/tactical.spec.js --grep "stable marker slots"` only if the installed test runner resolves locally. The new assertions must fail for the current layout.

**Step 3: Implement minimal layout support.** Enumerate candidate positions as now, but return `slot: index` on each placed group. Accept `preferredSlots` in options. Prefer that slot when it stays inside the viewport and avoids reserved UI and significant card collisions; otherwise fall back to the existing scored candidate search. In `CollaborationMap`, compute a base slot map from the unzoomed projected `nodes` and active marker groups, then pass it to the screen-space layout. Keep card content at screen-space size and protect the current left search dock. Do not mutate stars, gates, forces, or reports.

**Step 4: Run GREEN and refactor.** `node --test tests/unit/tacticalMarkerLayout.test.mjs tests/unit/tacticalMapPresentation.test.mjs`; run the focused E2E. Confirm off-screen and edge behavior; if a preferred slot is obscured, fallback still avoids the obstruction.

**Step 5: Commit.** Commit only this task's source/tests after `git diff --check` and fresh passing output.

### Task 2: Smooth, bounded wheel gesture and stable name layer

**Files:**
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/styles/tacticalMapIntel.css`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Step 1: Write failing E2E tests.** Verify a wheel burst changes the scale without document scrolling, leaves the pointed world coordinate under the pointer, and does not expose per-event card/name jumps. Test that wheel input at min/max scale does not pan the map.

**Step 2: Run RED.** Execute the focused wheel test and retain its failing output.

**Step 3: Implement.** Accumulate wheel delta and latest pointer anchor in a ref; commit at most one `setView` per animation frame using a gentler bounded factor. Guard unchanged clamped scale by returning the same view object. Clear animation frame/timer on unmount. While wheel events are arriving, fade the dynamically decluttered name layer, then restore it after a short idle interval; keep stars, real gate lines, and live cards visible. Respect reduced-motion CSS.

**Step 4: Run GREEN.** Re-run the focused E2E plus `node --test tests/unit/tacticalMapInteraction.test.mjs tests/unit/tacticalMapLayout.test.mjs`.

**Step 5: Commit.** Commit source/tests after fresh verification.

### Task 3: One card action geometry and truthful content centering

**Files:**
- Modify: `front-codex/src/utils/tacticalMapPresentation.js`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/styles/tacticalMapIntel.css`
- Modify: `front-codex/src/styles/tacticalCollaboration.css`
- Test: `front-codex/tests/unit/tacticalMapPresentation.test.mjs`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Step 1: Write failing tests.** Assert count-card width reserves close space only when the current user can withdraw; verify both action hit regions are the same size and use the same centered icon geometry. For commander and scout fixtures, compare visible text center to the true content area's center. Existing tests must still assert fleet count remains visible, archive/withdraw actions are permission-safe, and × never selects or drags the star.

**Step 2: Run RED.** Execute `node --test tests/unit/tacticalMapPresentation.test.mjs` and the focused badge E2E.

**Step 3: Implement.** Share a small SVG `CloseAction` in `CollaborationMap` with a 24px hit box and two crossed strokes centered at its local center. Use the same content/action slot arithmetic for fleet and count badges. Pass count close-permission to width building, so read-only badges do not gain empty right space. Keep content-adaptive width, current aria names, data selectors, keyboard handling, and the existing confirmation callbacks.

**Step 4: Run GREEN.** Run the focused unit/E2E tests and inspect long Chinese names and 0/unknown counts.

**Step 5: Commit.** Commit source/tests after `git diff --check` and passing output.

### Task 4: Compact archive and withdraw confirmations

**Files:**
- Modify: `front-codex/src/components/tactical/TacticalControls.jsx`
- Modify: `front-codex/src/components/tactical/TacticalReportForm.jsx`
- Modify: `front-codex/src/styles/tacticalCollaboration.css`
- Test: `front-codex/tests/tactical-e2e/tactical.spec.js`

**Step 1: Write failing E2E tests.** For both dialogs, assert a width no greater than 460px at desktop, viewport-safe width on narrow mobile, zero default paragraph top/bottom margins, and clear target/history text. Verify Cancel yields no command and explicit confirmation still sends the existing versioned command.

**Step 2: Run RED.** Execute the focused dialog E2E test.

**Step 3: Implement.** Add `confirm`/`is-confirm` option to `TacticalDialog` that changes only short destructive confirmations, not form dialogs. Use compact 16–18px title, reset paragraph margins, readable 13–14px body, concise target summary, calm danger primary action, and matching mobile safe-area layout. Use it in `ArchiveForce` and `WithdrawCount` only. Preserve loading/error semantics and command payloads.

**Step 4: Run GREEN.** Re-run the focused dialog E2E and existing archive/count tests.

**Step 5: Commit.** Commit source/tests after fresh verification.

### Task 5: Integrated visual and regression verification

**Files:**
- Create: `docs/plans/2026-09-23-tactical-zoom-card-polish-verification.md`

**Step 1: Run full tactical unit tests.** `node --test tests/unit/tactical*.test.mjs` in `front-codex`.

**Step 2: Run tactical browser tests.** `npx playwright test tests/tactical-e2e/tactical.spec.js tests/tactical-e2e/map-scope.spec.js` in `front-codex`; use installed local runner or the established browser fallback if npm cache access blocks npx.

**Step 3: Build.** `npm run build` in `front-codex`, including the bundle check.

**Step 4: Inspect.** Capture current 1440px desktop and narrow/mobile tactical map and both confirmation states in the local preview. Inspect card/action alignment, zoom steadiness, dialog text hierarchy, and no clipping. Record actual results and limitations; do not treat screenshots alone as behavioral proof.

**Step 5: Final review and commit.** Request a code review of all task commits, address important findings, run `git diff --check`, commit the verification note, and leave this branch local. Do not push, merge, or deploy.
