# Market session rotation and optional shared-account coordination

## Behavior and limits

Market now validates the entire configured pool, rejects duplicate material even
when JSON key order differs, and selects A, B, C, A using a cursor persisted in
the existing singleton `MarketConfig` row. A process restart preserves the next
slot. Selection happens only under the current collection lease, and one run
uses exactly one selected bundle. No rejection triggers another-account retry.
The shared round-robin calculation is also used by Killboard; its existing
private cursor file and bundle schema remain supported.

Existing `MARKET_SESSION_FILE` / `MARKET_SESSION_FILES` configuration is unchanged.
Market still runs 35–51 minutes after a finished collection, handles at most 40
items per pass, and spaces item queries by one second. Killboard's ten-minute
timer with up-to-one-minute jitter, 24-look-up limit, 36-total-RPC limit and
210-second deadline remain intact.
Increasing pool size never adds passes, sessions per pass, or request capacity.
An absent or corrupt bundle pauses the whole pool rather than changing slot
numbers by silently filtering files. Remove a retired entry explicitly.

Captured files contain replayable authentication material, not live connections.
Rotation does not refresh credentials or prove an idle/absolute lifetime. Keep
Market's `get_super_orders` templates: a Killboard-only file is still rejected.
Do not splice authentication and RPC templates from different captures/accounts.

## Rejection and recovery

- Missing/unsafe/malformed material: `needs_auth`, `invalid_session`; no network I/O.
- Explicit authentication denial: `needs_auth`, `auth_rejected`; stop the pass and
  automatic collection. Do not retry another slot.
- An unclassified service refusal: `blocked`, `service_rejected`; stop automatic
  collection without claiming that refreshing authentication will fix the refusal.
- A captured structured rate rejection: `cooldown`, `rate_limited`; stop all
  remaining queries. Persist 15/30/60-minute increasing cooldowns. Scheduled and
  queued manual jobs cannot bypass the cooldown. The next automatic pass is also
  no earlier than the existing finish-plus-35–51-minute schedule.
- Network/timeout failures remain `error` with `network_error` / `timeout`; a later normally scheduled pass can
  recover. Malformed login replies are protocol errors, not proof of expiry.

Cooldown intervals and all budgets are conservative local policy, not official
quotas. The game transport is TCP/MessagePack, not an HTTP 401/403/429 API. Only
observed structured errors are classified; unknown prose is not guessed into
an auth/rate code. Unknown refusals stay paused until the operator has resolved
the service restriction. No account switching may bypass limits or revocation.

For auth recovery, the operator uses the game's supported login flow on an
authorized dedicated account, obtains and validates replacement captured
material using the existing private import/export workflow, and installs it
with the existing collector-only permissions. This feature does not create
credentials, log in with passwords, discover accounts or widen credential ACLs.
Then enqueue one deliberate Market verification pass; a failed verification
stops again. Killboard retains its explicit operator `killboard_probe --resume`
flow. This development change has not performed either live verification.

## Shared accounts: explicit, optional, single-host

A character ID or token cannot reliably identify an account shared between KM
and Market. There is no automatic identity inference. Prefer separate dedicated
accounts. If the SAME game account is intentionally shared, the operator must
map both pool entries to the same short non-secret reference, for example:

```text
GAME_SESSION_COORDINATOR_FILE=/private/collector-state/accounts.sqlite3
MARKET_SESSION_ACCOUNT_IDS=["collector-a","collector-b"]
KILLBOARD_SESSION_ACCOUNT_IDS=["collector-a","collector-c"]
```

Each JSON array follows its module's configured file order and must match the
complete pool length. References match `[a-z][a-z0-9_-]{0,31}` and must be unique
inside a pool. Use an administrative label, never a token, password or login
payload. Wrong/partial mapping fails closed. If both coordination variables are
absent for a module, legacy separate-account operation remains available; this
does NOT establish safety for accounts secretly shared between modules.

