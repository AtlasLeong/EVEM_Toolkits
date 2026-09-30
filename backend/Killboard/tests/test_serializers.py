from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase

from Killboard.serializers import item_payload, participant_payload, report_payload


class KillboardSerializerDisplayTests(SimpleTestCase):
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
