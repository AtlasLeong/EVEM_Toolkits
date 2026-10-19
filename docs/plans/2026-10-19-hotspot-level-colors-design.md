# Restore five-level hotspot colors

## Evidence and scope

The owner reports that different hotspot levels have indistinguishable map
circles. Production `52affbc1f` still feeds `destroy_num` into the original
three count thresholds (`80`, `200`), although the current client consumes
exact levels `1` through `5`. A fresh public snapshot contains all five levels;
the screenshot's A8-XBW is level 2 while neighboring systems are level 1. Both
currently select the same yellow circle and radius.

The owner previously delegated subsequent implementation choices without
repeated questions. This narrow presentation repair follows that delegation;
it does not authorize an unrelated metric migration or production publish.

## Decision

Use the existing five-level game legend rather than new relative quantiles or
the obsolete three count thresholds. One immutable exported palette supplies
the canvas renderer and visible legend:

| Level | Game legend range | Color | CSS-pixel radius |
| --- | --- | --- | --- |
| 1 | 1–50 | green `#34d399` | 14 |
| 2 | 51–100 | yellow-green `#bef264` | 18 |
| 3 | 101–150 | amber `#fbbf24` | 22 |
| 4 | 151–200 | orange `#fb923c` | 26 |
| 5 | >200 | red `#f43f5e` | 30 |

These are activity levels and legend ranges, not reconstructed exact counts.
Non-integer, zero, or out-of-range levels produce no heat circle. Do not infer
a legacy/raw-count mode from the numeric value. Retain viewport culling,
constant screen-space radius, the DPR sprite cache, overlap behavior, and
canvas state restoration. Cache at most five sprites per current DPR.

The legend is generated from this same palette, includes level and range, and
states that the statistic's time window remains unconfirmed. Base star security
colors, route and selected-star rendering remain unchanged.

## Non-goals and known separate work

No account/session, timer, RPC, backend contract, snapshot/history, ranking,
regional aggregation, or private changes-board calculation changes. Existing
rankings and deltas still have a separate metric-semantics debt; changing them
correctly requires explicit versioned precision and historical compatibility,
not an implicit front-end numeric heuristic in this color repair.

## Verification and delivery

Start with red regressions for all five bands, invalid inputs, direct canvas
colors, cached colors/DPR, and a five-item shared-source legend. Run focused
and full frontend unit suites, the production build and bundle budget, and
inspect desktop/mobile screenshots from the real local application with
synthetic levels 1–5. Obtain separate specification and code-quality reviews.
Leave production unchanged unless the owner requests publishing this change.
