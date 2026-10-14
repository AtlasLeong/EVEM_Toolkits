# 犁地热点界面与星图性能设计

## Scope and authorization

User requests: visible update time, correct leaderboard alignment, title 犁地热点, in-board search, faster map loading and smoother movement. The user previously delegated implementation choices without further questions; the recommended design was presented in this turn and uses that authorization. No changes to game sessions, polling frequency, backoff, routes, credentials or statistics-window interpretation.

## Evidence

Live 2026-10-14 read-only browser sample: boardsystems 4.54 s / 819,425 transfer bytes; constellations 3.34 s / 119,609 B; regions 2.23 s / 3,382 B; compressed gates 4.26 s / 142,555 B (decoded 1,679,940 B). All four currently block canvas mounting. This is a sample, not a guaranteed speedup target.

At 1036×905 the 358 px panel contains a 709 px scrolling content area; the update time starts at page Y=1096 outside the panel's bottom Y=752. Nested flex scrolling hides the time and allows controls to scroll out of view.

Same browser 180-frame overview drag: heat on draw p95 4.3 ms vs off 3.6 ms; on 6,754 arcs vs off 5,428 arcs per final moving frame. Both paths construct 182 Intl.DateTimeFormat instances. Instrumented JS timings are not actual FPS and include observer overhead.

## Selected design

1. Keep leaderboard at map edge and preserve collapse, region/system tabs and location actions. Rename visible title and region accessible name to 犁地热点 / 犁地热点排行榜. Move the last successful snapshot time to a non-scrolling header, 24-hour Asia/Shanghai; retain it when collapsed. Never present last browser poll as data collection time. No snapshot means 尚未更新.
2. Fixed header/controls/footer with one scrollable ranked-results area, consistent grid alignment and enough rank width for values beyond ten. Prevent overlap with HUD/system card at narrow desktop sizes; mobile remains its own non-map panel. Preserve wheel propagation isolation and finish-drag behavior.
3. Search all records in the current snapshot, not only the top ten. Case-insensitive substring search by system display name, region name and numeric ID; region tab searches region name/ID. Sort full rankings once, assign stable global rank before filtering; default top ten, filtered results bounded with a visible count/limit hint and explicit no-match state. Clearing restores top ten. Search does not alter heat layer, map camera or trigger any game/API request.
4. Prevent camera frames from rerendering unchanged leaderboard through memo and stable callbacks. Reuse the date formatter. Cache three DPR-aware, screen-sized double-circle heat sprites; draw one image per visible point, preserve color, opacity overlap and security cores drawn above heat. Keep unknown IDs excluded from map without excluding them from rankings.
5. Show the map once systems return; gates/region labels appear progressively with visible loading/failure status, without remounting map or resetting camera/selection/route. Retain existing hour-long memory query cache and access behavior. Add scoped Django gzip_page to three currently uncompressed static endpoints, retaining exact JSON, DB-data cache and auth gates. No global cache/middleware or deployment-config changes.

## Alternatives

Only fixing CSS would leave loading and repeated work unchanged. A separate worker/map-engine rewrite could reduce additional costs but adds camera, hit-test and route risk disproportionate to measured workload. Use scoped changes first; defer spatial indexing until a repeatable post-fix near-view bottleneck justifies it.

## Verification

Red/green unit and browser tests: rename/time above scroll and collapsed; whole-snapshot search beyond top ten with correct global rank, zero/no-match, tabs and unknown IDs; keyboard/wheel/camera independence; 800/1036/1440/1920 widths and mobile; visible timestamp no horizontal overflow or control overlap. Delayed gates/labels must not block systems, and late responses must preserve camera/route. Realistic 5,428-system + ≥1,754-hotspot performance sample verifies fewer path calls, no canvas resets, no formatter construction per drag frame, retained security color/overlap. Scoped gzip tests verify decompression exactness, non-gzip fallback, Vary, cached queries and existing anonymous-access gate. Run existing units, starmap e2e, backend scope/access tests, production build and bundle budget. Compare before/after bytes and measured timings separately, with no unmeasured FPS claim.
