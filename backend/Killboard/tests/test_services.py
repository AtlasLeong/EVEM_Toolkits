"""Red tests for report persistence and collection-policy handling."""

from decimal import Decimal

from django.test import TestCase

from Killboard.models import CollectionPolicy, KillItem, KillReport, ShipClass
from Killboard.services import persist_report


def parsed_report(*, kill_id=100, ship_class_key="battleship", completeness=None):
    value = {
        "kill_id": kill_id,
        "ship_type_id": 9001,
        "ship_name": "Test Battleship",
        "ship_class_key": ship_class_key,
        "system_id": 30000001,
        "system_name": "Jita",
        "victim_character_id": 7,
        "victim_name": "Victim",
        "kill_time_raw": "2026-09-28T12:00:00+00:00",
        "time_quality": "source",
        "isk_lost": Decimal("123.45"),
        "participant_count": 1,
        "participants": [{
            "character_id": 8,
            "character_name": "Pilot",
            "damage": 123,
            "damage_pct": Decimal("100"),
            "is_final_blow": True,
            "is_top_damage": True,
            "source_index": 0,
        }],
        "items": [{
            "type_id": 99,
            "name": "Dropped module",
            "slot": "low",
            "quantity_dropped": 1,
            "quantity_destroyed": 0,
            "quantity_unknown": 0,
            "status": "dropped",
        }],
        "equipment_status": "provided",
    }
    if completeness is not None:
        value["completeness"] = completeness
    return value


class KillReportPersistenceTests(TestCase):
    def setUp(self):
        ShipClass.objects.create(key="frigate", label="Frigate", rank=1)
        ShipClass.objects.create(key="battleship", label="Battleship", rank=4)
        self.policy = CollectionPolicy.objects.create(
            name="battleship_plus",
            min_ship_rank=4,
            allowed_class_keys=["battleship"],
        )

    def test_persists_report_children_and_applies_ship_policy(self):
        report, created = persist_report(parsed_report(), policy=self.policy, source="fake")

        self.assertTrue(created)
        self.assertEqual(report.kill_id, 100)
        self.assertEqual(report.participants.count(), 1)
        self.assertEqual(report.items.get().status, KillItem.Status.DROPPED)

        filtered, stored = persist_report(
            parsed_report(kill_id=101, ship_class_key="frigate"),
            policy=self.policy,
            source="fake",
        )
        self.assertFalse(stored)
        self.assertIsNone(filtered)
        self.assertFalse(KillReport.objects.filter(kill_id=101).exists())

    def test_lower_completeness_cannot_replace_complete_report(self):
        complete, _ = persist_report(
            parsed_report(completeness="complete"), policy=self.policy, source="fake"
        )
        partial = parsed_report(completeness="partial")
        partial["ship_name"] = ""
        partial["participants"] = []
        updated, created = persist_report(partial, policy=self.policy, source="fake")

        self.assertFalse(created)
        self.assertEqual(updated.pk, complete.pk)
        complete.refresh_from_db()
        self.assertEqual(complete.ship_name, "Test Battleship")
        self.assertEqual(complete.completeness, KillReport.Completeness.COMPLETE)
        self.assertEqual(complete.participants.count(), 1)

    def test_new_complete_report_can_upgrade_partial_report(self):
        persist_report(
            parsed_report(completeness="partial"), policy=self.policy, source="fake"
        )
        report, created = persist_report(
            parsed_report(completeness="complete"), policy=self.policy, source="fake"
        )

        self.assertFalse(created)
        self.assertEqual(report.completeness, KillReport.Completeness.COMPLETE)
        self.assertEqual(report.items.count(), 1)
