# Private Killboard operation

## Release boundaries

Only the configured active owner can discover the navigation entry or read reports. The API is authoritative; a 403 clears private page state and latches until a fresh capability-verified mount. Public GameData exposes static game metadata/images, never captured account sessions or reports.

The collection policy is strictly greater than 20,000,000,000 ISK, independent of ship class. Source damage-row counts are labelled as records, not as verified players. Only the first seven positively identified character rows are presented; missing identity does not prove an NPC. Equipment retains its original dropped/destroyed state and verified slot mapping.

## Private worker

The service runs as `evem-killboard`, with an isolated Django settings module and table-scoped MySQL DML. It does not load the website secret, authentication tables or licence database. Session files are outside releases, each mode 0600 in a mode 0700 directory owned by the service account. Never commit or display their contents.

The systemd timer triggers five minutes start-to-start. Each normal pass has a 210-second request deadline, at most 24 KM lookups, at most 36 total game RPCs and a five-second RPC spacing. Identity enrichment also consumes that budget. The service timeout is four minutes. Collector and application publisher share one provisioned lock inode.

Exactly one captured session is selected for a pass. No password login, token refresh, or alternate-account retry after a rejection is implemented. An observed rate rejection stops the whole pass and establishes a persisted 15/30/60-minute increasing cooldown. These intervals are local conservative policy, not a claimed official quota. Authentication or configuration failure pauses collection until an operator explicitly resumes it after correcting the session/configuration.

## Initialization and limitations

`killboard_bootstrap --known-id ... --upper-id ... --assume-contiguous --write` performs a bounded search and stores a candidate ID. It does not establish worldwide coverage. `--initialize --recent-count 30` explicitly starts a recent window and refuses to overwrite an existing collection cursor. Sparse or delayed report IDs remain a source limitation; empty boundaries are revisited, including after a crashed pass. Historical backfill is not part of this release.

Before deployment, create and verify a root-private default-database backup, apply additive migrations against the exact candidate, provision the restricted worker account and validate one known report from Linux. Enable the timer only after session validation and cursor initialization succeed. If the game rejects server-side session reuse, leave collection paused and the interface in archive mode; do not claim collection is running.

Disable the timer before application rollback. Keep additive database migrations and collected reports; do not reverse them automatically. Preserve previous application artifacts, private configuration and the backup for operator recovery.

## Asset updates

See [game-data.md](game-data.md) and [client asset toolchain](../scripts/game_data/client_assets/README.md). Content-addressed PNGs and versioned catalog manifests record source paths, decoder/provenance and exact item-to-image mappings. New client versions are verified and published as a new immutable catalog revision; old revisions and URLs remain available.
