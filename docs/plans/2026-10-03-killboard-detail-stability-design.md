# Killboard detail stability design

## Goal

Improve killmail detail readability and switching stability without changing
the backend contract or collector behavior.

## Decisions

1. Give the hero's report identifier a dedicated readable style so the small
   global eyebrow treatment is not used for the primary identifier.
2. Use one participant ship/avatar frame for both loaded hull artwork and the
   missing-image placeholder. The placeholder must fill the same box and use
   the same border, radius and background.
3. Prefer the resolved solar-system name. If it is absent but `system_id` is
   present, show `星系 #<id>`; use `未知星系` only when neither value exists.
   Constellation and region names remain optional secondary context.
4. Keep one page transition key and one route element for the entry and numeric
   KM paths, so report selection never remounts the whole page. While details
   are pending, render only the matching new summary, never the previous KM's
   details. A late entry-list response must not overwrite a newer selection.

## Scope and verification

The change covers `Killboard.jsx`, its presentation helpers, `App.jsx`,
`AppShell.jsx`, `killboard.css`, and focused unit tests. Tests cover the system-ID
fallback, dedicated report-ID class, equal placeholder box styling, stable
transition keys and stale-response fencing. The normal Killboard unit suite,
production build, and an isolated browser smoke check must pass before release.
