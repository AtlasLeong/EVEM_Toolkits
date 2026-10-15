import io
import os
from pathlib import Path
import tempfile
import json
from unittest.mock import patch, Mock

from django.core.management import call_command, get_commands
from django.test import SimpleTestCase, override_settings
from AnomalyHotspots.tests.test_core import bundle
from AnomalyHotspots.session_bundle import save_session
from AnomalyHotspots.snapshot import read_snapshot
from Killboard.collector_transport import CollectorError
from AnomalyHotspots import collector
from AnomalyHotspots.tests.test_core import wire
from GameSessions.coordination import provision


class CommandTests(SimpleTestCase):
    def test_history_uses_same_success_time_and_failed_pass_keeps_baseline(self):
        from AnomalyHotspots.history import read_changes, read_attempts
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            if os.name == 'posix': parent.chmod(0o750)
            snapshot, history = parent / 'snapshot.json', parent / 'history'
            history.mkdir(mode=0o750)
            output = io.StringIO()
            with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot), ANOMALY_HISTORY_DIR=str(history)), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.load_round_robin_session', return_value=(bundle(), 'B', 1, 7)), \
                    patch('time.time', side_effect=[1, 601, 1201]), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', side_effect=[
                        [{'solar_system_id': 1, 'destroy_num': 10}], CollectorError('rate_limited'),
                        [{'solar_system_id': 1, 'destroy_num': 17}]]) as collect:
                for _ in range(3): call_command('anomaly_collect', stdout=output)
            self.assertEqual(collect.call_count, 3)
            changes = read_changes(history, now_ms=1201000)
            self.assertEqual(changes['status'], 'ok')
            self.assertEqual(changes['interval']['start_at_ms'], 1000)
            self.assertEqual(changes['interval']['end_at_ms'], read_snapshot(snapshot)['collected_at_ms'])
            self.assertEqual(changes['interval']['elapsed_ms'], 1200000)
            self.assertEqual(changes['systems'][0]['delta'], 7)
            self.assertEqual([item['status'] for item in read_attempts(history)], ['ok', 'rate_limited', 'ok'])
            journal = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([item['history_status'] for item in journal], ['ok', 'ok', 'ok'])

    def test_history_publication_failure_does_not_replace_source_success(self):
        from AnomalyHotspots.history import HistoryError
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            if os.name == 'posix': parent.chmod(0o750)
            output, snapshot = io.StringIO(), parent / 'snapshot.json'
            with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot), ANOMALY_HISTORY_DIR=str(parent)), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.load_round_robin_session', return_value=(bundle(), 'A', 0, 1)), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', return_value=[{'solar_system_id': 1, 'destroy_num': 9}]) as collect, \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.record_success', side_effect=HistoryError(), create=True), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.record_attempt', side_effect=HistoryError(), create=True):
                call_command('anomaly_collect', stdout=output)
            self.assertEqual(collect.call_count, 1)
            self.assertEqual(read_snapshot(snapshot)['systems'], [{'solar_system_id': 1, 'destroy_num': 9}])
            self.assertEqual(json.loads(output.getvalue())['status'], 'ok')
            self.assertEqual(json.loads(output.getvalue()).get('history_status'), 'unavailable')
            self.assertNotIn(str(parent), output.getvalue())

    def test_source_success_with_history_failure_is_visible_in_persisted_attempt(self):
        from AnomalyHotspots.history import HistoryError, read_attempts
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            if os.name == 'posix': parent.chmod(0o750)
            output, snapshot = io.StringIO(), parent / 'snapshot.json'
            with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot), ANOMALY_HISTORY_DIR=str(parent)), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.load_round_robin_session', return_value=(bundle(), 'A', 0, 1)), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', return_value=[{'solar_system_id': 1, 'destroy_num': 9}]), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.record_success', side_effect=HistoryError()):
                call_command('anomaly_collect', stdout=output)
            attempt = read_attempts(parent)[0]
            self.assertEqual(attempt['status'], 'ok')
            self.assertEqual(attempt.get('history_status'), 'unavailable')

    def test_unconfigured_history_is_opt_in_without_filesystem_access(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            if os.name == 'posix': parent.chmod(0o750)
            output = io.StringIO()
            with override_settings(ANOMALY_SNAPSHOT_FILE=str(parent / 'snapshot.json'), ANOMALY_HISTORY_DIR=''), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.load_round_robin_session', return_value=(bundle(), 'A', 0, 1)), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', return_value=[]), \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.record_success', create=True) as history, \
                    patch('AnomalyHotspots.management.commands.anomaly_collect.record_attempt', create=True) as attempts:
                call_command('anomaly_collect', stdout=output)
            history.assert_not_called()
            attempts.assert_not_called()
            self.assertEqual(json.loads(output.getvalue()).get('history_status'), 'disabled')

    def test_seven_real_pool_passes_select_once_journal_slots_and_bind_actual_account(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            parent.chmod(0o750)
            cursor, snapshot, state = (parent / name for name in ('cursor.json', 'snapshot.json', 'coord.sqlite3'))
            paths = []
            for index in range(7):
                value = bundle()
                value['hello']['synthetic'] = ('opaque-' + str(index)).encode()
                path = parent / ('private-' + str(index) + '.json')
                save_session(value, path)
                paths.append(path)
            before = [path.read_bytes() for path in paths]
            provision(state)
            env = {'ANOMALY_SESSION_FILES': os.pathsep.join(map(str, paths)),
                   'ANOMALY_SESSION_CURSOR_FILE': str(cursor),
                   'GAME_SESSION_COORDINATOR_FILE': str(state),
                   'ANOMALY_SESSION_ACCOUNT_IDS': json.dumps(['slot-' + str(i) for i in range(7)])}
            captured, output, clock = [], io.StringIO(), [2000000000]
            def now():
                clock[0] += 1
                return clock[0]
            def rpc(session, method, item):
                if method == collector.HOTSPOT_METHOD:
                    captured.append((session.bundle['hello']['synthetic'], session.account_lease.account_ref))
                    return wire([{'solar_system_id': 1, 'destroy_num': len(captured)}])
                return {'login_sigma': [0, {'client_id': 42, 'proxy_node_id': 43}],
                        'request_start_wait': [], 'get_newbie_info': [], 'select_character_id': 1}[method]
            handshake = (2, {'accepted': True, 'info': {'node_info': {'node_id': 7}}})
            with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot)), patch.dict(os.environ, env, clear=True), patch.object(collector.market.socket, 'create_connection', side_effect=lambda *a, **kw: Mock()) as connect, patch.object(collector.market, '_read_frame', return_value=handshake), patch.object(collector.HotspotSession, '_raw_rpc', rpc), patch.object(collector.time, 'sleep'), patch.object(collector.time, 'time', side_effect=now):
                for _ in range(7): call_command('anomaly_collect', stdout=output)
            journals = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([entry.get('session_slot') for entry in journals], list('ABCDEFG'))
            self.assertTrue(all(entry.get('pool_size') == 7 and entry['status'] == 'ok'
                                and entry['rpc_count'] == 5 and entry['stage'] == 'statistics' for entry in journals))
            self.assertEqual(captured, [(('opaque-' + str(i)).encode(), 'slot-' + str(i)) for i in range(7)])
            self.assertEqual(connect.call_count, 7)
            self.assertEqual(json.loads(cursor.read_text()), 0)
            self.assertEqual([path.read_bytes() for path in paths], before)
            self.assertEqual(set(read_snapshot(snapshot)), {'version', 'collected_at_ms', 'last_attempt_at_ms',
                                                         'status', 'systems', 'statistics_window'})
            for private in ('opaque', str(parent), 'account_ref', 'hello', 'templates', 'material'):
                self.assertNotIn(private, output.getvalue())

    def test_invalid_selection_preserves_snapshot_and_never_calls_collector(self):
        from AnomalyHotspots.snapshot import write_success
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            parent.chmod(0o750)
            snapshot = parent / 'snapshot.json'
            write_success(snapshot, [{'solar_system_id': 1, 'destroy_num': 8}], now_ms=1000)
            output = io.StringIO()
            with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot)), patch.dict(os.environ, {}, clear=True), patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once') as collect:
                call_command('anomaly_collect', stdout=output)
            collect.assert_not_called()
            self.assertEqual(read_snapshot(snapshot)['collected_at_ms'], 1000)
            self.assertEqual(read_snapshot(snapshot)['systems'], [{'solar_system_id': 1, 'destroy_num': 8}])
            entry = json.loads(output.getvalue())
            self.assertNotIn('session_slot', entry)
            self.assertEqual(entry['status'], 'unauthorized')

    def test_one_selection_no_fallback_on_collection_failure_and_diagnostics_sanitized(self):
        from AnomalyHotspots.snapshot import write_success
        for code in ('rate_limited', 'unauthorized', 'network_error'):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                parent = Path(directory)
                parent.chmod(0o750)
                snapshot, private = parent / 'snapshot.json', parent / 'private.json'
                save_session(bundle(), private)
                write_success(snapshot, [{'solar_system_id': 1, 'destroy_num': 8}], now_ms=1000)
                output = io.StringIO()
                def failed(value, **kwargs):
                    kwargs['audit'].update(rpc_count=3, stage='authentication', reason='private-secret',
                                           private='opaque', user='private-user')
                    raise CollectorError(code, 'private-secret')
                with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot)), patch.dict(os.environ, {'ANOMALY_SESSION_FILE': str(private)}, clear=True), patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', side_effect=failed) as collect:
                    call_command('anomaly_collect', stdout=output)
                self.assertEqual(collect.call_count, 1)
                self.assertEqual(read_snapshot(snapshot)['collected_at_ms'], 1000)
                self.assertEqual(read_snapshot(snapshot)['systems'], [{'solar_system_id': 1, 'destroy_num': 8}])
                entry = json.loads(output.getvalue())
                self.assertEqual(entry.get('session_slot'), 'A')
                self.assertEqual(entry.get('pool_size'), 1)
                self.assertEqual(entry.get('rpc_count'), 3)
                self.assertEqual(entry.get('stage'), 'authentication')
                self.assertEqual(entry['status'], code)
                for secret in ('private-secret', 'private-user', 'opaque', str(private)):
                    self.assertNotIn(secret, output.getvalue())

    def test_worker_success_and_failure_preserve_rows_and_safe_journal(self):
        self.assertIn('anomaly_collect', get_commands(), 'command missing')
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            private, snapshot = parent / 'private.json', parent / 'snapshot.json'
            save_session(bundle(), private)
            if os.name == 'posix': parent.chmod(0o750)
            output = io.StringIO()
            with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot)), patch.dict(os.environ, {'ANOMALY_SESSION_FILE': str(private)}):
                with patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', return_value=[{'solar_system_id': 1, 'destroy_num': 5}]):
                    call_command('anomaly_collect', stdout=output)
                good = read_snapshot(snapshot)
                self.assertEqual(good['status'], 'ok')
                with patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', side_effect=CollectorError('rate_limited')):
                    call_command('anomaly_collect', stdout=output)
                failed = read_snapshot(snapshot)
                self.assertEqual(failed['systems'], good['systems'])
                self.assertEqual(failed['collected_at_ms'], good['collected_at_ms'])
                self.assertEqual(failed['status'], 'rate_limited')
                self.assertNotIn(str(private), output.getvalue())
                self.assertNotIn('opaque', output.getvalue())
