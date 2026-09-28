"""Model tests.

Run with ``--settings=EVE_MDjango.killboard_test_settings`` so this suite
uses an isolated in-memory SQLite database and never imports production
credentials or connects to the live MySQL databases.
"""

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from Killboard.models import (
    CollectionPolicy,
    KillItem,
    KillParticipant,
    KillReport,
    ProbeCursor,
    ProbeRun,
    ShipClass,
)


class KillboardModelTests(TestCase):
    def test_kill_report_id_is_unique_and_related_rows_are_supported(self):
        report = KillReport.objects.create(
            kill_id=19748417,
            ship_type_id=123,
            ship_name="Vassago",
            ship_class_key="assault_carrier",
            system_id=30000299,
            system_name="Test system",
            kill_time_raw="2026-08-15T06:43:05",
            source="test",
        )

        participant = KillParticipant.objects.create(
            report=report,
            character_id=42,
            character_name="Pilot",
            damage=1234,
            damage_pct="100.000",
            is_final_blow=True,
            is_top_damage=True,
            source_index=0,
        )
        item = KillItem.objects.create(
            report=report,
            type_id=456,
            name="Test module",
            quantity_dropped=1,
            status=KillItem.Status.DROPPED,
        )

        self.assertEqual(report.participants.get(), participant)
        self.assertEqual(report.items.get(), item)

        with self.assertRaises(IntegrityError), transaction.atomic():
            KillReport.objects.create(kill_id=19748417)

    def test_kill_item_status_has_only_supported_values(self):
        report = KillReport.objects.create(kill_id=19748418, source="test")
        for status in KillItem.Status.values:
            item = KillItem.objects.create(report=report, status=status)
            self.assertEqual(item.status, status)

        with self.assertRaises(IntegrityError), transaction.atomic():
            KillItem.objects.create(report=report, status="salvaged")

    def test_policy_cursor_and_run_are_registered_domain_models(self):
        ship_class = ShipClass.objects.create(key="battleship", label="Battleship", rank=4)
        policy = CollectionPolicy.objects.create(
            name="battleship_plus",
            min_ship_rank=ship_class.rank,
            allowed_class_keys=[ship_class.key],
        )
        cursor = ProbeCursor.objects.create(name="default", next_probe_id=19748419)
        run = ProbeRun.objects.create(cursor=cursor, policy=policy, status=ProbeRun.Status.QUEUED)

        self.assertEqual(run.cursor, cursor)
        self.assertEqual(run.policy, policy)
        self.assertEqual(ShipClass.objects.get(key="battleship"), ship_class)

    def test_invalid_status_is_rejected_by_model_validation(self):
        item = KillItem(status="salvaged")
        with self.assertRaises(ValidationError):
            item.full_clean()
