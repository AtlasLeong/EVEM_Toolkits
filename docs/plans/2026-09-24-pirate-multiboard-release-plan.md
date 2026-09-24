# Pirate multiboard MySQL preflight and release runbook

**Goal:** Safely rehearse and apply only TacticalCollaboration migration 0007 against MySQL 8, using a verified backup and isolated clone before any production write.

**Architecture:** A standalone, opt-in Python script exposes `inspect`, `backup`, `rehearse`, and `migrate` modes. It binds each stage to the candidate commit, migration file digest, source database identity, row counts and full Report/Force fingerprints, and an on-disk private manifest. A clone uses a separate database alias and an administrator option file; every write target is independently checked with `SELECT DATABASE()`.

**Tech Stack:** Python 3.10+, Django 4.2 migration executor, mysqlclient, MySQL 8 client tools, stdlib `unittest`/`mock`.

---

### Task 1: Pure safety gates

**Files:** Create `scripts/deploy/tactical_multiboard_preflight.py`; create `scripts/deploy/tests/test_tactical_multiboard_preflight.py`.

1. Write failing tests for exact migration plan, safe backup directory, immutable candidate identity, source counts and manifest validation; run `python -m unittest scripts.deploy.tests.test_tactical_multiboard_preflight -v` and confirm expected failures.
2. Implement pure validation helpers without opening a production connection. Pin target `('TacticalCollaboration', '0007_multiboard_pirate')`; reject any other TacticalCollaboration migration plan or partial 0007 schema.
3. Re-run targeted tests; `git diff --check`.

### Task 2: Backup and isolated rehearsal

**Files:** Same script and test.

1. Add failing tests proving backup subprocess failures, missing dump footer, digest mismatch, mismatched source identity, unsafe QA name and failed clone identity all stop before migration.
2. Implement private 0700 backup directory and 0600 dump/credential file; use subprocess argument arrays, no password in arguments/logs. Record SHA-256, size, source identity/row counts and candidate digest.
3. Restore into a new random, retained MySQL schema, reconnect Django using a QA-only alias and administrator option file, assert actual database identity, run only 0007 and verify all old reports/forces map to the single default war board with unchanged counts/scope.
4. Re-run targeted tests; never automatically delete QA schemas or production data.

### Task 3: Explicit production migration gate and runbook

**Files:** Same script/test plus this plan.

1. Add failing tests for absent/old backup, missing successful rehearsal, altered candidate/migration, changed source counts, wrong source DB, and missing maintenance confirmation.
2. Implement `migrate` mode to re-check all gates immediately before and after exactly 0007. On failure stop, keep backup/QA, and require manual state inspection; never `fake`, reverse-migrate or retry automatically.
3. Document the exact four-stage commands, required MySQL privileges, backup restoration evidence, maintenance window, two-stage X→Y release and forbidden rollback to pre-multiboard code after secondary-board writes.
4. Run targeted tests, deployment tests, backend migration tests and `git diff --check` before handoff.

## Release gates

No production run until a private full-database dump has been restored into a unique QA schema on the same MySQL version and the candidate 0007 migration plus cardinality checks pass there. The running release's previous code only groups tactical data by organization; after any secondary war-board writes, application rollback must target a multiboard-aware compatibility release (X), not the old release.

## Operator procedure (not yet executed on production)

This script is **not** included in the backend/frontend release archive: `pack.py` packages those two components only. A maintainer must review this exact script and install it at `/usr/local/lib/evem-deploy/tactical_multiboard_preflight.py` with a root-owned `0755` parent and root-owned non-writable-by-group/others script; record and recheck its SHA-256 before root executes it. `/EVEMTK/deploy` is owned by `evem-deploy` and is **not** a safe place for a root-executed preflight script. The CLI refuses a non-root operator or a script/ancestor path writable by another account. `pack.py` includes `backend/.release-sha`; the script compares that marker and the bytes of `0007_multiboard_pirate.py` at every stage. The script has only been exercised with local fake adapters; it has **not** yet been tested against the production MySQL server. Do not interpret passing unit tests as migration authorization.

