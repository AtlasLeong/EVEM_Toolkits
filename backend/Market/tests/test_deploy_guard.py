from pathlib import Path
import stat
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase


class LockSpy:
    def __init__(self, busy=False):
        self.busy = busy
        self.acquired = 0
        self.released = 0

    def acquire(self, stream):
        if self.busy:
            raise BlockingIOError()
        self.acquired += 1

    def release(self, stream):
        self.released += 1


class CollectorDeployGuardTests(SimpleTestCase):
    def test_missing_lock_fails_closed(self):
        from Market.deploy_guard import CollectorUnavailable, collector_guard

        with TemporaryDirectory() as temporary:
            with self.assertRaises(CollectorUnavailable):
                with collector_guard(Path(temporary), lock_api=LockSpy()):
                    self.fail('collector must not run without a release lock')

    def test_busy_lock_does_not_enter_collection(self):
        from Market.deploy_guard import CollectorBusy, collector_guard

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / 'shared' / 'market'
            folder.mkdir(parents=True)
            (folder / 'collector.lock').touch()
            with self.assertRaises(CollectorBusy):
                with collector_guard(root, lock_api=LockSpy(busy=True)):
                    self.fail('collector must not run during publish')

    def test_unfinished_release_blocks_collection_after_lock(self):
        from Market.deploy_guard import CollectorBusy, collector_guard

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / 'shared' / 'market'
            folder.mkdir(parents=True)
            (folder / 'collector.lock').touch()
            (root / 'transaction.json').touch()
            lock = LockSpy()
            with self.assertRaises(CollectorBusy):
                with collector_guard(root, lock_api=lock):
                    self.fail('collector must not run during an unfinished release')
            self.assertEqual(lock.acquired, 1)
            self.assertEqual(lock.released, 1)

    def test_fifo_is_rejected_before_open_can_block(self):
        from Market.deploy_guard import CollectorUnavailable, collector_guard

        fake_info = SimpleNamespace(st_mode=stat.S_IFIFO | 0o600)
        with TemporaryDirectory() as temporary:
            with patch('pathlib.Path.lstat', return_value=fake_info):
                with patch('Market.deploy_guard.os.open', side_effect=AssertionError('FIFO must not be opened')) as opened:
                    with self.assertRaises(CollectorUnavailable):
                        with collector_guard(Path(temporary), lock_api=LockSpy()):
                            self.fail('collector must reject a FIFO lock')
                opened.assert_not_called()
