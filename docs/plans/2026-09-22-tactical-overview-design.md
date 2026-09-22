# Tactical strength overview — approved local scope

User approved upgrading the current deployment panel to a realtime strength overview, then requested count-only scout reporting, renaming intelligence to reporting history, and a separate compact membership control with member counts. Work remains local-only in the existing tactical worktree; preserve dirty changes and all local records, no commits/push/deployment.

## UI and semantics

- Compact overlay, not a separate page: enemy/friendly summary and fleet/location rows, current-warzone default with all-organization option. Camera movement does not change totals. Explicitly mark outside-scope rows and unknown/stale counts. Scouts never receive or see friendly totals.
- Quick report defaults to `人数上报`: select system and enemy people, no fleet name required. Named new/existing fleet modes remain optional. Count-only observations are `system_count`, not fake fleet records, and appear on the actual map with a compact count label.
- Existing `情报` labels become `上报记录` (contextual copy uses 上报/战术数据 where appropriate). Record count is not people count. Historical reports remain separate from current estimates.
- Membership is a separate small card/button, not a third tab: active members + online count, opens existing management dialog for founder/commander. Online user count is never a game-deployment count. Preserve full-board administration and demotion/revocation protections.
- Rows show name/type, count, system, source and observation age; group enemy/friendly and optionally by star. Selecting a row focuses/highlights the map; map selection selects/scrolls the relevant row. Live updates do not steal camera position or reset search.
- Disconnected state clearly retains last synchronized data; displayed age ticks locally instead of freezing between snapshots.

## Counting decision

A non-blocking user question asks whether to prefer the latest system-wide count for a star (fallback to named-fleet sum only when no system report exists) or always display the two independent figures without a mixed total. Never add a system total and its fleets. If unanswered, use the recommended system-first estimate with explicit source/coverage and stale labels; unknown latest count stays unknown rather than becoming zero or silently falling back. Do not claim estimates are live game telemetry. Server scope annotations keep mobile totals correct without fetching the graph.

## Verification

Test-first scoped aggregation, null/zero, history, stale values, permissions, static map scope metadata and active member counts. Browser cases cover default count-only form, renamed tabs, independent membership card, two-way map/list focus, live count/location/member changes, scopes, narrow widths, and no mobile graph download. Run real local HTTP/WS and browser trial, ordinary navigation regressions, full tactical suites/build, spec then quality review and screenshots.
