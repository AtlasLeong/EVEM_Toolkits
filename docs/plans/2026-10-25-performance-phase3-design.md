# Performance phase 3: bounded legacy work and SMTP resilience

## Approval and baseline

The user requested implementation, tests, push and deployment of stage three
from the 2026-10-23 audit, explicitly avoiding over-refactoring. The original
stage is SMTP timeout, legacy query limits, fraud history pagination/batched
users, and numeric planetary ranking. Start from master
`bba09771a2ecdf8e96536f020a2849a4248c30aa` in the existing attached worktree on
`codex/performance-phase3-20261025`; preserve unrelated private outputs and the
dirty original 43c4 checkout. Baseline: 46 auth, 6 fraud and 781 frontend
unit/preview tests pass.

## Chosen approach and alternatives

Use local, explicit bounds at existing handlers, a socket timeout, and opt-in
fraud pagination. Reject work that exceeds a bound with an actionable 400;
never silently truncate and present an incomplete chart or Top 3 as complete.
Keeping all existing unbounded reads does not satisfy the approved audit;
replacing them with a universal pagination platform, task queue, Redis or
database migration is unnecessary. Bounds are conservative protection policy,
not measurements of every production query or a database execution deadline.

## SMTP

Set `EMAIL_TIMEOUT = 10` seconds and ensure CustomEmailBackend actually passes
its effective timeout to SMTP_SSL. A missing timeout uses the same finite
default; invalid/nonfinite/nonpositive or over-30-second values are rejected
before network I/O.
Preserve SSL certificate validation and current synchronous delivery semantics,
no automatic retries or background threads. Failed login/open must discard and
close a partial connection so it cannot be reused as authenticated. A socket
timeout is per blocking operation, not an end-to-end deadline/DNS guarantee.
The existing verification endpoint continues returning its existing error on
delivery failure; never report a simulated timeout as sent. Test SMTP at the
transport seam, never send real verification mail for acceptance.

## Query bounds

- Planetary POST body is an object with typed location/resource arrays. At most
  100 submitted IDs per location level and 34 resources (the existing server
  catalog size); bound raw input before stable deduplication. Positive signed
  64-bit decimal IDs accept integers and strings, not bool/float/containers.
  Resource names come from the server map; rebuild icons from the server catalog
  while accepting historical option display fields. Preserve most-specific
  location selection and the existing per-planet first matching resource rule.
- Full planetary candidate reads use LIMIT 5001 and reject above 5000 before
  ranking. Precomputed/final results use a 10000-row total bound and cap+1
  detection. A real 10000-row tie fixture reproduced the old correlated MAX
  query's multiplicative scan (>1 minute in isolated SQLite). Therefore the
  global path reads selected precomputed rows once (LIMIT10001), rejects overflow,
  and computes finite maxima/ties per resource/region in that bounded list,
  retaining requested-resource order and the response shape. No new table/cache.
  Do not claim SQL LIMIT bounds every underlying database scan or execution time.
- Rank finite, nonnegative numeric yields; skip null/bool/invalid/NaN/infinite
  values, keep original serialized yield values. Top-three ties are stable.
- StarField child-directory CSVs: at most 100 submitted IDs/2000 characters,
  valid positive decimal IDs, no missing/empty/repeated query keys. Preserve
  plain arrays used by both planetary and corporation selectors; bound returned
  directory objects with cap+1 detection rather than changing the envelope.
- Bazaar charts: at most 8 submitted series, strict item shapes/names <=255,
  china/world case-insensitive whitelist and integer ranks 1..50. These match
  the historical UI (5 defaults, 8 maximum). Stable deduplication; keep one
  merged query, requested unique-series order, and existing nested-array labels.
  At most 366 points per series, SQL LIMIT unique_count*366+1 (<=2929), explicit
  error if exceeded. Never rebase a truncated history to misleading day numbers.
  No new Bazaar page; the current adapter has no page consumer.
- Independent read throttles for planetary (30/min) and chart (60/hour), using
  the existing cache and trusted transport REMOTE_ADDR, not user-supplied XFF.
  These are approximate process-cache budgets, not distributed protection or
  replacements for input/row bounds. They do not change email throttles.
- Frontend propagates safe 400/429 guidance and preserves existing results;
  never automatically splits a rejected query into more requests.

## Fraud history

GET /api/fraudbehaviorflow must continue checking current authenticated group
membership on every request. Page authorized non-F anchor operations, not raw
B/F rows; default20/max50, stable descending primary key, page <=10000. Count
means authorized anchors. For current-page nonempty operation IDs, aggregate
the first authorized F primary key per operation, then batch-fetch those rows;
duplicate/empty legacy IDs cannot cause unbounded results or cross-group leaks.
Read all distinct page actor names once and pass a map into the serializer,
without a per-row query fallback or schema/FK change. A page has <=100 rows.

No-param legacy clients get a bounded first-page array. Explicit page/page_size
gets `count/results/page/page_size/has_next`; the new frontend accepts both for
rolling deployment, keys queries by page and never auto-fetches all history.
Show pagination in the existing history tab, preserve details and prefix query
invalidation. Use a map for pairing instead of repeated rows.find. Private
responses remain non-shared (`private, no-store`). Do not expand this change to
fraud search, evidence uploads, approvals or report-list semantics.

## Verification and release

Use test-first regressions with temporary unmanaged SQLite fixture tables under
existing isolated settings. Assert invalid input before SQL, SQL LIMIT and
bounded query/object counts, cap/cap+1, real numeric Top 3, operation pairs,
missing actors, duplicate IDs, current ACL/revocation, public switch/invalid JWT,
and 429 without trusted-header bypass. Exercise frontend old/new envelopes,
pagination, error retention and existing admin/planetary/corporation flows.

Add new suites to existing full CI commands without removing any gates or
weakening policy. No new dependency, model migration, collector cadence/budget,
credential, service topology, global authorization, OS/framework, hotspot cache
or deployment-protocol changes. Require independent spec then quality review,
complete PR/master CI, protected automatic Production, exact component versions,
public safe reads and real desktop/mobile checks; no real mail, game requests,
production fixture data or private-user access for acceptance.
