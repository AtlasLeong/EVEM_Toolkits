import builtins
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase, TestCase

from Killboard.models import KillReport
from Killboard.security import security_meta, system_security_map


class SecurityMetaTests(SimpleTestCase):
    def test_boundaries_and_unknown_are_semantic(self):
        self.assertEqual(security_meta(None)['security_band'], 'unknown')
        self.assertEqual(security_meta(float('nan'))['security_band'], 'unknown')
        self.assertEqual(security_meta(0)['security_band'], 'nullsec')
        self.assertEqual(security_meta(0.49)['security_band'], 'low')
        self.assertEqual(security_meta(0.5)['security_band'], 'high')
        self.assertEqual(security_meta(0)['security_label'], '00地区')

    def test_system_lookup_is_batched_and_resolves_names(self):
        region = SimpleNamespace(zh_name='星域甲', name='Region A')
        constellation = SimpleNamespace(zh_name='星座甲', name='Constellation A', region=region)
        rows = [SimpleNamespace(system_id=7, security_status=0.4, constellation=constellation)]
        manager = SimpleNamespace(filter=lambda **kwargs: SimpleNamespace(select_related=lambda *args: rows))
        model = SimpleNamespace(objects=manager)
        with patch.dict('sys.modules', {'TacticalBoard.models': SimpleNamespace(BoardSystems=model)}):
            result = system_security_map([7, 7])
        self.assertEqual(result['7']['security_label'], '低安')
        self.assertEqual(result['7']['constellation_name'], '星座甲')
        self.assertEqual(result['7']['region_name'], '星域甲')

    def test_unavailable_tactical_models_fail_closed(self):
        original_import = builtins.__import__

        def import_without_tactical_models(name, *args, **kwargs):
            if name == 'TacticalBoard.models':
                raise RuntimeError('model app is not installed in this settings module')
            return original_import(name, *args, **kwargs)

        with patch.object(builtins, '__import__', side_effect=import_without_tactical_models):
            self.assertEqual(system_security_map([7]), {})

    def test_missing_tactical_row_uses_verified_client_location_labels(self):
        original_import = builtins.__import__

        def import_without_tactical_models(name, *args, **kwargs):
            if name == 'TacticalBoard.models':
                raise RuntimeError('model app is not installed in this settings module')
            return original_import(name, *args, **kwargs)

        with patch.object(builtins, '__import__', side_effect=import_without_tactical_models):
            result = system_security_map([33007327])
        self.assertEqual(result['33007327']['system_name'], 'NI-D1003327')
        self.assertEqual(result['33007327']['constellation_name'], 'EI-S1238')
        self.assertEqual(result['33007327']['region_name'], 'EI-S11907')
        self.assertEqual(result['33007327']['security_label'], '安等未知')

    def test_unavailable_system_table_fails_closed_when_queryset_is_evaluated(self):
        class UnavailableRows:
            def __iter__(self):
                raise DatabaseError('lookup table unavailable')

        manager = SimpleNamespace(filter=lambda **kwargs: SimpleNamespace(
            select_related=lambda *args: UnavailableRows(),
        ))
        model = SimpleNamespace(objects=manager)
        with patch.dict('sys.modules', {'TacticalBoard.models': SimpleNamespace(BoardSystems=model)}):
            self.assertEqual(system_security_map([7]), {})


class SecurityLookupDatabaseTests(TestCase):
    def test_real_missing_table_error_is_caught_during_lazy_evaluation(self):
        # Keep the real database error and lazy QuerySet; substitute only the
        # TacticalBoard model because the isolated settings do not install it.
        with self.assertNumQueries(0):
            rows = KillReport.objects.raw('SELECT * FROM killboard_test_missing_systems')
        manager = SimpleNamespace(filter=lambda **kwargs: SimpleNamespace(
            select_related=lambda *args: rows,
        ))
        model = SimpleNamespace(objects=manager)
        with patch.dict('sys.modules', {'TacticalBoard.models': SimpleNamespace(BoardSystems=model)}):
            with self.assertNumQueries(1):
                self.assertEqual(system_security_map([7]), {})
