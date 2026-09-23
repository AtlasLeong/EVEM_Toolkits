from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase, override_settings


class TacticalLocalDatabaseTests(SimpleTestCase):
    @override_settings(TACTICAL_LOCAL_DEMO=True)
    def test_demo_reserves_write_lock_before_transaction_reads(self):
        from EVE_MDjango.tactical_sqlite.base import DatabaseWrapper
        cursor = MagicMock()
        with patch.object(DatabaseWrapper, 'cursor', return_value=cursor):
            DatabaseWrapper({'NAME': ':memory:'})._start_transaction_under_autocommit()
        cursor.execute.assert_called_once_with('BEGIN IMMEDIATE')

    @override_settings(TACTICAL_LOCAL_DEMO=False)
    def test_demo_backend_refuses_non_demo_settings(self):
        from EVE_MDjango.tactical_sqlite.base import DatabaseWrapper
        with self.assertRaises(RuntimeError):
            DatabaseWrapper({'NAME': ':memory:'})._start_transaction_under_autocommit()
