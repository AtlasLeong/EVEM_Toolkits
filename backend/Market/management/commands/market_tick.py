import os
from pathlib import Path
import sys

from django.core.management.base import BaseCommand, CommandError

from Market.deploy_guard import CollectorBusy, CollectorUnavailable, collector_guard
from Market.worker import collect_due


def running_backend_matches_current(root=None, *, loaded_backend=None):
    deploy_root = Path(root or os.environ.get('MARKET_DEPLOY_ROOT', '/EVEMTK/deploy'))
    try:
        current = (deploy_root / 'current' / 'backend').resolve(strict=True)
        loaded = Path(loaded_backend or Path(__file__).resolve().parents[3]).resolve(strict=True)
    except (OSError, RuntimeError):
        return False
    return current == loaded


class Command(BaseCommand):
    help = 'Collect a due market price batch in a short-lived game session.'

    def handle(self, *args, **options):
        if sys.platform.startswith('linux') or os.environ.get('MARKET_DEPLOY_ROOT'):
            try:
                with collector_guard():
                    if not running_backend_matches_current():
                        self.stdout.write('stale')
                        return
                    run = collect_due()
            except CollectorBusy:
                self.stdout.write('busy')
                return
            except CollectorUnavailable as exc:
                raise CommandError('market collector deployment lock unavailable') from exc
        else:
            run = collect_due()
        self.stdout.write(run.status if run is not None else 'idle')
