"""Real SQLite transactional checks; no public network or local demo file access."""
import importlib.util
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from TacticalBoard.models import BoardConstellations, BoardRegions, BoardStargates, BoardSystems
from TacticalCollaboration.models import Force, Membership, Organization


ROOT = Path(__file__).resolve().parents[1]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TacticalUniverseImportTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.created_tables = []
        existing = connection.introspection.table_names()
        with connection.schema_editor() as editor:
            for model in (BoardRegions, BoardConstellations, BoardSystems, BoardStargates):
                if model._meta.db_table not in existing:
                    editor.create_model(model)
                    cls.created_tables.append(model)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        with connection.schema_editor() as editor:
            for model in reversed(cls.created_tables):
                editor.delete_model(model)

    def setUp(self):
        self.module = load(ROOT / 'scripts/tactical/real_universe.py', 'test_tactical_import')
        fixtures = load(ROOT / 'scripts/tactical/tests/test_real_universe.py', 'universe_fixtures')
        self.snapshot = self.module.normalize_snapshot(*fixtures.fixture())
        self.snapshot['metadata']['retrieved_at'] = '2026-09-21T00:00:00+00:00'
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.backend = Path(self.directory.name)
        self.users = {role: get_user_model().objects.create_user(
            username=f'tactical_demo_{role}', email=f'{role}@tactical.local', password='existing-unchanged')
            for role in ('founder', 'commander', 'scout')}
        self.original_org = Organization.objects.create(name='原演习，不可覆盖', founder=self.users['founder'])
        BoardRegions.objects.create(region_id=99000001, name='演习区', zh_name='演习区')

    def import_snapshot(self):
        self.assertTrue(callable(getattr(self.module, 'import_snapshot', None)), 'transactional local importer missing')
        # Only bypass the path/environment guard for the managed in-memory CI DB.
        # All ORM writes, service commands, transactions and file publication run.
        with patch.object(self.module, 'require_local_environment', return_value=self.backend):
            return self.module.import_snapshot(self.snapshot)

    def test_imports_only_static_tables_and_new_demo_without_resetting_existing_state(self):
        result = self.import_snapshot()
        self.assertTrue(BoardRegions.objects.filter(pk=99000001).exists())
        self.assertEqual(BoardSystems.objects.count(), 5)
        self.assertEqual(BoardStargates.objects.count(), 2)
        self.original_org.refresh_from_db()
        self.assertEqual(self.original_org.name, '原演习，不可覆盖')
        real_org = Organization.objects.get(pk=result['organization_id'])
        self.assertEqual(real_org.name, '真实星图 · 本地演习')
        self.assertEqual(real_org.region_ids, [10000001])
        self.assertEqual(real_org.border_hops, 1)
        self.assertEqual(Membership.objects.filter(organization=real_org).count(), 3)
        forces = Force.objects.filter(organization=real_org)
        self.assertEqual(forces.count(), 5)
        self.assertTrue(all('非真实军情' in row.notes and row.system_id in range(30000001, 30000006) for row in forces))
        for user in self.users.values():
            user.refresh_from_db()
            self.assertTrue(user.check_password('existing-unchanged'))
        saved = json.loads((self.backend / '.tactical-universe.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['metadata']['sha256'], self.snapshot['metadata']['sha256'])

    def test_second_import_preserves_renamed_organization_force_edits_and_removed_members(self):
        result = self.import_snapshot()
        org_id = result['organization_id']
        Organization.objects.filter(pk=org_id).update(name='我改过名字', region_ids=[99000001])
        Force.objects.filter(organization_id=org_id).update(people=999)
        Membership.objects.filter(organization_id=org_id, user=self.users['scout']).update(status='removed')
        again = self.import_snapshot()
        self.assertEqual(again['organization_id'], org_id)
        self.assertEqual(Organization.objects.count(), 2)
        self.assertEqual(Organization.objects.get(pk=org_id).name, '我改过名字')
        self.assertEqual(Organization.objects.get(pk=org_id).region_ids, [99000001])
        self.assertEqual(list(Force.objects.filter(organization_id=org_id).values_list('people', flat=True)), [999] * 5)
        self.assertEqual(Membership.objects.get(organization_id=org_id, user=self.users['scout']).status, 'removed')

    def test_failed_seed_rolls_back_all_static_upserts_and_preserves_previous_snapshot(self):
        self.assertTrue(callable(getattr(self.module, 'seed_real_organization', None)), 'isolated organization seed missing')
        target = self.backend / '.tactical-universe.json'
        target.write_text('{"previous":true}', encoding='utf-8')
        with patch.object(self.module, 'seed_real_organization', side_effect=RuntimeError('test failure')):
            with self.assertRaises(RuntimeError):
                self.import_snapshot()
        self.assertEqual(BoardRegions.objects.count(), 1)
        self.assertEqual(BoardSystems.objects.count(), 0)
        self.assertEqual(target.read_text(encoding='utf-8'), '{"previous":true}')

    def test_file_publish_failure_rolls_back_database_and_created_demo(self):
        self.assertTrue(callable(getattr(self.module, 'import_snapshot', None)), 'transactional local importer missing')
        with patch.object(self.module.os, 'replace', side_effect=OSError('test publish failure')):
            with self.assertRaises(OSError):
                self.import_snapshot()
        self.assertEqual(BoardRegions.objects.count(), 1)
        self.assertEqual(Organization.objects.count(), 1)
        self.assertFalse((self.backend / '.tactical-universe.json').exists())
        self.assertEqual(list(self.backend.iterdir()), [])

    def test_refuses_any_non_demo_environment_before_writing(self):
        self.assertTrue(callable(getattr(self.module, 'require_local_environment', None)), 'local guard missing')
        with self.assertRaises(ValueError):
            self.module.require_local_environment()
        self.assertEqual(BoardRegions.objects.count(), 1)

    def test_tampered_snapshot_digest_is_rejected_before_database_mutation(self):
        self.snapshot['systems'][0]['x'] = 123
        self.assertTrue(callable(getattr(self.module, 'import_snapshot', None)), 'transactional local importer missing')
        with self.assertRaises(ValueError):
            self.import_snapshot()
        self.assertEqual(BoardSystems.objects.count(), 0)
