# Performance phase 4: measured public hotspot projection reuse

## Approval, baseline and evidence

The user approved continuing the original 2026-10-23 metric-led fourth stage,
testing, pushing and deploying without over-refactoring. Reuse the attached
anomaly-hotspots worktree, branch `codex/performance-phase4-20261025` from
`c6a45392bc0cbdd1250805385f2bf6bfaeab1848`. Preserve other worktrees, private
outputs, sessions and all existing deployment gates. Baseline AnomalyHotspots:
90 tests pass, six existing Windows platform skips.

Read-only Linux production sampling on 2026-10-25, five sequential samples:
1,653 current systems; snapshot read plus strict validation median 4.131 ms;
two geography SQL queries median 41.591 ms; direct loopback application HTTP
median 59.684 ms (range 58.916--301.782). In-process complete handler warm
median 53.147 ms. The first HTTP experiment followed the port-80 HTTPS redirect
through the external domain and measured about 705 ms; that is NOT a loopback
application baseline or an optimization target. These are small diagnostic
samples, not P95, a load test or an end-user SLA. No game calls or data writes.

History: 1,303 samples, three reads, complete changes median 35.589 ms, manifest
25.404 ms. Local Windows max-4,321-sample fixture is about 207 ms warm and does
N+6 file metadata checks even with limit=1. A generation-only cache would miss
nonselected sample chmod/deletion/link changes. Preserve the complete scan.

Tactical isolated fixture: cold graph12 SELECTs, warm4; the existing300-second
public-static cache already removes eight static SELECTs. JWT duplication is
real (middleware plus DRF, two identity SELECTs in a probe), but there is no
production lock-wait/private-auth latency evidence. Keep current identity,
membership and lock semantics. These findings are explicit deferrals, not
unimplemented promises to weaken verification later.

## Chosen narrow design and alternatives

Reuse one validated, enriched public projection per process for at most60 seconds.
This removes the measured repeated two-query geography lookup. Keep
`read_snapshot()` untouched and call it before checking any cache: its measured
cost is small and its file safety matters. An exact full validated snapshot and
configured path identify an entry, not just collected_at or file timestamps.

Alternative1: no cache preserves all semantics but repeats the dominant measured
business work. Alternative2: cache raw file/manifest generations, add shared
Redis/watchers or redesign auth/locks; these add integrity/invalidation/operations
risks without enough measured benefit. Choose only the public projection reuse.

## Invalidation, concurrency and failures

- Fixed single entry, no user-controlled unbounded dictionary. Key includes
  configured source path and full validated snapshot (status, attempts, metric,
  counts and timestamps). New data/failure status changes are immediate.
- Each request still performs path-component/reparse/link/mode/regular-file/size,
  nofollow open, inode/stability, duplicate-JSON-key and schema checks. A cached
  valid response never masks missing, unsafe or corrupt current input.
- Use monotonic time: only `0 <= age < 60` is a hit; boundary/clock regression
  refreshes. Geography names/membership may be60 seconds stale, not counts or
  collector status. No claim of cross-process coordination or immediate static
  geography edits. No settings switch is needed for this fixed optimization.
- Cache exclusively sanitized public data. Return independent objects so an
  API response cannot mutate the retained entry. A small lock protects only
  cache access/publication, never file/database I/O. Duplicate concurrent cold
  work is acceptable; a late old publication can cause an extra miss but cannot
  match a different freshly validated snapshot.
- Preserve `system_metadata(rows)` fallback `{}` for private_changes callers.
  Split a raising metadata loader if necessary. Database failure still preserves
  counts/time with unknown names, never exposes errors, and is NOT cached;
  recovery is retried on the next request. Unavailable snapshots are not retained.
- Permissions, public-read switch, JWT behavior, throttle and HTTP `no-store`
  execute for every request before the read/cache. No auth/user/org data in cache.

## Verification and release boundaries

Test-first real temporary snapshots and SQLite geography: first request two
queries, unchanged hit zero; status/content/metric/path changes; TTL boundary
and clock regression; failed metadata lookup recovery; response isolation;
warm-cache corruption/deletion/oversize/link/POSIX mode changes; permissions and
throttle still enforced. Cover concurrent publication deterministically without
sleep and ensure cache locks do not surround I/O. Existing protocol/history,
worker import boundary, ControlCenter same-JWT revoke/deny-before-read tests and
release-safety gates remain intact.

No frontend/UI/schema/dependency/collector/session/budget/timer/publisher/CI or
production config changes. Run independent spec then quality review, relevant
backend and full existing CI gates. Normal protected PR merge, master CI and
automatic Production, exact running versions, bounded public smoke and timing
comparison. Do not trigger game collection, use owner credentials, mutate ACLs
or create production fixtures for acceptance. Report small-sample timings and
deferred work honestly.
