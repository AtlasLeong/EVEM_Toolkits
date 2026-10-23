# Performance phase 2: explicit data contracts, not a rewrite

## Approval and scope

The user approved the second step of the 2026-10-23 whole-repository audit:
hotspot grade semantics, layered market freshness, and collection pause reasons.
Implement and deploy after tests. Phase 1 is already live. This does not authorize
higher collection concurrency, lower protection intervals, credential changes,
permission relaxation, framework changes, or unrelated cleanup.

## Baseline

Start at master `674a74e2274a0fd1fca238daa782de4a61b13cd9` in the existing
attached anomaly-hotspots worktree, new branch `codex/performance-phase2-20261023`.
Production frontend/backend are `36ad359f5ada2ff89fd9158ceeee07af8038efc8`;
the later master change is a deployment helper only. Both timers are waiting,
KM remains disabled, and phase-1 public-only gzip remains active.

## Hotspots

- Introduce one small pure metric-contract module and version-2 sanitized
  snapshot/sample/API envelopes. Current new observations explicitly use
  `activity_level`, bounded 0–5, with the versioned client range mapping:
  0 no heat; 1:1–50, 2:51–100, 3:101–150, 4:151–200, 5:>200.
- Keep raw `destroy_num` values. No midpoint estimates. Statistics window stays
  null/unknown; do not invent 1h or 24h. Captured/client evidence establishes
  grade semantics, not a confirmed statistics time window.
- Read version-1 snapshots and immutable samples as `legacy_unclassified`.
  Preserve their bytes, manifest references, and hashes. Never infer semantics
  from a small number, timestamp, or the structural wire discriminator alone.
- Public system ranking shows grade and range. Region ranking uses highest
  grade, then number of positive-grade systems, then region ID. No summed
  destruction counts. Unknown geography remains visible/fallback-addressable.
- Comparable grade history shows upward grade movement, not destruction count
  delta. Equal grades do not imply zero underlying activity. Mixed or legacy
  pairs explicitly return incomparable with the actual interval and no ranked
  deltas. Retain interval navigation and existing permission checks.
- Failure fallback carries metric metadata with the last-good rows and time.
  Map palette, search, focus, interaction performance, security boundaries, and
  raw history retention/physical safety budgets remain intact.
- Version readers accept legacy data. An isolated downgrade rehearsal must
  confirm that old latest-snapshot code recovers only on the next successful
  scheduled pass. Old history code cannot append after a v2 latest sample and
  does not automatically recover: an operational downgrade must temporarily
  disable history reads/writes, preserve the entire store, and use a
  reader-compatible forward fix before restoring history. No automatic
  downgrade, sample rewrite, or deletion is permitted.

## Market

- Add one optional nullable `collection_priority` boolean, false/null means
  ordinary. Existing inventory is not automatically reprioritized. Existing
  admin item PATCH/create and permission checks control it. No new admin app.
- Inside the existing effective batch limit, allocate at most half to priority
  oldest-attempt-first, reserving the other half for ordinary oldest-first.
  Donate unused slots, avoid duplicates, and select again at the actual shared
  40-item cap rather than truncating away an entire tier. Ordinary-only order
  stays unchanged. One account per pass and all stop/cooldown/budget rules stay.
- Priority observation target is 2h; ordinary planning target is 6h. These are
  disclosed planning objectives, not freshness status redefinitions or service
  guarantees. Existing public `fresh/stale/empty/uncollected` and the 2h stale
  threshold stay unchanged. Show actual observation age/tier additively.
- Private admin overview displays enabled and covered counts per tier, age
  statistics, actual recent successful observations per elapsed hour, latest
  persisted effective plan and its timestamp, and capacity feasibility warnings.
  Label estimates/unknowns explicitly. Use bounded SQL/rows, not a new collector.
- Existing sanitized config/run error codes get distinct private explanations:
  invalid material is not proven expiry; authentication rejection, service
  refusal, rate/global cooldown, occupied account, exhausted budget, malformed
  configuration, timeout/network failure remain distinct. Unknown pool state
  remains unknown. No credential/account identifier exposure or HTTP calls into
  the coordinator (its transactions mutate state).
- Public quality responses must not gain internal account/pause diagnostics.
  Private admin and ControlCenter links retain existing guards/no-store headers.

## Non-goals

No SMTP/query-bound fixes (phase 3), projection/history caching (phase 4), OS or
Django upgrade (phase 5), account rotation bypass, timer change, budget increase,
Redis, task queue, microservice, broad styling migration, or new dependency.

## Verification and release

Test-first focused backend and frontend contracts, legacy preservation, bounded
selection/fairness, null migration compatibility, sanitized diagnostics and
authorization/revocation. Independently review specification then code quality.
Run full local relevant suites, frontend units/build and browser regressions,
then complete unchanged PR/master CI gates. Publish only via the normal protected
workflow. Check exact deployed SHAs, public semantics, private denial, frontend
desktop/mobile, unchanged gzip, timers/KM and no unfinished release transaction.
Wait for normal scheduled hotspot observations for grade-baseline acceptance;
do not manually trigger game requests merely to obtain release evidence.
