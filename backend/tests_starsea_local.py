import json
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient


@override_settings(ROOT_URLCONF='EVE_MDjango.starsea_local_urls', STARSEA_LOCAL_DEMO=True)
class StarseaLocalLoginTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='local_test', email='test@starsea.local', password='Starsea2026', first_name='测试飞行员')
        self.client = APIClient()

    def test_local_login_returns_session(self):
        response = self.client.post('/api/user/login', {'login_email': self.user.email, 'login_password': 'Starsea2026'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)

    def test_linked_corporation_has_readonly_public_detail_in_local_preview(self):
        from Community.models import Corporation, Revision
        from Community.views import default_content
        corporation = Corporation.objects.create(name='本地关联军团', name_key='local-starsea-linked-corporation', owner=self.user)
        revision = Revision.objects.create(corporation=corporation, author=self.user, status='approved', content=default_content())
        corporation.published_revision = revision
        corporation.save(update_fields=['published_revision'])
        response = self.client.get(f'/api/community/corporations/{corporation.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['name'], corporation.name)
        corporation.is_listed = False
        corporation.save(update_fields=['is_listed'])
        self.assertEqual(self.client.get(f'/api/community/corporations/{corporation.pk}/').status_code, 404)

    def test_local_preview_exposes_corporation_list_and_management_routes(self):
        from django.conf import settings
        from Community.models import Corporation, Revision
        from Community.views import default_content
        corporation = Corporation.objects.create(name='本地可编辑军团', name_key='local-manage-corporation', owner=self.user)
        revision = Revision.objects.create(corporation=corporation, author=self.user, status='approved', content=default_content())
        corporation.published_revision = revision
        corporation.working_revision = revision
        corporation.save(update_fields=['published_revision', 'working_revision'])
        self.assertEqual(self.client.get('/api/community/corporations/').status_code, 200)
        token = self.client.post('/api/user/login', {'login_email': self.user.email, 'login_password': 'Starsea2026'}, format='json').data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(self.client.get(f'/api/community/corporations/{corporation.pk}/manage/').status_code, 200)
        self.assertTrue(settings.COMMUNITY_UPLOAD_ROOT)

    def test_wrong_password_and_scalar_body_never_crash(self):
        response = self.client.post('/api/user/login', {'login_email': self.user.email, 'login_password': 'wrong'}, format='json')
        self.assertEqual(response.status_code, 401)
        for body in [None, [], 1, True, 'text']:
            with self.subTest(body=body):
                response = self.client.generic('POST', '/api/user/login', json.dumps(body), content_type='application/json')
                self.assertEqual(response.status_code, 400)

    @override_settings(STARSEA_LOCAL_DEMO=False)
    def test_local_login_unavailable_outside_explicit_demo_mode(self):
        response = self.client.post('/api/user/login', {'login_email': self.user.email, 'login_password': 'Starsea2026'}, format='json')
        self.assertEqual(response.status_code, 404)
