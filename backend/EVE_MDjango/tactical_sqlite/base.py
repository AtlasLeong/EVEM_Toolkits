from django.conf import settings
from django.db.backends.sqlite3.base import DatabaseWrapper as SQLiteWrapper


class DatabaseWrapper(SQLiteWrapper):
    def _start_transaction_under_autocommit(self):
        if not getattr(settings, 'TACTICAL_LOCAL_DEMO', False):
            raise RuntimeError('Tactical SQLite backend is for the isolated demo only')
        # SQLite has no row locks. Reserve its single writer before reads, so
        # read-to-write upgrades cannot fail immediately during HTTP/WS overlap.
        # This serializes LOCAL transactions; it is not MySQL capacity evidence.
        self.cursor().execute('BEGIN IMMEDIATE')
