from django.core.management.base import BaseCommand

from License.catalog import DEFAULT_PLAN_SCRIPT_IDS, SCRIPT_CATALOG
from License.models import Plan, PlanScript, ScriptProduct


class Command(BaseCommand):
    help = '初始化授权系统脚本清单、默认组和 VIP 金主组'

    def add_arguments(self, parser):
        parser.add_argument(
            '--default-script-id',
            action='append',
            dest='default_script_ids',
            help='默认组脚本 ID，可重复传入；不传则使用内置默认组。',
        )

    def handle(self, *args, **options):
        default_script_ids = options.get('default_script_ids') or list(DEFAULT_PLAN_SCRIPT_IDS)

        script_objects = {}
        for script_id, display_name, sort_order in SCRIPT_CATALOG:
            script, _created = ScriptProduct.objects.update_or_create(
                script_id=script_id,
                defaults={
                    'display_name': display_name,
                    'is_active': True,
                    'sort_order': sort_order,
                },
            )
            script_objects[script_id] = script

        default_plan, _created = Plan.objects.update_or_create(
            code='default',
            defaults={
                'name': '默认组',
                'grant_all_scripts': False,
                'is_active': True,
            },
        )
        vip_plan, _created = Plan.objects.update_or_create(
            code='vip',
            defaults={
                'name': 'VIP金主组',
                'grant_all_scripts': True,
                'is_active': True,
            },
        )

        PlanScript.objects.filter(plan=default_plan).delete()
        for index, script_id in enumerate(default_script_ids, start=1):
            script = script_objects.get(script_id)
            if script is None:
                self.stderr.write(self.style.WARNING(f'跳过未知默认脚本: {script_id}'))
                continue
            PlanScript.objects.create(plan=default_plan, script=script, sort_order=index)

        self.stdout.write(self.style.SUCCESS(f'已初始化 {len(script_objects)} 个脚本'))
        self.stdout.write(self.style.SUCCESS(f'默认组脚本: {", ".join(default_script_ids)}'))
        self.stdout.write(self.style.SUCCESS(f'套餐已就绪: {default_plan.code}, {vip_plan.code}'))

