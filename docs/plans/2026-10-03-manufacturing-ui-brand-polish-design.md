# Manufacturing interaction and EVEM branding polish

## Approved scope

The user approved this design on 2026-10-03. Keep the established navy console, the EVEM navigation wordmark and the existing compass asset. The public website title becomes **EVEM 工具箱**; individual browser tabs use **模块名称 · EVEM 工具箱**. Remove the user-visible Front Codex label from the HTML delivered to browsers and sharing crawlers.

## Evidence and causes

- At 1440 × 900, opening the manufacturing target picker changes the root content width from 1430 to 1440 px. The workspace grows by 10 px and its cost rail moves right by 10 px. The picker sets body overflow to hidden without reserving the root scrollbar gutter.
- Selecting a node does not change its bounding rectangle, but legacy CSS adds an external 1 px amber shadow. The quote editor also adds an internal cost-rail scrollbar, reducing its content width by 10 px.
- Make/buy controls combine a zero-gap bordered group with independently rounded bordered buttons. Final computed buttons have 7 px radii and no visible separation.
- The static index title is `EVEM Toolkits - Front Codex`. Nginx serves the same index HTML for frontend routes; client-only document titles do not repair non-JavaScript share crawlers.
- The footer counts only priced purchases, reporting 0 categories even when 25 purchase categories are missing quotes.

## Design

1. Reserve the root scrollbar gutter, and reserve internal scroll gutters on desktop manufacturing rails. Do not alter sidebar widths or grid columns when opening a picker, selecting a quote node, or changing routing.
2. Render make and buy as separate fixed-width controls with a 6 px gap, 8 px corners and one border each. Remove the enclosing border and inherited inset/external decoration. The active choice remains amber with dark text; the inactive choice uses the dark console palette. Keyboard focus is visible and unclipped, and phone touch targets remain at least 44 px tall.
3. Keep node selection inside its existing rectangle: use an inset accent only, without an external halo. Preserve icons, expansion, recursive manufacturing, manual purchase pricing and accessible pressed states.
4. Remove duplicate panel eyebrow labels and the disabled skill/building preset entry. Retain the final percentage field and its meaning, the 150% default / 75% floor, missing-price explanation and cost-calculation limitations. Count actual unique purchase IDs, including missing quotes, in the route footer.
5. Set the static HTML title and public share metadata to EVEM 工具箱. Use a concise public description of market, manufacturing, navigation and collaboration tools; do not include account, invitation or manufacturing-plan data. Preserve favicon/apple icon URLs. A single global route-title mapping updates document.title during navigation, including login and access-denied routes, without adding dependencies.

## Boundaries

No deployment, push, permission expansion, backend/API change, formula change, asset extraction, or source-directory/package rename. The existing single-viewer production policy remains unchanged. Share platforms can retain cached historical cards; this local iteration can verify the newly served HTML, not invalidate platform caches.

## Acceptance

- Geometry changes at picker open/close and node selection are ≤ 0.5 px for outer cards and stable internal rail widths.
- Both route controls are readable, separated and stable when toggled, with no inherited white border or outer halo.
- Desktop and phone layouts have no horizontal overflow; keyboard picker dismissal restores focus.
- Unconnected settings are absent, purchase counts include missing-price categories, and calculation regression tests remain unchanged.
- Static and runtime titles contain the approved brand and no Front Codex; public sharing metadata exists without private data.
- Fresh unit, targeted/full browser regression and production-build checks pass; final screenshots are captured from the actual local app.
