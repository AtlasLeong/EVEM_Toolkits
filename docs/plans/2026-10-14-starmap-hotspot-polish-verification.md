# 犁地热点与星图优化验证记录

Date: 2026-10-14, Asia/Shanghai. Baseline product source: `ca3e013db724639ef26c1c3bd62576d596c8c32e`.

## Implemented

- 犁地热点 title; fixed last-success snapshot timestamp in24-hour Beijing time, retained while collapsed or after failed polls.
- Search across all snapshot systems/confirmed regions by name/region/ID, keep original global rank, defaultTOP10/search cap100 with count hint and empty state.
- One results scroll, fixed search/tabs/status/footer; aligned rank/name/count columns; reset results to top on query/tab change.
- Systems-first map display; optional gates/labels load progressively with error feedback; stable camera/system model/selection/routes.
- Memoized leaderboard and stable camera-independent callbacks; reused date formatter; three bounded DPR-specific double-circle raster sprites below security cores/routes.
- Scoped gzip for the three existing coordinate read APIs; existing Python-list cache/auth/local-demo filtering unchanged.

## Red/green evidence

- Formatter regression failed with `2 !== 1` constructor calls, then passed with a shared formatter.
- Sprite regression failed on uncached heat paths, then passed with one image draw per point and three reused bands/currentDPR.
- Progressive-display regression failed because canvas was absent until delayed optional datasets resolved, then passed without remount or camera/start-point reset.
- Header/title/search and rows-only-scrolling tests failed before their implementation.
- Actual count-column geometry failed with old auto-width columns, then passed with consistent columns.
- Clearing a scrolled search failed at `scrollTop=414`, then passed at zero after query/tab reset.
- Three coordinate APIs had nine expected gzip sub-assertion failures before decorators; after implementation all passed with byte-identical decompression.

## Fresh verified checks

- Full frontend Node suite:710/710 passed.
- Backend `TacticalBoard` with isolated `EVE_MDjango.ci_settings`:30/30 passed.
- `Authentication.test_viewer_access` and `Authentication.test_public_read_access` with isolated public-access settings:24/24 passed. Existing144 SQLite column/table-comment warnings only.
- Production build and bundle budget passed. Entry stylesheet remains122,110bytes unchanged; map-scoped stylesheet4,965bytes.
- Independent specification review: no remaining missing or out-of-scope implementation.
- Independent code-quality review: no critical/important defect;30 hotspot units and6 map-scope tests independently passed.
- Responsive expanded/selected-detail geometry and distanceHUD:768/800/1036/1440/1920 desktop and390 mobile passed. Header time remains fixed during scrolling/collapse, noHUD/card overlap or horizontal overflow, panel wheel does not zoom map.
- Real browser tests verify optional-layer failure text and12 heat-pixel comparisons (DPR1/2, zoom.37/7.56, all3 bands): overlap opacity, screen radius and security core retain reference-vector pixels within2 channel values.
- Final complete31-case browser acceptance:31/31 passed in1.3minutes, including expanded selected-card geometry and distanceHUD at768/800/1036/1440/1920 desktop and390 mobile.

## Performance evidence and limits

Read-only live baseline sample: systems4.54s /819,425transferbytes; constellations3.34s /119,609B; regions2.23s /3,382B; existing compressed gates4.26s /142,555B (decoded1,679,940B). These include network/server waiting and are not a promised speedup.

Same-browser live180-frame drag baseline: heat on draw p95~4.3ms versus off~3.6ms, and182 formatter constructions. This is instrumented JS draw time, not FPS.

Post-change controlled5,428-system/1,754-hotspot test: moving frame uses5,428 core arcs plus1,754 sprite draws, instead of an additional3,508 heat arcs/fills. Formatter construction and canvas-size resets during drag are zero. Final acceptance draw sample p50~2.7ms/p95~4.0ms; this has more hotspots than the live sample and is not a like-for-like speed comparison or GPU/FPS measurement. No claim of a percentage FPS improvement.

Gzip large-ORM test samples for each new compressed endpoint are below50% of ordinaryJSON size, with exact decompressed bytes; production transfer size must be checked after publication. Progressive-display tests prove slow optional requests no longer block the available star points; serverTTFB remains outside this change.

## Remaining boundary and release state

The existing Django4.2.5 gzip middleware recognizes the token `gzip` without parsing `q=0`. The reviewer reproduced this inherited negotiation edge; ordinary browser Accept-Encoding headers are unaffected. It is recorded as non-blocking future hardening, not a collector or access-policy change.

No collector frequency/backoff/session changes, gameRPC, DB migration, framework dependency, CI/source-policy or deployment configuration changes. This turn has not pushed or deployed a production version. Keep the task branch/worktree for the next authorized publication step; original43c4 dirty files are untouched.
