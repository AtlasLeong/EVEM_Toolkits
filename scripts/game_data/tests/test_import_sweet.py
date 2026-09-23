"""Small synthetic fixtures only: no licensed game records are committed."""
import hashlib
import importlib.util
from contextlib import closing
import math
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "import_sweet.py"
spec = importlib.util.spec_from_file_location("import_sweet", MODULE_PATH)
subject = importlib.util.module_from_spec(spec) if MODULE_PATH.exists() else None
if subject is not None:
    sys.modules[spec.name] = subject
    spec.loader.exec_module(subject)


class ImportSweetTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(subject, "lossless importer must be implemented")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "fixture.db"
        with closing(sqlite3.connect(self.source)) as db, db:
            db.executescript("""
                PRAGMA user_version=7;
                CREATE TABLE items(id INTEGER PRIMARY KEY, text TEXT, value REAL, extra BLOB);
                CREATE TABLE duplicates(code TEXT NOT NULL, value REAL);
                CREATE TABLE compound(a INTEGER NOT NULL, b INTEGER NOT NULL, PRIMARY KEY(a,b));
                CREATE TABLE untyped(value);
            """)
            db.executemany("INSERT INTO items VALUES(?,?,?,?)", [
                (2**40, "山岳\x00🚀", 0.12345678901234566, b"\x00\xff"),
                (2**40 + 1, "", None, b""),
                (2**40 + 2, None, -1.125, None),
            ])
            db.executemany("INSERT INTO duplicates(rowid,code,value) VALUES(?,?,?)", [
                (2, "same", 1.0), (9, "same", 1.0),
            ])
            db.execute("INSERT INTO compound VALUES(1,2)")
            db.execute("INSERT INTO untyped VALUES(NULL)")
        self.source_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()

    def inspect(self):
        return subject.inspect_source(self.source, self.source_hash, expected_version=7)

    def test_digest_preserves_type_boundaries_duplicates_and_float_bits(self):
        rows = [(), (None,), ("",), (b"",), (1,), (1.0,), (-0.0,), (0.0,),
                ("a", "bc"), ("ab", "c"), ("🚀\x00",),
                (0.12345678901234566,), (math.nextafter(0.12345678901234566, 1.0),)]
        digests = [subject.digest_rows([row])[1] for row in rows]
        self.assertEqual(len(digests), len(set(digests)))
        self.assertNotEqual(subject.digest_rows([(1,)])[1],
                            subject.digest_rows([(1,), (1,)])[1])

    def test_source_inspection_preserves_bigint_text_blob_rowid_and_keys(self):
        report = self.inspect()
        self.assertEqual(report["row_count"], 7)
        self.assertEqual(report["table_count"], 4)
        tables = {table["name"]: table for table in report["tables"]}
        columns = {c["name"]: c for c in tables["items"]["columns"]}
        self.assertEqual(columns["id"]["mysql_type"], "BIGINT")
        self.assertEqual(columns["text"]["mysql_type"], "LONGTEXT")
        self.assertEqual(columns["value"]["mysql_type"], "DOUBLE")
        self.assertEqual(columns["extra"]["mysql_type"], "LONGBLOB")
        self.assertEqual(tables["compound"]["primary_key"], ["a", "b"])
        self.assertIn("PRIMARY KEY", tables["items"]["sqlite_sql"])
        with closing(sqlite3.connect(self.source)) as db:
            rows = list(subject.iter_source_rows(db, tables["duplicates"], batch_size=1))
        self.assertEqual(rows, [(2, "same", 1.0), (9, "same", 1.0)])
        self.assertEqual(tables["duplicates"]["digest"], subject.digest_rows(rows)[1])

    def test_wrong_hash_and_version_refused_before_inspection(self):
        with self.assertRaisesRegex(subject.ImportRefused, "SHA256"):
            subject.inspect_source(self.source, "0" * 64)
        with self.assertRaisesRegex(subject.ImportRefused, "version"):
            subject.inspect_source(self.source, self.source_hash, expected_version=8)

    def test_mixed_storage_types_refused_without_coercion(self):
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute("INSERT INTO untyped VALUES(1)")
            db.execute("INSERT INTO untyped VALUES('1')")
        sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        with self.assertRaisesRegex(subject.ImportRefused, "storage"):
            subject.inspect_source(self.source, sha)

    def test_invalid_schema_names_refused(self):
        for schema in ["eve_echoes", "mysql", "evem_sweet_7_x;DROP DATABASE mysql",
                       "evem_sweet_7_deadbeef`", "evem_sweet_7_deadbeef", "EVEM_SWEET_7_" + "a" * 16]:
            with self.subTest(schema=schema), self.assertRaises(subject.ImportRefused):
                subject.validate_target_schema(schema)
        self.assertEqual(subject.validate_target_schema("evem_sweet_7_" + "a" * 16),
                         "evem_sweet_7_" + "a" * 16)

    def test_unsupported_source_identifiers_and_shadow_rowid_are_refused(self):
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute("CREATE TABLE shadow(rowid INTEGER)")
        sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        with self.assertRaisesRegex(subject.ImportRefused, "rowid"):
            subject.inspect_source(self.source, sha)

    def test_existing_schema_causes_no_mutating_statements(self):
        connection = RecordingConnection(existing=True)
        with self.assertRaisesRegex(subject.ImportRefused, "already exists"):
            subject.import_snapshot(connection, self.source, self.inspect())
        self.assertTrue(connection.statements)
        self.assertTrue(all(sql.lstrip().startswith("SELECT") for sql, _ in connection.statements))

    def test_non_strict_session_causes_no_mutating_statements(self):
        connection = RecordingConnection(strict=False)
        with self.assertRaisesRegex(subject.ImportRefused, "strict"):
            subject.import_snapshot(connection, self.source, self.inspect())
        self.assertTrue(all(sql.lstrip().startswith("SELECT") for sql, _ in connection.statements))

    def test_ddl_keeps_source_keys_and_exact_collation(self):
        tables = {t["name"]: t for t in self.inspect()["tables"]}
        ddl = subject.create_table_sql("evem_sweet_7_" + "a" * 16, tables["compound"])
        self.assertIn("`_sweet_rowid` BIGINT NOT NULL PRIMARY KEY", ddl)
        self.assertIn("UNIQUE KEY `source_primary_key` (`a`, `b`)", ddl)
        self.assertIn("utf8mb4_0900_bin", ddl)

    def test_connection_parameters_never_select_business_database(self):
        self.assertTrue(callable(getattr(subject, "isolated_connection_params", None)),
                        "connection configuration must isolate the selected database")
        original = {"database": "eve_echoes", "db": "eve_echoes", "user": "private",
                    "password": "not-a-real-secret", "charset": "utf8"}
        result = subject.isolated_connection_params(original, object)
        self.assertNotIn("database", result)
        self.assertNotIn("db", result)
        self.assertEqual(result["charset"], "utf8mb4")
        self.assertEqual(original["database"], "eve_echoes")

    def test_full_import_verifies_all_rows_before_promotion(self):
        connection = MemoryImportConnection()
        result = subject.import_snapshot(connection, self.source, self.inspect(), batch_size=1)
        self.assertEqual(result["state"], "verified")
        self.assertEqual(connection.state, "verified")
        self.assertEqual(connection.raw_rows["duplicates"], [(2, "same", 1.0), (9, "same", 1.0)])
        self.assertEqual(connection.raw_rows["items"][0][2], "山岳\x00🚀")
        self.assertGreaterEqual(connection.commits, 9)
        self.assertEqual(subject.verify_snapshot(connection, self.inspect())["rows"], 7)

    def test_corrupted_target_remains_loading_and_cannot_verify(self):
        connection = MemoryImportConnection(corrupt=True)
        with self.assertRaisesRegex(subject.ImportRefused, "digest mismatch"):
            subject.import_snapshot(connection, self.source, self.inspect())
        self.assertEqual(connection.state, "loading")
        self.assertEqual(connection.rollbacks, 1)
        with self.assertRaisesRegex(subject.ImportRefused, "state or manifest mismatch"):
            subject.verify_snapshot(connection, self.inspect())

    def test_unexpected_extra_table_prevents_verified_state(self):
        connection = MemoryImportConnection(extra_table=True)
        with self.assertRaisesRegex(subject.ImportRefused, "table set"):
            subject.import_snapshot(connection, self.source, self.inspect())
        self.assertEqual(connection.state, "loading")

    def test_bounded_batches_limit_size_and_reject_oversized_row(self):
        self.assertEqual(list(subject.bounded_batches([(1,), (2,), (3,)], 2)),
                         [[(1,), (2,)], [(3,)]])
        with self.assertRaisesRegex(subject.ImportRefused, "transfer budget"):
            list(subject.bounded_batches([("a" * (3 * 1024 * 1024),)], 1))

    def test_source_change_between_inspection_and_import_prevents_writes(self):
        report = self.inspect()
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute("INSERT INTO duplicates VALUES('new',1.5)")
        connection = RecordingConnection()
        with self.assertRaisesRegex(subject.ImportRefused, "SHA256"):
            subject.import_snapshot(connection, self.source, report)
        self.assertTrue(all(sql.lstrip().startswith("SELECT") for sql, _ in connection.statements))

    def test_foreign_version_schema_prevents_any_database_access(self):
        connection = RecordingConnection()
        with self.assertRaisesRegex(subject.ImportRefused, "does not identify"):
            subject.import_snapshot(connection, self.source, self.inspect(), "evem_sweet_8_" + "a" * 16)
        self.assertEqual(connection.statements, [])

    def test_old_sqlite_without_table_xinfo_uses_table_info(self):
        self.assertTrue(callable(getattr(subject, "source_columns", None)),
                        "older SQLite needs table_info compatibility")
        with closing(sqlite3.connect(self.source)) as db:
            expected = db.execute("PRAGMA table_xinfo(items)").fetchall()
            class OldSQLite:
                def execute(self, sql):
                    if "table_xinfo" in sql:
                        return db.execute("SELECT 1 WHERE 0")
                    return db.execute(sql)
            self.assertEqual(subject.source_columns(OldSQLite(), "items"), expected)

    def test_modern_sqlite_keeps_generated_column_visibility(self):
        self.assertTrue(callable(getattr(subject, "source_columns", None)),
                        "column introspection must retain hidden-column flags")
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute("CREATE TABLE generated(a INTEGER, b INTEGER GENERATED ALWAYS AS(a+1))")
            columns = subject.source_columns(db, "generated")
            self.assertNotEqual(columns[-1][-1], 0)
        sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        with self.assertRaisesRegex(subject.ImportRefused, "hidden columns"):
            subject.inspect_source(self.source, sha)


