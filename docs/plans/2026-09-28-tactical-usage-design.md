# Private tactical usage overview

Approved: the owner requested a read-only dashboard restricted to the existing account `2235102484@qq.com`. No visit tracking, new analytics records, production data edits, or deployment is part of this implementation request.

## Scope and definitions

- Creator users: distinct Organization.founder_id; explicitly organization creators, not all board creation actors.
- Organizations and boards: current persisted totals; boards separated into war and pirate.
- Joined users: distinct users with an active Membership, including founders. Removed memberships excluded; multi-organization users counted once.
- Pending applicants: distinct users with a pending JoinApplication; independent of joined users (a person may belong to one organization and apply to another).
- Actual operation users and operations: successful AuditLog events from explicit report.*, force.*, and sighting.create/withdraw action allowlists only. Invitations, creation, member administration and scope changes excluded.
- Show today, the last 7 Shanghai calendar days including today, and the last 30 including today; stop at generation time. Include all-time recorded operation users and earliest recorded qualifying operation time as coverage context.
- No website registration total: tactical boards reuse website accounts. No visit counts or online counts: existing leases do not reliably cover both board types and are not view history.

## Authorization and privacy

JWT authentication, server-side active account check against the uniquely resolved owner email. No staff/superuser bypass, no client-supplied email/user ID. Ambiguous email matches fail closed. A capability endpoint returns only a boolean; the overview independently enforces authorization. Responses, including denials, are private/no-store. Only GET/HEAD/OPTIONS, no new write endpoints. Existing tactical membership authorization remains unchanged.

Return only aggregate numbers, bounds and timestamps. Never serialize organization names, rosters, audit metadata, deployment/report contents, account emails, IDs, tokens or private sightings.

## Contract

GET `/api/tactical/usage/access/`: `{can_view_usage: boolean}` for authenticated users; anonymous 401.

GET `/api/tactical/usage/overview/`: owner only; others 403.

```
{
  generated_at: ISO timestamp with timezone,
  timezone: "Asia/Shanghai",
  totals: {
    creator_users, organizations, war_boards, pirate_boards,
    joined_users, pending_applicants, operation_users
  },
  periods: [
    {key: "today" | "7d" | "30d", start_at, end_at, operation_users, operations, active_organizations}
  ],
  first_operation_at: ISO timestamp | null
}
```

UTC-aware test timestamps and production naive Shanghai timestamps must produce identical Shanghai calendar boundaries. Constant-count aggregate SQL, no per-user/per-organization loops or business service GET calls with hidden legacy backfill writes.

## UI

Route `/tactical/usage`, reachable via an owner-only `战术板概况` sidebar entry confirmed by the server capability. Reuse the warm neutral application theme. Responsive summary cards, a compact resource breakdown, period comparison table, and brief definitions. Manual refresh only. Do not mistake loading/error/permission denial for zero usage. Clear private data on logout/account switch, abort obsolete requests, hide stale summary on authorization loss. No browser persistent storage or shared React Query cache for private overview data.

## Verification

Backend: anonymous, unrelated user, unrelated staff/superuser, inactive owner, ambiguous identities, JWT tampering, aggregate deduplication, allowed action filtering, time boundaries, empty data, no writes, no private payloads, bounded queries, GET-only behavior and existing membership isolation.

Frontend: owner navigation/page, unauthorized direct URL, loading/error/empty/refresh states, account switch and late response isolation, no mutation calls, mobile and desktop layout. Run isolated SQLite tactical regressions, frontend unit regressions and production build. Browser automation uses synthetic API fixtures, never real user private data.
