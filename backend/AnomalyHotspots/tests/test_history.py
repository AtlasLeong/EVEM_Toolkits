"""Offline history contracts; synthetic counts only, never game credentials."""
import importlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


def rows(**counts):
    return [{'solar_system_id': int(identifier), 'destroy_num': count}
            for identifier, count in counts.items()]


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('AnomalyHotspots.history'), 'sanitized history module missing')
        self.api = importlib.import_module('AnomalyHotspots.history')
        self.clock_ms = 0
        clock = patch.object(self.api.time, 'time', side_effect=lambda: self.clock_ms / 1000)
        clock.start()
        self.addCleanup(clock.stop)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        if os.name == 'posix': self.directory.chmod(0o2750)

    def record(self, stamp, **counts):
        if type(stamp) is int and self.clock_ms < stamp <= 2**53 - 1: self.clock_ms = stamp
        self.api.record_success(self.directory, rows(**counts), now_ms=stamp)

    def test_expired_history_is_not_servable_without_a_new_collection(self):
        self.record(1000, **{'1': 1})
        self.record(2000, **{'1': 2})
        self.record(3000, **{'1': 3})
        self.clock_ms = 1000 + self.api.RETENTION_MS + 1
        value = self.api.read_changes(self.directory)
        self.assertEqual([item['id'] for item in value['intervals']], [3000])
        self.assertEqual(value['interval']['start_at_ms'], 2000)
        with self.assertRaises(self.api.HistoryError):
            self.api.read_changes(self.directory, interval=2000)
        self.clock_ms = 3000 + self.api.RETENTION_MS + 1
        value = self.api.read_changes(self.directory)
        self.assertEqual(value['status'], 'unavailable')
        self.assertEqual(value['systems'], [])
        self.assertEqual(value['intervals'], [])
        with self.assertRaises(self.api.HistoryError):
            self.api.read_changes(self.directory, interval=3000)

    def test_one_remaining_retained_sample_is_baseline_and_read_clock_is_strict(self):
        self.record(1000, **{'1': 1})
        self.record(2000, **{'1': 2})
        try: value = self.api.read_changes(self.directory, now_ms=1000 + self.api.RETENTION_MS + 1)
        except TypeError: self.fail('history reads need a deterministic retention clock')
        self.assertEqual(value['status'], 'baseline')
        for value in (True, -1, '1000', 2**53):
            with self.subTest(value=value), self.assertRaises(self.api.HistoryError):
                self.api.read_changes(self.directory, now_ms=value)

    def test_manifest_crash_has_only_one_bounded_staged_sample_of_headroom(self):
        self.assertEqual(getattr(self.api, 'MAX_STAGED_SAMPLES', None), 1,
                         'physical staging headroom must be explicit and bounded')
        self.record(1000, **{'1': 1})
        self.record(2000, **{'1': 2})
        committed_bytes = sum(path.stat().st_size for path in self.directory.glob('sample-*.json'))
        real_replace = os.replace
        def fail_manifest(source, target):
            if Path(target).name == 'manifest.json': raise OSError('simulated manifest crash')
            return real_replace(source, target)
        with patch.object(self.api, 'MAX_SAMPLES', 2), \
                patch.object(self.api, 'MAX_HISTORY_BYTES', committed_bytes), \
                patch.object(self.api.os, 'replace', side_effect=fail_manifest):
            for stamp in (3000, 4000, 5000):
                with self.assertRaises(self.api.HistoryError): self.record(stamp, **{'1': 3})
                samples = list(self.directory.glob('sample-*.json'))
                self.assertLessEqual(len(samples), 2 + self.api.MAX_STAGED_SAMPLES)
                self.assertLessEqual(sum(path.stat().st_size for path in samples),
                                     committed_bytes + self.api.MAX_SAMPLE_BYTES)
                self.assertTrue((self.directory / 'sample-1000.json').exists())
                self.assertTrue((self.directory / 'sample-2000.json').exists())
                manifest = json.loads((self.directory / 'manifest.json').read_text())
                self.assertEqual([item['id'] for item in manifest['samples']], [1000, 2000])
                self.assertFalse(list(self.directory.glob('.history-tmp-*')))
        self.assertEqual(self.api.MAX_PHYSICAL_HISTORY_BYTES,
            self.api.MAX_HISTORY_BYTES + self.api.MAX_SAMPLE_BYTES + 2 * self.api.MAX_MANIFEST_BYTES
            + self.api.MAX_ATTEMPT_BYTES)

    def test_budget_file_checks_reject_regular_looking_windows_reparse_points(self):
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o640, st_nlink=1, st_size=1,
                               st_file_attributes=getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400))
        with self.assertRaises(self.api.HistoryError): self.api._file_info(info, Mock(), 100)

    def test_attempt_history_status_is_fixed_enum_and_source_status_stays_distinct(self):
        try:
            self.api.record_attempt(self.directory, 'ok', now_ms=1000, system_count=2,
                                    history_status='unavailable')
        except TypeError: self.fail('history publication status must be separately recordable')
        self.assertEqual(self.api.read_attempts(self.directory), [
            {'at_ms': 1000, 'status': 'ok', 'system_count': 2, 'history_status': 'unavailable'}])
        for status in ('ok', 'disabled'):
            self.api.record_attempt(self.directory, 'network_error', now_ms=2000, history_status=status)
            self.assertEqual(self.api.read_attempts(self.directory)[0]['history_status'], status)
        for invalid in ('private exception', True, 1, {}):
            with self.subTest(invalid=invalid), self.assertRaises(self.api.HistoryError):
                self.api.record_attempt(self.directory, 'ok', now_ms=3000, history_status=invalid)

    def test_first_sample_is_baseline_not_invented_zero(self):
        self.assertEqual(self.api.read_changes(self.directory)['status'], 'unavailable')
        self.record(1000, **{'1': 40})
        value = self.api.read_changes(self.directory)
        self.assertEqual(value, {'version': 1, 'status': 'baseline', 'statistics_window': None,
                                'interval': None, 'coverage': {'comparable': 0, 'new': 0, 'missing': 0,
                                                            'negative': 0, 'unchanged': 0},
                                'systems': [], 'intervals': [], 'next_before': None})

    def test_signed_comparable_deltas_unknown_new_missing_and_true_elapsed(self):
        self.record(1000, **{'1': 10, '2': 20, '3': 30, '4': 40})
        self.api.record_attempt(self.directory, 'rate_limited', now_ms=600000)
        self.record(1201000, **{'1': 15, '2': 17, '3': 30, '5': 100})
        value = self.api.read_changes(self.directory)
        self.assertEqual(value['interval'], {'id': 1201000, 'start_at_ms': 1000,
                                            'end_at_ms': 1201000, 'elapsed_ms': 1200000})
        self.assertEqual(value['coverage'], {'comparable': 3, 'new': 1, 'missing': 1,
                                            'negative': 1, 'unchanged': 1})
        self.assertEqual(value['systems'], [
            {'solar_system_id': 1, 'previous_destroy_num': 10, 'destroy_num': 15, 'delta': 5},
            {'solar_system_id': 2, 'previous_destroy_num': 20, 'destroy_num': 17, 'delta': -3},
            {'solar_system_id': 3, 'previous_destroy_num': 30, 'destroy_num': 30, 'delta': 0}])
        self.assertIsNone(value['statistics_window'])

    def test_identical_later_counts_are_valid_interval_duplicate_is_idempotent(self):
        self.record(1000, **{'1': 10})
        before = {path.name: path.read_bytes() for path in self.directory.iterdir()}
        self.record(1000, **{'1': 10})
        self.assertEqual({path.name: path.read_bytes() for path in self.directory.iterdir()}, before)
        self.record(2000, **{'1': 10})
        self.assertEqual(self.api.read_changes(self.directory)['coverage']['unchanged'], 1)

    def test_conflicting_or_out_of_order_sample_preserves_committed_history(self):
        self.record(1000, **{'1': 10})
        self.record(2000, **{'1': 20})
        before = {path.name: path.read_bytes() for path in self.directory.iterdir()}
        for stamp, count in ((2000, 21), (500, 1), (1000, 10)):
            with self.subTest(stamp=stamp), self.assertRaises(self.api.HistoryError):
                self.record(stamp, **{'1': count})
            self.assertEqual({path.name: path.read_bytes() for path in self.directory.iterdir()}, before)

    def test_interval_selection_and_bounded_older_pagination(self):
        for stamp in range(1000, 7000, 1000): self.record(stamp, **{'1': stamp})
        value = self.api.read_changes(self.directory, limit=2)
        self.assertEqual([entry['id'] for entry in value['intervals']], [6000, 5000])
        self.assertEqual(value['next_before'], 5000)
        older = self.api.read_changes(self.directory, interval=3000, before=5000, limit=2)
        self.assertEqual([entry['id'] for entry in older['intervals']], [4000, 3000])
        self.assertEqual(older['interval']['id'], 3000)
        self.assertEqual(older['systems'][0]['delta'], 1000)
        for kwargs in ({'interval': True}, {'interval': '3000'}, {'before': -1},
                       {'limit': 0}, {'limit': 101}, {'limit': True}, {'interval': 9999}):
            with self.subTest(kwargs=kwargs), self.assertRaises(self.api.HistoryError):
                self.api.read_changes(self.directory, **kwargs)

    def test_retention_prunes_only_unreferenced_recognized_artifacts(self):
        untouched = self.directory / 'operator-notes.json'
        untouched.write_text('private operator file', encoding='utf-8')
        self.record(1000, **{'1': 1})
        self.record(2000, **{'1': 2})
        with patch.object(self.api, 'MAX_SAMPLES', 2): self.record(3000, **{'1': 3})
        self.assertEqual([entry['id'] for entry in self.api.read_changes(self.directory)['intervals']], [3000])
        self.assertFalse((self.directory / 'sample-1000.json').exists())
        self.assertTrue((self.directory / 'sample-2000.json').exists())
        self.assertEqual(untouched.read_text(), 'private operator file')
        self.record(3000 + self.api.RETENTION_MS + 1, **{'1': 4})
        self.assertEqual(self.api.read_changes(self.directory)['status'], 'baseline')

    def test_byte_budget_is_hard_bounded_and_never_drops_current_baseline(self):
        self.record(1000, **{'1': 1})
        one_size = (self.directory / 'sample-1000.json').stat().st_size
        with patch.object(self.api, 'MAX_HISTORY_BYTES', one_size * 2 + 4):
            for stamp in (2000, 3000, 4000): self.record(stamp, **{'1': 1})
            samples = list(self.directory.glob('sample-*.json'))
            self.assertLessEqual(sum(path.stat().st_size for path in samples), one_size * 2 + 4)
            self.assertEqual(len(samples), 2)
        with patch.object(self.api, 'MAX_HISTORY_BYTES', 1), self.assertRaises(self.api.HistoryError):
            self.record(5000, **{'1': 1})
        self.assertEqual(self.api.read_changes(self.directory)['interval']['id'], 4000)

    def test_manifest_failure_keeps_committed_samples_and_retry_recovers_orphan(self):
        self.record(1000, **{'1': 1})
        self.record(2000, **{'1': 2})
        real_replace = os.replace
        def fail_manifest(source, target):
            if Path(target).name == 'manifest.json': raise OSError('private path secret')
            return real_replace(source, target)
        with patch.object(self.api.os, 'replace', side_effect=fail_manifest), self.assertRaises(self.api.HistoryError) as caught:
            self.record(3000, **{'1': 3})
        self.assertNotIn('secret', str(caught.exception))
        self.assertEqual(self.api.read_changes(self.directory)['interval']['id'], 2000)
        self.assertTrue((self.directory / 'sample-1000.json').exists())
        self.assertTrue((self.directory / 'sample-2000.json').exists())
        self.record(3000, **{'1': 3})
        self.assertEqual(self.api.read_changes(self.directory)['interval']['id'], 3000)

    def test_sample_is_atomically_published_before_manifest_and_recovers_crash_temporary(self):
        self.record(1000, **{'1': 1})
        real_replace, real_link = os.replace, os.link
        published = []
        def observe_link(source, target, **kwargs):
            if Path(target).name == 'sample-2000.json':
                self.assertEqual(json.loads(Path(source).read_text())['collected_at_ms'], 2000)
                self.assertFalse(Path(target).exists())
                published.append(Path(target).name)
            return real_link(source, target, **kwargs)
        with patch.object(self.api.os, 'link', side_effect=observe_link):
            self.record(2000, **{'1': 2})
        self.assertEqual(published, ['sample-2000.json'])
        # Simulate a crash after atomic link and before temporary unlink.
        temporary = self.directory / '.history-tmp-crash123'
        os.link(self.directory / 'sample-2000.json', temporary)
        partial = self.directory / '.history-tmp-partial1'
        partial.write_bytes(b'{"version":')
        if os.name == 'posix': partial.chmod(0o640)
        self.record(3000, **{'1': 3})
        self.assertFalse(temporary.exists())
        self.assertFalse(partial.exists())
        self.assertTrue((self.directory / 'sample-2000.json').exists())
        self.assertEqual(self.api.read_changes(self.directory)['interval']['id'], 3000)

    def test_unknown_sample_shaped_artifact_is_not_deleted(self):
        self.record(1000, **{'1': 1})
        unknown = self.directory / 'sample-999.json'
        unknown.write_text('{"operator":"unknown"}', encoding='utf-8')
        if os.name == 'posix': unknown.chmod(0o640)
        with self.assertRaises(self.api.HistoryError): self.record(2000, **{'1': 2})
        self.assertEqual(unknown.read_text(), '{"operator":"unknown"}')

    def test_duplicate_retry_finishes_pruning_after_manifest_commit_crash(self):
        self.record(1000, **{'1': 1})
        self.record(2000, **{'1': 2})
        remove, calls = self.api._remove_orphans, []
        def crash_after_commit(*args):
            calls.append(1)
            if len(calls) == 2: raise OSError('simulated post-commit crash')
            return remove(*args)
        with patch.object(self.api, 'MAX_SAMPLES', 2), \
                patch.object(self.api, '_remove_orphans', side_effect=crash_after_commit), \
                self.assertRaises(self.api.HistoryError):
            self.record(3000, **{'1': 3})
        self.assertEqual(self.api.read_changes(self.directory)['interval']['id'], 3000)
        self.assertTrue((self.directory / 'sample-1000.json').exists())
        self.record(3000, **{'1': 3})
        self.assertFalse((self.directory / 'sample-1000.json').exists())
        self.assertTrue((self.directory / 'sample-2000.json').exists())

    def test_crash_before_temp_group_assignment_recovers_private_owned_temporary(self):
        # A POSIX mkstemp starts 0600 with the collector's primary group. A
        # crash may occur before assigning the dedicated read group.
        temporary = Mock()
        temporary.name, temporary.parents = '.history-tmp-private1', []
        temporary.is_symlink.return_value = False
        temporary.lstat.return_value = SimpleNamespace(st_mode=stat.S_IFREG | 0o600,
            st_nlink=1, st_size=10, st_uid=41, st_gid=99)
        directory = Mock()
        directory.iterdir.return_value = [temporary]
        owner = SimpleNamespace(st_uid=41, st_gid=42)
        with patch.object(self.api.os, 'name', 'posix'), patch.object(self.api, '_sync_directory'):
            try: self.api._cleanup_temporaries(directory, owner)
            except self.api.HistoryError: self.fail('collector-owned 0600 crash temporary must be recoverable')
        temporary.unlink.assert_called_once()

    def test_oversize_and_nonregular_history_files_fail_closed(self):
        self.record(1000, **{'1': 1})
        with patch.object(self.api, 'MAX_MANIFEST_BYTES', 1), self.assertRaises(self.api.HistoryError):
            self.api.read_changes(self.directory)
        with patch.object(self.api, 'MAX_SAMPLE_BYTES', 1), self.assertRaises(self.api.HistoryError):
            self.api.read_changes(self.directory)
        manifest = self.directory / 'manifest.json'
        manifest.unlink()
        manifest.mkdir()
        with self.assertRaises(self.api.HistoryError): self.api.read_changes(self.directory)

    def test_corrupt_or_missing_manifest_never_silently_reinitializes(self):
        self.record(1000, **{'1': 1})
        manifest = self.directory / 'manifest.json'
        for content in ('{"version":1,"version":1}', '{"secret":"never output"}', 'not json'):
            manifest.write_text(content, encoding='utf-8')
            with self.assertRaises(self.api.HistoryError): self.record(2000, **{'1': 2})
            with self.assertRaises(self.api.HistoryError): self.api.read_changes(self.directory)
            self.assertEqual(manifest.read_text(), content)
        manifest.unlink()
        with self.assertRaises(self.api.HistoryError): self.record(2000, **{'1': 2})
        self.assertTrue((self.directory / 'sample-1000.json').exists())

    def test_sample_tampering_unknown_fields_and_digest_fail_closed(self):
        self.record(1000, **{'1': 1})
        self.record(2000, **{'1': 2})
        sample = self.directory / 'sample-2000.json'
        good = sample.read_bytes()
        value = json.loads(good)
        value['systems'][0]['destroy_num'] = 3
        sample.write_text(json.dumps(value, separators=(',', ':')), encoding='utf-8')
        with self.assertRaises(self.api.HistoryError): self.api.read_changes(self.directory)
        sample.write_bytes(good)
        value = json.loads(good)
        value['private'] = 'secret'
        sample.write_text(json.dumps(value), encoding='utf-8')
        with self.assertRaises(self.api.HistoryError): self.record(3000, **{'1': 3})

    def test_strict_rows_timestamps_and_unsafe_paths(self):
        for value in ([{'solar_system_id': True, 'destroy_num': 1}],
                      [{'solar_system_id': 1, 'destroy_num': 1, 'private': 'secret'}],
                      [{'solar_system_id': 1, 'destroy_num': -1}]):
            with self.subTest(value=value), self.assertRaises(self.api.HistoryError):
                self.api.record_success(self.directory, value, now_ms=1000)
        for stamp in (True, -1, 2**53, '1000'):
            with self.subTest(stamp=stamp), self.assertRaises(self.api.HistoryError): self.record(stamp)
        for path in ('relative/history', '', self.directory / 'missing'):
            with self.subTest(path=path), self.assertRaises(self.api.HistoryError):
                self.api.record_success(path, [], now_ms=1000)
        with patch.object(Path, 'is_symlink', return_value=True), self.assertRaises(self.api.HistoryError):
            self.record(1000)

    def test_attempts_are_sanitized_bounded_and_do_not_advance_baseline(self):
        self.record(1000, **{'1': 5})
        for stamp in range(2000, 2201):
            self.api.record_attempt(self.directory, 'network_error', now_ms=stamp, system_count=0,
                                    session_slot='A', pool_size=7,
                                    audit={'rpc_count': 3, 'stage': 'authentication', 'reason': 'timeout',
                                           'token': 'private-token', 'endpoint': 'private-endpoint'})
        attempts = self.api.read_attempts(self.directory)
        self.assertEqual(len(attempts), 200)
        self.assertEqual(attempts[0], {'at_ms': 2200, 'status': 'network_error', 'system_count': 0,
                                      'session_slot': 'A', 'pool_size': 7, 'rpc_count': 3,
                                      'stage': 'authentication', 'reason': 'timeout'})
        self.assertNotIn('private-', json.dumps(attempts))
        self.assertEqual(self.api.read_changes(self.directory)['status'], 'baseline')
        with self.assertRaises(self.api.HistoryError):
            self.api.record_attempt(self.directory, 'raw-private-error', now_ms=3000)

    def test_attempt_diagnostics_match_worker_allowlist_and_pool_bound(self):
        try:
            self.api.record_attempt(self.directory, 'ok', now_ms=1000, system_count=1,
                                    session_slot='GS', pool_size=201,
                                    audit={'reason': 'ok', 'stage': 'private', 'rpc_count': 999})
        except self.api.HistoryError: self.fail('supported worker pool size must remain recordable')
        self.assertEqual(self.api.read_attempts(self.directory), [
            {'at_ms': 1000, 'status': 'ok', 'system_count': 1, 'session_slot': 'GS', 'pool_size': 201}])

    @unittest.skipUnless(os.name == 'posix', 'POSIX filesystem contract')
    def test_directory_file_modes_owner_and_links_are_checked(self):
        self.directory.chmod(0o755)
        with self.assertRaises(self.api.HistoryError): self.record(1000)
        self.directory.chmod(0o2750)
        self.record(1000)
        for path in self.directory.iterdir():
            self.assertEqual(path.stat().st_mode & 0o7777, 0o640)
            self.assertEqual(path.stat().st_uid, self.directory.stat().st_uid)
            self.assertEqual(path.stat().st_gid, self.directory.stat().st_gid)
        sample = self.directory / 'sample-1000.json'
        sample.chmod(0o644)
        with self.assertRaises(self.api.HistoryError): self.api.read_changes(self.directory)


if __name__ == '__main__': unittest.main()
