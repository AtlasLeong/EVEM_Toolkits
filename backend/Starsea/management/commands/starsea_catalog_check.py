"""Validate the configured ship source with the application's read-only loader."""
import json

from django.core.management.base import BaseCommand, CommandError

from Starsea import catalog


class Command(BaseCommand):
    help = 'Check the private pinned Starsea ship snapshot without database queries or writes.'
    requires_system_checks = []

    def handle(self, *args, **options):
        try:
            ships = catalog._ships()
        except catalog.CatalogUnavailable:
            raise CommandError(
                'Starsea ship catalog unavailable. Verify STARSEA_SHIP_DB is an absolute local '
                'path readable by the service user and matches SWEET 218811 SHA-256/user_version.'
            ) from None
        self.stdout.write(json.dumps({
            'status': 'ok', 'source_version': catalog.SOURCE_VERSION,
            'sha256': catalog.PINNED_SHA256, 'user_version': catalog.PINNED_USER_VERSION,
            'catalog_count': len(ships), 'ship_class_count': len({ship.ship_class for ship in ships}),
        }))
