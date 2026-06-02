import datetime

from django.test import TestCase
from django.utils import timezone

from .models import ActivationCodeExtraScript, LicenseActivationCode, Plan, PlanScript, ScriptProduct
from .services import build_permissions_for_activation


class PermissionCalculationTests(TestCase):
    databases = {'license'}

    def create_script(self, script_id, order):
        return ScriptProduct.objects.create(
            script_id=script_id,
            display_name=script_id,
            is_active=True,
            sort_order=order,
        )

    def create_activation(self, plan):
        return LicenseActivationCode.objects.create(
            code=f'code-{plan.code}',
            plan=plan,
            expires_at=timezone.now() + datetime.timedelta(days=7),
        )

    def test_default_plan_returns_plan_scripts(self):
        script = self.create_script('big_mining', 10)
        plan = Plan.objects.create(code='default', name='默认组')
        PlanScript.objects.create(plan=plan, script=script, sort_order=1)
        activation = self.create_activation(plan)

        permissions = build_permissions_for_activation(activation)

        self.assertEqual(permissions['plan'], 'default')
        self.assertEqual(permissions['scripts'], ['big_mining'])

    def test_extra_scripts_are_added_after_plan_scripts(self):
        plan_script = self.create_script('system_monitor', 10)
        extra_script = self.create_script('big_mining', 20)
        plan = Plan.objects.create(code='default', name='默认组')
        PlanScript.objects.create(plan=plan, script=plan_script, sort_order=1)
        activation = self.create_activation(plan)
        ActivationCodeExtraScript.objects.create(activation_code=activation, script=extra_script, sort_order=1)

        permissions = build_permissions_for_activation(activation)

        self.assertEqual(permissions['scripts'], ['system_monitor', 'big_mining'])

    def test_vip_plan_grants_all_active_scripts(self):
        self.create_script('system_monitor', 10)
        self.create_script('big_mining', 20)
        ScriptProduct.objects.create(
            script_id='inactive',
            display_name='inactive',
            is_active=False,
            sort_order=30,
        )
        plan = Plan.objects.create(code='vip', name='VIP金主组', grant_all_scripts=True)
        activation = self.create_activation(plan)

        permissions = build_permissions_for_activation(activation)

        self.assertTrue(permissions['grant_all_scripts'])
        self.assertEqual(permissions['scripts'], ['system_monitor', 'big_mining'])

