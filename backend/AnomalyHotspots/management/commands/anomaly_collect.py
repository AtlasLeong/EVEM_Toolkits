"""One authorized, bounded pass; journal only sanitized status and counts."""
import json
import os

from django.conf import settings
from django.core.management import BaseCommand, CommandError
from AnomalyHotspots.collector import collect_once, CollectorError
from AnomalyHotspots.session_bundle import load_session, NeedsAuthError
from AnomalyHotspots.snapshot import write_success, write_failure, STATUSES, SnapshotError


class Command(BaseCommand):
    help = 'Collect one anomaly-statistics snapshot with a preconfigured private session.'
    requires_system_checks = []
    requires_migrations_checks = False

    def handle(self, *args, **options):
        snapshot = getattr(settings, 'ANOMALY_SNAPSHOT_FILE', '')
        if not snapshot: raise CommandError('Anomaly snapshot configuration is unavailable.')
        status, count = 'configuration_error', 0
        try:
            bundle = load_session(os.environ.get('ANOMALY_SESSION_FILE', ''))
            rows = collect_once(bundle)
            write_success(snapshot, rows)
            status, count = 'ok', len(rows)
        except NeedsAuthError:
            status = 'unauthorized'
        except CollectorError as error:
            status = error.reason if error.reason == 'account_busy' else error.code
            if status not in STATUSES: status = 'configuration_error'
        except SnapshotError:
            raise CommandError('Anomaly snapshot publication is unavailable.') from None
        except Exception:
            status = 'configuration_error'
        if status != 'ok':
            try: write_failure(snapshot, status)
            except SnapshotError:
                raise CommandError('Anomaly snapshot publication is unavailable.') from None
        self.stdout.write(json.dumps({'status': status, 'system_count': count}, sort_keys=True))
