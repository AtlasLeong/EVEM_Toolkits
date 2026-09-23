# Named fleet intelligence — approved local design

User approved: 2026-09-22. Scope is the existing local tactical worktree only; no commit, push, deployment or production DB access.

- Same-kind map text uses consistent font weights. Fleet badge text is horizontally and vertically centered, with content-sized width.
- A real system can have multiple distinct fleets: `大航队 100人`, `远炮战列队 50人`. Show three nearby labels above the star when space permits; `+N 支` opens the remaining deployments. Keep actual coordinates, density focus, destination chooser and independent fleet drag.
- Quick report defaults to named fleet reporting. Offer new fleet / update existing fleet, preset names and custom names; system enemy-count snapshots remain a separate explicit option. Reports appear immediately, without approval.
- Fleet identity is an ID, never name matching. Updating an existing fleet creates the reporter's own new observation; another reporter's observation cannot be edited. Old history remains. Same names may identify different fleets.
- Only the latest eligible observation updates a fleet's estimate. Revisions to historical reports cannot replace a newer source; editing a report never reverses commander movement. Keep observation location separate from current deployment location.
- Star-name labels retain a consistent font and security value. Remove oversized duplicate enemy-count typography; system counts stay in details (and a subtle ring), never summed with fleets.
- Details show fleet name, count, source/observation time; scouts may update an existing enemy fleet by adding an observation, but cannot use force-management endpoints or see friendly fleets.

## API contract

Preserve legacy `fleet` and `system_count` semantics; new named flow uses `report_kind=fleet_intel`.

`report.create`: common observation content plus `report_kind=fleet_intel`; new fleet has `fleet_name`; updating has `force_id` + `force_expected_version` and keeps the fleet's current name. The command is transactional, idempotent, and uses the existing organization/lease lock.

`report.update`: author-only, report CAS, immutable type/linked fleet, may correct `fleet_name` and observation content. Only the current source may update the estimate, never the deployment position; stale report revisions remain history. Report response adds `fleet_name`, `force_id`, `is_current` for this kind. Force response adds nullable `source_report_id`, `source_author_id`, `source_author_name` without exposing friendly data.

New observations of an existing fleet require the explicitly reviewed force version, and cannot target a different organization, friendly or archived force. Older observations remain history rather than overwriting fresher estimates. A direct commander force edit clears the automatic source; movement preserves attribution/time and shields the current position from report revisions. New fleet-intel reports cannot be adopted again via legacy confirmation.

## Local verification

Backend permission/CAS/idempotency/chronology tests; label/payload unit tests; mocked browser form/update/stack/centering regressions; real local HTTP/WS smoke. Keep normal star-map regression coverage. Guard and back up the exact local SQLite database before migration; preserve current demo data. Show actual local screenshots after review and leave services running.
