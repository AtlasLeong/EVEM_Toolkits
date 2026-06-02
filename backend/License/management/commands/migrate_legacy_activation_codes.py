from django.core.management.base import BaseCommand, CommandError

from ActivationCode.models import ActivationCode as LegacyActivationCode
from License.models import LicenseActivationCode, Plan
from License.services import LICENSE_DB


class Command(BaseCommand):
    help = '把旧 activation_code 表中的激活码迁移到新授权库'

    def add_arguments(self, parser):
        parser.add_argument('--plan', default='default', help='迁移后绑定的套餐 code，默认 default')
        parser.add_argument('--dry-run', action='store_true', help='只统计，不写入')
        parser.add_argument('--update-existing', action='store_true', help='已存在的新授权码也同步更新字段')

    def handle(self, *args, **options):
        plan_code = options['plan']
        try:
            plan = Plan.objects.using(LICENSE_DB).get(code=plan_code, is_active=True)
        except Plan.DoesNotExist as exc:
            raise CommandError(f'套餐不存在或已停用: {plan_code}') from exc

        dry_run = bool(options['dry_run'])
        update_existing = bool(options['update_existing'])
        created = 0
        updated = 0
        skipped = 0

        legacy_codes = (
            LegacyActivationCode.objects.using('default')
            .exclude(code__isnull=True)
            .exclude(code='')
            .order_by('id')
        )

        for legacy in legacy_codes.iterator():
            exists = LicenseActivationCode.objects.using(LICENSE_DB).filter(code=legacy.code).exists()
            if exists and not update_existing:
                skipped += 1
                continue

            defaults = {
                'is_active': bool(legacy.is_active),
                'plan': plan,
                'expires_at': legacy.expires_at,
                'pc_identifier': legacy.pc_identifier,
                'last_used': legacy.last_used,
                'remark': getattr(legacy, 'remark', None),
            }
            if dry_run:
                if exists:
                    updated += 1
                else:
                    created += 1
                continue

            _activation, was_created = LicenseActivationCode.objects.using(LICENSE_DB).update_or_create(
                code=legacy.code,
                defaults=defaults,
            )
            if was_created:
                created += 1
            else:
                updated += 1

        summary = f'迁移完成 created={created}, updated={updated}, skipped={skipped}, dry_run={dry_run}'
        self.stdout.write(self.style.SUCCESS(summary))

