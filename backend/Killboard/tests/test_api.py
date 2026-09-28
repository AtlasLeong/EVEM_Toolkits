from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from Killboard.models import KillItem, KillParticipant, KillReport, ShipClass


class KillboardApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        ShipClass.objects.create(key='battleship', label='战列舰', rank=4)
        report = KillReport.objects.create(
            kill_id=19748417,
            ship_type_id=9001,
            ship_name='测试战列舰',
            ship_class_key='battleship',
            ship_class_label='战列舰',
            system_id=30000299,
            system_name='测试星系',
            victim_character_id=42,
            victim_name='目标甲',
            kill_time_raw='2026-08-15T06:43:05',
            isk_lost=Decimal('229307984742.00'),
            participant_count=None,
            participant_count_source='unknown',
            participants_status='provided',
            equipment_status='provided',
            source='test',
        )
        KillParticipant.objects.create(
            report=report, character_id=9, character_name='', damage=100,
            is_final_blow=True, ship_type_id=123, weapon_type_id=456,
        )
        KillItem.objects.create(
            report=report, type_id=100, name='', slot='12',
            quantity_dropped=1, quantity_destroyed=0, quantity_unknown=5,
            status='dropped',
        )

    def test_reports_list_is_public_paginated_and_hides_raw_fields(self):
        response = self.client.get('/api/killboard/reports/?page_size=25')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['kill_id'], '19748417')
        self.assertNotIn('raw_hash', response.data['results'][0])

    def test_detail_prefetches_participants_and_items_with_explicit_status(self):
        response = self.client.get('/api/killboard/reports/19748417/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['participants_status'], 'provided')
        self.assertEqual(response.data['equipment_status'], 'provided')
        self.assertEqual(response.data['participants'][0]['is_final_blow'], True)
        self.assertEqual(response.data['items'][0]['quantity_unknown'], 5)

    def test_filters_validate_and_status_is_explicitly_not_configured(self):
        filters = self.client.get('/api/killboard/filters/')
        self.assertEqual(filters.status_code, 200)
        self.assertEqual(filters.data['ship_classes'][0]['key'], 'battleship')
        status = self.client.get('/api/killboard/status/')
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.data['state'], 'not_configured')
        invalid = self.client.get('/api/killboard/reports/?page_size=1000')
        self.assertEqual(invalid.status_code, 400)

    def test_unknown_report_is_404_and_write_methods_are_not_available(self):
        self.assertEqual(self.client.get('/api/killboard/reports/1/').status_code, 404)
        self.assertEqual(self.client.post('/api/killboard/reports/').status_code, 405)
