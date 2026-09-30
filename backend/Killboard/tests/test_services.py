"""Red tests for report persistence and collection-policy handling."""

from decimal import Decimal

from django.test import TestCase
from django.test import override_settings

from Killboard.models import CollectionPolicy, KillItem, KillReport, ShipClass
from Killboard.services import persist_report


def parsed_report(*, kill_id=100, ship_class_key="battleship", isk_lost=Decimal("123.45"), completeness=None):
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
        "isk_lost": isk_lost,
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
    def test_source_combat_metadata_survives_database_round_trip(self):
        from Killboard.parser import parse_kill_blob
        parsed = parse_kill_blob('<attackers><a s=8 w=9 d=100 cf=500019 fs=3141.37/></attackers>',
                                 summary={'kill_id': 105, 'final_ship_type_id': 8,
                                          'final_weapon_type_id': 9, 'final_damage_done': 100,
                                          'killer_camouflaged_faction_id': 500019,
                                          'killer_feat_score': 3141.37, 'victim_damage_taken': 100})
        report, _ = persist_report(parsed)
        report.refresh_from_db()
        self.assertEqual(report.victim_damage_taken, 100)
        self.assertTrue(report.damage_total_verified)
        self.assertEqual(report.final_summary['damage'], 100)
        self.assertEqual(report.final_summary['feat_score'], '3141.37')
        row = report.participants.get()
        self.assertEqual(row.camouflaged_faction_id, 500019)
        self.assertEqual(row.feat_score, Decimal('3141.37'))
        self.assertTrue(row.is_final_blow)
        self.assertTrue(row.is_top_damage)

    def setUp(self):
        ShipClass.objects.create(key="frigate", label="Frigate", rank=1)
        ShipClass.objects.create(key="battlecruiser", label="Battlecruiser", rank=3)
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
        self.assertEqual(report.equipment_status, 'provided')
        self.assertEqual(report.participants_status, 'provided')
        self.assertEqual(report.participants.get().ship_type_id, None)

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

    def test_disabled_policy_fails_closed(self):
        self.policy.enabled = False
        self.policy.save(update_fields=["enabled"])

        report, stored = persist_report(parsed_report(kill_id=102), policy=self.policy)

        self.assertIsNone(report)
        self.assertFalse(stored)
        self.assertFalse(KillReport.objects.filter(kill_id=102).exists())

    def test_battlecruiser_is_not_battleship_or_above(self):
        policy = CollectionPolicy.objects.create(
            name="ranked", min_ship_rank=4, allowed_class_keys=[]
        )

        report, stored = persist_report(
            parsed_report(kill_id=103, ship_class_key="battlecruiser"),
            policy=policy,
        )

        self.assertIsNone(report)
        self.assertFalse(stored)

    def test_value_policy_accepts_any_ship_class_only_above_strict_threshold(self):
        policy = CollectionPolicy.objects.create(
            name="high_value_all",
            min_ship_rank=0,
            allowed_class_keys=[],
            min_isk_lost=Decimal("20000000000.00"),
        )

        below, stored = persist_report(
            parsed_report(kill_id=108, ship_class_key="frigate", isk_lost=Decimal("19999999999.99")),
            policy=policy,
        )
        self.assertIsNone(below)
        self.assertFalse(stored)

        equal, stored = persist_report(
            parsed_report(kill_id=109, ship_class_key="frigate", isk_lost=Decimal("20000000000.00")),
            policy=policy,
        )
        self.assertIsNone(equal)
        self.assertFalse(stored)

        above, stored = persist_report(
            parsed_report(kill_id=110, ship_class_key="frigate", isk_lost=Decimal("20000000000.01")),
            policy=policy,
        )
        self.assertTrue(stored)
        self.assertEqual(above.ship_class_key, "frigate")

    def test_value_policy_rejects_missing_value(self):
        policy = CollectionPolicy.objects.create(
            name="high_value_missing",
            min_ship_rank=0,
            allowed_class_keys=[],
            min_isk_lost=Decimal("20000000000.00"),
        )
        parsed = parsed_report(kill_id=111, ship_class_key="frigate", isk_lost=None)
        report, stored = persist_report(parsed, policy=policy)
        self.assertIsNone(report)
        self.assertFalse(stored)

    def test_missing_item_section_does_not_delete_existing_items(self):
        persist_report(
            parsed_report(kill_id=104, completeness="complete"),
            policy=self.policy,
        )
        incoming = parsed_report(kill_id=104, completeness="complete")
        incoming.pop("items")
        incoming.pop("equipment_status")

        report, created = persist_report(incoming, policy=self.policy)

        self.assertFalse(created)
        self.assertEqual(report.items.count(), 1)
        self.assertEqual(report.equipment_status, 'provided')

    def test_missing_status_does_not_downgrade_existing_source(self):
        persist_report(parsed_report(kill_id=107, completeness="complete"), policy=self.policy)
        incoming = parsed_report(kill_id=107, completeness="complete")
        incoming["participants"] = []
        incoming["participants_status"] = "missing"
        incoming.pop("items")
        incoming["equipment_status"] = "missing"

        report, created = persist_report(incoming, policy=self.policy)

        self.assertFalse(created)
        self.assertEqual(report.participants_status, 'provided')
        self.assertEqual(report.equipment_status, 'provided')

    def test_missing_participant_section_does_not_delete_existing_participants(self):
        persist_report(
            parsed_report(kill_id=105, completeness="complete"),
            policy=self.policy,
        )
        incoming = parsed_report(kill_id=105, completeness="complete")
        incoming["participants"] = []
        incoming["participant_count"] = 1

        report, created = persist_report(incoming, policy=self.policy)

        self.assertFalse(created)
        self.assertEqual(report.participants.count(), 1)

    @override_settings(USE_TZ=False)
    def test_naive_database_mode_keeps_parsed_time_naive(self):
        report, created = persist_report(parsed_report(kill_id=106), policy=self.policy)

        self.assertTrue(created)
        self.assertIsNone(report.kill_time_display.tzinfo)
