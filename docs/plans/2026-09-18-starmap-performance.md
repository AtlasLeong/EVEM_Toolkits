# Star Map Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce redundant Canvas work and repeated static data requests without changing map navigation or route calculations.

**Architecture:** Retain React/Canvas and memoized model. Cull at the render boundary, deduplicate visual edges only, and coalesce camera updates with requestAnimationFrame. Scope longer React Query caching to four static map datasets.

**Tech Stack:** React 18, Canvas 2D, TanStack Query, Vite, Playwright.

---

### Task 1: Baseline and regression evidence
- Existing specs: `front-codex/tests/e2e/specs/starmap*.spec.js`.
- Add `front-codex/tests/e2e/specs/starmap-performance.spec.js` and helper `front-codex/tests/e2e/helpers/starmapPerformance.js`.
- Run existing specs first; add and run failing assertions for unchanged-size resets, offscreen drawing, reverse edges and rapid wheel accumulation. Preserve true Canvas calls; API fixtures only.
- Capture repeatable generated dataset baseline and attach measurements via Playwright artifacts.

### Task 2: Rendering and interaction
- Modify `front-codex/src/components/tactical/TacticalStarMap.jsx` only after red tests.
- Guard width/height assignments; precompute colors and unique undirected gate geometry in memoized model.
- Compute world viewport plus screen-pixel margin; skip out-of-bounds nodes and non-overlapping edge bounding boxes. Keep route rendering and edge crossings intact.
- Coalesce manual view updates; keep latest camera ref authoritative; cancel pending work when animation takes over/unmounts. Track manual interaction separately from animated camera and restore details after settling.
- Run targeted regression and original map specs to green; inspect screenshots and operation count artifacts.

### Task 3: Static dataset reuse (independent)
- Modify `front-codex/src/pages/TacticalBoard.jsx`; add `front-codex/tests/e2e/specs/starmap-data-cache.spec.js`.
- Failing test: revisit after original three-minute freshness must not re-request the four datasets, but revisit after one hour must revalidate.
- Add one-hour staleTime/gcTime to just the four map queries; do not change global query defaults or mutations.
- Verify data and failed requests still recover; commit scoped changes.

### Task 4: Validation and handoff
- Run `npm run test:e2e -- --workers=4` and `npm run build` in `front-codex`.
- Independent reviewer checks correctness, viewport edge cases, scheduling, cleanup and test strength; address findings using regression tests.
- Record baseline/after evidence and exact validation results in design report. Commit only relevant files on `codex/starmap-performance`.
- No master merge, push, deployment or backend restart.
