# Private Killboard operation

## Release boundaries

Only the configured active owner can discover the navigation entry or read reports. The API is authoritative; a 403 clears private page state and latches until a fresh capability-verified mount. Public GameData exposes static game metadata/images, never captured account sessions or reports.

The collection policy is strictly greater than 20,000,000,000 ISK, independent of ship class. Source damage-row counts are labelled as records, not as verified players. The collector enriches only the first seven positively identified character rows; missing identity does not prove an NPC. The frontend may additionally render up to seven participant rows with explicit NPC identity or verified ship/weapon evidence, while continuing to label unresolved identity honestly. Equipment retains its original dropped/destroyed state and verified slot mapping.

## Private worker

The service runs as `evem-killboard`, with an isolated Django settings module and table-scoped MySQL DML. It does not load the website secret, authentication tables or licence database. Session files are outside releases, each mode 0600 in a mode 0700 directory owned by the service account. Never commit or display their contents.

The systemd timer triggers five minutes start-to-start. Each normal pass has a 210-second request deadline, at most 24 KM lookups, at most 36 total game RPCs and a five-second RPC spacing. Identity enrichment also consumes that budget and is skipped for reports excluded by the strict loss-value threshold. Source reports without a loss value are not enriched or stored; malformed values remain errors, not empty reports. The service timeout is four minutes. Collector and application publisher share one provisioned lock inode. These bounds do not guarantee that a backlog or a faster-growing source can be fully covered in one pass.

Exactly one captured session is selected for a pass. No password login, token refresh, or alternate-account retry after a rejection is implemented. An observed rate rejection stops the whole pass and establishes a persisted 15/30/60-minute increasing cooldown. These intervals are local conservative policy, not a claimed official quota. Authentication or configuration failure pauses collection until an operator explicitly resumes it after correcting the session/configuration.

## Initialization and limitations

`killboard_bootstrap --known-id ... --upper-id ... --assume-contiguous --write` performs a bounded search and stores a candidate ID. It does not establish worldwide coverage. `--initialize --recent-count 30` explicitly starts a recent window and refuses to overwrite an existing collection cursor. Sparse or delayed report IDs remain a source limitation; empty boundaries are revisited, including after a crashed pass. Historical backfill is not part of this release.

New reports can change an observed empty boundary during the search. A `boundary_changed` result must remain a failed candidate search; do not remove the reprobe protection or present its lower bound as a verified latest ID. An operator may instead initialize an unused cursor at an explicitly recorded, recently verified lower point (or a declared small recent window below it) and scan forward. Preserve `candidate_id = NULL` and the coverage limitation. Do not overwrite an existing cursor or retry with another account after an authentication/rate rejection.

Packaging must preserve committed catalog bytes independently of Windows `core.autocrlf`. The publisher checks every declared immutable catalog hash in addition to the outer artifact manifest before staging. A package with corrupted inner catalog bytes is rejected even if its outer manifest is self-consistent.

Before deployment, create and verify a root-private default-database backup, apply additive migrations against the exact candidate, provision the restricted worker account and validate one known report from Linux. Enable the timer only after session validation and cursor initialization succeed. If the game rejects server-side session reuse, leave collection paused and the interface in archive mode; do not claim collection is running.

Disable the timer before application rollback. Keep additive database migrations and collected reports; do not reverse them automatically. Preserve previous application artifacts, private configuration and the backup for operator recovery.

## Asset updates

See [game-data.md](game-data.md) and [client asset toolchain](../scripts/game_data/client_assets/README.md). Content-addressed PNGs and versioned catalog manifests record source paths, decoder/provenance and exact item-to-image mappings. New client versions are verified and published as a new immutable catalog revision; old revisions and URLs remain available.