Do **not** call `release.py publish` to stage a candidate: if migrations are already satisfied it could switch the live application. Copy the reviewed CI artifact to a root-controlled private path and verify its approved SHA-256. Install a separately reviewed copy of `release.py` in the same root-controlled library directory and verify that script's approved hash. **Complete the interpreter/venv ownership and symlink checks in the following paragraph before this step**, then invoke only `stage(archive, releases)` into a root-owned private staging root. The command rechecks the root-controlled library, its ancestors and `release.py` before adding it to `sys.path`:

```sh
<venv-python> -I -c '
import stat, sys
from pathlib import Path
library = Path("/usr/local/lib/evem-deploy")
for node in (library / "release.py", library, *library.parents):
    metadata = node.lstat()
    if stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022:
        raise SystemExit("unsafe root-controlled release library")
sys.path.insert(0, str(library))
import release
print(release.stage(sys.argv[1], "/EVEMTK/preflight-releases"))
' <root-private-verified-artifact>
```

Create `/EVEMTK/preflight-releases` as root-owned `0700` before this call. `stage()` validates the artifact manifest and file digests and extracts to `<SHA>/backend` without touching `current` or starting a service. Verify that the resulting backend's `.release-sha` is the approved 40-character commit and its migration file digest is the reviewed value. Keep the candidate directory and **all its files and ancestor paths** root-owned, not writable by group/others and free of symlinks until all four modes finish. The CLI checks this before it imports any candidate Python module; do not run it from an `evem-deploy`-writable normal release directory. No candidate `.env` copy is needed because the preflight injects the controlled environment file.

The root-run interpreter and its imported packages are a separate trust boundary. The 2026-09-24 read-only check found `/usr/local/lib/evem-deploy/runtime` is a root-owned symlink to `/EVEMTK/EVEM_Toolkits/backend/.venv`; the resolved interpreter is `/usr/local/python3.10/bin/python3.10`. Their ancestors, venv directories and sampled Python/Django/mysqlclient paths are root-owned `0755`; a full venv scan found no non-root-owned or group/other-writable non-symlink entry. Django is 4.2.5 and mysqlclient 2.2.0. **Recheck immediately before use**, because a root process must never import from a deploy-user-writable venv or symlink target:

```sh
readlink -f /usr/local/lib/evem-deploy/runtime
readlink -f /usr/local/lib/evem-deploy/runtime/bin/python
stat -c '%n %U:%G %a %F' /usr/local/lib/evem-deploy /EVEMTK /EVEMTK/EVEM_Toolkits /EVEMTK/EVEM_Toolkits/backend /EVEMTK/EVEM_Toolkits/backend/.venv /EVEMTK/EVEM_Toolkits/backend/.venv/lib/python3.10/site-packages /usr/local/python3.10/bin/python3.10
find /EVEMTK/EVEM_Toolkits/backend/.venv -xdev ! -type l \( ! -user root -o -perm /022 \) -print -quit
find /EVEMTK/EVEM_Toolkits/backend/.venv -xdev -type l -print
```

The first four outputs must match the reviewed root-controlled paths/modes, the first `find` must print **nothing**, and every listed symlink's resolved target and ancestors must be checked for root ownership and no group/other write access. This check is not satisfied merely because the `runtime` symlink itself says `root:root`; it depends on its target tree. If any condition fails, stop and provision a separate pinned, root-owned and root-private Python environment, then review its packages and symlinks before root use. Set `<venv-python>` below to the verified `/usr/local/lib/evem-deploy/runtime/bin/python` only if these gates still pass.

