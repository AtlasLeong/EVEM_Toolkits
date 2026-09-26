# Market side-view controls

Approved by the user: remove the selected instrument's top status badge and offer explicit `双边走势 / 只看卖价 / 只看买价` modes.

## Display and interaction contract

- Remove the top instrument status badge for all freshness states, not the catalog statuses or the sidebar's existing collection time/age. Data freshness remains visible without the floating green badge.
- Replace two independently toggleable legend buttons with three mutually exclusive, keyboard-operable buttons. Default to both sides; exactly one mode is selected, so users cannot hide both charts.
- Sell-only or buy-only fills the central chart width. Its statistics, tooltip, persistent readout and accessible data table show only that side. Both mode preserves independent charts and synchronized readout.
- Preserve selection while switching items, time range or refreshing data. Reset the chart's active historical point on a mode change so hidden-side hover does not survive; use latest data until a new point is activated.
- Right-side quote cards and both five-level order books remain unchanged for comparison. No API, collection, dependency, persistence or backend changes.
- Fit the existing dark framed theme, retain visible focus and adequate text contrast, and avoid horizontal overflow at desktop/tablet/mobile widths.

## Verification and delivery

Test actual page behavior with isolated API responses: absence of badge, exclusive pressed state, keyboard activation, full-width single panel, matching tooltip/readout/table, empty selected side, no request on mode switch, retained mode on item/range changes, and unchanged double-sided sidebar. Preserve existing freshness-clock regression on catalog status. Inspect desktop/mobile screenshots, run market suites, frontend unit/preview tests and production build. Local implementation only; do not push or deploy this turn.
