# Static dark market quality summary

Approved by the user on 2026-10-24 after reviewing the screenshot and design.

Replace the public Market quality disclosure with a non-interactive dark summary.
Keep the quality label, fresh-sell numerator/enabled denominator and percentage
(or existing zero-inventory wording). Remove the disclosure entry, expanded
explanations, detail cards, timestamps and Escape/focus disclosure behavior.

Reuse the existing console surface, border, text, muted and accent tokens; align
the summary's minimum height/radius with the adjacent 40px controls. It is not a
button, so no pointer cursor, hover action or tab stop. Preserve wrapping within
the header, including signed-in controls, 320px phones and enlarged text.

Keep visible loading/unavailable states. If refresh fails with cached data, show
a short labelled status in the summary so removing the disclosure cannot hide a
failure. Continue ageing cached observations normally. Do not alter APIs, public
quality definitions, two-hour freshness, polling, permissions, collection or
administration diagnostics. No backend changes or dependencies.

Alternatives considered: dark static summary (chosen for consistency with nearby
controls), or unframed text (smaller visual footprint but less grouping). No new
tooltip, modal, expandable panel or extra metadata is needed.

Verification: test-first browser assertions for absent disclosure, retained
metrics, console styling and responsive/accessibility constraints. Preserve
cached-age, clock-rollback, refresh failure, zero inventory and unavailable
coverage. Run all frontend units, relevant Market browser regressions, production
build and visual review. This request authorizes implementation, not another
production deployment; leave the tested branch for user-directed release.
