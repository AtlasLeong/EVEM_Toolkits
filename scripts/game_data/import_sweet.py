#!/usr/bin/env python3
"""Append-only, version-isolated SWEET SQLite archival import into MySQL 8.

This is an operator tool, not an application endpoint or Django migration.
No raw source records, credentials, or connection exception details are logged.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import struct
import sys


APPROVED_SHA256 = "c47d33925de2d61c44880dfc2fd45e41ada168c596961deb696ecefc8818dd6a"
APPROVED_VERSION = 218811
APPROVED_COUNTS = {"attributes": 3015, "categories": 68, "effects": 269,
    "gold_nano_attr_class": 29, "groups": 1451, "implants": 1347,
    "item_attributes": 467069, "item_bonus_text": 1489, "item_effects": 69251,
    "item_modifiers": 139130, "item_nanocore_affix": 1859, "item_nanocores": 3044,
    "items": 55373, "level_attribute": 78, "localised_strings": 98405,
    "market_group": 659, "modifier_definition": 3885, "modifier_value": 44539,
    "npc_equipment": 754, "ship_modes": 2, "ship_nanocore": 7856, "unit": 58}
SOURCE_URL = "https://sweet.meise.blue/game_data/echoes_db.tbz"
SOURCE_LAST_MODIFIED = "2025-12-25T16:27:55Z"
FORMAT = "sweet-row-v1"
COLLATION = "utf8mb4_0900_bin"  # MySQL 8 NO PAD: trailing spaces are significant.
ROWID = "_sweet_rowid"
META = "_sweet_snapshot"
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}\Z")
SCHEMA = re.compile(r"evem_sweet_[1-9][0-9]{0,9}_[a-f0-9]{16}(?:_r[0-9]{1,8})?\Z")


class ImportRefused(ValueError):
    """A safe-to-display validation failure without source data or secrets."""


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ImportRefused("unsupported SQL identifier")
    return "`" + value + "`"


def validate_target_schema(value):
    if not isinstance(value, str) or not SCHEMA.fullmatch(value) or len(value) > 64:
        raise ImportRefused("target must be a versioned evem_sweet schema")
    return value


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def canonical_row(row):
    """Unambiguous typed binary encoding, including exact IEEE-754 double bits."""
    chunks = [b"R", struct.pack(">I", len(row))]
    for value in row:
        if value is None:
            chunks.append(b"N")
        elif type(value) is int:
            chunks.append(b"I" + struct.pack(">q", value))
        elif type(value) is float and math.isfinite(value):
            chunks.append(b"F" + struct.pack(">d", value))
        elif isinstance(value, (str, bytes)):
            data = value.encode("utf-8", errors="strict") if isinstance(value, str) else value
            chunks.append((b"T" if isinstance(value, str) else b"B") + struct.pack(">Q", len(data)) + data)
        else:
            raise ImportRefused("unsupported or non-finite source value")
    return b"".join(chunks)


def digest_rows(rows):
    digest = hashlib.sha256(FORMAT.encode("ascii") + b"\x00")
    count = 0
    for row in rows:
        digest.update(canonical_row(row))
        count += 1
    return count, digest.hexdigest()


@contextmanager
def open_source(path, expected_sha):
    path = Path(path).resolve(strict=True)
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha):
        raise ImportRefused("expected SHA256 must be 64 lowercase hex characters")
    # A WAL could contain rows not represented by the pinned main-file SHA256.
    if Path(str(path) + "-wal").exists() or Path(str(path) + "-journal").exists():
        raise ImportRefused("source must be a closed, standalone SQLite snapshot")
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        connection.execute("SELECT count(*) FROM sqlite_master").fetchone()
        if sha256_file(path) != expected_sha:
            raise ImportRefused("source SHA256 does not match the pinned snapshot")
        yield connection
        if sha256_file(path) != expected_sha:
            raise ImportRefused("source SHA256 changed during processing")
    finally:
        connection.close()


def iter_source_rows(connection, table, batch_size=250):
    if not 1 <= batch_size <= 1000:
        raise ImportRefused("batch size must be between 1 and 1000")
    names = ", ".join(identifier(c["name"]) for c in table["columns"])
    cursor = connection.execute(f"SELECT rowid, {names} FROM {identifier(table['name'])} ORDER BY rowid")
    while True:
        rows = cursor.fetchmany(batch_size)
        if not rows:
            return
        yield from rows


def source_columns(connection, name):
    columns = connection.execute(f"PRAGMA table_xinfo({identifier(name)})").fetchall()
    if columns:
        return columns
    # Older system SQLite (including production's 3.7.17) silently ignores xinfo.
    # Those versions cannot parse generated columns; modern xinfo flags stay intact.
    return [tuple(row) + (0,) for row in connection.execute(f"PRAGMA table_info({identifier(name)})")]


def inspect_source(path, expected_sha, expected_version=None, expected_counts=None):
    with open_source(path, expected_sha) as connection:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ImportRefused("SQLite integrity_check failed")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if expected_version is not None and version != expected_version:
            raise ImportRefused("source version does not match")
        objects = connection.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        if any(kind in ("trigger", "view") for kind, _, _ in objects):
            raise ImportRefused("views and triggers are not supported in archival snapshots")
        tables = []
        for kind, name, sql in objects:
            if kind != "table":
                continue
            identifier(name)
            if name.lower().startswith("_sweet_") or "WITHOUT ROWID" in sql.upper() or "VIRTUAL TABLE" in sql.upper():
                raise ImportRefused("unsupported table or missing source rowid")
            columns = []
            primary = []
            for _, col, declared, notnull, default, pk, hidden in source_columns(connection, name):
                identifier(col)
                if hidden or col.lower() in ("rowid", "oid", "_rowid_", ROWID):
                    raise ImportRefused("hidden columns or shadowed rowid are not supported")
                types = [row[0] for row in connection.execute(
                    f"SELECT DISTINCT typeof({identifier(col)}) FROM {identifier(name)} WHERE {identifier(col)} IS NOT NULL")]
                allowed = {"INTEGER": "integer", "REAL": "real", "TEXT": "text", "BLOB": "blob", "": None}
                declared = declared.upper()
                if declared not in allowed or len(types) > 1 or (types and allowed[declared] not in (None, types[0])):
                    raise ImportRefused(f"unsupported or mixed storage types in {name}.{col}")
                storage = types[0] if types else allowed[declared]
                mysql_type = {"integer": "BIGINT", "real": "DOUBLE", "text": "LONGTEXT", "blob": "LONGBLOB", None: "LONGBLOB"}[storage]
                if pk and mysql_type != "BIGINT":
                    raise ImportRefused("only integer source primary keys are supported losslessly")
                columns.append({"name": col, "declared_type": declared, "storage_type": storage,
                                "mysql_type": mysql_type, "notnull": bool(notnull), "default_sql": default})
                if pk:
                    primary.append((pk, col))
            if not columns:
                raise ImportRefused("source table has no visible columns")
            table = {"name": name, "sqlite_sql": sql, "columns": columns,
                     "primary_key": [col for _, col in sorted(primary)]}
            table["row_count"], table["digest"] = digest_rows(iter_source_rows(connection, table))
            tables.append(table)
        counts = {table["name"]: table["row_count"] for table in tables}
        if not tables or (expected_counts is not None and counts != expected_counts):
            raise ImportRefused("source table names or row counts do not match the pinned snapshot")
        return {"format": FORMAT, "source_sha256": expected_sha, "source_version": version,
                "source_size": Path(path).stat().st_size, "table_count": len(tables),
                "row_count": sum(counts.values()), "tables": tables,
                "source_url": SOURCE_URL if expected_sha == APPROVED_SHA256 else None,
                "source_last_modified": SOURCE_LAST_MODIFIED if expected_sha == APPROVED_SHA256 else None,
                "scope_note": "Raw third-party snapshot; not guaranteed current or complete for CN. No artwork included."}


def json_manifest(report):
    return json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def target_for(report):
    return validate_target_schema(f"evem_sweet_{report['source_version']}_{report['source_sha256'][:16]}")


def checked_target(report, schema):
    expected = target_for(report)
    schema = validate_target_schema(schema or expected)
    if schema != expected and not re.fullmatch(re.escape(expected) + r"_r[0-9]{1,8}", schema):
        raise ImportRefused("target schema does not identify this source version and SHA256")
    return schema


@contextmanager
def db_cursor(connection):
    cursor = connection.cursor()
    try:
        yield cursor
    finally:
        cursor.close()


def one(connection, sql, params=()):
    with db_cursor(connection) as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone()


def check_server(connection):
    version = one(connection, "SELECT VERSION()")[0]
    if not re.match(r"8\.", version) or "mariadb" in version.lower():
        raise ImportRefused("this importer requires MySQL 8 for exact NO PAD binary collation")
    modes = set(one(connection, "SELECT @@SESSION.sql_mode")[0].split(","))
    if not modes.intersection({"STRICT_TRANS_TABLES", "STRICT_ALL_TABLES"}):
        raise ImportRefused("strict MySQL SQL mode is required")
    if one(connection, "SELECT @@max_allowed_packet")[0] < 8 * 1024 * 1024:
        raise ImportRefused("max_allowed_packet must be at least 8 MiB")


def create_table_sql(schema, table):
    validate_target_schema(schema)
    definitions = [f"{identifier(ROWID)} BIGINT NOT NULL PRIMARY KEY"]
    for column in table["columns"]:
        mysql_type = column["mysql_type"]
        if mysql_type not in ("BIGINT", "DOUBLE", "LONGTEXT", "LONGBLOB"):
            raise ImportRefused("unsupported target type")
        definitions.append(f"{identifier(column['name'])} {mysql_type}" + (" NOT NULL" if column["notnull"] else " NULL"))
    if table["primary_key"]:
        definitions.append("UNIQUE KEY `source_primary_key` (" + ", ".join(identifier(c) for c in table["primary_key"]) + ")")
    return f"CREATE TABLE {identifier(schema)}.{identifier(table['name'])} (" + ", ".join(definitions) + f") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={COLLATION}"


def bounded_batches(rows, batch_size):
    batch, byte_count = [], 0
    for row in rows:
        # Conservative SQL-escaping expansion budget; a single huge record fails closed.
        size = len(canonical_row(row)) * 2 + 1024
        if size > 4 * 1024 * 1024:
            raise ImportRefused("one row exceeds the bounded 4 MiB transfer budget")
        if batch and (len(batch) >= batch_size or byte_count + size > 4 * 1024 * 1024):
            yield batch
            batch, byte_count = [], 0
        batch.append(row)
        byte_count += size
    if batch:
        yield batch


def import_snapshot(connection, path, report, schema=None, batch_size=250, progress=None):
    schema = checked_target(report, schema)
    if not 1 <= batch_size <= 1000:
        raise ImportRefused("batch size must be between 1 and 1000")
    check_server(connection)
    if one(connection, "SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=%s", (schema,)):
        raise ImportRefused("target schema already exists; no overwrite or resume is permitted")
    # Reinspect the pinned source, not a caller-modified or stale inspection report.
    fresh = inspect_source(path, report["source_sha256"], expected_version=report["source_version"])
    if fresh != report:
        raise ImportRefused("inspection report differs from the pinned source")
    manifest = json_manifest(report)
    manifest_hash = hashlib.sha256(manifest.encode("utf-8")).hexdigest()
    with open_source(path, report["source_sha256"]) as source:
        with db_cursor(connection) as cursor:
            # No IF NOT EXISTS: a concurrent creator must cause failure, never adoption.
            cursor.execute(f"CREATE DATABASE {identifier(schema)} CHARACTER SET utf8mb4 COLLATE {COLLATION}")
            cursor.execute(f"CREATE TABLE {identifier(schema)}.{identifier(META)} (id BIGINT NOT NULL PRIMARY KEY, state VARCHAR(16) NOT NULL, manifest LONGTEXT NOT NULL, manifest_sha256 CHAR(64) NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), verified_at TIMESTAMP(6) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE={COLLATION}")
            cursor.execute(f"INSERT INTO {identifier(schema)}.{identifier(META)} (id,state,manifest,manifest_sha256) VALUES (1,%s,%s,%s)", ("loading", manifest, manifest_hash))
        connection.commit()
        try:
            for table in report["tables"]:
                with db_cursor(connection) as cursor:
                    cursor.execute(create_table_sql(schema, table))
                    columns = [ROWID] + [c["name"] for c in table["columns"]]
                    sql = f"INSERT INTO {identifier(schema)}.{identifier(table['name'])} (" + ", ".join(identifier(c) for c in columns) + ") VALUES (" + ", ".join(["%s"] * len(columns)) + ")"
                    for batch in bounded_batches(iter_source_rows(source, table, batch_size), batch_size):
                        cursor.executemany(sql, batch)
                        connection.commit()
                if progress:
                    progress({"table": table["name"], "rows": table["row_count"], "state": "loaded"})
            verify_snapshot(connection, report, schema, required_state="loading")
            # The source read transaction stays open through verification.
            if sha256_file(path) != report["source_sha256"]:
                raise ImportRefused("source SHA256 changed before final verification")
            with db_cursor(connection) as cursor:
                cursor.execute(f"UPDATE {identifier(schema)}.{identifier(META)} SET state=%s, verified_at=CURRENT_TIMESTAMP(6) WHERE id=1 AND state=%s", ("verified", "loading"))
                if cursor.rowcount != 1:
                    raise ImportRefused("verification state transition failed")
            connection.commit()
        except BaseException:
            connection.rollback()
            # Keep the isolated partial schema for diagnosis. Never erase or restart it.
            raise
    return {"schema": schema, "state": "verified", "tables": report["table_count"], "rows": report["row_count"], "source_sha256": report["source_sha256"]}


def verify_snapshot(connection, report, schema=None, required_state="verified"):
    """Read-only complete content verification; never promotes a partial import."""
    schema = checked_target(report, schema)
    check_server(connection)
    with db_cursor(connection) as cursor:
        cursor.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s", (schema,))
        names = {row[0] for row in cursor.fetchall()}
    if names != {META, *(table["name"] for table in report["tables"])}:
        raise ImportRefused("target table set differs from the source manifest")
    saved = one(connection, f"SELECT state,manifest,manifest_sha256 FROM {identifier(schema)}.{identifier(META)} WHERE id=1")
    expected = json_manifest(report)
    if not saved or saved[0] != required_state or saved[1] != expected or saved[2] != hashlib.sha256(expected.encode("utf-8")).hexdigest():
        raise ImportRefused("target snapshot state or manifest mismatch")
    for table in report["tables"]:
        columns = [ROWID] + [c["name"] for c in table["columns"]]
        with db_cursor(connection) as cursor:
            cursor.execute(f"SELECT {', '.join(identifier(c) for c in columns)} FROM {identifier(schema)}.{identifier(table['name'])} ORDER BY {identifier(ROWID)}")
            def rows():
                while True:
                    batch = cursor.fetchmany(250)
                    if not batch:
                        return
                    yield from batch
            count, digest = digest_rows(rows())
        if count != table["row_count"] or digest != table["digest"]:
            raise ImportRefused(f"target row count or exact content digest mismatch in {table['name']}")
    return {"schema": schema, "state": required_state, "tables": report["table_count"], "rows": report["row_count"], "source_sha256": report["source_sha256"]}


def isolated_connection_params(original, cursorclass):
    params = dict(original)
    params.pop("database", None)
    params.pop("db", None)
    params.update(charset="utf8mb4", cursorclass=cursorclass)
    return params


def connect_via_django(backend_root):
    """Use existing private Django credentials; never accept passwords on argv."""
    root = Path(backend_root).resolve(strict=True)
    if not (root / "manage.py").is_file():
        raise ImportRefused("backend root must contain manage.py")
    os.chdir(root)
    sys.path.insert(0, str(root))
    os.environ["DJANGO_SETTINGS_MODULE"] = "EVE_MDjango.settings"
    import django
    django.setup()
    from django.db import connections
    import MySQLdb
    from MySQLdb.cursors import SSCursor
    django_connection = connections["default"]
    if django_connection.vendor != "mysql":
        raise ImportRefused("Django default connection must be MySQL")
    # Server-side cursor: verification must not buffer a whole 467k-row table.
    # A separate connection has no default schema, including the business database.
    params = isolated_connection_params(django_connection.get_connection_params(), SSCursor)
    connection = MySQLdb.connect(**params)
    connection.autocommit(False)
    return connection


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "import", "verify"))
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--backend-root", type=Path)
    parser.add_argument("--schema", help="optional matching versioned schema, or _r<number> rehearsal suffix")
    parser.add_argument("--batch-size", type=int, default=250)
    args = parser.parse_args(argv)
    try:
        source = args.source.resolve(strict=True)
        report = inspect_source(source, APPROVED_SHA256, APPROVED_VERSION, APPROVED_COUNTS)
        if args.command == "inspect":
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0
        if args.backend_root is None:
            raise ImportRefused("--backend-root is required for MySQL commands")
        connection = connect_via_django(args.backend_root)
        try:
            if args.command == "import":
                result = import_snapshot(connection, source, report, args.schema, args.batch_size,
                                         progress=lambda item: print(json.dumps(item), file=sys.stderr, flush=True))
            else:
                result = verify_snapshot(connection, report, args.schema)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            connection.close()
        return 0
    except ImportRefused as error:
        print("REFUSED: " + str(error), file=sys.stderr)
    except Exception as error:
        # Driver errors may include SQL/source rows or connection secrets.
        print("FAILED: " + type(error).__name__ + "; connection details and raw data suppressed", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
