# Anomaly destruction hotspots

Approved scope: add the owner's newly captured account to the existing KM pool and collect anomaly destruction statistics for the star map. Only anomaly hotspots are included; Klein Wells are excluded.

## Decision

Reuse the existing authenticated transport and GameSessions broker, with a separately validated anomaly-only capability bundle. The new KM bundle uses the same captured authentication and a transparently derived, already verified `get_kill_info` business-call schema; it is not described as a captured KM request. Admission to the seven-slot pool requires one bounded, successful, ID-matching KM response. Existing six files remain unchanged.

Alternatives considered: a separate uncoordinated login loop risks concurrent account use; broadening the KM method allowlist weakens its boundary. Neither is selected. The strict KM extractor/validator is unchanged.

## Collection and persistence

The worker uses the captured no-argument `get_dungeon_destroy_statistics` template once after four authentication RPCs. Every RPC uses a shared account lease, pacing and rejection state; no account switching/reconnect on rejection. Existing KM slots receive operator-defined non-secret account aliases; the new account shares one alias across KM and anomaly workers. A single-host shared SQLite coordinator is explicitly provisioned. GameSessions quotas are conservative local limits, not official game quotas.

Run every five minutes plus zero-to-five minutes randomized delay. An atomic, bounded file stores only the latest validated counts and safe attempt status outside all public/static/release roots. Failures retain the last successful counts and time; raw RPC/auth/exception data are never persisted or returned. No new database tables or widened worker database grants are needed. Use the existing KM service user for private bundles and coordination; a separately protected read-only snapshot is readable by the backend user.

## Public read boundary

`GET /api/anomaly-hotspots/` reads the saved snapshot only, never connects to the game. Map metadata comes from verified static `solarsystem` and `region` tables. Missing geography retains a system-ID row but is excluded from region aggregation with a visible coverage note. Only this sanitized read endpoint is added to the current star-map public GET allowlist. No management, credential or manual-trigger endpoint is public.

## Presentation

Independent dynamic query refreshes stored data every minute, preserving cached static map data, canvas view and route. Translucent heat circles preserve security-color cores. Foldable left-edge leaderboard under the HUD has system/region tabs, deterministic Top 10, exact destruction counts, a last-success timestamp and stale/failure status. System clicks locate existing coordinates; region clicks fit known hotspot members, explicitly labeled as hotspot extent. Unknown coordinates cannot be located. On mobile, show the leaderboard outside the currently hidden desktop map without fake location controls.

The captured response contains destruction counts, not remaining anomalies. Its time window is unverified: do not claim one hour or 24 hours or fabricate a window selector. Initial color bands use 1–80, 81–200 and >200 as our display ranges; do not claim the screenshot proves the exact 80 boundary.

## Verification and rollout

Test-first strict response/bundle validation, malformed/duplicate/nonfinite/oversized rejection, coordinator-required transport, five-RPC budget and terminal rejection handling; atomic last-good preservation; GET-only sanitized API, unknown geography; deterministic UI grouping, locating and non-resetting canvas behavior. Run existing KM/GameSessions regressions, front-end unit suite, production build and browser visual checks. Validate the new session with exactly one KM and one hotspot request before pool admission. Stage private configuration recoverably, prevent collector overlap during publishing, deploy with the repository release workflow and verify both timer state and an actual saved successful snapshot. A failed live authorization is reported rather than bypassed.
