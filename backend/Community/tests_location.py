"""Real-catalog integration tests, using only isolated CI SQLite tables."""
import copy
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import OperationalError, connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Corporation, Revision
from . import views


@override_settings(INSTALLED_APPS=[*settings.INSTALLED_APPS, 'StarFieldSearch'])
class CorporationLocationTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Guard this test utility itself against accidentally running on real data.
        if connection.vendor != 'sqlite' or 'memory' not in str(connection.settings_dict['NAME']):
            raise RuntimeError('Location integration tests require isolated in-memory SQLite.')
        cls.Region = apps.get_model('StarFieldSearch', 'Region')
        cls.Constellation = apps.get_model('StarFieldSearch', 'Constellation')
        cls.Solarsystem = apps.get_model('StarFieldSearch', 'Solarsystem')
        with connection.schema_editor() as editor:
            for model in (cls.Region, cls.Constellation, cls.Solarsystem):
                editor.create_model(model)

    @classmethod
    def tearDownClass(cls):
        try:
            with connection.schema_editor() as editor:
                for model in (cls.Solarsystem, cls.Constellation, cls.Region):
                    editor.delete_model(model)
        finally:
            super().tearDownClass()

    def setUp(self):
        self.Solarsystem.objects.all().delete()
        self.Constellation.objects.all().delete()
        self.Region.objects.all().delete()
        self.Region.objects.create(r_id='r1', r_title='德里克', r_safetylvl='0.50')
        self.Region.objects.create(r_id='r2', r_title='伏尔戈', r_safetylvl='0.59')
        self.Constellation.objects.create(co_id='c1', co_region_id='r1', co_title='艾玛边境', co_safetylvl='0.30')
        self.Constellation.objects.create(co_id='c2', co_region_id='r2', co_title='北境', co_safetylvl='0.70')
        self.Solarsystem.objects.create(ss_id='s1', ss_region_id='r1', ss_constellation_id='c1', ss_title='西卡塔', ss_safetylvl='-0.22')
        self.Solarsystem.objects.create(ss_id='s2', ss_region_id='r2', ss_constellation_id='c2', ss_title='异域', ss_safetylvl='0.90')
        self.Solarsystem.objects.create(ss_id='broken', ss_region_id='r2', ss_constellation_id='c1', ss_title='异常目录', ss_safetylvl='0.10')
        self.owner = get_user_model().objects.create_user('location-owner')
        self.corporation = Corporation.objects.create(name='驻地测试军团', short_name='LOC', name_key='location-test', owner=self.owner)
        self.revision = Revision.objects.create(corporation=self.corporation, author=self.owner, content=views.default_content())
        self.corporation.working_revision = self.revision
        self.corporation.save(update_fields=['working_revision'])
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def edit(self, **content):
        self.revision.refresh_from_db()
        return self.client.patch(f'/api/community/revisions/{self.revision.pk}/',
                                 {'expected_version': self.revision.version, **content}, format='json')

    def location(self):
        return {'region_id': 'r1', 'constellation_id': 'c1', 'solarsystem_id': 's1'}

    def snapshot(self):
        return {**self.location(), 'region_name': '德里克', 'constellation_name': '艾玛边境',
                'solarsystem_name': '西卡塔', 'security': -0.22}

    def store(self, **values):
        self.revision.content.update(values)
        self.revision.save(update_fields=['content'])

    def test_full_location_derives_authoritative_snapshot_and_region(self):
        response = self.edit(base_location=self.location(), base_region='客户端错误名称')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['base_location'], self.snapshot())
        self.assertEqual(response.json()['base_region'], '德里克')
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.content['base_location'], self.snapshot())

    def test_region_and_constellation_only_selections_are_valid(self):
        for selection, constellation_name, security in [
            ({'region_id': 'r1'}, None, 0.5),
            ({'region_id': 'r1', 'constellation_id': 'c1'}, '艾玛边境', 0.3),
        ]:
            response = self.edit(base_location=selection)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()['base_location'], {
                'region_id': 'r1', 'constellation_id': selection.get('constellation_id'), 'solarsystem_id': None,
                'region_name': '德里克', 'constellation_name': constellation_name,
                'solarsystem_name': None, 'security': security,
            })

    def test_missing_ids_and_wrong_parent_relationships_are_rejected(self):
        invalid = [
            {'region_id': 'missing'}, {'region_id': 'r1', 'constellation_id': 'missing'},
            {**self.location(), 'solarsystem_id': 'missing'},
            {'region_id': 'r1', 'constellation_id': 'c2'},
            {**self.location(), 'solarsystem_id': 's2'},
            {**self.location(), 'solarsystem_id': 'broken'},
        ]
        for value in invalid:
            with self.subTest(value=value):
                response = self.edit(base_location=value)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('base_location', response.json())
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.version, 1)

    def test_non_object_missing_parents_and_invalid_id_types_are_rejected(self):
        invalid = [[], '', 1, True, {}, {'constellation_id': 'c1'},
                   {'region_id': 'r1', 'solarsystem_id': 's1'},
                   {'region_id': None}, {'region_id': ''}, {'region_id': ' r1 '},
                   {'region_id': 1}, {'region_id': True}, {'region_id': ['r1']},
                   {'region_id': 'x' * 256}, {'region_id': 'r1', 'constellation_id': ''},
                   {'region_id': 'r1', 'constellation_id': True},
                   {**self.location(), 'solarsystem_id': 1},
                   {**self.location(), 'region_name': '伪造'},
                   {**self.location(), 'security': 1.0},
                   {**self.location(), 'unknown': 'ignored?'}]
        for value in invalid:
            with self.subTest(value=value):
                response = self.edit(base_location=value)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('base_location', response.json())

    def test_clearing_linked_location_clears_only_derived_region(self):
        self.store(base_location=self.snapshot(), base_region='德里克', tagline='保持标语')
        response = self.edit(base_location=None)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(response.json()['base_location'])
        self.assertEqual(response.json()['base_region'], '')
        self.assertEqual(response.json()['tagline'], '保持标语')

    def test_legacy_text_is_preserved_unless_explicitly_replaced(self):
        self.store(base_region='德里克与边境地区')
        response = self.edit(tagline='只改标语')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['base_region'], '德里克与边境地区')
        self.assertIsNone(response.json().get('base_location'))
        response = self.edit(base_location=None)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['base_region'], '德里克与边境地区')
        response = self.edit(base_location={'region_id': 'r2'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['base_region'], '伏尔戈')

    def test_linked_region_cannot_drift_from_authoritative_snapshot(self):
        self.store(base_location=self.snapshot(), base_region='德里克')
        response = self.edit(base_region='错误星域')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['base_region'], '德里克')
        self.assertEqual(response.json()['base_location'], self.snapshot())

    def test_private_public_snapshot_round_trip_and_region_filter(self):
        response = self.edit(base_location=self.location())
        self.assertEqual(response.status_code, 200, response.content)
        snapshot = response.json()['base_location']
        # Clients round-trip only IDs, never server-generated labels/security.
        response = self.edit(base_location={key: snapshot[key] for key in self.location()})
        self.assertEqual(response.status_code, 200, response.content)
        self.revision.refresh_from_db()
        self.revision.status = 'approved'
        self.revision.reviewed_at = timezone.now()
        self.revision.save(update_fields=['status', 'reviewed_at'])
        self.corporation.published_revision = self.revision
        self.corporation.save(update_fields=['published_revision'])
        self.client = APIClient()
        public = self.client.get(f'/api/community/corporations/{self.corporation.pk}/')
        self.assertEqual(public.status_code, 200, public.content)
        self.assertEqual(public.json()['revision']['base_location'], snapshot)
        self.assertEqual(self.client.get('/api/community/corporations/?region=德里克').json()['count'], 1)
        self.assertEqual(self.client.get('/api/community/corporations/?region=伏尔戈').json()['count'], 0)

    def test_read_preserves_historical_snapshot_without_catalog_queries_or_mutation(self):
        self.store(base_location=self.snapshot(), base_region='德里克')
        before = copy.deepcopy(self.revision.content)
        self.Solarsystem.objects.filter(pk='s1').update(ss_title='已更名', ss_safetylvl='0.4')
        with self.assertNumQueries(0):
            payload = views.revision_data(self.revision, public=True)
        self.assertEqual(payload.get('base_location'), self.snapshot())
        self.assertEqual(self.revision.content, before)

    def test_malformed_legacy_location_is_safe_to_read_and_never_mutates(self):
        for value in ([], '', 1, {'region_id': []}, {**self.snapshot(), 'security': float('inf')},
                      {**self.snapshot(), 'security': 10 ** 400}, {**self.snapshot(), 'security': True},
                      {**self.snapshot(), 'constellation_id': None, 'solarsystem_id': 's1'}):
            with self.subTest(value=value):
                legacy = SimpleNamespace(pk=1, content={'base_location': value, 'base_region': '保留旧文字'})
                before = copy.deepcopy(legacy.content)
                payload = views.revision_data(legacy, public=True)
                self.assertIsNone(payload.get('base_location'))
                self.assertEqual(payload['base_region'], '保留旧文字')
                self.assertEqual(legacy.content, before)

    def test_invalid_catalog_security_becomes_null_not_non_json_number(self):
        for value in ('NaN', 'Infinity', 'bad', '', None):
            self.Solarsystem.objects.filter(pk='s1').update(ss_safetylvl=value)
            response = self.edit(base_location=self.location())
            self.assertEqual(response.status_code, 200, response.content)
            self.assertIsNone(response.json()['base_location']['security'])

    def test_missing_catalog_titles_use_english_then_id(self):
        self.Region.objects.filter(pk='r1').update(r_title=None, r_titleen='Derelik')
        self.Constellation.objects.filter(pk='c1').update(co_title='', co_titleen='Border')
        self.Solarsystem.objects.filter(pk='s1').update(ss_title=' ', ss_titleen=None)
        response = self.edit(base_location=self.location())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['base_region'], 'Derelik')
        self.assertEqual(response.json()['base_location'], {
            **self.location(), 'region_name': 'Derelik', 'constellation_name': 'Border',
            'solarsystem_name': 's1', 'security': -0.22,
        })

    def test_catalog_database_failure_is_sanitized_and_preserves_draft(self):
        self.store(base_location=self.snapshot(), base_region='德里克')
        before = copy.deepcopy(self.revision.content)
        with self.assertLogs('Community.views', level='ERROR'), patch.object(
                self.Region.objects, 'filter', side_effect=OperationalError('private sql details')):
            response = self.edit(base_location={'region_id': 'r2'})
        self.assertEqual(response.status_code, 503, response.content)
        self.assertNotIn('private sql details', response.content.decode())
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.content, before)
        self.assertEqual(self.revision.version, 1)

    def test_new_draft_location_does_not_change_approved_snapshot(self):
        self.store(base_location=self.snapshot(), base_region='德里克')
        self.revision.status = 'approved'
        self.revision.reviewed_at = timezone.now()
        self.revision.save(update_fields=['status', 'reviewed_at'])
        self.corporation.published_revision = self.revision
        self.corporation.save(update_fields=['published_revision'])
        approved = copy.deepcopy(self.revision.content)
        response = self.client.post(f'/api/community/corporations/{self.corporation.pk}/draft/',
                                    {'request_id': str(uuid4())}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        new_revision = response.json()
        response = self.client.patch(f"/api/community/revisions/{new_revision['id']}/", {
            'expected_version': new_revision['version'], 'base_location': {'region_id': 'r2'},
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['base_region'], '伏尔戈')
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.content, approved)
        public = APIClient().get(f'/api/community/corporations/{self.corporation.pk}/').json()
        self.assertEqual(public['revision']['base_location'], self.snapshot())
