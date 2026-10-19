# Hotspot Level Colors Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the five current hotspot activity levels visually distinct and keep the legend consistent with the map.

**Architecture:** Export one immutable five-band palette from the existing hotspot helper; select by exact activity level and reuse it in the canvas and React legend. Preserve existing worker/data contracts and all map performance safeguards.

**Tech Stack:** React, Canvas 2D, Node test runner, Vite, Playwright CLI.

---

### Task 1: Reproduce and repair exact-level heat rendering

**Files:**
- Modify: `front-codex/src/utils/anomalyHotspots.js`
- Test: `front-codex/tests/unit/anomalyHotspots.test.mjs`
- Update existing regression fixtures: `front-codex/tests/e2e/specs/starmap-performance.spec.js`

1. Replace the old three-count-band regression with exact expectations for levels
   1–5 from the design palette; assert five unique colors and increasing radii.
2. Add invalid-level cases: zero, negative, boolean, string, fractional, >5,
   nonfinite. Assert `null`, not a guessed count band.
3. Use level-valued points in canvas tests; record actual `fillStyle` for all
   five vector bands and cached sprites, five surfaces per DPR, proper alpha
   reset, viewport culling and fixed CSS-pixel sizing under zoom.
4. Run `node --test tests/unit/anomalyHotspots.test.mjs` in `front-codex` and
   observe the expected red failure before production edits.
5. Export `ANOMALY_HEAT_BANDS` with frozen records and array, then make
   `anomalyHeatBand(level)` return its exact level's record or null.
6. Update cache documentation from three to five; keep drawing and alpha
   behavior otherwise unchanged. Rerun the focused suite green.
7. Update the existing performance regression's old count-valued heat fixtures
   to levels 1–5 and its pixel-comparison matrix from 12 to 20 cases. Do not
   weaken its overlap, core-security-pixel, zoom or DPR assertions.

### Task 2: Keep the five-level legend on the same source

**Files:**
- Modify: `front-codex/src/components/tactical/AnomalyHotspotLeaderboard.jsx`
- Modify: `front-codex/src/components/tactical/AnomalyHotspotLeaderboard.css`
- Test: `front-codex/tests/unit/anomalyHotspotsLeaderboard.test.mjs`

1. Add a failing rendered-markup regression requiring all five level/range
   entries, their shared palette colors, and no obsolete 1–80 / 81–200 bands.
2. Import `ANOMALY_HEAT_BANDS` and render the legend from it, including a stable
   level identity, accessible level labels, and a color swatch from the record.
3. Use text clarifying that the intervals are level ranges rather than exact
   counts, while retaining the unconfirmed-statistics-window notice.
4. Remove obsolete independently hardcoded three-color CSS. Keep the small
   legend wrapped with readable spacing; do not redesign the panel.
5. Run the helper, panel and integration test files green.

### Task 3: Verify and review the bounded presentation repair

**Files:**
- Local verification artifacts only: `output/playwright/`
- Update: this plan with verified results if needed.

1. Run all frontend unit tests with `npm run test:unit`.
2. Run `npm run build` including the existing bundle-budget check.
3. Use the Playwright CLI against the existing local app; inject only public
   synthetic hotspot rows (levels 1–5), never private sessions or game calls.
4. Inspect screenshots of five distinct map colors/radii, the matching desktop
   legend, and a narrow/mobile layout. Check heat toggle, map selection and
   canvas errors are unaffected.
5. Obtain specification review first, then independent code-quality review;
   repair findings and rerun affected tests.
6. Commit only scoped source/tests/docs. Do not commit diagnostic output,
   captures or account files. Do not push, merge or publish without a request.

## Verified execution results

- Clean baseline: 31 focused frontend tests passed on `52affbc1f`.
- TDD red: 6 expected failures demonstrated the missing five-level palette,
  invalid-level handling, distinct actual canvas colors, five-surface cache,
  and shared five-item legend before production edits.
- Implementation: `e624a265b4875d5a3fea385bc969a3235cc811bd`; 34 focused tests
  passed. Independent specification and subsequent code-quality reviews both
  approved the six-file repair, with no outstanding findings.
- Full frontend unit suite: 729/729 passed, zero skipped or failed.
- `npm run build`: passed, including `check:bundle`.
- Real Chromium CLI: five distinct colored/increasing circles and matching
  legend visually inspected at 1600×1000. Heat checkbox toggled off/on.
- Browser pixel checks: 20 combinations (five levels × two zooms × DPR 1/2)
  passed; maximum sprite/reference channel difference was 2. Existing overlap,
  screen radius and security-core checks were retained. This was CLI visual/
  pixel verification, not a claim to have run the entire Playwright suite.
- Narrow layout: 390×844, all five legend entries remained inside the panel,
  five distinct computed swatch colors, no horizontal page overflow; screenshot
  inspected. No application page errors. Canvas readback performance advisories
  originated solely from the synthetic pixel-check harness.
- Local-only artifacts are under `output/playwright/hotspot-five-level-*20261019*`;
  no private account/capture data was used for browser verification.
- No production configuration, accounts, timers or published code changed.
  Branch and existing managed worktree are retained for a later publish request.
