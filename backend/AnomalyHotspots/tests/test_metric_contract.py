"""Explicit metric provenance; historical values never imply their semantics."""
import copy
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

from AnomalyHotspots import history, snapshot


ACTIVITY = {'kind': 'activity_level', 'range_version': 1}
LEGACY = {'kind': 'legacy_unclassified', 'range_version': None}


def rows(value):
    return [{'solar_system_id': 30001211, 'destroy_num': value}]


def put(path, value):
    encoded = json.dumps(value, separators=(',', ':')).encode()
    path.write_bytes(encoded)
    if os.name == 'posix': path.chmod(0o640)
    return encoded


def legacy_sample(directory, stamp, value, entries):
    encoded = put(directory / ('sample-%s.json' % stamp),
                  {'version': 1, 'collected_at_ms': stamp,
                   'statistics_window': None, 'systems': rows(value)})
    entries.append({'id': stamp, 'bytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest()})
    put(directory / 'manifest.json', {'version': 1, 'samples': entries})
    return encoded


class MetricContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        if os.name == 'posix': self.directory.chmod(0o750)

    def test_pure_metric_contract_is_strict_and_does_not_infer_small_values(self):
        self.assertIsNotNone(importlib.util.find_spec('AnomalyHotspots.metric'),
                             'explicit metric contract is missing')
        metric = importlib.import_module('AnomalyHotspots.metric')
        self.assertEqual(metric.validate_metric(ACTIVITY), ACTIVITY)
        self.assertEqual(metric.validate_metric(LEGACY), LEGACY)
        for invalid in (None, {}, {'kind': 'activity_level', 'range_version': True},
                        {'kind': 'activity_level', 'range_version': 2},
                        {'kind': 'legacy_unclassified', 'range_version': 1},
                        {**ACTIVITY, 'statistics_window': '24h'}):
            with self.subTest(metric=invalid), self.assertRaises(metric.AnomalyValidationError):
                metric.validate_metric(invalid)

    def test_new_snapshot_and_immutable_sample_explicitly_store_activity_metric(self):
        path = self.directory / 'snapshot.json'
        snapshot.write_success(path, rows(5), now_ms=1000)
        value = snapshot.read_snapshot(path)
        self.assertEqual(value['version'], 2)
        self.assertEqual(value.get('metric'), ACTIVITY)
        self.assertEqual(json.loads(path.read_bytes())['metric'], ACTIVITY)
        history.record_success(self.directory, rows(5), now_ms=1000)
        stored = json.loads((self.directory / 'sample-1000.json').read_bytes())
        self.assertEqual(stored['version'], 2)
        self.assertEqual(stored.get('metric'), ACTIVITY)
        self.assertIsNone(stored['statistics_window'])

    def test_current_publication_rejects_six_without_replacing_last_good(self):
        path = self.directory / 'snapshot.json'
        snapshot.write_success(path, rows(0), now_ms=1000)
        before = path.read_bytes()
        for value in (6, 155, True, -1):
            with self.subTest(value=value), self.assertRaises(snapshot.SnapshotError):
                snapshot.write_success(path, rows(value), now_ms=2000)
            self.assertEqual(path.read_bytes(), before)
            with self.assertRaises(history.HistoryError):
                history.record_success(self.directory, rows(value), now_ms=2000)

    def test_v1_snapshot_small_and_large_values_project_legacy_without_disk_rewrite(self):
        path = self.directory / 'snapshot.json'
        for value in (1, 155):
            original = put(path, {'version': 1, 'collected_at_ms': 1000,
                                 'last_attempt_at_ms': 1000, 'status': 'ok',
                                 'statistics_window': None, 'systems': rows(value)})
            projected = snapshot.read_snapshot(path)
            self.assertEqual(projected['version'], 2)
            self.assertEqual(projected.get('metric'), LEGACY)
            self.assertEqual(projected['systems'], rows(value))
            self.assertEqual(path.read_bytes(), original)
            snapshot.write_failure(path, 'network_error', now_ms=2000)
            failed = snapshot.read_snapshot(path)
            self.assertEqual(failed.get('metric'), LEGACY)
            self.assertEqual(failed['collected_at_ms'], 1000)
            self.assertEqual(failed['systems'], rows(value))

    def test_failure_and_first_unavailable_never_fabricate_grade_provenance(self):
        path = self.directory / 'snapshot.json'
        self.assertEqual(snapshot.read_snapshot(path).get('metric'), LEGACY)
        snapshot.write_failure(path, 'unauthorized', now_ms=1000)
        missing = snapshot.read_snapshot(path)
        self.assertEqual(missing.get('metric'), LEGACY)
        self.assertIsNone(missing['collected_at_ms'])
        snapshot.write_success(path, [], now_ms=2000)
        snapshot.write_failure(path, 'rate_limited', now_ms=3000)
        failed = snapshot.read_snapshot(path)
        self.assertEqual(failed.get('metric'), ACTIVITY)
        self.assertEqual(failed['collected_at_ms'], 2000)
        self.assertEqual(failed['systems'], [])

    def test_v2_metric_and_grade_drift_fail_closed(self):
        path = self.directory / 'snapshot.json'
        snapshot.write_success(path, rows(1), now_ms=1000)
        good = json.loads(path.read_bytes())
        candidates = [{**good, 'metric': metric} for metric in
                      ({'kind': 'activity_level', 'range_version': True},
                       {'kind': 'activity_level', 'range_version': 2}, None)]
        candidates += [{key: value for key, value in good.items() if key != 'metric'},
                       {**good, 'systems': rows(6)},
                       {**good, 'statistics_window': '24h'}]
        for candidate in candidates:
            with self.subTest(candidate=candidate):
                put(path, candidate)
                self.assertEqual(snapshot.read_snapshot(path)['status'], 'unavailable')

    def test_legacy_and_mixed_history_keep_interval_navigation_without_invented_deltas(self):
        entries = []
        legacy_sample(self.directory, 1000, 155, entries)
        legacy_sample(self.directory, 2000, 1, entries)
        original = {path.name: path.read_bytes() for path in self.directory.iterdir()}
        value = history.read_changes(self.directory, now_ms=2000)
        self.assertEqual(value['version'], 2)
        self.assertEqual(value['status'], 'incomparable')
        self.assertEqual(value.get('metric'), LEGACY)
        self.assertEqual(value['systems'], [])
        self.assertEqual(value['interval']['elapsed_ms'], 1000)
        self.assertEqual({path.name: path.read_bytes() for path in self.directory.iterdir()}, original)
        history.record_success(self.directory, rows(5), now_ms=3000)
        mixed = history.read_changes(self.directory, now_ms=3000, limit=1)
        self.assertEqual(mixed['status'], 'incomparable')
        self.assertEqual(mixed['interval']['id'], 3000)
        self.assertEqual(mixed['next_before'], 3000)
        self.assertEqual(mixed['systems'], [])
        selected = history.read_changes(self.directory, now_ms=3000, interval=2000,
                                        before=3000, limit=1)
        self.assertEqual(selected['status'], 'incomparable')
        self.assertEqual(selected['interval']['id'], 2000)
        self.assertEqual([item['id'] for item in selected['intervals']], [2000])
        for name, encoded in original.items():
            if name != 'manifest.json': self.assertEqual((self.directory / name).read_bytes(), encoded)
        manifest = json.loads((self.directory / 'manifest.json').read_bytes())
        self.assertEqual(manifest['samples'][:2], entries)

    def test_grade_pairs_allow_signed_grade_movement_and_never_claim_count_window(self):
        history.record_success(self.directory, rows(0), now_ms=1000)
        history.record_success(self.directory, rows(5), now_ms=2000)
        for stamp, expected in ((2000, 5), (3000, -5), (4000, 0)):
            if stamp != 2000: history.record_success(self.directory, rows(0), now_ms=stamp)
            value = history.read_changes(self.directory, now_ms=stamp)
            self.assertEqual(value['status'], 'ok')
            self.assertEqual(value.get('metric'), ACTIVITY)
            self.assertEqual(value['systems'][0]['delta'], expected)
            self.assertIsNone(value['statistics_window'])
        self.assertEqual(value['coverage']['unchanged'], 1)

    def test_v2_history_semantic_validation_still_applies_after_valid_checksum(self):
        history.record_success(self.directory, rows(1), now_ms=1000)
        history.record_success(self.directory, rows(5), now_ms=2000)
        path = self.directory / 'sample-2000.json'
        good_sample = json.loads(path.read_bytes())
        good_manifest = json.loads((self.directory / 'manifest.json').read_bytes())
        candidates = [{**good_sample, 'metric': metric} for metric in
                      ({'kind': 'activity_level', 'range_version': True},
                       {'kind': 'activity_level', 'range_version': 2}, None)]
        candidates += [{key: value for key, value in good_sample.items() if key != 'metric'},
                       {**good_sample, 'systems': rows(6)},
                       {**good_sample, 'version': True}, {**good_sample, 'statistics_window': '24h'}]
        for candidate in candidates:
            with self.subTest(candidate=candidate):
                encoded = put(path, candidate)
                manifest = copy.deepcopy(good_manifest)
                manifest['samples'][-1] = {'id': 2000, 'bytes': len(encoded),
                                           'sha256': hashlib.sha256(encoded).hexdigest()}
                put(self.directory / 'manifest.json', manifest)
                with self.assertRaises(history.HistoryError):
                    history.read_changes(self.directory, now_ms=2000)
                self.assertEqual(path.read_bytes(), encoded)

    def test_legacy_same_timestamp_cannot_be_reclassified_or_overwritten(self):
        legacy_sample(self.directory, 1000, 1, [])
        original = {path.name: path.read_bytes() for path in self.directory.iterdir()}
        with self.assertRaises(history.HistoryError):
            history.record_success(self.directory, rows(1), now_ms=1000)
        self.assertEqual({path.name: path.read_bytes() for path in self.directory.iterdir()}, original)