Before running `inspect`, verify the candidate is the reviewed commit, the script hash matches the reviewed file, the release bundle is staged but not live, the server reports MySQL 8.0.37, and the source `django_migrations` plan is precisely `TacticalCollaboration.0007_multiboard_pirate`. The audited baseline is one tactical organization, three Reports and four Forces. Any changed count, same-count content change, partial 0007 table/column or extra migration must stop this run and trigger a new review. The source and every other base table must be InnoDB for a consistent `--single-transaction` full-schema dump. `inspect` also rejects **any** source MySQL Event, enabled or disabled: this dump intentionally omits `--events`, while restoring active events into same-host QA could execute against live objects. The administrator option-file account must have a **direct** global or source-schema `EVENT`/`ALL PRIVILEGES` grant; the code checks `SHOW GRANTS FOR CURRENT_USER()` before trusting `INFORMATION_SCHEMA.EVENTS`, and rejects role-only/unparseable grants or any partial `REVOKE` rather than interpreting an empty result as no events. The administrator connection rechecks this gate before backup, rehearsal and migration. Events require a separately designed, isolated backup/rehearsal plan; do not simply add `--events`.

Prepare a new root-owned backup root with mode `0700`, a new direct-child backup directory name (do **not** create that child; `backup` creates it), and a root-owned MySQL client option file with mode `0600` using an account allowed to dump the source, create a fresh QA schema, import it and inspect its metadata. The option file must have only one `[client]` group and connection keys (`host`, `port`, `user`, `password`, `socket`, `protocol`, `default-character-set`); includes, command-specific groups and other options are rejected. The MySQL CLI uses `--defaults-file`, not `--defaults-extra-file`, to avoid global option overrides. The option file must point to the **same** MySQL server as Django. The candidate backend contains no `.env`; pass `--env-file` naming the exact `env_file` in root-managed `/EVEMTK/deploy/config.json`. The script parses it as data, never shell-sources it. This controlled `.env` must explicitly contain `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`; missing fields must not fall back to an inherited shell variable, and the actual Django default connection fields are compared to these values without printing the password. All private files must be root-owned and not world-readable; a trusted group-readable `0640` env/config file is accepted, but group-writable or world-readable is rejected. The 2026-09-24 read-only metadata check found the configured production `.env` at mode `0644 root:root`, so this gate currently **fails**. Have the operator resolve the permissions without breaking the service user's access, then recheck; do not copy the secret file into a release or print its contents.

Before the same-host backup/restore, inspect `df -B1` for both the backup path and MySQL `datadir`, MySQL schema `DATA_LENGTH + INDEX_LENGTH` from `information_schema.TABLES`, existing free inode count and any disk quota. Reserve enough space for the full dump, a second complete QA schema, MySQL migration/rebuild temporary space and log growth, not just the three tactical rows. Record the actual estimates and headroom. If the backup root and `datadir` share a filesystem, account for **both** copies on that same free-space figure; insufficient headroom is a stop condition. Do not run a destructive cleanup to make room without a separate reviewed plan.

Explicitly suspend automated publish (`EVEM_AUTO_DEPLOY=false` / no competing Production workflow) and take a maintenance window. Before `backup`, put the affected write endpoints into maintenance and **actually stop or isolate every writer**: the WSGI `evem-backend.service`, the WebSocket `evem-tactical-asgi.service` if installed, and any jobs or operator scripts that can modify tactical tables. Enumerate the active services/processes and verify no sessions are issuing tactical writes; note that a quiet process list is supplementary evidence, not a proof. Keep the write freeze in force through backup, QA restore/migration and production 0007. Record time, services stopped, observed source counts/fingerprints and responsible operator. The `--maintenance-confirmed` switch is only an operator attestation: the script cannot enforce or prove a real freeze. Do not start old pre-multiboard code against the migrated database.

From the candidate backend directory, with the **operator-verified root-controlled** Python environment containing Django/mysqlclient, run the following commands in order. `-I` prevents inherited `PYTHONPATH`, user site-packages and the untrusted current directory from influencing startup; the script adds the verified candidate backend to `sys.path` only after ownership checks. Placeholder paths must be replaced by inspected absolute paths, not shell wildcards. Run as root, the owner of the private credentials and directories; do not log secret values. Review each output before the next step.