The coordinator holds an expiring, owner-fenced account lease, checks ownership
before each RPC, and persists a common ledger across restarts and collectors.
Its conservative additional ceiling is 44 total RPCs per account per five
minutes (including all four auth calls), with at least one second between RPCs.
Each module's original lower pass budgets still apply. Exhaustion stops the
pass; no other account is tried to complete it. A rate rejection pauses EVERY
account mapped to that coordinator file. Authentication denial suspends the
mapped account until explicit recovery, and the rejecting collector itself
also remains paused. No captured material or material hashes are persisted in
coordination state.

The SQLite file is for trusted collectors on ONE host's local filesystem.
Neither separate copies, NFS/SMB, nor per-host files provide a distributed
account lease. Multi-host use requires a separately designed shared database
lease and reliable identity mapping; do not enable this single-host adapter as
a substitute. Concurrent player login can still invalidate a captured session,
even when collector jobs are serialized.

## Additive migration and provisioning (not performed by this change)

1. Stop both collector timers during rollout. Back up the database and apply
   Market migration `0008` under the existing migration identity. It adds cursor
   and cooldown fields to the existing config table; no new worker DB grants
   or Django applications are required. Existing pool configuration remains valid.
2. For optional sharing only, provision a separate local state directory with
   access limited to the trusted collector identities. Do not place credentials
   in this directory or grant either collector access to the other's credentials.
   Create a NEW state file with the candidate backend's Python:
   `python -m GameSessions provision --state-file /private/collector-state/accounts.sqlite3`.
   This creates non-secret state only and refuses an existing file.
3. An administrator must explicitly provision the shared group/file ACLs and
   systemd write access for this non-secret directory. On POSIX, the file may be
   `0660` for the dedicated collector group and the directory `0770`; no other
   access is allowed. The service examples are intentionally not broadened by
   default. Windows requires a protected ACL for just the trusted identities.
4. Configure the same state path plus the correct module-specific mapping on
   BOTH collectors. Validate using synthetic material before a separately
   authorized bounded live check. Wrong mapping can serialize unrelated accounts
   or fail to coordinate a shared account, so mapping is an operator responsibility.

After supported re-login and authorized replacement, clear only the shared
account's auth latch explicitly:

```text
python -m GameSessions resume --account-id collector-a --confirm-authorized-session-replacement
```

This command uses `GAME_SESSION_COORDINATOR_FILE`, refuses an active lease, makes
no game connection, and does not clear rate cooldowns or the module's pause.
Follow it with the module's existing deliberate verification/resume flow.
Never use it to ignore an unresolved refusal or revoked access.

Before rollback, stop both timers. Retain additive schema and non-secret state;
old workers do not honor the new cooldown/rotation fields, so do not resume them
while relying on the new rejection protections. No migration reversal or
automatic credential replacement is part of rollback.

## Offline verification

Run `python manage.py test Market GameSessions.tests --settings=EVE_MDjango.ci_settings --noinput`
and the complete Killboard suite with `EVE_MDjango.killboard_test_settings`.
The tests use synthetic bundles, mocked TCP byte streams, temporary SQLite and
a separate local process. They cover rotation/restart, duplicate material,
ownership fencing, cross-process contention, shared budgets, persistent auth
and rate stops, manual cooldown protection, network recovery and unchanged
batch/frequency limits. They do not prove game credential lifetime or live
MySQL/systemd behavior.

Local verification on Windows / Python 3.11: 167 Market/shared/settings tests,
278 explicitly selected Killboard/shared-catalog tests, 607 frontend unit/preview
tests and 45 related deployment/packaging contract tests passed. The frontend
build, Django system check, migration drift checks and Python compilation passed.
Use the explicit Killboard module list in `.github/workflows/ci.yml`: the bare
`Killboard` test label does not discover its namespace test directory.

The full deployment suite exceeded a 60-second local bound in the existing
Windows backup escrow test; it was stopped. Linux-only release tests and real
disposable MySQL integration remain CI checks. No production database, game
credential or real game endpoint was used for this verification.
