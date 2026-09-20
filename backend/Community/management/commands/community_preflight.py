from django.core.management.base import BaseCommand, CommandError

from Community.preflight import check_storage_configuration


class Command(BaseCommand):
    help = 'Read-only Community private persistent storage configuration gate.'

    def add_arguments(self, parser):
        parser.add_argument('--forbidden-root', action='append', default=[])

    def handle(self, *args, **options):
        try:
            check_storage_configuration(options['forbidden_root'])
        except Exception:
            raise CommandError('Community storage preflight failed; inspect private persistent storage configuration.') from None
        self.stdout.write('Community storage configuration preflight passed (no write probe).')
