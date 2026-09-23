# Tactical map card clarity — approved local design

Approved by the user on 2026-09-23. Scope: local implementation and verification only; no push, merge, production deployment, or production data changes.

## Problem and invariant

`fleet_intel` creates a durable observation (`Report`) and a current deployment (`Force`). The map currently renders both as live cards; after a force moves, the observation remains at its historical system and looks like a detached second force. The historical position is correct and must not be rewritten. Separate layout passes then push the star label away and draw multiple leaders through one star. A real stargate may also run beneath text.

## Map presentation

- Render each current named fleet as one content-sized force badge. Keep its source author, observation time, and original system in the force detail and report history, not in a second live map card.
- Render `system_count` only through its dedicated count marker. The generic report layer may show only unlinked legacy `fleet` observations when explicitly requested or focused. Archived-force observations never reappear as map cards.
- Keep real star coordinates and all real stargate edges. Place the star name/security close to its node and choose label candidates that avoid gate strokes when possible. Give label text an unobtrusive dark backdrop where a gate must cross it.
- Keep at most one short focus leader per system/marker stack where useful; do not draw redundant leaders for a historical duplicate. The layout must be deterministic across live snapshot refreshes and preserve readable spacing at desktop and laptop widths.

## Quick archive

- Show a separate, accessible `×` hit target inside each force badge only when the viewer has `manageForces` and the session is live. It must not start dragging or select a star.
- Clicking or keyboard-activating `×` opens the existing archive confirmation. Confirming sends `force.archive` with the current version; it never invokes `report.withdraw` or hard-deletes history. Scouts see no archive control.
- Reserve sufficient badge width for the control without truncating the person count. Keep the full force name in the accessible label/title.

## Verification

Write failing unit/browser tests first for linked-report de-duplication, post-move/archive historical observations, system-count exclusivity, label/leader geometry, quick-archive click and scout visibility. Verify the targeted tactical suite, production frontend build, and visual desktop/laptop screenshots against real static star data. Preserve existing backend permission behavior. Do not release online in this task.
