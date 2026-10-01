# KM freshness and diagnostics — approved implementation

The user authorized autonomous implementation and deployment, with a ten-minute
schedule. Existing evidence shows a stale sequential cursor, repeated upstream
RequestTooOften stops, ambiguous per-account diagnostics, and UTC timestamps
rendered as local time. Increasing the schedule alone cannot solve these issues.

## Design

- Run every ten minutes, with up to one minute of scheduler jitter. Keep the
  existing five-second minimum RPC spacing plus zero-to-three-second random
  delay, 36 wire-RPC budget and 210-second deadline. A limit stops the entire run;
  no account hopping within a run and no clearing server cooldowns.
- Use one round-robin session per eligible run. Record only its ordinal A/B/C,
  RPC method/stage and stable error classifier, never credentials or payloads.
- Separate verified base KM acquisition from optional identity enrichment.
  Persist eligible base data if enrichment fails, record the deferred stage,
  then obey the same transport stop. Preserve already enriched data.
- Add JSON audit fields to existing cursor/run/event tables (additive migration).
  Preserve existing history progress. A resumable, bounded frontier search uses
  the already documented contiguous-ID assumption; it never labels a network,
  authentication, rate or decoding error as an empty ID.
- Search from a known boundary with exponential bracketing and bisection, saving
  progress after each response. Prioritize a recent descending window once a
  candidate boundary is located. Preserve unscanned older ranges and spend a
  small explicit share of collection requests on them. Do not claim full
  coverage; skipped ranges remain visible in the owner-only administration page.
- Store parsed/created/updated/value-filtered/NPC-filtered counts separately.
  The existing strict >20 billion ISK rule and proven-NPC-only exclusion stay.
- Serialize known game-source naive timestamps as UTC, then render Shanghai
  24-hour time. Refresh selected detail as well as list on refresh, visibility
  recovery and bounded backend-only polling. Keep all owner-only checks.

## Implementation / verification plan

1. Test and implement transport/session audit metadata and partial-base safety.
2. Test and implement resumable latest-first discovery, preserved history ranges,
   bounded work, pause/lease recovery, and the ten-minute worker contract.
3. Test and implement serializer time provenance and owner-only audit output;
   update frontend diagnostics and refresh behavior.
4. Run explicit Killboard and GameData suites, deployment contract tests, frontend
   unit/build checks, migration consistency and independent code review.
5. Push the reviewed commit, use verified CI output, back up the database, apply
   additive migration with collector exclusion, publish via the existing release
   mechanism, update/reload timer, and verify owner access and a bounded real run.

Upstream permission/limiting remains an external constraint. Ten-minute checks
are not a promise of ten-minute full coverage or a bypass of RequestTooOften.
