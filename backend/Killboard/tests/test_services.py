"""Red tests for report persistence and collection-policy handling."""

from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.test import override_settings

from Killboard.models import CollectionPolicy, KillItem, KillReport, ShipClass
from Killboard.services import persist_report
from Killboard.serializers import detail_payload, participant_payload, report_payload


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
    def ticker_report(self):
        parsed = parsed_report(completeness='partial')
        parsed.update(victim_corporation_id=202, victim_corporation_name='双子王的暗卫喵',
                      victim_corporation_ticker='GCG1')
        parsed['participants'][0].update(corporation_id=201, corporation_name='罗德骑士团',
                                         corporation_ticker='KOFR')
        return parsed

    def test_verified_tickers_survive_database_and_all_payload_round_trips(self):
        report, created = persist_report(self.ticker_report())
        report.refresh_from_db()
        row = report.participants.get()
        self.assertTrue(created)
        self.assertEqual(getattr(report, 'victim_corporation_ticker', None), 'GCG1')
        self.assertEqual(getattr(row, 'corporation_ticker', None), 'KOFR')
        self.assertEqual(report_payload(report).get('victim_corporation_ticker'), 'GCG1')
        self.assertEqual(participant_payload(row).get('corporation_ticker'), 'KOFR')
        detail = detail_payload(report)
        self.assertEqual(detail.get('victim_corporation_ticker'), 'GCG1')
        self.assertEqual(detail['participants'][0].get('corporation_ticker'), 'KOFR')

    def test_same_corporation_partial_refresh_preserves_known_tickers(self):
        for missing_id in (False, True):
            with self.subTest(missing_id=missing_id):
                original = self.ticker_report()
                original['kill_id'] = 120 + int(missing_id)
                persist_report(original)
                incoming = self.ticker_report()
                incoming['kill_id'] = original['kill_id']
                incoming['victim_corporation_ticker'] = ''
                incoming['victim_corporation_name'] = ''
                incoming['participants'][0]['corporation_ticker'] = ''
                if missing_id:
                    incoming['victim_corporation_id'] = None
                    incoming['participants'][0]['corporation_id'] = None
                report, created = persist_report(incoming)
                self.assertFalse(created)
                self.assertEqual(getattr(report, 'victim_corporation_ticker', None), 'GCG1')
                self.assertEqual(report.victim_corporation_name, '双子王的暗卫喵')
                self.assertEqual(getattr(report.participants.get(), 'corporation_ticker', None), 'KOFR')

    def test_inferred_victim_corporation_id_stays_associated_with_verified_name_and_ticker(self):
        from Killboard.parser import parse_kill_blob

        persist_report(self.ticker_report())
        incoming = parse_kill_blob(
            '<other data="opaque"/>',
            summary={'kill_id': 100, 'victim_character_id': 7},
            identity_map={
                'characters': {7: {'name': 'Victim', 'corporation_id': 203}},
                'corporations': {203: {'name': 'New victim corp', 'ticker': 'BBB'}},
            },
        )
        report, _ = persist_report(incoming)
        report.refresh_from_db()
        self.assertEqual(
            (incoming['victim_corporation_id'], report.victim_corporation_id,
             report.victim_corporation_name, report.victim_corporation_ticker),
            (203, 203, 'New victim corp', 'BBB'),
        )

    def test_confirmed_changed_victim_corporation_without_name_clears_old_name(self):
        from Killboard.parser import parse_kill_blob

        persist_report(self.ticker_report())
        incoming = parse_kill_blob(
            '<other data="opaque"/>',
            summary={'kill_id': 100, 'victim_character_id': 7, 'victim_corporation_id': 203},
            identity_map={'corporations': {203: {'ticker': 'BBB'}}},
        )
        report, _ = persist_report(incoming)
        report.refresh_from_db()
        self.assertEqual(report.victim_corporation_id, 203)
        self.assertEqual(report.victim_corporation_name, '')
        self.assertEqual(report.victim_corporation_ticker, 'BBB')

    def test_changed_corporation_with_missing_ticker_clears_stale_ticker(self):
        persist_report(self.ticker_report())
        incoming = self.ticker_report()
        incoming.update(victim_corporation_id=203, victim_corporation_ticker='')
        incoming['participants'][0].update(corporation_id=204, corporation_ticker='')
        report, _ = persist_report(incoming)
        self.assertEqual(report.victim_corporation_id, 203)
        self.assertEqual(getattr(report, 'victim_corporation_ticker', None), '')
        row = report.participants.get()
        self.assertEqual(row.corporation_id, 204)
        self.assertEqual(getattr(row, 'corporation_ticker', None), '')

    def test_changed_corporation_retains_new_verified_ticker(self):
        persist_report(self.ticker_report())
        incoming = self.ticker_report()
        incoming.update(victim_corporation_id=203, victim_corporation_ticker='NEWV')
        incoming['participants'][0].update(corporation_id=204, corporation_ticker='NEWP')
        report, _ = persist_report(incoming)
        self.assertEqual(getattr(report, 'victim_corporation_ticker', None), 'NEWV')
        self.assertEqual(getattr(report.participants.get(), 'corporation_ticker', None), 'NEWP')

    def test_invalid_ticker_refresh_preserves_same_corp_and_clears_changed_corp(self):
        from Killboard.parser import parse_kill_blob

        for index, ticker in enumerate((123, 'X' * 256)):
            with self.subTest(ticker_type=type(ticker).__name__):
                original = self.ticker_report()
                original['kill_id'] = 130 + index
                persist_report(original)
                for changed in (False, True):
                    victim_corp = 203 if changed else 202
                    participant_corp = 204 if changed else 201
                    incoming = parse_kill_blob(
                        f'<attackers><a c=8 r={participant_corp} d=123/></attackers>',
                        summary={'kill_id': original['kill_id'], 'victim_character_id': 7,
                                 'victim_corporation_id': victim_corp},
                        identity_map={'corporations': {
                            victim_corp: {'name': 'Victim corp', 'ticker': ticker},
                            participant_corp: {'name': 'Participant corp', 'ticker': ticker},
                        }},
                    )
                    report, _ = persist_report(incoming)
                    self.assertEqual(report.victim_corporation_ticker, '' if changed else 'GCG1')
                    self.assertEqual(report.participants.get().corporation_ticker, '' if changed else 'KOFR')

    def test_equal_completeness_base_refresh_preserves_enriched_participant_names(self):
        original = parsed_report(completeness='partial')
        original['participants'][0].update(corporation_id=9, corporation_name='Known corp',
                                           alliance_id=10, alliance_name='Known alliance')
        persist_report(original)
        incoming = parsed_report(completeness='partial')
        incoming['participants'][0].update(character_name='', corporation_id=9,
                                           corporation_name='', alliance_id=None, alliance_name='')
        updated, created = persist_report(incoming)
        participant = updated.participants.get()
        self.assertFalse(created)
        self.assertEqual(participant.character_name, 'Pilot')
        self.assertEqual(participant.corporation_name, 'Known corp')
        self.assertEqual(participant.alliance_id, 10)
        self.assertEqual(participant.alliance_name, 'Known alliance')

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

    @patch("Killboard.services.npc_identity", return_value={"name": "科尔", "identity_kind": "npc"})
    def test_npc_only_report_is_not_persisted(self, npc_identity):
        parsed = parsed_report(kill_id=112)
        parsed["participants"] = [{
            "weapon_type_id": 56000171040,
            "ship_type_id": 56000170001,
            "damage": 123,
            "damage_pct": Decimal("100"),
            "is_final_blow": True,
            "is_top_damage": True,
            "source_index": 0,
        }]
        parsed["participant_count"] = 1

        report, stored = persist_report(parsed, policy=self.policy)

        self.assertIsNone(report)
        self.assertFalse(stored)
        self.assertFalse(KillReport.objects.filter(kill_id=112).exists())
        npc_identity.assert_called_once_with(56000171040)

    @patch("Killboard.services.npc_identity", return_value={"name": "科尔", "identity_kind": "npc"})
    def test_uncertain_or_mixed_report_is_retained(self, npc_identity):
        parsed = parsed_report(kill_id=113)
        parsed["participants"] = [
            {
                "weapon_type_id": 56000171040,
                "ship_type_id": 56000170001,
                "damage": 123,
                "damage_pct": Decimal("50"),
                "source_index": 0,
            },
            {
                "character_id": 8,
                "character_name": "Pilot",
                "corporation_id": 9,
                "corporation_name": "Corp",
                "damage": 123,
                "damage_pct": Decimal("50"),
                "is_final_blow": True,
                "source_index": 1,
            },
        ]
        parsed["participant_count"] = 2

        report, stored = persist_report(parsed, policy=self.policy)

        self.assertTrue(stored)
        self.assertEqual(report.kill_id, 113)
        self.assertEqual(report.participants.count(), 2)
        self.assertEqual(npc_identity.call_count, 1)

    @patch("Killboard.services.npc_identity", return_value={"name": "科尔", "identity_kind": "npc"})
    def test_npc_only_refresh_does_not_replace_existing_report(self, npc_identity):
        existing, _ = persist_report(parsed_report(kill_id=114), policy=self.policy)
        incoming = parsed_report(kill_id=114)
        incoming["participants"] = [{"weapon_type_id": 56000171040, "source_index": 0}]
        incoming["participant_count"] = 1

        report, stored = persist_report(incoming, policy=self.policy)

        self.assertIsNone(report)
        self.assertFalse(stored)
        self.assertEqual(KillReport.objects.get(kill_id=114).pk, existing.pk)
        self.assertEqual(KillReport.objects.get(kill_id=114).participants.count(), 1)

    @patch("Killboard.services.npc_identity", return_value={"name": "科尔", "identity_kind": "npc"})
    def test_parser_npc_summary_is_not_persisted(self, npc_identity):
        from Killboard.parser import parse_kill_blob

        parsed = parse_kill_blob(
            '<other data="opaque" />',
            summary={
                "kill_id": 115,
                "ship_type_id": 56000170001,
                "ship_name": "NPC target",
                "ship_class": "battleship",
                "final_character_id": None,
                "final_ship_type_id": 56000170001,
                "final_weapon_type_id": 56000171040,
                "final_damage_done": 100,
                "isk_lost": "123.45",
            },
        )
        self.assertEqual(len(parsed["participants"]), 1)
        self.assertTrue(parsed["participants"][0]["is_source_summary"])
        self.assertIsNone(parsed["participants"][0]["character_id"])

        report, stored = persist_report(parsed)

        self.assertIsNone(report)
        self.assertFalse(stored)
        self.assertFalse(KillReport.objects.filter(kill_id=115).exists())

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
