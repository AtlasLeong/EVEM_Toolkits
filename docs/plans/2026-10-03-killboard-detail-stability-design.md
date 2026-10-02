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
4. During a report switch, retain the last complete detail as a visual shell
   while the new detail request is pending. A response may replace the shell
   only when its `kill_id` matches the selected route. This removes the blank
   intermediate render and prevents stale detail from being shown under a new
   selection.

## Scope and verification

The change is limited to `Killboard.jsx`, `KillParticipantRow.jsx`,
`killboard.css`, and focused unit tests. Tests cover the system-ID fallback,
dedicated report-ID class, equal placeholder box styling, stale-response
fencing and no blank detail during a switch. The normal Killboard unit suite,
production build, and an isolated browser smoke check must pass before release.
