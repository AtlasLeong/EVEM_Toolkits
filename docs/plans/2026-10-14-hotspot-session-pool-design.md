# Hotspot-only sequential session pool

Approved by the owner on 2026-10-14 (Asia/Shanghai): implement and deploy the proposed conversion of all seven existing KM sessions to anomaly hotspot collection. KM is already operationally suspended: its timer is disabled, collector/bootstrap/identity services inactive, and its configured owner is blank. Reports, cursors and original private files remain recoverable.

## Architecture and limits

Maintain one global hotspot timer, five minutes plus zero-to-five minutes random delay. Each scheduled pass selects exactly one account from an explicit private pool, in persistent sequential round-robin order. Do not start a timer per account, run accounts concurrently, add immediate failover, or increase total statistics requests. A pass retains four authentication RPCs plus one full-universe statistics request, five-RPC/90-second budgets and existing 1–3-second RPC jitter.

Introduce `ANOMALY_SESSION_FILES`, `ANOMALY_SESSION_CURSOR_FILE` and matching `ANOMALY_SESSION_ACCOUNT_IDS`. Single-file configuration stays compatible; conflicting single/pool settings fail closed. The selected index and pool size flow to `HotspotSession` and the existing account coordinator. Use a private anomaly-specific cursor, never mutate the old KM cursor or use a secret-derived identifier. The existing shared flock serializes passes and deployment. Validate full pool configuration before connecting; duplicate paths/files/materials, unsafe files and invalid mapping are rejected.

Shared global rate-limit cooling remains authoritative, including across accounts and process restarts. No reset of cooldown, account authorization/service pauses or quota policy. Rejection terminates the pass. Removing KM requests eliminates its lock contention and request consumption, but does not prove game quotas are per-account or guarantee freshness every 5–10 minutes.

## Private material conversion

Derive a new strict hotspot-only bundle from each existing strictly validated KM bundle. Preserve that account's endpoint, hello, authentication templates, route envelope and flags. Only replace the observed `get_kill_info` business Ext10 with `[get_dungeon_destroy_statistics, [], {}]`, remove optional profile capabilities, and run the existing hotspot validator. `char_mgr` and target `-1` must already be present. Reject incompatible captures; never copy another account's authentication or route. Document these as derived capabilities, not seven independently captured hotspot requests.

Keep originals unchanged and create new owner-only files outside Git, release, web and static roots. Offline schema validation is not a claim of live game authorization. Admit compatible materials and verify authorization at normal timer cadence after existing cooling, without a burst of test requests. Report any unverified or rejected accounts separately.

## Output and verification

Public snapshot schema, read-only API and UI are unchanged. Failures preserve the last good rows and true collection time. Journal may add safe slot, pool size, normalized stage/RPC count and normalized failure reason; never credentials, paths, raw game errors, material hashes or identity-derived keys. This permits verification of actual sequential selection without exposing private material.

Test strict conversion, seven-slot coverage and restart continuation, singular configuration compatibility, explicit secure cursor behavior, full-pool duplicate/file validation, selected lease mapping, one connection/no failover, shared cooldown across slots, command failure preservation and safe logging. Run existing anomaly, KM transport/session, GameSessions and worker packaging tests, then unchanged full CI. Publish via the current dedicated deployment workflow; do not change CI policy, install protected publisher scripts or deploy application code through root SSH.

## Operational rollout

Pause the hotspot timer only for final private configuration staging. Create recoverable backups, derive seven files locally on the server with the deployed helper (no download), map the original explicit non-secret account aliases, and atomically set the new pool and independent cursor. Preserve shared coordinator state. Reload the timer without changing its frequency, keep KM stopped, and confirm source versions, permissions, pool selection and a real saved snapshot. Observe normal scheduled collection, not manual aggressive probes. If conversion/publication fails, preserve old working hotspot configuration and suspended KM state.
