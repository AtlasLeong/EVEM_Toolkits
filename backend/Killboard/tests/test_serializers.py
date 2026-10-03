from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase

from Killboard.serializers import item_payload, participant_payload, report_payload


class KillboardSerializerDisplayTests(SimpleTestCase):
    def test_missing_corporation_ticker_is_an_additive_blank_payload_field(self):
        report = self.time_report('kill_api', None)
        self.assertEqual(report_payload(report).get('victim_corporation_ticker'), '')
        row = SimpleNamespace(
            character_id=None, character_name='', corporation_id=None, corporation_name='',
            alliance_id=None, alliance_name='', damage=None, damage_pct=None,
            is_final_blow=False, is_top_damage=False, ship_type_id=None,
            weapon_type_id=None, camouflaged_faction_id=None,
            feat_score=None, is_source_summary=False,
        )
        self.assertEqual(participant_payload(row).get('corporation_ticker'), '')

    def time_report(self, source, point):
        return SimpleNamespace(
            kill_id=19748417, ship_type_id=None, ship_name='', ship_class_key='',
            ship_class_label='', system_id=None, system_name='', victim_character_id=None,
            victim_name='', victim_corporation_id=None, victim_corporation_name='',
            victim_alliance_id=None, victim_alliance_name='', kill_time_raw='2026-09-30T12:58:02',
            kill_time_display=point, time_quality='provided', isk_lost=None,
            participant_count=None, participant_count_source='unknown', participants_status='missing',
            equipment_status='missing', completeness='partial', source=source,
            victim_damage_taken=None, damage_total_verified=False, final_summary={},
        )

    def test_verified_game_source_naive_time_is_explicit_utc(self):
        for source in ('kill_api', 'kill_api_bootstrap', 'kill_api_latest'):
            with self.subTest(source=source):
                report = self.time_report(source, datetime(2026, 9, 30, 12, 58, 2))
                payload = report_payload(report)
                self.assertEqual(payload['kill_time_display'], '2026-09-30T12:58:02+00:00')
                self.assertEqual(payload['kill_time_raw'], '2026-09-30T12:58:02')

    def test_unknown_source_naive_time_is_not_reinterpreted(self):
        report = self.time_report('collector', datetime(2026, 9, 30, 12, 58, 2))
        self.assertEqual(report_payload(report)['kill_time_display'], '2026-09-30T12:58:02')

    def test_existing_timezone_is_preserved_for_known_game_source(self):
        report = self.time_report('kill_api', datetime(2026, 9, 30, 12, 58, 2, tzinfo=timezone.utc))
        self.assertEqual(report_payload(report)['kill_time_display'], '2026-09-30T12:58:02+00:00')

    def test_anonymous_npc_weapon_identity_is_resolved_from_client_catalog(self):
        row = SimpleNamespace(
            character_id=None, character_name='', corporation_id=None, corporation_name='',
            alliance_id=None, alliance_name='', damage=53084, damage_pct=Decimal('29'),
            is_final_blow=True, is_top_damage=True, ship_type_id=10500000601,
            weapon_type_id=56000171040, camouflaged_faction_id=None,
            feat_score=None, is_source_summary=False,
        )

        payload = participant_payload(row)

        self.assertEqual(payload['display_name'], '科尔')
        self.assertEqual(payload['identity_kind'], 'npc')
        self.assertEqual(payload['npc_source_type_id'], '56000171040')

    def test_named_player_identity_wins_over_npc_weapon_fallback(self):
        row = SimpleNamespace(
            character_id=1001, character_name='真实玩家', corporation_id=2001, corporation_name='玩家军团',
            alliance_id=None, alliance_name='', damage=1, damage_pct=Decimal('1'),
            is_final_blow=False, is_top_damage=False, ship_type_id=10500000601,
            weapon_type_id=56000171040, camouflaged_faction_id=None,
            feat_score=None, is_source_summary=False,
        )

        payload = participant_payload(row)

        self.assertEqual(payload['display_name'], '真实玩家')
        self.assertEqual(payload['identity_kind'], 'character')
        self.assertIsNone(payload['npc_source_type_id'])

    def test_ordinary_weapon_does_not_become_npc(self):
        row = SimpleNamespace(
            character_id=None, character_name='', corporation_id=None, corporation_name='',
            alliance_id=None, alliance_name='', damage=1, damage_pct=Decimal('1'),
            is_final_blow=False, is_top_damage=False, ship_type_id=10500000601,
            weapon_type_id=11004320024, camouflaged_faction_id=None,
            feat_score=None, is_source_summary=False,
        )

        payload = participant_payload(row)

        self.assertNotEqual(payload['identity_kind'], 'npc')
        self.assertIsNone(payload['npc_source_type_id'])

    def test_source_camouflage_is_named_without_inventing_a_character(self):
        row = SimpleNamespace(
            character_id=None, character_name='', corporation_id=None, corporation_name='',
            alliance_id=None, alliance_name='', damage=293464, damage_pct=Decimal('29'),
            is_final_blow=True, is_top_damage=True, ship_type_id=10500000601,
            weapon_type_id=11004320024, camouflaged_faction_id=500019,
            feat_score=Decimal('3141.37'), is_source_summary=True,
        )
        payload = participant_payload(row)
        self.assertEqual(payload['display_name'], '萨沙少尉')
        self.assertEqual(payload['identity_kind'], 'camouflaged')
        self.assertTrue(payload['is_final_blow'])
        self.assertTrue(payload['is_top_damage'])
        self.assertIsNone(payload['character_id'])

    def test_special_client_location_is_used_when_business_security_is_missing(self):
        report = SimpleNamespace(
            kill_id=19748417, ship_type_id=10500000601, ship_name='', ship_class_key='',
            ship_class_label='', system_id=33007327, system_name='', victim_character_id=None,
            victim_name='', victim_corporation_id=None, victim_corporation_name='',
            victim_alliance_id=None, victim_alliance_name='', kill_time_raw='',
            kill_time_display=None, time_quality='unknown', isk_lost=None,
            participant_count=None, participant_count_source='unknown', participants_status='missing',
            equipment_status='missing', completeness='partial', source='collector',
            victim_damage_taken=None, damage_total_verified=False, final_summary={},
        )
        payload = report_payload(report, security=None)
        self.assertEqual(payload['system_name'], 'NI-D1003327')
        self.assertEqual(payload['constellation_name'], 'EI-S1238')
        self.assertEqual(payload['region_name'], 'EI-S11907')
        self.assertEqual(payload['security_label'], '安等未知')

    def test_localized_item_name_wins_over_legacy_wrapper(self):
        row = SimpleNamespace(
            type_id=11302300025, name='{module_affix:皮特丙型} {module:自适应全能力场}',
            slot='27', quantity_dropped=1, quantity_destroyed=0, quantity_unknown=0,
            status='dropped',
        )
        self.assertEqual(item_payload(row)['name'], '皮特丙型 自适应全能力场')
