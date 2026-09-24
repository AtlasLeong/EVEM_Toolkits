# Pirate Intel Map Performance Design

## Problem

Every pointer or wheel camera update recomputes the floating-card layout. The
current eight-candidate collision scan compares every card with all previously
placed cards and every marker label. At 1200×700, 400 markers take about 16 ms
and 800 about 74 ms in a Node benchmark, before React or browser paint. Even
50 cards cannot fit without extensive overlap. The static map can include over
2,000 systems, and sighting count is not capped.

## Chosen design

Keep every SVG marker and its pointer/keyboard selection. Only the HTML identity
cards are bounded to the viewport's estimated non-overlapping capacity (and a
small absolute ceiling). Choose card-bearing markers with deterministic spatial
sampling in map coordinates, with the selected marker always first. With an
unchanged visible marker set, camera translation and scale do not change which
markers receive cards. Place each chosen card near its anchor when a clear
candidate exists, otherwise use a clear fallback slot; never deliberately
stack cards. Show a compact count and a pointer to the list/map markers when
not all locations have cards.

Merge wheel and pointer-move camera updates into one React state commit per
animation frame. Button, scope reset, and external focus updates remain
immediate. Cancel pending frames on teardown.

## Verification

Add failing tests for dense layout bounds, no overlaps, selected-target
priority, stable selection during zoom/pan, hidden-count disclosure, and camera
update coalescing. Re-run map/polling unit tests, build/bundle budget, and
repeat 400/800-marker layout timings against the same synthetic workload.
