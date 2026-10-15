# 犁地变化榜与统一管理中心

Approved by the user on 2026-10-15. Public totals remain public; access controls protect the provided changes/history service, not changes independently derivable from public snapshots.

## Scope and semantics

- Collect at a nominal ten-minute cadence, retaining per-RPC random delays and the existing shared cooldown, account rotation and bounded request budget. Do not add game requests for history, rankings, or HTTP requests.
- Preserve sanitized successful samples for thirty days with hard sample/byte limits. Compare only consecutive successful recorded samples, showing actual start/end/elapsed time. First sample is a baseline; failure never inserts zero or advances the baseline.
- Compare IDs present in both samples. New/missing IDs are unknown-baseline coverage, not invented zeros. Preserve signed differences; rank positive differences descending then system ID. Negative changes must not top the ranking. Source window remains explicitly unknown, so use “快照净增量”, not exact new destruction during ten minutes.
- Expose an independently authorized history/changes API. Never append private fields to the public snapshot. Reuse the map panel with total/changes modes, searching and location, rather than another overlapping sidebar.
- Preserve thirty-day interval selection with bounded pagination. Previously unsaved history cannot be reconstructed.

## Architecture

Use immutable sanitized JSON sample files and an atomic bounded manifest in a dedicated private directory, separate from game credentials and Git/static/release directories. This keeps the collector free of application ORM/database credentials. Reuse strict filesystem ownership, no-link, size, schema and atomic-publication protections. Write/prune only explicitly recognized collector-owned artifacts, preserve referenced samples, and make crashes/retries idempotent. Failure logs are sanitized bounded operational records, never RPC bodies/tokens.

An alternative local SQLite ledger would simplify transactions but adds read-only/journal deployment concerns. Application MySQL history is not selected because it would breach the isolated worker's existing credential boundary.

Keep authorization in a small new Django `ControlCenter` app on the normal application database. A dedicated explicit `hotspot_changes.view` user grant is separate from staff status, script licenses, fraud groups and organization membership. Grant updates and audit records are transactional and versioned. Revocation, disabled users and account changes must take effect on subsequent requests without waiting for JWT expiry.

## Identity and management consolidation

The management center is restricted to a configured stable owner user ID AND the unique active database account with email `2235102484@qq.com`. Missing/ambiguous/reassigned configuration denies access; JWT email, browser input, staff and generic superuser status do not substitute for this owner binding.

One owner-only management center contains hotspot access grants, sanitized collection state/failure history, authorization audit, and existing activation/review/market/statistics entry points. Existing feature/object/group checks remain intact; consolidation does not grant broader privileges or rewrite all authorization. KM stays down and `KILLBOARD_OWNER_EMAIL` stays independent and blank in production.

## Interfaces

- `GET /api/control-center/access/`: authenticated capability discovery (`can_manage`, `can_view_hotspot_changes`).
- Owner-only exact-account search, grant list/update with optimistic version, immutable authorization audit and sanitized overview endpoints below `/api/control-center/`.
- `GET /api/anomaly-hotspots/changes/`: current grant/owner check before reading private files or metadata; optional selected interval and bounded older-interval pagination. Include interval start/end/elapsed, coverage and signed count changes with verified geography.
- Private success/error responses are `private, no-store` and vary on Authorization. They are never public-allowlisted. Clear client data on logout, identity switch, permission denial or revocation; no cross-user last-good private cache.
- Historical storage may be temporarily unavailable without destroying public last-good data. Admin surfaces must distinguish source/collection status from history-publication failure.

## Operational rollout and verification

Configuration is opt-in and fail-closed: provision the private history directory, web group-read access, owner ID and application migration before enabling the private service. The worker still receives no web database credentials. Change timer to nominal ten minutes with small schedule jitter; retain cooldown and request jitter. No KM reactivation.

Test delta math, unknown IDs, resets, zero intervals, failures/gaps, duplicate/conflict/out-of-order samples, bounded retention and publication recovery; test owner/grant/revoke/disabled/anonymous/staff boundaries and no public schema leakage; test switching users, 403 cleanup, mobile/desktop spacing, map camera/performance and history selection. Independently review specification and quality. Local implementation approval does not itself authorize pushing or deploying; report release readiness accurately.
