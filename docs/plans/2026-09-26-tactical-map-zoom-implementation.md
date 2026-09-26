# Tactical Map Zoom and Density Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make both tactical SVG boards zoom smoothly without size jumps, desynchronised hit rings, or card deformation, while reducing dense-map rendering work and preserving current features.

**Architecture:** Keep the current React/SVG renderer. Add shared wheel-frame and live-camera helpers, render topology separately from fixed-size interaction/annotation layers, and update only the bounded interaction set during rAF preview. Apply viewport culling and label LOD to static geometry, with stable label visibility instead of whole-layer reveal animations.

**Tech Stack:** React 18, SVG, Vite, Node test runner, Playwright.

---

### Task 1: Add failing camera-preview regression tests

**Files:**
- Modify: `front-codex/tests/unit/pirateIntelMap.test.mjs`
- Modify: `front-codex/tests/unit/boardMapPrimitives.test.mjs`
- Modify: `front-codex/tests/unit/tacticalMapInteraction.test.mjs`
- Create: `front-codex/tests/tactical-e2e/tactical-zoom-preview.spec.js`

**Step 1: Write the failing unit assertions**

- Assert wheel deltas from pixel/line/page modes normalize to the same bounded frame delta.
- Assert the preview camera exposes the scale used by fixed-size primitives rather than the last committed scale.
- Assert star glyphs and hit rings carry explicit fixed-size metadata that can be updated without a React render.

**Step 2: Run the focused tests and verify they fail**

Run: `npm --prefix front-codex exec -- node --test tests/unit/pirateIntelMap.test.mjs tests/unit/boardMapPrimitives.test.mjs tests/unit/tacticalMapInteraction.test.mjs`

Expected: FAIL on the new preview-scale and metadata assertions.

**Step 3: Add the Playwright repro**

- Use the existing marker and collaboration harnesses.
- Dispatch 30 wheel frames around a selected node without waiting for React commit.
- Measure ring hit bounds and annotation card width/height during preview and after settle.

**Step 4: Run the Playwright repro to capture the current failure**

Run: `npx playwright test tests/tactical-e2e/tactical-zoom-preview.spec.js --config=tests/tactical-e2e/playwright.config.js --reporter=line`

Expected: current code shows a preview/settled size mismatch or a card scale jump.

**Step 5: Commit the tests**

```bash
git add front-codex/tests
git commit -m "test: reproduce tactical map zoom preview desync"
```

### Task 2: Unify wheel normalization and live camera scheduling

**Files:**
- Modify: `front-codex/src/utils/tacticalMapInteraction.js`
- Modify: `front-codex/src/components/tactical/PirateIntelMap.jsx`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Test: `front-codex/tests/unit/tacticalMapInteraction.test.mjs`
- Test: `front-codex/tests/unit/pirateIntelMap.test.mjs`

**Step 1: Implement shared input normalization**

- Export a helper that converts pixel, line, and page wheel deltas to a bounded logical delta.
- Reuse `wheelCameraFrame` limits and pointer anchoring in both maps.
- Coalesce pending delta and anchor into one rAF, preserving the latest pointer position.

**Step 2: Add a live-camera preview contract**

- Keep `committedCamera`/`view` as the React snapshot used for culling.
- Store `liveCamera` in a ref and expose the current scale/translation to DOM patch functions.
- Ensure preview cleanup restores the committed transform only after the final frame is committed.

**Step 3: Run focused unit tests**

Run: `npm --prefix front-codex exec -- node --test tests/unit/tacticalMapInteraction.test.mjs tests/unit/pirateIntelMap.test.mjs`

Expected: PASS, including line/page delta normalization and pointer-anchored zoom.

**Step 4: Commit**

```bash
git add front-codex/src/utils/tacticalMapInteraction.js front-codex/src/components/tactical/PirateIntelMap.jsx front-codex/src/components/tactical/CollaborationMap.jsx front-codex/tests/unit
git commit -m "perf: share live tactical map wheel scheduler"
```

### Task 3: Keep star glyphs, hit rings, gates, and cards fixed-size during preview

