import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'mysql_qa.py'
spec = importlib.util.spec_from_file_location('community_mysql_qa', SCRIPT)
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class SafetyTests(unittest.TestCase):
    def test_schema_requires_strict_qa_whitelist(self):
        for name in ('eve_echoes', 'mysql', 'evem_community_qa_', 'evem_community_qa_x;DROP DATABASE mysql', 'evem_community_qa_../root'):
            with self.subTest(name=name), self.assertRaises(qa.SafetyError):
                qa.validate_schema(name)
        self.assertEqual(qa.validate_schema('evem_community_qa_0123456789abcdef'), 'evem_community_qa_0123456789abcdef')

    def test_database_map_refuses_additional_alias_or_live_test_database(self):
        name = 'evem_community_qa_0123456789abcdef'
        safe = {'default': {'ENGINE': 'django.db.backends.mysql', 'NAME': name, 'TEST': {'NAME': name}}}
        qa.validate_database_map(safe, name)
        for mapping in ({**safe, 'license': safe['default']}, {'default': {**safe['default'], 'NAME': 'eve_echoes'}}, {'default': {**safe['default'], 'TEST': {'NAME': 'eve_echoes'}}}):
            with self.subTest(mapping=mapping), self.assertRaises(qa.SafetyError):
                qa.validate_database_map(mapping, name)

    def test_plan_does_not_read_credentials_or_connect(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            candidate = root / 'candidate'
            live = root / 'live'
            candidate.mkdir()
            live.mkdir()
            for app in ('Authentication', 'Community'):
                (candidate / app).mkdir()
                (candidate / app / 'models.py').write_text('', encoding='utf-8')
            with patch.object(qa, 'load_credentials', side_effect=AssertionError('must not read credentials')), patch.object(qa, 'run_rehearsal', side_effect=AssertionError('must not connect')):
                result = qa.main(['--candidate-backend', str(candidate), '--live-backend', str(live), '--database', 'evem_community_qa_0123456789abcdef'])
            self.assertEqual(result, 0)

    def test_execute_requires_exact_confirmation(self):
        with self.assertRaises(qa.SafetyError):
            qa.confirm_execution('evem_community_qa_0123456789abcdef', 'eve_echoes')

    def test_credential_loading_is_allowlisted_and_env_file_wins(self):
        with tempfile.TemporaryDirectory() as folder:
            backend = Path(folder)
            (backend / '.env').write_text('DB_NAME=eve_echoes\nDB_USER=private\nDB_PASSWORD=secret\nDB_HOST=localhost\nDB_PORT=3306\nOTHER_SECRET=not-loaded\n', encoding='utf-8')
            result = qa.load_credentials(backend, {'DB_PASSWORD': 'stale', 'OTHER_SECRET': 'no'})
            self.assertEqual(set(result), {'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT'})
            self.assertEqual(result['DB_PASSWORD'], 'secret')

    def test_admin_connection_never_selects_live_database_and_refuses_reuse(self):
        class Cursor:
            def __init__(self, exists):
                self.exists = exists
                self.sql = []
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def execute(self, sql, parameters=None): self.sql.append((sql, parameters))
            def fetchone(self): return (1,) if self.exists else None
        class Connection:
            def __init__(self, exists): self.cur = Cursor(exists)
            def cursor(self): return self.cur
            def close(self): pass
        name = 'evem_community_qa_0123456789abcdef'
        credentials = dict(DB_NAME='eve_echoes', DB_USER='private', DB_PASSWORD='secret', DB_HOST='localhost', DB_PORT='3306')
        connection = Connection(False)
        observed = {}
        def connector(**kwargs):
            observed.update(kwargs)
            return connection
        qa.create_schema(name, credentials, connector)
        self.assertNotIn('database', observed)
        self.assertNotIn('db', observed)
        self.assertEqual(len(connection.cur.sql), 2)
        self.assertIn('CREATE DATABASE `evem_community_qa_', connection.cur.sql[1][0])
        self.assertFalse(any('DROP' in sql for sql, _ in connection.cur.sql))
        with self.assertRaises(qa.SafetyError):
            qa.create_schema(name, credentials, lambda **_: Connection(True))


if __name__ == '__main__':
    unittest.main()
