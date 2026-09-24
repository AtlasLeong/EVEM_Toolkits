from importlib import import_module

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.exceptions import IrreversibleError
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone


class LegacyBoardMigrationTests(TransactionTestCase):
    migrate_from = [('TacticalCollaboration', '0006_organization_state_version')]
    migrate_to = [('TacticalCollaboration', '0007_multiboard_pirate')]

    def test_existing_scope_reports_and_forces_move_into_one_default_war_board(self):
        executor = MigrationExecutor(connection)
        current = executor.loader.project_state(self.migrate_to).apps
        owner = get_user_model().objects.create_user(username='migration-owner')
        organization = current.get_model('TacticalCollaboration', 'Organization').objects.create(
            name='旧组织', founder_id=owner.pk, region_ids=[100], border_hops=2, scope_version=7)
        old_report = current.get_model('TacticalCollaboration', 'Report').objects.create(
            organization_id=organization.pk, author_id=owner.pk, system_id=1, system_name='旧星系',
            observed_at=timezone.now())
        old_force = current.get_model('TacticalCollaboration', 'Force').objects.create(
            organization_id=organization.pk, name='旧部署', side='enemy', system_id=1,
            system_name='旧星系', observed_at=timezone.now())
        migration = import_module('TacticalCollaboration.migrations.0007_multiboard_pirate')
        with connection.schema_editor() as schema_editor:
            migration.preserve_legacy_war_boards(current, schema_editor)
        Board = current.get_model('TacticalCollaboration', 'Board')
        board = Board.objects.get(organization_id=organization.pk)
        self.assertEqual((board.kind, board.is_default, board.region_ids, board.border_hops, board.scope_version),
                         ('war', True, [100], 2, 7))
        self.assertEqual(current.get_model('TacticalCollaboration', 'Report').objects.get(pk=old_report.pk).board_id, board.pk)
        self.assertEqual(current.get_model('TacticalCollaboration', 'Force').objects.get(pk=old_force.pk).board_id, board.pk)

    def test_multiboard_migration_cannot_reverse_and_discard_pirate_intelligence(self):
        executor = MigrationExecutor(connection)
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(self.migrate_to))
        current = executor.loader.project_state(self.migrate_to).apps
        owner = get_user_model().objects.create_user(username='migration-reverse-owner')
        organization = current.get_model('TacticalCollaboration', 'Organization').objects.create(
            name='情报组织', founder_id=owner.pk)
        board = current.get_model('TacticalCollaboration', 'Board').objects.create(
            organization_id=organization.pk, name='海盗情报', kind='pirate')
        sighting = current.get_model('TacticalCollaboration', 'PirateSighting').objects.create(
            board_id=board.pk, author_id=owner.pk, character_name='目标', ship_type='航母',
            normalized_name='目标', normalized_ship='航母', location_kind='system',
            location_id=1, location_name='测试星系', observed_at=timezone.now())

        with self.assertRaises(IrreversibleError):
            executor.migrate(self.migrate_from)

        self.assertTrue(current.get_model('TacticalCollaboration', 'Board').objects.filter(pk=board.pk).exists())
        self.assertTrue(current.get_model('TacticalCollaboration', 'PirateSighting').objects.filter(pk=sighting.pk).exists())