**Files:**
- Modify: `front-codex/src/components/tactical/BoardMapPrimitives.jsx`
- Modify: `front-codex/src/components/tactical/PirateIntelMap.jsx`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/styles/tacticalMapIntel.css`
- Modify: `front-codex/src/styles/pirateIntelMap.css`
- Test: `front-codex/tests/unit/boardMapPrimitives.test.mjs`
- Test: `front-codex/tests/tactical-e2e/tactical-zoom-preview.spec.js`

**Step 1: Split topology and fixed-size layers**

- Leave topology paths in the affine-transformed world layer.
- Keep selected/report glyphs, hit targets, labels, and cards in an interaction layer whose positions follow the live camera but whose dimensions do not inherit the preview scale.
- Apply `vector-effect="non-scaling-stroke"` to screen-readable borders and leaders where appropriate.

**Step 2: Patch bounded interaction elements in rAF**

- Add data attributes for world coordinates and fixed-size geometry.
- Update visible hit rings, report markers, leader endpoints, and annotation/card positions from `liveCamera` without a React render.
- Preserve pointer events and keyboard focus while previewing.

**Step 3: Remove global label reveal on settle**

- Replace whole-layer `animation` with a class/data attribute only for newly visible labels.
- Disable opacity transitions while a wheel frame is active; do not restart all labels after every wheel burst.

**Step 4: Run unit and Playwright tests**

Run: `npm --prefix front-codex exec -- node --test tests/unit/boardMapPrimitives.test.mjs tests/unit/pirateIntelMap.test.mjs`

Run: `npx playwright test tests/tactical-e2e/tactical-zoom-preview.spec.js --config=tests/tactical-e2e/playwright.config.js --reporter=line`

Expected: preview and settled ring/card dimensions differ by at most 1px, and no label-wide reveal occurs.

**Step 5: Commit**

```bash
git add front-codex/src/components/tactical front-codex/src/styles front-codex/tests
git commit -m "fix: keep tactical annotations stable during zoom"
```

### Task 4: Cull static geometry and stabilize label density

**Files:**
- Modify: `front-codex/src/components/tactical/PirateIntelMap.jsx`
- Modify: `front-codex/src/components/tactical/CollaborationMap.jsx`
- Modify: `front-codex/src/utils/tacticalMapLayout.js`
- Modify: `front-codex/src/utils/tacticalMapInteraction.js`
- Test: `front-codex/tests/unit/tacticalMapLayout.test.mjs`
- Test: `front-codex/tests/unit/pirateIntelMap.test.mjs`
- Modify: `front-codex/tests/tactical-e2e/pirate-density.spec.js`

**Step 1: Add viewport culling helpers**

- Cull static systems and gates against the camera viewport plus a hysteresis margin.
- Always retain selected, reported, searched, and focused systems.
- Keep the existing maximum label/marker limits as a second guard.

**Step 2: Add stable label LOD**

- Use zoom thresholds with hysteresis so labels do not flicker at the boundary.
- Keep primary labels visible while moving and defer only secondary labels; never hide the full map.

**Step 3: Add density assertions**

- Assert dense harness DOM counts stay below the configured caps.
- Assert 5,000 systems plus 5,950 gates does not render every offscreen label/gate.

**Step 4: Run density tests**

Run: `npx playwright test tests/tactical-e2e/pirate-density.spec.js --config=tests/tactical-e2e/playwright.config.js --reporter=line`

Expected: PASS with lower or equal DOM counts and no regressions in selected/report retention.

**Step 5: Commit**

```bash
git add front-codex/src/components/tactical front-codex/src/utils front-codex/tests
git commit -m "perf: cull tactical map geometry and stabilize labels"
```

### Task 5: Full verification and production build

**Files:**
- No source changes expected; update `docs/plans` only if test evidence needs recording.

**Step 1: Run all focused unit tests**

Run: `npm --prefix front-codex exec -- node --test tests/unit/pirateIntelMap.test.mjs tests/unit/boardMapPrimitives.test.mjs tests/unit/tacticalMapInteraction.test.mjs tests/unit/tacticalMapLayout.test.mjs tests/unit/tacticalMapPresentation.test.mjs`

Expected: PASS.

**Step 2: Run tactical E2E suites**

Run: `npx playwright test tests/tactical-e2e/tactical.spec.js tests/tactical-e2e/pirate-density.spec.js tests/tactical-e2e/tactical-zoom-preview.spec.js --config=tests/tactical-e2e/playwright.config.js --reporter=line`

Expected: PASS, including search, reporting, archive, selection, and zoom behavior.

**Step 3: Run public star map performance regression**

Run: `npx playwright test tests/e2e/specs/starmap-performance.spec.js --config=playwright.config.js --reporter=line`

Expected: PASS; record systems/gates and median/p95 draw timings.

**Step 4: Build the production bundle**

Run: `npm --prefix front-codex run build`

Expected: Vite build and bundle checks succeed.

**Step 5: Inspect diff and commit verification evidence**

Run: `git diff master...HEAD --stat; git status --short`

Expected: only the tactical map source, tests, and plan documents are changed; unrelated user artifacts remain untouched.

```bash
git commit -m "test: verify complete tactical map zoom optimization"
```
