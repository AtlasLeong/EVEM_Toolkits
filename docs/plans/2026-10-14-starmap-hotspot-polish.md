# Starmap Hotspot Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make 犁地热点 readable/searchable with always-visible snapshot time and reduce initial map transfer and drag work without changing collection behavior.

**Architecture:** Keep the existing stored snapshot query and map camera. Refine the leaderboard into fixed controls with one results scroll, memoize it across camera frames, use three cached heat sprites, progressively supply static layers and scope compression to existing static read endpoints.

**Tech Stack:** React 18, TanStack Query 5, Canvas 2D, Vite, Node unit tests, existing Playwright regression suite, Django/DRF.

---

### Task 1: Leaderboard behavior and layout

Files: `front-codex/src/components/tactical/AnomalyHotspotLeaderboard.jsx`, its `.css`, `src/utils/anomalyHotspots.js`, existing `tests/unit/anomalyHotspots*.test.mjs`, `tests/e2e/specs/anomaly-hotspots.spec.js` (discover actual existing file).

1. Add unit/browser assertions for visible 犁地热点, header time independent of collapse/list scroll, search matching a below-ten record and correct original global rank, clear/tabs/no-match, keyboard and wheel isolation. Run relevant tests; require failures caused by missing features.
2. Rank all rows once (use existing rank helpers with full bounded limit), annotate global rank before query filtering, cap matching display with accurate visible hint. Match case-insensitive display/region/ID, no API calls. Render header timestamp and search input with explicit accessible name, one scroll region and responsive dimensions.
3. Memoize exported leaderboard with stable default functions; reuse formatter, but leave parent callbacks for Task 2. Preserve last-good states, unknown-region exclusions, mobile no-location behavior and unconfirmed statistics-window warning.
4. Run `node --test tests/unit/anomalyHotspots*.test.mjs` and `npx playwright test tests/e2e/specs/anomaly-hotspots.spec.js --workers=1` using actual file name. Verify screenshots and box metrics at narrow desktop/mobile. Commit only owned files after verification.

### Task 2: Progressive map and drag work

Files: `src/pages/TacticalBoard.jsx`, `src/components/tactical/TacticalStarMap.jsx`, `src/utils/anomalyHotspots.js` (coordinate shared file), existing `tests/e2e/specs/starmap-performance.spec.js`, `starmap-data-cache.spec.js` and unit integration tests.

1. Add failing tests: systems displayed while optional gates/metadata are delayed; route/camera not reset when data resolves; busy/error feedback; hotspot drag frames do not construct time formatters and use one sprite draw per point without changing heat pixels, radius/culling or color cores.
2. Change pending mount gate to systems only and expose optional layer progress/errors. Keep map instance and coordinate normalization stable; isolate normalized system memo from optional metadata if needed. Stabilize camera-independent leaderboard callbacks (`useCallback` with exact dependencies) and memo props.
3. Cache bounded three-band heat canvases for current DPR; preserve two-layer alpha-composited circles, radius in screen pixels, edge culling and draw order. Use a safe canvas-unavailable fallback for unit/SSR contexts; do not keep unbounded caches on repeated DPR changes.
4. Run relevant unit and map browser tests, instrument realistic systems and ≥1,754 hotspots with p50/p95 and work counts. Assert no canvas resets during drag, region fit, security cores, wheel anchoring and release cleanup. Commit only verified owned files.

### Task 3: Scoped static API compression

Files: `backend/TacticalBoard/views.py`, `backend/TacticalBoard/test_public_scope.py`.

1. Add failing tests using sufficiently large data on systems/regions/constellations, `Accept-Encoding: gzip`, actual rendered responses, exact decompressed data, Vary and uncompressed fallback. Retain local-demo filtering/cache separation and cold/hot query count tests.
2. Apply `method_decorator(gzip_page, name='dispatch')` only to the three existing APIView classes, with existing auth/access checks and response schema unchanged. Leave existing gate compression and routing unchanged.
3. Run `python manage.py test TacticalBoard.test_public_scope Authentication.test_viewer_access --settings=EVE_MDjango.public_access_test_settings` (confirm installed runner/settings first), plus existing public access integration tests. Commit scoped changes only.

### Task 4: Integrated acceptance and review

1. Run full frontend units, focused starmap/hotspot e2e, production build+bundle budget and backend scope/access tests. Diagnose any failure before changing code.
2. Independently review spec first, then code quality for all changes; fix and reverify findings. Preserve source-policy inventory, dirty original worktree and collector config.
3. Re-measure same browser/path and live-sized static fixture, capture 800/1036/1440/1920/mobile screenshots, record transmitted-size improvement separately from TTFB and first canvas. Report actual verified state; do not claim deployment unless deployment is explicitly performed and version confirmed.

Execution uses in-session subagents for independent scope with review checkpoints. The user's delegated-choice instruction selects this workflow without additional questions.
