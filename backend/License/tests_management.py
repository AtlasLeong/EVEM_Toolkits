import datetime

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from ActivationCode.models import ActivationCode as LegacyActivationCode

from .models import ActivationCodeExtraScript, LicenseActivationCode, Plan, PlanScript, ScriptProduct


class LicenseManagementApiTests(APITestCase):
    databases = {'default', 'license'}

    def setUp(self):
        user_model = get_user_model()
        self.staff = user_model.objects.create_user(
            username='admin',
            email='admin@example.com',
            password='password',
            is_staff=True,
        )
        self.client.force_authenticate(self.staff)

        self.default_plan = Plan.objects.create(code='default', name='默认组')
        self.vip_plan = Plan.objects.create(code='vip', name='VIP金主组', grant_all_scripts=True)
        self.big_mining = ScriptProduct.objects.create(script_id='big_mining', display_name='大鱼', sort_order=1)
        self.monitor = ScriptProduct.objects.create(script_id='system_monitor', display_name='观察者', sort_order=2)
        PlanScript.objects.create(plan=self.default_plan, script=self.monitor, sort_order=1)

    def test_create_code_with_extra_scripts_returns_permissions(self):
        response = self.client.post(
            reverse('license_code_list'),
            {
                'expiration_days': 30,
                'plan': 'default',
                'remark': '定制客户',
                'extra_script_ids': ['big_mining'],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['plan']['code'], 'default')
        self.assertEqual(response.data['permissions']['scripts'], ['system_monitor', 'big_mining'])

    def test_list_codes_supports_remark_search(self):
        activation = LicenseActivationCode.objects.create(
            code='code-001',
            plan=self.default_plan,
            expires_at=timezone.now() + datetime.timedelta(days=7),
            remark='客户甲',
        )
        ActivationCodeExtraScript.objects.create(activation_code=activation, script=self.big_mining)

        response = self.client.get(reverse('license_code_list'), {'search': '客户'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['code'], 'code-001')

    def test_patch_code_updates_plan_active_state_and_extra_scripts(self):
        activation = LicenseActivationCode.objects.create(
            code='code-002',
            plan=self.default_plan,
            expires_at=timezone.now() + datetime.timedelta(days=7),
        )

        response = self.client.patch(
            reverse('license_code_detail', args=[activation.id]),
            {'plan': 'vip', 'is_active': False, 'extra_script_ids': ['big_mining']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        activation.refresh_from_db()
        self.assertEqual(activation.plan.code, 'vip')
        self.assertFalse(activation.is_active)
        self.assertEqual(list(activation.extra_scripts.values_list('script_id', flat=True)), ['big_mining'])

    def test_unbind_clears_pc_identifier(self):
        activation = LicenseActivationCode.objects.create(
            code='code-003',
            plan=self.default_plan,
            expires_at=timezone.now() + datetime.timedelta(days=7),
            pc_identifier='pc-a',
        )

        response = self.client.post(reverse('license_code_unbind', args=[activation.id]))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        activation.refresh_from_db()
        self.assertIsNone(activation.pc_identifier)

    def test_extend_adds_days_to_current_expiration(self):
        expires_at = timezone.now() + datetime.timedelta(days=7)
        activation = LicenseActivationCode.objects.create(
            code='code-004',
            plan=self.default_plan,
            expires_at=expires_at,
        )

        response = self.client.post(reverse('license_code_extend', args=[activation.id]), {'days': 30}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        activation.refresh_from_db()
        self.assertEqual(activation.expires_at.date(), (expires_at + datetime.timedelta(days=30)).date())


class MigrateLegacyActivationCodesTests(APITestCase):
    databases = {'default', 'license'}

    def setUp(self):
        self.default_plan = Plan.objects.create(code='default', name='默认组')

    def test_migrate_legacy_activation_codes_copies_codes_to_license_database(self):
        LegacyActivationCode.objects.create(
            code='legacy-001',
            is_active=1,
            expires_at=timezone.now() + datetime.timedelta(days=7),
            pc_identifier='pc-a',
            remark='老客户',
        )

        call_command('migrate_legacy_activation_codes')

        migrated = LicenseActivationCode.objects.get(code='legacy-001')
        self.assertEqual(migrated.plan.code, 'default')
        self.assertTrue(migrated.is_active)
        self.assertEqual(migrated.pc_identifier, 'pc-a')
        self.assertEqual(migrated.remark, '老客户')
