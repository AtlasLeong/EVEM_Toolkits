# Operating the hotspot-only account pool

The owner-approved mode uses one randomized global timer and one account per pass. Normal round-robin selection is not rejection-driven failover and is not a claim that the game rate limit is per account.

## Private configuration

Use either the legacy `ANOMALY_SESSION_FILE` or the path-separated `ANOMALY_SESSION_FILES`, not both. For a multi-account pool, configure an independent absolute `ANOMALY_SESSION_CURSOR_FILE` and a matching JSON list `ANOMALY_SESSION_ACCOUNT_IDS`. The account aliases are operator-defined non-secret references, not values extracted from tokens or role names. Preserve the existing `GAME_SESSION_COORDINATOR_FILE` and alias assignments so persisted cooling and pauses continue to apply.

Keep all bundles and the cursor outside Git, release, web and static trees. POSIX bundles/cursor are collector-owned regular files with mode0600; the cursor parent is collector-owned and not writable by group/others. No symlink/reparse components, duplicate files/materials or cursor collisions with bundles or the old KM cursor are allowed. The existing shared collector flock serializes cursor selection and requests. Do not start multiple per-account timers or bypass the runner for concurrent manual collection.

## Converting existing owner-authorized KM material

`AnomalyHotspots.session_bundle.derive_from_killboard(bundle)` is offline only. It strictly validates the input, retains that account's own handshake/authentication and envelope, replaces only the observed business call with `get_dungeon_destroy_statistics([], {})`, removes optional KM profile capabilities, and validates a strict hotspot-only bundle. It rejects a destination other than the observed `char_mgr` / target-1.

Run conversion as the existing collector user, with its existing dependency runtime. Save each result to a new private file using `save_session`; never overwrite KM originals or copy another account's authentication/route. The source KM allowlist is unchanged. Converted calls are derived from an observed schema, not separately captured hotspot calls. Offline success proves format/security compatibility only; real authorization is checked by normal scheduled collection after cooling. Captured sessions can expire and a live game login on the same account may be displaced.

## Sampling and failure behavior

One pool selection is fixed for the whole pass. Existing limits remain: four authentication RPCs, one full statistics RPC, five total RPCs,90-second pass budget, and1–3-second random delays between RPCs. The five-minute timer plus up to five-minute randomized delay is global, not per account. A network/auth/rate rejection ends that pass; no immediate reconnect or switch to another slot occurs.

Shared global rate cooling remains15/30/60minutes. Do not clear the coordinator database, reset pauses, or use rotation to evade rejection. Last-good snapshot data and its actual successful collection time are preserved on failure. Public web requests only read the sanitized saved snapshot and never contact the game.

Safe journal fields identify the selected slot, pool size, normalized stage, RPC count and failure reason without publishing files, opaque authentication, account identities, raw exceptions or game response bodies. Selection during a cooled pass does not prove a game request occurred; check the RPC count/status.

## Deployment and rollback

1. Keep KM timer disabled and collector/bootstrap/identity services stopped. A blank existing `KILLBOARD_OWNER_EMAIL` denies its API and hides its navigation after refresh; retain reports and original sessions.
2. Publish tested application changes through the existing CI and dedicated publisher. No dependency/migration or protected publisher change is required.
3. For the private configuration switch, pause the hotspot timer and wait for any in-flight pass to end. Keep a root-only backup of its old environment file, create and offline-validate new private materials, then atomically update pool configuration. Do not change coordinator state or timer cadence.
4. Restore the original randomized timer. Verify the deployed backend version, true snapshot timestamp and actual scheduled slot advancement. Do not call all accounts consecutively as a release probe. Separate seven-file offline validation from individual game authorization evidence in the release report.
5. If staging fails, leave the previous hotspot configuration usable. To roll back after switching, stop the hotspot timer, wait for the worker, atomically restore its protected environment backup and restart only the timer. Preserve KM suspension unless the owner explicitly requests restoration. Newly staged private files may be retained for review; never recursively delete private credential directories.
