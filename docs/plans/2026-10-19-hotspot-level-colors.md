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
