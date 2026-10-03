# Private Killboard operation

## Release boundaries

Only the configured active owner can discover the navigation entry or read reports. The API is authoritative; a 403 clears private page state and latches until a fresh capability-verified mount. Public GameData exposes static game metadata/images, never captured account sessions or reports.

The collection policy is strictly greater than 20,000,000,000 ISK, independent of ship class. Source damage-row counts are labelled as records, not as verified players. The collector enriches only the first seven positively identified character rows; missing identity does not prove an NPC. The frontend may additionally render up to seven participant rows with explicit NPC identity or verified ship/weapon evidence, while continuing to label unresolved identity honestly. Equipment retains its original dropped/destroyed state and verified slot mapping.

## Private worker

The service runs as `evem-killboard`, with an isolated Django settings module and table-scoped MySQL DML. It does not load the website secret, authentication tables or licence database. Session files are outside releases, each mode 0600 in a mode 0700 directory owned by the service account. Never commit or display their contents.

The systemd timer triggers five minutes start-to-start. Each normal pass has a 210-second request deadline, at most 24 KM lookups, at most 36 total game RPCs and a five-second RPC spacing. Identity enrichment also consumes that budget and is skipped for reports excluded by the strict loss-value threshold. Source reports without a loss value are not enriched or stored; malformed values remain errors, not empty reports. The service timeout is four minutes. Collector and application publisher share one provisioned lock inode. These bounds do not guarantee that a backlog or a faster-growing source can be fully covered in one pass.

Exactly one captured session is selected for a pass. No password login, token refresh, or alternate-account retry after a rejection is implemented. An observed rate rejection stops the whole pass and establishes a persisted 15/30/60-minute increasing cooldown. These intervals are local conservative policy, not a claimed official quota. Authentication or configuration failure pauses collection until an operator explicitly resumes it after correcting the session/configuration.

Within one pass, a locator response that was successfully parsed and excluded
by a known, finite loss value at or below the current strict threshold is
already resolved. It is removed from that pass's pending scan range instead of
spending a second `get_kill_info` request. Reports with an unknown value, reports
above the threshold, and responses with a deferred transport stop remain pending
for the existing recovery/enrichment path. This optimization does not persist a
response cache across passes, suppress empty-boundary revalidation, raise any
request/time budget, or change cooldowns. Response and persistence counters count
only actual responses; they are not counts of unique reports worldwide.

## Read-only collection diagnostics

The owner-only collector log API includes a bounded summary for the previous
24 hours by default; `?window_hours=N` accepts 1 through 168. The same database-only
summary is available with:

```console
python manage.py killboard_diagnostics --cursor latest --window-hours 24 --format summary
python manage.py killboard_diagnostics --cursor latest --window-hours 24 --format json
```

Use the appropriate existing Django settings and authorized database identity.
The command does not create a game client, load private session files, change a
cursor, resume collection, or initiate requests. Summary windows use run start
times, with creation time as a fallback for older rows. Coverage fields explain
bounded/truncated history and missing counters; missing observations remain
unknown. Accepted KM responses from retained run counters, value/NPC/policy
filtering, new/updated rows, and transport stops are separate counts. Historical
discovery can record a successful `REPORT` event rejected for reversed time
without incrementing its accepted run counter; event outcomes therefore remain
separate, with their own truncation coverage. Running rounds can be partial.
A successful base KM can coexist with
an identity-enrichment stop. Zero-request cooldown rounds are skipped rounds,
not additional rate rejections or material attempts.

New normal collector runs record a `material_alias`, `material_version`, and
`pool_version` tuple using only configured path and verified file metadata from
the existing bounded session load. The path itself, credentials, and credential
hashes are never exposed in these diagnostics. The alias survives pool reorder
while the pool version changes; replacing a file at the same path retains the
alias and normally changes its filesystem generation version. Moving to another
configured path creates a new alias. A filesystem generation is not a
cryptographic content identity, and the deterministic path pseudonym does not
prove an account identity or anonymity against someone who already knows the
path. No additional private-file read is performed for this attribution.

Historical ordinal slots such as `B` are reported as legacy pool slots, without
backfilling a material identity. The summary reports account count as unknown;
neither six configured files nor six aliases establish six distinct accounts.
Rate/parse stops do not by themselves prove authentication expiry. Collection
still stops after rejected authentication or service refusal and uses the
existing supported operator recovery process. Rotating materials cannot promise
permanent authentication or override a service restriction.

## Initialization and limitations

`killboard_bootstrap --known-id ... --upper-id ... --assume-contiguous --write` performs a bounded search and stores a candidate ID. It does not establish worldwide coverage. `--initialize --recent-count 30` explicitly starts a recent window and refuses to overwrite an existing collection cursor. Sparse or delayed report IDs remain a source limitation; empty boundaries are revisited, including after a crashed pass. Historical backfill is not part of this release.

New reports can change an observed empty boundary during the search. A `boundary_changed` result must remain a failed candidate search; do not remove the reprobe protection or present its lower bound as a verified latest ID. An operator may instead initialize an unused cursor at an explicitly recorded, recently verified lower point (or a declared small recent window below it) and scan forward. Preserve `candidate_id = NULL` and the coverage limitation. Do not overwrite an existing cursor or retry with another account after an authentication/rate rejection.

Packaging must preserve committed catalog bytes independently of Windows `core.autocrlf`. The publisher checks every declared immutable catalog hash in addition to the outer artifact manifest before staging. A package with corrupted inner catalog bytes is rejected even if its outer manifest is self-consistent.

Before deployment, create and verify a root-private default-database backup, apply additive migrations against the exact candidate, provision the restricted worker account and validate one known report from Linux. Enable the timer only after session validation and cursor initialization succeed. If the game rejects server-side session reuse, leave collection paused and the interface in archive mode; do not claim collection is running.

Disable the timer before application rollback. Keep additive database migrations and collected reports; do not reverse them automatically. Preserve previous application artifacts, private configuration and the backup for operator recovery.

## Asset updates

See [game-data.md](game-data.md) and [client asset toolchain](../scripts/game_data/client_assets/README.md). Content-addressed PNGs and versioned catalog manifests record source paths, decoder/provenance and exact item-to-image mappings. New client versions are verified and published as a new immutable catalog revision; old revisions and URLs remain available.