class RecordingConnection:
    """Read-only DB-API boundary stub: no credentials or real database needed."""
    def __init__(self, existing=False, strict=True):
        self.statements = []
        self.existing = existing
        self.strict = strict

    def cursor(self):
        return RecordingCursor(self)


class RecordingCursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None

    def execute(self, sql, params=()):
        self.connection.statements.append((sql, params))
        if "SCHEMATA" in sql:
            self.result = (1,) if self.connection.existing else None
        elif "sql_mode" in sql:
            self.result = ("STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION" if self.connection.strict else "",)
        elif "VERSION()" in sql:
            self.result = ("8.0.37",)
        elif "max_allowed_packet" in sql:
            self.result = (67108864,)
        else:
            raise AssertionError("Unexpected database access: " + sql)

    def fetchone(self):
        return self.result

    def close(self):
        pass


class MemoryImportConnection(RecordingConnection):
    """A DB-API boundary double; actual MySQL collation/driver QA runs separately."""
    def __init__(self, corrupt=False, extra_table=False):
        super().__init__()
        self.raw_rows = {}
        self.state = None
        self.manifest = None
        self.manifest_hash = None
        self.commits = 0
        self.rollbacks = 0
        self.corrupt = corrupt
        self.extra_table = extra_table

    def cursor(self):
        return MemoryImportCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class MemoryImportCursor(RecordingCursor):
    def execute(self, sql, params=()):
        conn = self.connection
        self.rowcount = 0
        if sql.startswith("CREATE DATABASE"):
            conn.existing = True
        elif sql.startswith("CREATE TABLE"):
            table = sql.split("`", 4)[3]
            if table != subject.META:
                conn.raw_rows[table] = []
        elif sql.startswith("INSERT INTO") and subject.META in sql:
            conn.state, conn.manifest, conn.manifest_hash = params
        elif sql.startswith("SELECT TABLE_NAME"):
            self.result = [(subject.META,)] + [(name,) for name in conn.raw_rows]
            if conn.extra_table:
                self.result.append(("unexpected",))
        elif sql.startswith("SELECT state,manifest"):
            self.result = (conn.state, conn.manifest, conn.manifest_hash)
        elif sql.startswith("SELECT `" + subject.ROWID):
            table = sql.split(" FROM ")[1].split("`", 4)[3]
            self.result = list(conn.raw_rows[table])
            if conn.corrupt and table == "duplicates":
                self.result[0] = (2, "damaged", 1.0)
        elif sql.startswith("UPDATE"):
            conn.state = params[0]
            self.rowcount = 1
        else:
            return super().execute(sql, params)
        conn.statements.append((sql, params))

    def executemany(self, sql, rows):
        table = sql.split("`", 4)[3]
        self.connection.raw_rows[table].extend(rows)

    def fetchall(self):
        return self.result

    def fetchmany(self, size):
        result, self.result = self.result[:size], self.result[size:]
        return result


if __name__ == "__main__":
    unittest.main()
