# SWEET raw snapshot import

This operator-only tool archives the approved SWEET snapshot in a **new, isolated MySQL 8 schema**. It does not publish a catalog, run Django migrations, add a Django database alias, edit application tables, or restart services. Dataset files must remain outside Git, web roots, release bundles, and public download endpoints.

## Pinned source and destination

- Source SQLite SHA256: `c47d33925de2d61c44880dfc2fd45e41ada168c596961deb696ecefc8818dd6a`
- SQLite `user_version`: `218811`
- Raw data: **22 tables / 899,630 rows**.
- Canonical schema: `evem_sweet_218811_c47d33925de2d61c`.
- Rehearsal schemas may add `_r<number>`, for example `_r1`.
- One additional `_sweet_snapshot` table stores provenance, original SQLite SQL, column/default/key metadata, source SHA256, row counts, typed content digests, and import state.

The CLI pins the SHA/version/table counts in code. Updating the source requires a reviewed code change. Library functions allow tiny synthetic sources for tests; the CLI does not accept arbitrary hashes.

Column inspection supports older system SQLite through `table_info` when `table_xinfo` is unavailable (such as the server's SQLite 3.7.17). Modern SQLite continues to use `table_xinfo` and reject hidden/generated columns. No server runtime upgrade is required.

The upstream HTTP modification time is 2025-12-25, not a guarantee of current CN game content. The archive has no artwork. Raw attributes are not computed fitting-panel values. Game-data redistribution rights are separate from the upstream software license; this tool does not grant such rights.

## Lossless mapping

Each raw table has `_sweet_rowid BIGINT PRIMARY KEY`, preserving source SQLite rowid, order, gaps, and duplicate records. Source integer primary keys are retained as named `UNIQUE KEY source_primary_key`; their original definition remains in metadata. Composite keys are not flattened. No-PK tables are not deduplicated.

| SQLite storage | MySQL storage |
| --- | --- |
| INTEGER | signed BIGINT |
| REAL | DOUBLE |
| TEXT | LONGTEXT, utf8mb4_0900_bin |
| BLOB | LONGBLOB |
| untyped, entirely NULL | nullable LONGBLOB |

`utf8mb4_0900_bin` is MySQL 8's binary **NO PAD** collation; trailing spaces remain significant. Text, embedded NUL, Unicode, nested JSON strings, NULL, and empty values are not transformed. Mixed incompatible storage classes, non-finite values, shadowed rowids, generated columns, virtual/without-rowid tables, triggers/views, and non-integer source primary keys fail closed. Column defaults are archived as source SQL, not executed in MySQL; archival writes always provide every field.

Verification hashes rows ordered by source rowid. Encoding uses explicit type tags and lengths, signed 64-bit integers, and `struct.pack('>d')` for exact double bits. It distinguishes NULL/empty/string/blob/integer/float and retains repeated rows. Every target row is read back, not just counted. Driver or server rounding therefore prevents promotion to verified.

## Safe rollout

Before importing, verify SSH host identity, database identity/version, new-schema CREATE permission, strict SQL mode, free disk space, a recent recoverable private production backup, and source/script hashes. Upload the database and script to a root-only folder outside served paths. Do not paste database credentials into shell commands or logs.

Use the server's existing backend virtualenv. Credentials are read internally from its private Django settings into a **separate connection with no default schema**; the existing Django connection configuration is not changed. All destination objects are explicitly schema-qualified. The tool requires MySQL 8, strict SQL mode, and `max_allowed_packet >= 8 MiB`.

Example commands (replace `/private/staging` with the operator's approved directory):

```sh
PYTHON=/usr/local/lib/evem-deploy/runtime/bin/python
SCRIPT=/private/staging/import_sweet.py
SOURCE=/private/staging/echoes.db
BACKEND=/EVEMTK/deploy/current/backend

# Read-only source audit; output includes schema/digests but no raw records.
"$PYTHON" "$SCRIPT" inspect --source "$SOURCE"

# Full rehearsal: creates only this fresh rehearsal schema.
"$PYTHON" "$SCRIPT" import --source "$SOURCE" --backend-root "$BACKEND" \
  --schema evem_sweet_218811_c47d33925de2d61c_r1
"$PYTHON" "$SCRIPT" verify --source "$SOURCE" --backend-root "$BACKEND" \
  --schema evem_sweet_218811_c47d33925de2d61c_r1

# After independently reviewing rehearsal evidence, import canonical snapshot.
"$PYTHON" "$SCRIPT" import --source "$SOURCE" --backend-root "$BACKEND"
"$PYTHON" "$SCRIPT" verify --source "$SOURCE" --backend-root "$BACKEND"
```

`import` refuses an existing schema before any write, including an already verified identical snapshot. There is no overwrite, resume, REPLACE, TRUNCATE, DROP, or cleanup command. Schema-name validation limits all writes to the exact source version/hash (optionally a rehearsal suffix). A concurrent CREATE fails rather than adopting someone else's schema.

The tool commits `loading` before raw rows, streams bounded batches (250 rows by default; conservative 4 MiB transfer budget), validates all target row counts/content digests, then commits `verified`. Verification uses a server-side cursor rather than buffering whole tables. Failure leaves the new schema isolated and incomplete (`loading` if metadata creation succeeded); it must not be consumed. A failure before metadata creation can leave an empty/partial schema. Preserve failed schemas for diagnosis, choose a fresh rehearsal suffix for another attempt, and obtain explicit cleanup authorization separately. The read-only `verify` command never promotes partial imports.

Success does not automatically grant application access or expose the data. A later feature should use a narrowly scoped read-only account and only a specifically verified version. Do not add cross-database Django foreign keys or global migrations for this raw snapshot.

## Tests and evidence

```sh
python -m unittest discover -s scripts/game_data/tests -v
```

Synthetic fixture tests cover typed digests, exact float distinction, 64-bit IDs, Unicode/NUL/BLOB, duplicate rows/rowid gaps, composite keys, strict-mode/schema/hash/type rejection, connection isolation, batching, full verification before promotion, and failure remaining loading. DB-API boundary doubles do **not** replace a full MySQL 8 rehearsal; run the pinned 899,630-row import and independent verify before treating a deployment as successful.