```sh
cd <staged-candidate-backend>
<venv-python> -I /usr/local/lib/evem-deploy/tactical_multiboard_preflight.py inspect \
  --env-file <configured-private-env>
<venv-python> -I /usr/local/lib/evem-deploy/tactical_multiboard_preflight.py backup \
  --env-file <configured-private-env> --mysql-options-file <private-client-cnf> \
  --backup-dir /EVEMTK/deploy-backups/<new-run-id>
<venv-python> -I /usr/local/lib/evem-deploy/tactical_multiboard_preflight.py rehearse \
  --env-file <configured-private-env> --mysql-options-file <private-client-cnf> \
  --backup-dir /EVEMTK/deploy-backups/<new-run-id>
<venv-python> -I /usr/local/lib/evem-deploy/tactical_multiboard_preflight.py migrate \
  --env-file <configured-private-env> --mysql-options-file <private-client-cnf> \
  --backup-dir /EVEMTK/deploy-backups/<new-run-id> --maintenance-confirmed
```

`backup` records a private manifest and SHA-256 of a complete `mysqldump` with a final completion footer. `rehearse` restores that exact dump to a fresh `evem_tactical_qa_<12 hex>` schema on the same server and migrates **only the clone**; it checks row fingerprints, old-to-default-board mappings, scope, counts and the pirate index. A passed QA result is retained, not automatically deleted; repeating `rehearse` against the same manifest is refused. `migrate` requires that QA result, the same candidate/migration bytes/source identity/content, a dump no older than 24 hours, the retained QA schema and the explicit maintenance attestation. It rechecks immediately before DDL, migrates exactly 0007 and verifies all seven legacy tactical rows. Capture the command exit codes, manifest, dump SHA, clone identity and independent application checks in the release record.

MySQL DDL is not transactional across this migration. If `migrate` fails or the post-migration check fails, **leave services frozen**, preserve the dump, manifest and QA schema, inspect actual tables, columns, `django_migrations` and links, and formulate a DBA-approved restore/repair. Do not automatically retry, `--fake`, reverse the migration or switch the old release back on. The clone and backup are evidence, not an automatic rollback mechanism. A full database restore would affect unrelated website writes too, hence the requirement to freeze all relevant writes and explicitly plan recovery.

After successful 0007 verification, publish compatibility release **X** first: the new schema and board-aware backend with `TACTICAL_MULTIBOARD_WRITES_ENABLED=false`, so server-side creation of additional boards and pirate-first organizations remains disabled, while the existing frontend remains. Explicitly restart **both** `evem-backend.service` (WSGI) and `evem-tactical-asgi.service` (if installed) and verify new process identities and live behavior, not merely the `.env` text. Verify tactical read/write and historical 1/3/4 ownership under X before re-opening normal traffic. Only then set `TACTICAL_MULTIBOARD_WRITES_ENABLED=true` for **Y**, explicitly restart WSGI and ASGI again, and verify the running backend has enabled it **before** exposing Y's board-creation UI. A frontend-only Y artifact would not restart the backend through `release.py changed_components`; never rely on publish for this flag transition. A guarded, authenticated duplicate-name board-creation probe in an organization with fewer than three boards can distinguish the disabled 403 from enabled duplicate-name 409 without creating a board; verify row count is unchanged and ensure the probe is valid apart from duplicate name. Then publish Y and test the two board types and permissions. For Y→X rollback, first set the flag false and explicitly restart/verify WSGI and ASGI, **then** switch the frontend; do not rely on a frontend-only rollback to reload settings. X understands board IDs, so this is a **data-isolation** rollback point, not a promise of full old-UI functionality: a pirate-first organization created under Y has no default war board, and X's old frontend may receive 404 for its board-id-less snapshot/map until Y is restored or a reviewed compatibility UI is supplied. Data is not mixed or deleted by that 404. Once a second board receives data, neither application rollback nor database reverse migration to the original pre-0007 release is safe: its tactical queries are organization-wide and can mix data from distinct boards. Keep X and the verified dump available until Y is accepted. Re-enable automatic deploy only after the release has passed health, authorization and data-isolation checks.
